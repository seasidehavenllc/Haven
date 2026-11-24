"use client";
import { use, useState } from "react";
import { api } from "@/lib/api";
import { useApi, useMe } from "@/lib/hooks";
import { Empty, ErrorNote, Loading, ProductCard } from "@/components/ui";
import { StreamCard } from "@/components/StreamCard";

export default function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data, error, loading, reload } = useApi<any>(`/stores/${slug}`);
  const { me } = useMe();
  const [following, setFollowing] = useState<boolean | null>(null);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote error={error} />;
  const sf = data.storefront;
  return (
    <div className="space-y-8">
      <div className="overflow-hidden rounded-3xl border border-line">
        <div className="h-40 bg-gradient-to-r from-brand/80 to-ai/70">{sf.bannerUrl && <img src={sf.bannerUrl} alt="" className="h-full w-full object-cover" />}</div>
        <div className="flex flex-wrap items-end gap-4 bg-card p-5">
          <div className="-mt-14 grid h-20 w-20 place-items-center overflow-hidden rounded-2xl border-4 border-card bg-line font-display text-2xl font-bold">{sf.logoUrl ? <img src={sf.logoUrl} alt="" /> : sf.name[0]}</div>
          <div className="flex-1">
            <h1 className="font-display text-2xl font-bold">{sf.name}</h1>
            <div className="text-sm text-muted">
              {data.followers} followers{data.reviews.count ? ` · ★ ${Number(data.reviews.average).toFixed(1)} (${data.reviews.count} reviews)` : ""}
            </div>
          </div>
          {me && me.user.id !== data.owner.id && (
            <button
              className="btn-primary"
              onClick={async () => {
                const r = await api(`/users/${data.owner.id}/follow`, { method: following ? "DELETE" : "POST", body: {} });
                setFollowing(r.following);
                reload();
              }}
            >
              {following ? "Following" : "Follow"}
            </button>
          )}
        </div>
      </div>
      {sf.description && <p className="max-w-2xl text-sm text-ink/80">{sf.description}</p>}
      {!!data.streams.length && (
        <section>
          <h2 className="mb-3 font-display text-xl font-semibold">Shows</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            {data.streams.map((s: any) => (
              <StreamCard key={s.id} s={{ ...s, seller: { businessName: sf.name }, viewers: 0 }} />
            ))}
          </div>
        </section>
      )}
      <section>
        <h2 className="mb-3 font-display text-xl font-semibold">Products</h2>
        {data.products.length ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {data.products.map((p: any) => (
              <ProductCard key={p.id} p={p} />
            ))}
          </div>
        ) : (
          <Empty title="No products yet" />
        )}
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <div className="panel p-4 text-sm">
          <div className="label">Shipping</div>
          {sf.shippingPolicy ?? "The seller hasn't added a shipping policy yet."}
        </div>
        <div className="panel p-4 text-sm">
          <div className="label">Returns</div>
          {sf.returnPolicy ?? "The seller hasn't added a return policy yet."}
        </div>
      </section>
    </div>
  );
}
