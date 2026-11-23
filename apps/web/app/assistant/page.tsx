"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { ErrorNote, ProductCard, Spinner } from "@/components/ui";

const examples = ["Find me a good gift under $100", "Which products are being shown live right now?", "Something for a home office", "Sneakers in stock under $80"];

export default function Assistant() {
  const { me } = useMe();
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [turns, setTurns] = useState<{ q: string; a?: string; products?: any[] }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<any>(null);
  async function ask(q: string) {
    if (!me) return router.push("/login?next=/assistant");
    setBusy(true);
    setErr(null);
    setTurns((t) => [...t, { q }]);
    try {
      const r = await api("/assistant", { body: { message: q } });
      setTurns((t) => [...t.slice(0, -1), { q, a: r.reply, products: r.products }]);
    } catch (e) {
      setErr(e);
      setTurns((t) => t.slice(0, -1));
    } finally {
      setBusy(false);
      setMsg("");
    }
  }
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">
          Ask <span className="text-ai">AI</span>
        </h1>
        <p className="text-sm text-muted">Searches real listings, prices and stock on this marketplace. It won't make up products or deals.</p>
      </div>
      {!turns.length && (
        <div className="flex flex-wrap gap-2">
          {examples.map((e) => (
            <button key={e} className="btn-ghost" onClick={() => ask(e)}>
              {e}
            </button>
          ))}
        </div>
      )}
      {turns.map((t, i) => (
        <div key={i} className="space-y-3">
          <div className="ml-auto w-fit max-w-[80%] rounded-2xl bg-brand px-4 py-2 text-sm text-brand-ink">{t.q}</div>
          {t.a ? (
            <div className="space-y-3">
              <div className="w-fit max-w-[90%] rounded-2xl bg-ai/10 px-4 py-2 text-sm">{t.a}</div>
              {!!t.products?.length && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {t.products.map((p) => (
                    <ProductCard key={p.id} p={p} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <Spinner />
          )}
        </div>
      ))}
      <ErrorNote error={err} />
      <form
        className="sticky bottom-4 flex gap-2 rounded-full border border-line bg-card p-2 shadow-lg"
        onSubmit={(e) => {
          e.preventDefault();
          if (msg.trim()) ask(msg.trim());
        }}
      >
        <input className="flex-1 bg-transparent px-3 text-sm outline-none" placeholder="What are you looking for?" value={msg} onChange={(e) => setMsg(e.target.value)} aria-label="Message" />
        <button className="btn-ai" disabled={busy}>
          Ask
        </button>
      </form>
    </div>
  );
}
