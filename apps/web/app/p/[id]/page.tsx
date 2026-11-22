"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useApi, useRealtime } from "@/lib/hooks";
import { ErrorNote, Loading, Money, ProductCard } from "@/components/ui";

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, error, loading, setData } = useApi<any>(`/products/${id}`);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [img, setImg] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<any>(null);

  // Live inventory: any change on web, iOS or Android shows up here.
  useRealtime(`product:${id}`, {
    "inventory:changed": (v: { id: string; quantity: number }) =>
      setData((d: any) => d && { ...d, product: { ...d.product, variants: d.product.variants.map((x: any) => (x.id === v.id ? { ...x, quantity: v.quantity } : x)) } }),
  });

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote error={error} />;
  const p = data.product;
  const v = p.variants.find((x: any) => x.id === variantId) ?? p.variants.find((x: any) => x.quantity > 0) ?? p.variants[0];
  const avg = p.reviews.length ? p.reviews.reduce((s: number, r: any) => s + r.rating, 0) / p.reviews.length : null;

  async function addToCart() {
    setErr(null);
    try {
      await api("/cart/items", { body: { variantId: v.id, quantity: 1 } });
      setMsg("Added to cart");
    } catch (e: any) {
      if (e.status === 401) router.push(`/login?next=/p/${id}`);
      else setErr(e);
    }
  }

  return (
    <div className="space-y-12">
      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <div className="aspect-square overflow-hidden rounded-3xl bg-line">{p.media[img] && <img src={p.media[img].url} alt={p.title} className="h-full w-full object-cover" />}</div>
          {p.media.length > 1 && (
            <div className="mt-2 flex gap-2">
              {p.media.map((m: any, i: number) => (
                <button key={m.id} onClick={() => setImg(i)} className={`h-16 w-16 overflow-hidden rounded-xl border-2 ${i === img ? "border-glint" : "border-transparent"}`}>
                  <img src={m.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-5">
          {data.liveNow && (
            <Link href={`/live/${data.liveNow.id}`} className="flex items-center gap-2 rounded-xl bg-live/10 px-3 py-2 text-sm font-semibold text-live">
              <span className="h-2 w-2 animate-pulse rounded-full bg-live" /> Being shown live now: {data.liveNow.title}
            </Link>
          )}
          <div>
            <h1 className="font-display text-3xl font-bold">{p.title}</h1>
            <div className="mt-1 text-sm text-muted">
              {p.brand && <>{p.brand} · </>}
              {p.condition.replace("_", " ").toLowerCase()}
              {avg != null && <> · ★ {avg.toFixed(1)} ({p.reviews.length})</>}
            </div>
          </div>
          <div className="font-display text-3xl font-bold">
            <Money cents={v.priceCents} />
          </div>
          {p.variants.length > 1 && (
            <div>
              <div className="label">Options</div>
              <div className="flex flex-wrap gap-2">
                {p.variants.map((x: any) => (
                  <button key={x.id} disabled={x.quantity === 0} onClick={() => setVariantId(x.id)} className={`btn-ghost ${x.id === v.id ? "border-glint bg-glint/10" : ""} ${x.quantity === 0 ? "line-through" : ""}`}>
                    {x.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="text-sm">{v.quantity === 0 ? <span className="font-semibold text-live">Sold out</span> : v.quantity <= 3 ? <span className="font-semibold text-warn">Only {v.quantity} left</span> : <span className="text-ok">In stock</span>}</div>
          <div className="flex gap-2">
            <button className="btn-primary flex-1 py-3" disabled={v.quantity === 0} onClick={addToCart}>
              Add to cart
            </button>
            <button className="btn-ghost" onClick={() => api(`/wishlist/${p.id}`, { body: {} }).then(() => setMsg("Saved to wishlist")).catch((e) => (e.status === 401 ? router.push("/login") : setErr(e)))}>
              Save
            </button>
          </div>
          {msg && (
            <div className="text-sm text-ok">
              {msg} · <Link href="/cart" className="underline">View cart</Link>
            </div>
          )}
          <ErrorNote error={err} />
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink/80">{p.description}</p>
          {p.seller.storefront && (
            <Link href={`/store/${p.seller.storefront.slug}`} className="panel flex items-center gap-3 p-3">
              <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-line font-bold">{p.seller.storefront.logoUrl ? <img src={p.seller.storefront.logoUrl} alt="" /> : p.seller.storefront.name[0]}</div>
              <div>
                <div className="text-sm font-semibold">{p.seller.storefront.name}</div>
                <div className="text-xs text-muted">Visit store</div>
              </div>
            </Link>
          )}
        </div>
      </div>
      <section>
        <h2 className="mb-3 font-display text-xl font-semibold">Verified reviews</h2>
        {p.reviews.length ? (
          <div className="space-y-3">
            {p.reviews.map((r: any) => (
              <div key={r.id} className="panel p-4 text-sm">
                <div className="font-semibold">{"★".repeat(r.rating)} <span className="font-normal text-muted">by {r.user.displayName}</span></div>
                <p className="mt-1">{r.body}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No reviews yet. Only buyers who purchased this item can review it.</p>
        )}
      </section>
      {!!data.related.length && (
        <section>
          <h2 className="mb-3 font-display text-xl font-semibold">You might also like</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {data.related.map((r: any) => (
              <ProductCard key={r.id} p={r} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
