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
            <div key={s.id} className="mt-2 text-xs">
              Shipped via {s.carrier}: <b>{s.trackingNumber}</b>
            </div>
          ))}
          <div className="mt-2 flex justify-between border-t border-line pt-2">
            <span className="text-muted">{new Date(o.createdAt).toLocaleDateString()}</span>
            <b>
              <Money cents={o.totalCents} />
            </b>
          </div>
        </div>
      ))}
    </div>
  );
}
