"use client";
import Link from "next/link";
import { useApi } from "@/lib/hooks";
import { Empty, Loading, ProductCard, Money } from "@/components/ui";
import { StreamCard } from "@/components/StreamCard";

export default function Home() {
  const streams = useApi<any[]>("/streams");
  const auctions = useApi<any[]>("/auctions");
  const products = useApi<{ items: any[] }>("/products?pageSize=24");
  const live = streams.data?.filter((s) => s.status === "LIVE") ?? [];
  return (
    <div className="space-y-12">
      <section className="grid items-center gap-6 rounded-3xl bg-ink p-8 text-paper md:grid-cols-[1.4fr_1fr] md:p-12">
        <div>
          <h1 className="font-display text-4xl font-bold leading-tight md:text-6xl">
            Shop it live.
            <br />
            <span className="text-glint">Sell it with a photo.</span>
          </h1>
          <p className="mt-4 max-w-lg text-paper/70">Live shows, auctions and real stores in one place. Sellers can go live themselves, with an AI co-host, or let an AI salesperson run the show.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/live" className="btn-primary">
              Watch live
            </Link>
            <Link href="/sell" className="btn rounded-full border border-paper/30">
              Start selling
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          {["Snap a photo", "AI writes the listing", "You confirm the price", "It's in your live menu", "Go live", "Sell"].map((s, i) => (
            <div key={s} className={`rounded-2xl p-3 ${i % 2 ? "bg-paper/10" : "bg-glint/90 text-glint-ink"}`}>
              <div className="font-display text-lg font-bold">{i + 1}</div>
              {s}
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-2xl font-semibold">Live now</h2>
          <Link href="/live" className="text-sm text-muted">
            All shows
          </Link>
        </div>
        {streams.loading ? <Loading /> : live.length ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {live.map((s) => (
              <StreamCard key={s.id} s={s} />
            ))}
          </div>
        ) : (
          <Empty title="Nobody is live right now">Followed sellers will notify you when they go live.</Empty>
        )}
      </section>

      {!!auctions.data?.length && (
        <section>
          <h2 className="mb-3 font-display text-2xl font-semibold">Ending soon</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            {auctions.data.slice(0, 10).map((a) => (
              <Link key={a.id} href={`/auctions/${a.id}`} className="panel block overflow-hidden">
                <div className="aspect-square bg-line">{a.product.media[0] && <img src={a.product.media[0].url} alt="" className="h-full w-full object-cover" />}</div>
                <div className="p-3 text-sm">
                  <div className="line-clamp-1 font-medium">{a.product.title}</div>
                  <div className="font-semibold">
                    <Money cents={a.currentPriceCents ?? a.startingPriceCents} /> <span className="text-xs font-normal text-muted">· {a._count.bids} bids</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 font-display text-2xl font-semibold">Fresh listings</h2>
        {products.loading ? <Loading /> : products.data?.items.length ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {products.data.items.map((p) => (
              <ProductCard key={p.id} p={p} />
            ))}
          </div>
        ) : (
          <Empty title="No listings yet">The marketplace is empty until sellers publish products.</Empty>
        )}
      </section>
    </div>
  );
}

