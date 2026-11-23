"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi, useRealtime } from "@/lib/hooks";
import { Empty, ErrorNote, Loading, Money } from "@/components/ui";

export default function SellerOrders() {
  const { data, loading, reload } = useApi<any[]>("/seller/orders");
  useRealtime(null, { "order:created": () => reload() });
  if (loading) return <Loading />;
  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold">Orders</h1>
      {!data?.length && <Empty title="No orders yet">New orders from web, iOS and Android show up here instantly.</Empty>}
      {data?.map((o) => (
        <OrderRow key={o.id} o={o} onChange={reload} />
      ))}
    </div>
  );
}

function OrderRow({ o, onChange }: { o: any; onChange: () => void }) {
  const [carrier, setCarrier] = useState("USPS");
  const [tracking, setTracking] = useState("");
  const [err, setErr] = useState<any>(null);
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
        <b>
          You receive <Money cents={o.totalCents - o.platformFeeCents} />
        </b>
      </div>
      {o.status === "PAID" && (
        <div className="flex flex-wrap gap-2 pt-1">
          <select className="input w-28" value={carrier} onChange={(e) => setCarrier(e.target.value)}>
            {["USPS", "UPS", "FedEx", "DHL"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <input className="input w-56" placeholder="Tracking number" value={tracking} onChange={(e) => setTracking(e.target.value)} />
          <button className="btn-primary" disabled={tracking.length < 4} onClick={() => api(`/seller/orders/${o.id}/ship`, { body: { carrier, trackingNumber: tracking } }).then(onChange).catch(setErr)}>
            Mark shipped
          </button>
          <span className="self-center text-xs text-muted">Label printing needs Shippo or EasyPost keys.</span>
        </div>
      )}
      <ErrorNote error={err} />
    </div>
  );
}
