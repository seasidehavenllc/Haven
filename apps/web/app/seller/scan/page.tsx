"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { useApi, useRealtime } from "@/lib/hooks";
import { Empty, ErrorNote, Loading, Money, NotConfigured, Spinner } from "@/components/ui";

const CONDITIONS = ["NEW", "LIKE_NEW", "GOOD", "FAIR", "POOR", "REFURBISHED"];

export default function ScanPage() {
  const caps = useApi<any>("/capabilities");
  const cats = useApi<any[]>("/categories");
  const drafts = useApi<any[]>("/seller/scans");
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [barcode, setBarcode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<any>(null);
  const [dupes, setDupes] = useState<Record<string, string>>({});
  useRealtime(null, { "scan:updated": () => drafts.reload() });

  async function upload() {
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.append("mode", mode);
    if (barcode) fd.append("barcode", barcode);
    files.forEach((f) => fd.append("files", f));
    try {
      const r = await api("/seller/scans", { form: fd });
      const d: Record<string, string> = {};
      for (const s of r.scans) if (s.duplicateOf) d[s.id] = s.duplicateOf;
      setDupes(d);
      const denied = r.scans.find((s: any) => s.errorCode);
      if (denied) setErr({ message: denied.error ?? "AI scan was not run", details: denied.errorDetails });
      setFiles([]);
      setBarcode("");
      drafts.reload();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  const pending = (drafts.data ?? []).filter((s) => s.status !== "PUBLISHED");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Scan to sell</h1>
        <p className="text-sm text-muted">Snap the item. AI drafts the listing. You check the details, set the price, and it lands in your live menu.</p>
      </div>
      {caps.data && !caps.data.ai.PRODUCT_SCAN && <NotConfigured what="AI product scanning" env={["ANTHROPIC_API_KEY (or another vision provider in Admin → AI)"]} />}

      <div className="panel space-y-4 p-5">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["single", "One item, several photos"],
              ["batch", "Many items, one photo each"],
            ] as const
          ).map(([v, l]) => (
            <button key={v} onClick={() => setMode(v)} className={`btn-ghost ${mode === v ? "border-brand bg-brand/10" : ""}`}>
              {l}
            </button>
          ))}
        </div>
        <button onClick={() => fileRef.current?.click()} className="grid w-full place-items-center rounded-2xl border-2 border-dashed border-line p-10 text-center hover:border-brand">
          <div className="text-4xl">📷</div>
          <div className="mt-2 font-semibold">{files.length ? `${files.length} photo${files.length > 1 ? "s" : ""} ready` : "Take or choose photos"}</div>
          <div className="text-xs text-muted">{mode === "single" ? "Front, back, labels and any wear. Up to 8." : "Up to 25 items at once."}</div>
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        {!!files.length && (
          <div className="flex gap-2 overflow-x-auto">
            {files.map((f, i) => (
              <img key={i} src={URL.createObjectURL(f)} alt="" className="h-20 w-20 flex-none rounded-xl object-cover" />
            ))}
          </div>
        )}
        {mode === "single" && (
          <div className="max-w-xs">
            <label className="label" htmlFor="bc">Barcode / UPC (optional)</label>
            <input id="bc" className="input" inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 012345678905" />
          </div>
        )}
        <ErrorNote error={err} />
        <button className="btn-primary" disabled={!files.length || busy} onClick={upload}>
          {busy ? (
            <>
              <Spinner /> Analyzing…
            </>
          ) : (
            `Create ${mode === "batch" && files.length > 1 ? `${files.length} listings` : "listing"}`
          )}
        </button>
      </div>

      <h2 className="font-display text-xl font-semibold">Drafts to review</h2>
      {drafts.loading ? <Loading /> : pending.length ? (
        <div className="space-y-4">
          {pending.map((s) => (
            <DraftCard key={s.id} scan={s} cats={cats.data ?? []} duplicateOf={dupes[s.id]} onDone={drafts.reload} />
          ))}
        </div>
      ) : (
        <Empty title="No drafts">Scanned items appear here for you to check before they go live.</Empty>
      )}
    </div>
  );
}

function Conf({ c }: { c?: string }) {
  if (!c) return null;
  const cls = c === "high" ? "bg-ok/15 text-ok" : c === "medium" ? "bg-warn/15 text-warn" : "bg-live/10 text-live";
  return <span className={`chip ${cls}`}>{c === "high" ? "confident" : c === "medium" ? "check this" : "guess, please confirm"}</span>;
}

function DraftCard({ scan, cats, duplicateOf, onDone }: { scan: any; cats: any[]; duplicateOf?: string; onDone: () => void }) {
  const r = scan.result ?? {};
  const d = scan.draft ?? {};
  const [f, setF] = useState({
    title: d.title ?? "",
    description: d.description ?? "",
    categoryId: d.categoryId ?? "",
    brand: d.brand ?? (r.brand?.value || ""),
    model: d.model ?? (r.model?.value || ""),
    condition: d.condition ?? "",
    tags: (d.tags ?? []).join(", "),
    price: r.price?.suggestedCents ? "" : "",
    quantity: d.quantity ?? 1,
    addToLiveMenu: true,
  });
  const [confirmed, setConfirmed] = useState(false);
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  if (scan.status === "ANALYZING" || scan.status === "UPLOADED")
    return (
      <div className="panel flex items-center gap-3 p-4 text-sm">
        <Spinner /> Analyzing photos…
      </div>
    );

  const priceCents = Math.round(Number(f.price) * 100);
  return (
    <div className="panel grid gap-4 p-4 md:grid-cols-[160px_1fr]">
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-1">
          {scan.imageUrls.map((u: string) => (
            <img key={u} src={u} alt="" className="aspect-square w-full rounded-lg object-cover" />
          ))}
        </div>
        {scan.status === "FAILED" && (
          <div className="text-xs text-live">
            AI couldn't analyze this ({scan.error}). You can still fill it in by hand.
          </div>
        )}
        {duplicateOf && <div className="text-xs text-warn">Looks like a photo you've scanned before.</div>}
        {r.ai && <div className="text-[11px] text-muted">Used {r.ai.credits} credits</div>}
      </div>
      <div className="space-y-3">
        {!!r.questionsForSeller?.length && (
          <div className="rounded-xl bg-ai/10 p-3 text-sm">
            <div className="mb-1 font-semibold text-ai">The AI needs you to confirm</div>
            <ul className="list-disc pl-5">
              {r.questionsForSeller.map((q: string) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </div>
        )}
        {r.barcode?.found && (
          <div className="rounded-xl bg-line/60 p-3 text-xs">
            Barcode match: <b>{r.barcode.item.title}</b> {r.barcode.item.brand && `(${r.barcode.item.brand})`}. Make sure this is the exact item you're selling.
          </div>
        )}
        <div>
          <label className="label">Title</label>
          <input className="input" value={f.title} onChange={set("title")} />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input" rows={4} value={f.description} onChange={set("description")} />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div>
            <label className="label">Category</label>
            <select className="input" value={f.categoryId} onChange={set("categoryId")}>
              <option value="">Choose…</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">
              Brand <Conf c={r.brand?.confidence} />
            </label>
            <input className="input" value={f.brand} onChange={set("brand")} placeholder="Leave blank if unknown" />
          </div>
          <div>
            <label className="label">
              Model <Conf c={r.model?.confidence} />
            </label>
            <input className="input" value={f.model} onChange={set("model")} />
          </div>
          <div>
            <label className="label">
              Condition <Conf c={r.condition?.confidence} />
            </label>
            <select className="input" value={f.condition} onChange={set("condition")}>
              <option value="">Choose…</option>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c.replace("_", " ").toLowerCase()}
                </option>
              ))}
            </select>
          </div>
        </div>
        {r.condition?.notes && <div className="text-xs text-muted">AI condition notes: {r.condition.notes}</div>}
        {!!r.attributes?.length && (
          <div className="flex flex-wrap gap-1 text-xs">
            {r.attributes.map((a: any) => (
              <span key={a.name} className="chip bg-line normal-case">
                {a.name}: {a.value} {a.confidence !== "high" && "?"}
              </span>
            ))}
          </div>
        )}
        <div>
          <label className="label">Tags</label>
          <input className="input" value={f.tags} onChange={set("tags")} />
        </div>
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-brand/40 bg-brand/5 p-3 lg:grid-cols-3">
          <div>
            <label className="label">Your price ($)</label>
            <input
              className="input"
              inputMode="decimal"
              value={f.price}
              onChange={(e) => {
                setF({ ...f, price: e.target.value.replace(/[^0-9.]/g, "") });
                setConfirmed(false);
              }}
            />
          </div>
          <div>
            <label className="label">Quantity</label>
            <input className="input" type="number" min={1} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} />
          </div>
          <div className="col-span-2 text-xs lg:col-span-1">
            {r.price ? (
              <>
                <div className="label">Suggested (estimate)</div>
                <Money cents={r.price.lowCents} />–<Money cents={r.price.highCents} />
                <button type="button" className="ml-2 text-brand underline" onClick={() => setF({ ...f, price: (r.price.suggestedCents / 100).toFixed(2) })}>
                  use <Money cents={r.price.suggestedCents} />
                </button>
                <div className="mt-1 text-muted">{r.price.basis}</div>
              </>
            ) : (
              <span className="text-muted">No reliable price data for this item. Set the price yourself.</span>
            )}
          </div>
          <label className="col-span-full flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={confirmed} disabled={!priceCents} onChange={(e) => setConfirmed(e.target.checked)} />I confirm {priceCents ? <Money cents={priceCents} /> : "the price"} is my selling price
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.addToLiveMenu} onChange={(e) => setF({ ...f, addToLiveMenu: e.target.checked })} /> Add to my live shopping menu
        </label>
        <ErrorNote error={err} />
        <div className="flex gap-2">
          <button
            className="btn-primary"
            disabled={busy || !confirmed || !f.title || !f.condition}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await api(`/seller/scans/${scan.id}/publish`, {
                  body: {
                    title: f.title,
                    description: f.description,
                    categoryId: f.categoryId || undefined,
                    brand: f.brand || null,
                    model: f.model || null,
                    condition: f.condition,
                    tags: f.tags.split(",").map((t: string) => t.trim()).filter(Boolean),
                    priceCents,
                    priceConfirmed: true,
                    quantity: f.quantity,
                    addToLiveMenu: f.addToLiveMenu,
                  },
                });
                onDone();
              } catch (e) {
                setErr(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Publish
          </button>
          <button className="btn-ghost" onClick={() => api(`/seller/scans/${scan.id}`, { method: "DELETE" }).then(onDone)}>
            Discard
          </button>
          {scan.status === "FAILED" && (
            <button className="btn-ghost" onClick={() => api(`/seller/scans/${scan.id}/retry`, { body: {} }).then(onDone).catch(setErr)}>
              Retry AI
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
