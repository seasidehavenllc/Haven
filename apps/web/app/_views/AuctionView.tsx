"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { api, newKey } from "@/lib/api";
import { useApi, useMe, useRealtime } from "@/lib/hooks";
import { Countdown } from "@/components/Countdown";
import { AddressForm, emptyAddress } from "@/components/AddressForm";
import { ErrorNote, Loading, Money } from "@/components/ui";

export default function AuctionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { me } = useMe();
  const { data: a, loading, error, reload, setData } = useApi<any>(`/auctions/${id}`);
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState<any>(null);
  const [address, setAddress] = useState(emptyAddress);
  const [paid, setPaid] = useState<any>(null);

  useRealtime(`auction:${id}`, {
    "auction:bid": (b: any) => {
      setData((d: any) => d && { ...d, currentPriceCents: b.amountCents, endsAt: b.endsAt });
      reload();
    },
    "auction:closed": () => reload(),
  });

  if (loading) return <Loading />;
  if (error || !a) return <ErrorNote error={error} />;
  const skew = new Date(a.serverTime).getTime() - Date.now();
  const min = a.currentPriceCents == null ? a.startingPriceCents : a.currentPriceCents + a.minIncrementCents;
  const leading = a.bids[0];
  const ended = a.status === "ENDED";

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div className="aspect-square overflow-hidden rounded-3xl bg-line">{a.product.media[0] && <img src={a.product.media[0].url} alt="" className="h-full w-full object-cover" />}</div>
      <div className="space-y-4">
        <h1 className="font-display text-3xl font-bold">{a.product.title}</h1>
        <div className="panel grid grid-cols-2 gap-4 p-4">
          <div>
            <div className="label">{a.currentPriceCents == null ? "Starting bid" : "High bid"}</div>
            <div className="font-display text-3xl font-bold">
              <Money cents={a.currentPriceCents ?? a.startingPriceCents} />
            </div>
            {leading && <div className="text-xs text-muted">by @{leading.bidder.handle}</div>}
          </div>
          <div>
            <div className="label">{ended ? "Status" : "Time left"}</div>
            <div className="font-display text-3xl font-bold">{ended ? "Ended" : <Countdown to={a.endsAt} skewMs={skew} />}</div>
            {a.hasReserve && <div className="text-xs text-muted">{a.reserveMet ? "Reserve met" : "Reserve not met"}</div>}
          </div>
        </div>
        {!ended ? (
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setErr(null);
              if (!me) return router.push(`/login?next=/auctions/${id}`);
              const cents = Math.round(Number(amount || min / 100) * 100);
              try {
                await api(`/auctions/${id}/bids`, { body: { amountCents: cents, idempotencyKey: newKey() } });
                setAmount("");
                reload();
              } catch (e) {
                setErr(e);
              }
            }}
          >
            <input className="input" inputMode="decimal" placeholder={`$${(min / 100).toFixed(2)} or more`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
            <button className="btn-primary px-6">Bid</button>
          </form>
        ) : a.winnerId && me?.user.id === a.winnerId ? (
          paid ? (
            <p className="text-ok">Order placed{paid.orders[0]?.isTest ? " (test payment)" : ""}.</p>
          ) : (
            <div className="panel space-y-3 p-4">
              <div className="font-semibold">You won! Complete checkout.</div>
              <AddressForm value={address} onChange={setAddress} />
              <button className="btn-primary w-full" onClick={() => api(`/auctions/${id}/checkout`, { body: { address } }).then(setPaid).catch(setErr)}>
                Pay <Money cents={a.currentPriceCents} />
              </button>
            </div>
          )
        ) : (
          <p className="text-muted">{a.winnerId ? "This auction has a winner." : "Ended without a winning bid."}</p>
        )}
        <ErrorNote error={err} />
        <div>
          <div className="label">Bid history</div>
          <ul className="divide-y divide-line text-sm">
            {a.bids.map((b: any) => (
              <li key={b.id} className="flex justify-between py-2">
                <span>@{b.bidder.handle}</span>
                <span className="font-semibold">
                  <Money cents={b.amountCents} />
                </span>
              </li>
            ))}
            {!a.bids.length && <li className="py-2 text-muted">No bids yet.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
