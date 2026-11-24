"use client";
import Link from "next/link";
import { useState } from "react";
import { api, newKey } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Empty, ErrorNote, Loading, Money } from "@/components/ui";
import { formatMoney } from "@haven/shared";
import { AddressForm, emptyAddress } from "@/components/AddressForm";
import { CardPayment } from "@/components/CardPayment";

export default function CartPage() {
  const { data: cart, loading, error, reload: reloadCart } = useApi<any>("/cart");
  const totals = useApi<any>("/cart/totals");
  const reload = () => (reloadCart(), totals.reload());
  const caps = useApi<any>("/capabilities");
  const [address, setAddress] = useState(emptyAddress);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<any>(null);
  const [done, setDone] = useState<any>(null);
  const [paid, setPaid] = useState(false);
  const [key] = useState(newKey);

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  if (done) {
    const pk = caps.data?.payments.publishableKey as string | null | undefined;
    const due = done.orders.reduce((s: number, o: any) => s + o.totalCents, 0);
    const needsCard = !!done.clientSecret && !paid;
    return (
      <div className="mx-auto max-w-lg space-y-4 text-center">
        <h1 className="font-display text-3xl font-bold">{needsCard ? "Pay for your order" : paid ? "Payment received" : "Order placed"}</h1>
        {done.orders[0]?.isTest && <p className="rounded-xl bg-warn/10 p-2 text-sm text-warn">Test payment: no real money moved. Stripe isn't connected on this server.</p>}
        {needsCard && pk && caps.data?.payments.liveMode === false && <p className="rounded-xl bg-warn/10 p-2 text-sm text-warn">Stripe test mode: use card 4242 4242 4242 4242, any future date and any CVC. No real money moves.</p>}
        {needsCard && pk && (
          <div className="panel p-4">
            <CardPayment publishableKey={pk} clientSecret={done.clientSecret} label={`Pay ${formatMoney(due)}`} onPaid={() => setPaid(true)} />
          </div>
        )}
        {needsCard && !pk && <p className="text-sm text-warn">Card payments aren't switched on yet (the server needs STRIPE_PUBLISHABLE_KEY). Your items are held for a short time.</p>}
        {paid && <p className="text-sm text-muted">Stripe is confirming the payment. Your order shows as paid in a few seconds.</p>}
        {!needsCard && (
          <Link className="btn-primary" href="/orders">
            View orders
          </Link>
        )}
      </div>
    );
  }
  const items = cart?.items ?? [];
  return (
    <div className="grid gap-8 md:grid-cols-[1fr_380px]">
      <section>
        <h1 className="mb-4 font-display text-3xl font-bold">Cart</h1>
        {!items.length ? (
          <Empty title="Your cart is empty">
            <Link href="/" className="underline">
              Keep shopping
            </Link>
          </Empty>
        ) : (
          <div className="divide-y divide-line rounded-2xl border border-line bg-card">
            {items.map((i: any) => (
              <div key={i.id} className="flex items-center gap-3 p-3">
                <div className="h-16 w-16 overflow-hidden rounded-xl bg-line">{i.variant.product.media[0] && <img src={i.variant.product.media[0].url} alt="" className="h-full w-full object-cover" />}</div>
                <div className="flex-1 text-sm">
                  <Link href={`/p/${i.variant.product.id}`} className="font-medium">
                    {i.variant.product.title}
                  </Link>
                  <div className="text-muted">
                    {i.variant.name} · qty {i.quantity}
                    {i.variant.quantity < i.quantity && <span className="ml-1 text-live">only {i.variant.quantity} left</span>}
                  </div>
                </div>
                <div className="text-sm font-semibold">
                  <Money cents={i.variant.priceCents * i.quantity} />
                </div>
                <button className="text-xs text-muted hover:text-live" onClick={() => api(`/cart/items/${i.variantId}`, { method: "DELETE" }).then(reload)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      {!!items.length && (
        <aside className="panel h-fit space-y-4 p-5">
          <h2 className="font-display text-lg font-semibold">Checkout</h2>
          <AddressForm value={address} onChange={setAddress} />
          {totals.data && (
            <div className="space-y-1 border-t border-line pt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Items</span>
                <Money cents={totals.data.subtotalCents} />
              </div>
              {totals.data.sellers.map((s: any) => (
                <div key={s.sellerId}>
                  <div className="flex justify-between">
                    <span className="text-muted">Shipping{totals.data.sellers.length > 1 ? ` from ${s.name}` : ""}</span>
                    {s.shippingCents ? <Money cents={s.shippingCents} /> : <span className="text-ok">Free</span>}
                  </div>
                  {s.freeShippingGapCents > 0 && (
                    <div className="text-xs text-brand-light">
                      Add <Money cents={s.freeShippingGapCents} /> more from {s.name} for free shipping
                    </div>
                  )}
                </div>
              ))}
              <div className="flex justify-between pt-1 text-base font-semibold">
                <span>Total</span>
                <Money cents={totals.data.totalCents} />
              </div>
            </div>
          )}
          {caps.data && !caps.data.payments.provider && <p className="text-xs text-warn">Payments aren't connected on this server yet (needs STRIPE_SECRET_KEY).</p>}
          {caps.data?.payments.provider === "test" && <p className="text-xs text-warn">Test mode: checkout uses a test payment and no money moves.</p>}
          <ErrorNote error={err} />
          <button
            className="btn-primary w-full py-3"
            disabled={busy || !address.line1 || !address.city || !address.postalCode}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                setDone(await api("/checkout", { body: { address, idempotencyKey: key } }));
              } catch (e) {
                setErr(e);
                reload();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Placing order…" : "Place order"}
          </button>
        </aside>
      )}
    </div>
  );
}
