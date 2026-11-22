"use client";
import Link from "next/link";
import { useApi, useMe, useRealtime } from "@/lib/hooks";
import { Loading, Money } from "@/components/ui";

export default function SellerOverview() {
  const { me } = useMe();
  const orders = useApi<any[]>("/seller/orders");
  const products = useApi<any[]>("/seller/products");
  const billing = useApi<any>("/seller/ai/billing");
  const scans = useApi<any[]>("/seller/scans?status=READY");
  useRealtime(null, { "order:created": () => orders.reload(), "credits:changed": () => billing.reload() });
  if (orders.loading || products.loading) return <Loading />;
  const paid = (orders.data ?? []).filter((o) => !["PENDING_PAYMENT", "CANCELLED"].includes(o.status));
  const real = paid.filter((o) => !o.isTest);
  const revenue = real.reduce((s, o) => s + o.totalCents - o.platformFeeCents, 0);
  const lowStock = (products.data ?? []).flatMap((p) => p.variants.filter((v: any) => v.quantity > 0 && v.quantity <= 2).map((v: any) => ({ p, v })));
  const stat = (label: string, value: React.ReactNode, sub?: string) => (
    <div className="panel p-4">
      <div className="label">{label}</div>
      <div className="font-display text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">Hi, {me?.user.displayName.split(" ")[0]}</h1>
        <div className="flex gap-2">
          <Link href="/seller/scan" className="btn-primary">
            📷 Scan an item
          </Link>
          <Link href="/seller/streams" className="btn-ghost">
            Go live
          </Link>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stat("Net sales", <Money cents={revenue} />, `${real.length} paid orders${paid.length > real.length ? ` · ${paid.length - real.length} test orders excluded` : ""}`)}
        {stat("To ship", paid.filter((o) => o.status === "PAID").length)}
        {stat("Active products", (products.data ?? []).filter((p) => p.status === "ACTIVE").length)}
        {stat("AI credits", billing.data?.balance.total ?? "—", billing.data?.subscription?.plan.name)}
      </div>
      {!!scans.data?.length && (
        <Link href="/seller/scan" className="panel flex items-center justify-between p-4 text-sm">
          <span>
            <b>{scans.data.length}</b> AI drafts waiting for your review
          </span>
          <span className="text-glint">Review →</span>
        </Link>
      )}
      {!!lowStock.length && (
        <div className="panel p-4 text-sm">
          <div className="label">Low stock</div>
          {lowStock.map(({ p, v }) => (
            <div key={v.id}>
              {p.title} — {v.name}: <b>{v.quantity} left</b>
            </div>
          ))}
        </div>
      )}
      <div className="panel p-4">
        <div className="label">Recent orders</div>
        {orders.data?.length ? (
          <ul className="divide-y divide-line text-sm">
            {orders.data.slice(0, 8).map((o) => (
              <li key={o.id} className="flex justify-between py-2">
                <span>
                  {o.items[0]?.titleSnapshot}
                  {o.items.length > 1 && ` +${o.items.length - 1}`} · @{o.buyer.handle}
                </span>
                <span>
                  {o.isTest && <span className="chip mr-2 bg-warn/15 text-warn">Test</span>}
                  <Money cents={o.totalCents} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No orders yet.</p>
        )}
      </div>
    </div>
  );
}
