"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi, useRealtime } from "@/lib/hooks";
import { Empty, ErrorNote, Loading, Money } from "@/components/ui";

export default function SellerOrders() {
  const { data, loading, reload } = useApi<any[]>("/seller/orders");
  const ship = useApi<any>("/seller/shipping");
  useRealtime(null, { "order:created": () => reload() });
  if (loading) return <Loading />;
  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold">Orders</h1>
      {!data?.length && <Empty title="No orders yet">New orders from web, iOS and Android show up here instantly.</Empty>}
      {data?.map((o) => (
        <OrderRow key={o.id} o={o} onChange={reload} labels={ship.data?.labels} />
      ))}
    </div>
  );
}

function OrderRow({ o, onChange, labels }: { o: any; onChange: () => void; labels: any }) {
  const a = o.shippingAddress;
  return (
    <div className="panel space-y-2 p-4 text-sm">
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          <b>#{o.id.slice(-6)}</b> · @{o.buyer.handle} · {new Date(o.createdAt).toLocaleString()}
        </div>
        <div className="flex items-center gap-2">
          {o.isTest && <span className="chip bg-warn/15 text-warn">Test payment</span>}
          {o.streamId && <span className="chip bg-live/10 text-live">From live show</span>}
          <span className="chip bg-line">{o.status.replace("_", " ").toLowerCase()}</span>
        </div>
      </div>
      <ul className="text-muted">
        {o.items.map((i: any) => (
          <li key={i.id}>
            {i.quantity} × {i.titleSnapshot} (<Money cents={i.unitPriceCents} />)
          </li>
        ))}
      </ul>
      <div className="text-xs">
        Ship to {a.name}, {a.line1}
        {a.line2 && `, ${a.line2}`}, {a.city}, {a.region} {a.postalCode}, {a.country}
      </div>
      <div className="flex justify-between border-t border-line pt-2">
        <span className="text-muted">
          Platform fee <Money cents={o.platformFeeCents} />
        </span>
        <span className="text-right">
          {o.shippingCents > 0 && (
            <span className="mr-3 text-muted">
              Shipping paid <Money cents={o.shippingCents} />
            </span>
          )}
          <b>
            You receive <Money cents={o.totalCents - o.platformFeeCents} />
          </b>
        </span>
      </div>
      {o.shipments?.map((sh: any) => (
        <div key={sh.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-line/50 px-3 py-2 text-xs">
          <span className="chip bg-line">{sh.status.replace(/_/g, " ").toLowerCase()}</span>
          <span>
            {sh.carrier} {sh.service} · <b>{sh.trackingNumber}</b>
          </span>
          {sh.labelCostCents != null && (
            <span className="text-muted">
              label <Money cents={sh.labelCostCents} />
            </span>
          )}
          {sh.labelUrl && (
            <a className="btn-primary ml-auto px-3 py-1" href={sh.labelUrl} target="_blank" rel="noreferrer">
              Print label
            </a>
          )}
        </div>
      ))}
      {["PAID", "FULFILLING"].includes(o.status) && <Fulfil o={o} onChange={onChange} labels={labels} />}
    </div>
  );
}

function Fulfil({ o, onChange, labels }: { o: any; onChange: () => void; labels: any }) {
  const [mode, setMode] = useState<"label" | "manual">(labels?.configured ? "label" : "manual");
  const [carrier, setCarrier] = useState("USPS");
  const [tracking, setTracking] = useState("");
  const [weight, setWeight] = useState("");
  const [quote, setQuote] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<any>(null);
  const run = async (key: string, f: () => Promise<any>) => {
    setBusy(key);
    setErr(null);
    try {
      await f();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-2 border-t border-line pt-2">
      <div className="flex gap-1 text-xs">
        <button className={mode === "label" ? "btn-primary px-3 py-1" : "btn-ghost px-3 py-1"} onClick={() => setMode("label")}>
          Buy a label
        </button>
        <button className={mode === "manual" ? "btn-primary px-3 py-1" : "btn-ghost px-3 py-1"} onClick={() => setMode("manual")}>
          I already shipped it
        </button>
      </div>
      {mode === "label" &&
        (!labels?.configured ? (
          <p className="text-xs text-muted">Label printing needs Shippo or EasyPost keys on the server. You can still enter a tracking number.</p>
        ) : !quote ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">
              <span className="mb-1 block text-muted">Weight (oz), blank to use item weights</span>
              <input className="input w-40" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
            <button
              className="btn-primary"
              disabled={!!busy}
              onClick={() => run("rates", async () => setQuote(await api(`/seller/orders/${o.id}/shipping/rates`, { body: weight ? { parcel: { weightOz: Number(weight) } } : {} })))}
            >
              {busy === "rates" ? "Getting rates…" : "Get rates"}
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="text-xs text-muted">
              Buyer paid <Money cents={o.shippingCents} /> shipping. {quote.parcel.weightOz} oz, {quote.parcel.lengthIn}×{quote.parcel.widthIn}×{quote.parcel.heightIn} in.
            </div>
            {quote.rates.map((r: any) => (
              <button
                key={r.id}
                disabled={!!busy}
                className="flex w-full items-center justify-between rounded-xl border border-line px-3 py-2 text-left hover:border-brand"
                onClick={() => run(r.id, async () => (await api(`/seller/orders/${o.id}/shipping/labels`, { body: { quoteId: quote.quoteId, rateId: r.id } }), onChange()))}
              >
                <span>
                  {r.carrier} {r.service}
                  {r.estDays != null && <span className="text-muted"> · {r.estDays} day{r.estDays === 1 ? "" : "s"}</span>}
                </span>
                <b>{busy === r.id ? "Buying…" : <Money cents={r.amountCents} />}</b>
              </button>
            ))}
            <button className="text-xs text-muted underline" onClick={() => setQuote(null)}>
              Change package
            </button>
          </div>
        ))}
      {mode === "manual" && (
        <div className="flex flex-wrap gap-2">
          <select className="input w-28" value={carrier} onChange={(e) => setCarrier(e.target.value)}>
            {["USPS", "UPS", "FedEx", "DHL"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <input className="input w-56" placeholder="Tracking number" value={tracking} onChange={(e) => setTracking(e.target.value)} />
          <button className="btn-primary" disabled={tracking.length < 4 || !!busy} onClick={() => run("ship", async () => (await api(`/seller/orders/${o.id}/ship`, { body: { carrier, trackingNumber: tracking } }), onChange()))}>
            Mark shipped
          </button>
        </div>
      )}
      <ErrorNote error={err} />
    </div>
  );
}
