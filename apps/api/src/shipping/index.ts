/**
 * Shipping providers. Haven buys labels on the platform's own Shippo or EasyPost account and charges
 * the label cost back to the seller in the seller ledger, so sellers never handle provider keys.
 *
 * Nothing here pretends to work without credentials: a provider is only offered when its key is set,
 * and without one sellers enter tracking numbers by hand ("manual").
 */

export type ShipAddress = { name: string; company?: string | null; line1: string; line2?: string | null; city: string; region: string; postalCode: string; country: string; phone?: string | null };
/** Inches and ounces, which is what US carriers rate on. */
export type Parcel = { lengthIn: number; widthIn: number; heightIn: number; weightOz: number };
export type Rate = { id: string; carrier: string; service: string; amountCents: number; currency: string; estDays: number | null };
export type Label = { providerRef: string; carrier: string; service: string; trackingNumber: string; trackingUrl: string | null; labelUrl: string; costCents: number };
export type TrackingStatus = "PRE_TRANSIT" | "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED" | "RETURNED" | "FAILURE" | "UNKNOWN";
export type TrackingUpdate = {
  trackingNumber: string;
  carrier: string | null;
  status: TrackingStatus;
  estDeliveryAt: Date | null;
  events: { status: TrackingStatus; description: string | null; location: string | null; occurredAt: Date }[];
};

export class ShippingError extends Error {
  constructor(public provider: string, message: string, public status?: number) {
    super(message);
  }
}

export interface ShippingProvider {
  id: "shippo" | "easypost";
  name: string;
  envVar: string;
  configured(): boolean;
  rates(from: ShipAddress, to: ShipAddress, parcel: Parcel): Promise<{ shipmentRef: string; rates: Rate[] }>;
  buyLabel(shipmentRef: string, rate: Rate): Promise<Label>;
  /** Start tracking a number that was bought elsewhere (manual shipments). Optional. */
  track?(carrier: string, trackingNumber: string): Promise<void>;
  parseWebhook(body: any): TrackingUpdate | null;
}

const cents = (amount: string | number) => Math.round(Number(amount) * 100);
const dt = (s: unknown) => (typeof s === "string" && !Number.isNaN(Date.parse(s)) ? new Date(s) : null);

async function call(provider: string, url: string, init: RequestInit) {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", accept: "application/json", ...(init.headers as any) } });
  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.detail ?? json?.messages?.[0]?.text ?? `HTTP ${res.status}`;
    throw new ShippingError(provider, typeof msg === "string" ? msg : JSON.stringify(msg), res.status);
  }
  return json;
}

// ── Shippo (https://docs.goshippo.com) ──

const SHIPPO_STATUS: Record<string, TrackingStatus> = { PRE_TRANSIT: "PRE_TRANSIT", TRANSIT: "IN_TRANSIT", DELIVERED: "DELIVERED", RETURNED: "RETURNED", FAILURE: "FAILURE", UNKNOWN: "UNKNOWN" };
const shippoAddr = (a: ShipAddress) => ({ name: a.name, company: a.company ?? undefined, street1: a.line1, street2: a.line2 ?? undefined, city: a.city, state: a.region, zip: a.postalCode, country: a.country, phone: a.phone ?? undefined });
const shippoLoc = (l: any) => (l ? [l.city, l.state].filter(Boolean).join(", ") || null : null);

export const shippo: ShippingProvider = {
  id: "shippo",
  name: "Shippo",
  envVar: "SHIPPO_API_KEY",
  configured: () => !!process.env.SHIPPO_API_KEY,
  async rates(from, to, p) {
    const j = await call("shippo", "https://api.goshippo.com/shipments/", {
      method: "POST",
      headers: { authorization: `ShippoToken ${process.env.SHIPPO_API_KEY}` },
      body: JSON.stringify({
        address_from: shippoAddr(from),
        address_to: shippoAddr(to),
        parcels: [{ length: String(p.lengthIn), width: String(p.widthIn), height: String(p.heightIn), distance_unit: "in", weight: String(p.weightOz), mass_unit: "oz" }],
        async: false,
      }),
    });
    return {
      shipmentRef: j.object_id,
      rates: (j.rates ?? []).map((r: any) => ({ id: r.object_id, carrier: r.provider, service: r.servicelevel?.name ?? r.servicelevel?.token ?? "", amountCents: cents(r.amount), currency: r.currency, estDays: r.estimated_days ?? null })),
    };
  },
  async buyLabel(_shipmentRef, rate) {
    const j = await call("shippo", "https://api.goshippo.com/transactions/", {
      method: "POST",
      headers: { authorization: `ShippoToken ${process.env.SHIPPO_API_KEY}` },
      body: JSON.stringify({ rate: rate.id, label_file_type: "PDF_4x6", async: false }),
    });
    if (j.status !== "SUCCESS") throw new ShippingError("shippo", j.messages?.map((m: any) => m.text).join("; ") || `Label status ${j.status}`);
    return { providerRef: j.object_id, carrier: rate.carrier, service: rate.service, trackingNumber: j.tracking_number, trackingUrl: j.tracking_url_provider ?? null, labelUrl: j.label_url, costCents: rate.amountCents };
  },
  async track(carrier, trackingNumber) {
    await call("shippo", "https://api.goshippo.com/tracks/", {
      method: "POST",
      headers: { authorization: `ShippoToken ${process.env.SHIPPO_API_KEY}` },
      body: JSON.stringify({ carrier: carrier.toLowerCase(), tracking_number: trackingNumber }),
    });
  },
  parseWebhook(body) {
    if (body?.event !== "track_updated" || !body.data?.tracking_number) return null;
    const d = body.data;
    const ev = (t: any) => ({ status: SHIPPO_STATUS[t?.status] ?? "UNKNOWN", description: t?.status_details ?? null, location: shippoLoc(t?.location), occurredAt: dt(t?.status_date) ?? new Date() });
    return {
      trackingNumber: d.tracking_number,
      carrier: d.carrier ?? null,
      status: SHIPPO_STATUS[d.tracking_status?.status] ?? "UNKNOWN",
      estDeliveryAt: dt(d.eta),
      events: [...(d.tracking_history ?? []), ...(d.tracking_status ? [d.tracking_status] : [])].map(ev),
    };
  },
};

// ── EasyPost (https://docs.easypost.com) ──

const EP_STATUS: Record<string, TrackingStatus> = {
  pre_transit: "PRE_TRANSIT",
  in_transit: "IN_TRANSIT",
  out_for_delivery: "OUT_FOR_DELIVERY",
  available_for_pickup: "OUT_FOR_DELIVERY",
  delivered: "DELIVERED",
  return_to_sender: "RETURNED",
  failure: "FAILURE",
  error: "FAILURE",
  cancelled: "FAILURE",
  unknown: "UNKNOWN",
};
const epAuth = () => `Basic ${Buffer.from(`${process.env.EASYPOST_API_KEY}:`).toString("base64")}`;
const epAddr = (a: ShipAddress) => ({ name: a.name, company: a.company ?? undefined, street1: a.line1, street2: a.line2 ?? undefined, city: a.city, state: a.region, zip: a.postalCode, country: a.country, phone: a.phone ?? undefined });

export const easypost: ShippingProvider = {
  id: "easypost",
  name: "EasyPost",
  envVar: "EASYPOST_API_KEY",
  configured: () => !!process.env.EASYPOST_API_KEY,
  async rates(from, to, p) {
    const j = await call("easypost", "https://api.easypost.com/v2/shipments", {
      method: "POST",
      headers: { authorization: epAuth() },
      body: JSON.stringify({ shipment: { from_address: epAddr(from), to_address: epAddr(to), parcel: { length: p.lengthIn, width: p.widthIn, height: p.heightIn, weight: p.weightOz } } }),
    });
    return {
      shipmentRef: j.id,
      rates: (j.rates ?? []).map((r: any) => ({ id: r.id, carrier: r.carrier, service: r.service, amountCents: cents(r.rate), currency: r.currency, estDays: r.delivery_days ?? r.est_delivery_days ?? null })),
    };
  },
  async buyLabel(shipmentRef, rate) {
    const j = await call("easypost", `https://api.easypost.com/v2/shipments/${encodeURIComponent(shipmentRef)}/buy`, {
      method: "POST",
      headers: { authorization: epAuth() },
      body: JSON.stringify({ rate: { id: rate.id } }),
    });
    return {
      providerRef: j.id,
      carrier: j.selected_rate?.carrier ?? rate.carrier,
      service: j.selected_rate?.service ?? rate.service,
      trackingNumber: j.tracking_code,
      trackingUrl: j.tracker?.public_url ?? null,
      labelUrl: j.postage_label?.label_url,
      costCents: j.selected_rate?.rate ? cents(j.selected_rate.rate) : rate.amountCents,
    };
  },
  async track(carrier, trackingNumber) {
    await call("easypost", "https://api.easypost.com/v2/trackers", { method: "POST", headers: { authorization: epAuth() }, body: JSON.stringify({ tracker: { tracking_code: trackingNumber, carrier } }) });
  },
  parseWebhook(body) {
    const t = body?.result;
    if (!String(body?.description ?? "").startsWith("tracker.") || t?.object !== "Tracker" || !t.tracking_code) return null;
    return {
      trackingNumber: t.tracking_code,
      carrier: t.carrier ?? null,
      status: EP_STATUS[t.status] ?? "UNKNOWN",
      estDeliveryAt: dt(t.est_delivery_date),
      events: (t.tracking_details ?? []).map((d: any) => ({
        status: EP_STATUS[d.status] ?? "UNKNOWN",
        description: d.message ?? null,
        location: d.tracking_location ? [d.tracking_location.city, d.tracking_location.state].filter(Boolean).join(", ") || null : null,
        occurredAt: dt(d.datetime) ?? new Date(),
      })),
    };
  },
};

export const shippingProviders: Record<string, ShippingProvider> = { shippo, easypost };

/** The provider labels are bought through: SHIPPING_PROVIDER if set, else the first configured one. */
export function activeShippingProvider(): ShippingProvider | null {
  const pick = process.env.SHIPPING_PROVIDER;
  if (pick && shippingProviders[pick]?.configured()) return shippingProviders[pick]!;
  return Object.values(shippingProviders).find((p) => p.configured()) ?? null;
}

/** What a buyer pays for shipping from one seller, from the seller's own rules. */
export function shippingCharge(profile: { flatRateCents: number; perAdditionalItemCents: number; freeOverCents: number | null } | null, subtotalCents: number, itemCount: number) {
  if (!profile) return 0;
  if (profile.freeOverCents != null && subtotalCents >= profile.freeOverCents) return 0;
  return profile.flatRateCents + profile.perAdditionalItemCents * Math.max(0, itemCount - 1);
}

export const gramsToOz = (g: number) => Math.max(1, Math.round((g / 28.3495) * 10) / 10);
