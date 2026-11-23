"use client";
import Link from "next/link";
import { useApi } from "@/lib/hooks";
import { Countdown } from "@/components/Countdown";
import { Empty, Loading, Money } from "@/components/ui";

export default function Auctions() {
  const { data, loading } = useApi<any[]>("/auctions");
  if (loading) return <Loading />;
  return (
    <div>
      <h1 className="mb-4 font-display text-3xl font-bold">Auctions</h1>
      {data?.length ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {data.map((a) => (
            <Link key={a.id} href={`/auctions/${a.id}`} className="panel block overflow-hidden">
              <div className="aspect-square bg-line">{a.product.media[0] && <img src={a.product.media[0].url} alt="" className="h-full w-full object-cover" />}</div>
              <div className="space-y-1 p-3 text-sm">
                <div className="line-clamp-1 font-medium">{a.product.title}</div>
                <div className="font-display text-lg font-bold">
                  <Money cents={a.currentPriceCents ?? a.startingPriceCents} />
                </div>
                <div className="flex justify-between text-xs text-muted">
                  <span>{a._count.bids} bids</span>
                  <Countdown to={a.endsAt} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Empty title="No auctions running" />
      )}
    </div>
  );
}
