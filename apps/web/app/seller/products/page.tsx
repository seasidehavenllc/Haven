"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Empty, ErrorNote, Loading, Money } from "@/components/ui";

export default function SellerProducts() {
  const { data, loading, reload } = useApi<any[]>("/seller/products");
  const cats = useApi<any[]>("/categories");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<any>(null);
  const [f, setF] = useState({ title: "", description: "", categoryId: "", price: "", quantity: 1, condition: "NEW" });
  if (loading) return <Loading />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-3xl font-bold">Products</h1>
        <div className="flex gap-2">
          <Link href="/seller/scan" className="btn-primary">
            📷 Scan
          </Link>
          <button className="btn-ghost" onClick={() => setOpen(!open)}>
            Add manually
          </button>
        </div>
      </div>
      {open && (
        <form
          className="panel grid gap-3 p-4 md:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            try {
              await api("/seller/products", {
                body: { title: f.title, description: f.description, categoryId: f.categoryId || undefined, condition: f.condition, variants: [{ name: "Default", priceCents: Math.round(Number(f.price) * 100), quantity: f.quantity }] },
              });
              setOpen(false);
              reload();
            } catch (e) {
              setErr(e);
            }
          }}
        >
          <input className="input md:col-span-2" placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required />
          <textarea className="input md:col-span-2" placeholder="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <select className="input" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
            <option value="">Category</option>
            {cats.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select className="input" value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })}>
            {["NEW", "LIKE_NEW", "GOOD", "FAIR", "POOR", "REFURBISHED"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <input className="input" placeholder="Price ($)" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^0-9.]/g, "") })} required />
          <input className="input" type="number" min={0} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} />
          <ErrorNote error={err} />
          <button className="btn-primary md:col-span-2">Save product</button>
        </form>
      )}
      {!data?.length ? (
        <Empty title="No products yet">Scan an item with your camera to create your first listing in seconds.</Empty>
      ) : (
        <div className="divide-y divide-line rounded-2xl border border-line bg-card">
          {data.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="h-14 w-14 overflow-hidden rounded-xl bg-line">{p.media[0] && <img src={p.media[0].url} alt="" className="h-full w-full object-cover" />}</div>
              <div className="min-w-40 flex-1 text-sm">
                <Link href={`/p/${p.id}`} className="font-medium">
                  {p.title}
                </Link>
                <div className="text-xs text-muted">
                  {p.status.toLowerCase()} {p.liveMenuEnabled && "· in live menu"}
                </div>
              </div>
              {p.variants.map((v: any) => (
                <StockEditor key={v.id} v={v} onSaved={reload} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StockEditor({ v, onSaved }: { v: any; onSaved: () => void }) {
  const [q, setQ] = useState(v.quantity);
  const [saving, setSaving] = useState(false);
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted">{v.name}</span>
      <b>
        <Money cents={v.priceCents} />
      </b>
      <input aria-label="Stock" className="input w-20" type="number" min={0} value={q} onChange={(e) => setQ(Number(e.target.value))} />
      <button
        className="btn-ghost px-3"
        disabled={q === v.quantity || saving}
        onClick={async () => {
          setSaving(true);
          await api(`/seller/variants/${v.id}/inventory`, { method: "PUT", body: { quantity: q } }).finally(() => setSaving(false));
          onSaved();
        }}
      >
        Save
      </button>
    </div>
  );
}
