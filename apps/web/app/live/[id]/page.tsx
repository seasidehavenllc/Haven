"use client";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, newKey } from "@/lib/api";
import { useApi, useMe, useRealtime } from "@/lib/hooks";
import { ErrorNote, Loading, ModeBadge, Money, NotConfigured, minPrice, stock } from "@/components/ui";

export default function LiveViewer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { me } = useMe();
  const { data: s, error, loading, reload, setData } = useApi<any>(`/streams/${id}`);
  const [chat, setChat] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState<any>(null);
  const [bought, setBought] = useState<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (s?.chat) setChat(s.chat);
  }, [s?.id]);
  // Scroll only the chat box, not the whole page (scrollIntoView jumped phones past the video).
  useEffect(() => {
    const box = chatEnd.current?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [chat.length]);

  useRealtime(`stream:${id}`, {
    "stream:chat": (m: any) => setChat((c) => (m.hidden ? c.filter((x) => x.id !== m.id) : [...c.slice(-199), m])),
    "stream:pinned": (p: any) => setData((d: any) => d && { ...d, pinnedProductId: p.productId }),
    "stream:viewers": (p: any) => setData((d: any) => d && { ...d, viewers: p.count }),
    "stream:status": () => reload(),
    "stream:menu": () => reload(),
    "inventory:changed": (v: any) =>
      setData((d: any) => d && { ...d, products: d.products.map((sp: any) => ({ ...sp, product: { ...sp.product, variants: sp.product.variants.map((x: any) => (x.id === v.id ? { ...x, quantity: v.quantity } : x)) } })) }),
  });

  if (loading) return <Loading />;
  if (error || !s) return <ErrorNote error={error} />;
  const pinned = s.products.find((p: any) => p.productId === s.pinnedProductId)?.product;

  async function buy(variantId: string) {
    setErr(null);
    if (!me) return router.push(`/login?next=/live/${id}`);
    try {
      await api("/cart/items", { body: { variantId, quantity: 1 } });
      setBought("Added to cart. Check out without leaving the show.");
    } catch (e) {
      setErr(e);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <section className="space-y-3">
        <div className="relative aspect-video overflow-hidden rounded-3xl border border-line bg-stage text-ink">
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            {s.status === "SCHEDULED" ? (
              <div>
                <div className="font-display text-2xl font-bold">Starts {s.scheduledFor ? new Date(s.scheduledFor).toLocaleString() : "soon"}</div>
              </div>
            ) : s.status === "ENDED" ? (
              <div className="font-display text-2xl font-bold">This show has ended</div>
            ) : s.video.configured ? (
              <div className="text-sm opacity-70">Connecting to live video…</div>
            ) : (
              <div className="max-w-sm text-sm opacity-80">
                Live video isn't connected on this server yet (LiveKit keys needed). Chat, the product menu and purchases below are fully live.
              </div>
            )}
          </div>
          <div className="absolute left-3 top-3 flex gap-2">
            {s.status === "LIVE" && <span className="chip bg-live text-white">Live</span>}
            <ModeBadge mode={s.mode} />
            <span className="chip bg-black/60 text-white">{s.viewers} watching</span>
          </div>
          {s.aiDisclosure && <div className="absolute bottom-3 left-3 right-3 rounded-xl bg-ai/90 px-3 py-2 text-xs font-semibold text-white">🤖 {s.aiDisclosure}</div>}
          {pinned && (
            <div className="absolute bottom-14 right-3 hidden w-60 rounded-2xl bg-card p-3 text-ink shadow-xl sm:block">
              <div className="flex gap-2">
                <div className="h-14 w-14 overflow-hidden rounded-xl bg-line">{pinned.media[0] && <img src={pinned.media[0].url} alt="" className="h-full w-full object-cover" />}</div>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="line-clamp-2 font-medium">{pinned.title}</div>
                  <div className="font-semibold">
                    <Money cents={minPrice(pinned)} />
                  </div>
                </div>
              </div>
              <button className="btn-primary mt-2 w-full" disabled={stock(pinned) === 0} onClick={() => buy(pinned.variants.find((v: any) => v.quantity > 0)?.id)}>
                {stock(pinned) === 0 ? "Sold out" : stock(pinned) <= 3 ? `Buy · ${stock(pinned)} left` : "Buy now"}
              </button>
            </div>
          )}
        </div>
        {pinned && (
          <div className="panel flex items-center gap-3 p-3 sm:hidden">
            <div className="h-14 w-14 flex-none overflow-hidden rounded-xl bg-line">{pinned.media[0] && <img src={pinned.media[0].url} alt="" className="h-full w-full object-cover" />}</div>
            <div className="min-w-0 flex-1 text-sm">
              <div className="line-clamp-1 font-medium">{pinned.title}</div>
              <div className="font-semibold">
                <Money cents={minPrice(pinned)} />
              </div>
            </div>
            <button className="btn-primary" disabled={stock(pinned) === 0} onClick={() => buy(pinned.variants.find((v: any) => v.quantity > 0)?.id)}>
              {stock(pinned) === 0 ? "Sold out" : stock(pinned) <= 3 ? `Buy · ${stock(pinned)} left` : "Buy now"}
            </button>
          </div>
        )}
        <div>
          <h1 className="font-display text-2xl font-bold">{s.title}</h1>
          <Link href={`/store/${s.seller.storefront?.slug}`} className="text-sm text-muted">
            {s.seller.businessName}
          </Link>
        </div>
        {bought && (
          <div className="text-sm text-ok">
            {bought} <Link href="/cart" className="underline">Checkout</Link>
          </div>
        )}
        <ErrorNote error={err} />
        <h2 className="font-display text-lg font-semibold">In this show</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {s.products.map(({ product: p }: any) => (
            <div key={p.id} className={`panel p-2 ${p.id === s.pinnedProductId ? "ring-2 ring-brand" : ""}`}>
              <Link href={`/p/${p.id}`} className="block aspect-square overflow-hidden rounded-xl bg-line">
                {p.media[0] && <img src={p.media[0].url} alt="" className="h-full w-full object-cover" />}
              </Link>
              <div className="mt-1 line-clamp-1 text-sm">{p.title}</div>
              <div className="flex items-center justify-between text-sm font-semibold">
                <Money cents={minPrice(p)} />
                <button className="text-xs text-brand disabled:text-muted" disabled={stock(p) === 0} onClick={() => buy(p.variants.find((v: any) => v.quantity > 0)?.id)}>
                  {stock(p) === 0 ? "Sold out" : "Add"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
      <aside className="panel flex h-[70vh] flex-col lg:sticky lg:top-20">
        <div className="border-b border-line p-3 text-sm font-semibold">Chat</div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
          {chat.map((m) => (
            <div key={m.id} className={m.isAi ? "rounded-xl bg-ai/10 p-2" : ""}>
              <b className={m.isAi ? "text-ai" : ""}>{m.isAi ? "AI assistant" : m.user?.displayName ?? "viewer"}</b> {m.body}
            </div>
          ))}
          {!chat.length && <div className="text-muted">No messages yet.</div>}
          <div ref={chatEnd} />
        </div>
        <form
          className="flex gap-2 border-t border-line p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!me) return router.push(`/login?next=/live/${id}`);
            if (!text.trim()) return;
            try {
              await api(`/streams/${id}/chat`, { body: { body: text } });
              setText("");
            } catch (e) {
              setErr(e);
            }
          }}
        >
          <input className="input" placeholder={s.status === "LIVE" || s.status === "PAUSED" ? "Say something" : "Chat opens when the show starts"} disabled={!["LIVE", "PAUSED"].includes(s.status)} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
          <button className="btn-primary">Send</button>
        </form>
      </aside>
    </div>
  );
}
