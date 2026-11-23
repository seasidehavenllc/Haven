"use client";
import { useApi } from "@/lib/hooks";
import { Empty, ErrorNote, Loading, Money } from "@/components/ui";

export default function Orders() {
  const { data, loading, error } = useApi<any[]>("/orders");
  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="font-display text-3xl font-bold">Your orders</h1>
      {!data?.length && <Empty title="No orders yet" />}
      {data?.map((o) => (
        <div key={o.id} className="panel p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">{o.seller.businessName}</div>
            <div className="flex items-center gap-2">
              {o.isTest && <span className="chip bg-warn/15 text-warn">Test</span>}
              <span className="chip bg-line">{o.status.replace("_", " ").toLowerCase()}</span>
            </div>
          </div>
          <ul className="mt-2 text-muted">
            {o.items.map((i: any) => (
              <li key={i.id}>
                {i.quantity} × {i.titleSnapshot}
              </li>
            ))}
          </ul>
          {o.shipments.map((s: any) => (
            <div key={s.id} className="mt-3 space-y-1 rounded-xl bg-line/40 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip bg-line">{s.status.replace(/_/g, " ").toLowerCase()}</span>
                <span>
                  {s.carrier} {s.service}{" "}
                  {s.trackingUrl ? (
                    <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="font-semibold underline">
                      {s.trackingNumber}
                    </a>
                  ) : (
                    <b>{s.trackingNumber}</b>
                  )}
                </span>
                {s.estDeliveryAt && !s.deliveredAt && <span className="text-muted">Expected {new Date(s.estDeliveryAt).toLocaleDateString()}</span>}
              </div>
              {s.events?.slice(0, 4).map((e: any) => (
                <div key={e.id} className="text-muted">
                  {new Date(e.occurredAt).toLocaleString()} · {e.description ?? e.status.toLowerCase()}
                  {e.location ? ` · ${e.location}` : ""}
                </div>
              ))}
            </div>
          ))}
          <div className="mt-2 flex justify-between border-t border-line pt-2">
            <span className="text-muted">{new Date(o.createdAt).toLocaleDateString()}</span>
            <span>
              {o.shippingCents > 0 && (
                <span className="mr-2 text-xs text-muted">
                  incl. <Money cents={o.shippingCents} /> shipping
                </span>
              )}
              <b>
                <Money cents={o.totalCents} />
              </b>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
