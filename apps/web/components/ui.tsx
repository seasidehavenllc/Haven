"use client";
import Link from "next/link";
import { formatMoney } from "@haven/shared";
import type { ReactNode } from "react";

export const Money = ({ cents }: { cents: number }) => <>{formatMoney(cents)}</>;

export function minPrice(p: { variants: { priceCents: number }[] }) {
  return p.variants.length ? Math.min(...p.variants.map((v) => v.priceCents)) : 0;
}
export function stock(p: { variants: { quantity: number }[] }) {
  return p.variants.reduce((s, v) => s + v.quantity, 0);
}

export function ProductCard({ p }: { p: any }) {
  const img = p.media?.[0]?.url;
  const qty = stock(p);
  return (
    <Link href={`/p/${p.id}`} className="group block">
      <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-line">
        {img ? <img src={img} alt="" className="h-full w-full object-cover transition group-hover:scale-[1.03]" /> : <div className="grid h-full place-items-center text-xs text-muted">No photo</div>}
        {qty === 0 && <span className="chip absolute left-2 top-2 bg-black/70 text-white">Sold out</span>}
        {qty > 0 && qty <= 3 && <span className="chip absolute left-2 top-2 bg-warn text-white">Only {qty} left</span>}
      </div>
      <div className="mt-2 line-clamp-1 text-sm font-medium">{p.title}</div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">
          <Money cents={minPrice(p)} />
        </span>
        {p.seller?.storefront && <span className="truncate text-xs text-muted">{p.seller.storefront.name}</span>}
      </div>
    </Link>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="panel grid place-items-center gap-2 p-10 text-center">
      <div className="font-display text-lg font-semibold">{title}</div>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: any }) {
  if (!error) return null;
  const d = error.details;
  return (
    <div role="alert" className="rounded-xl border border-live/30 bg-live/10 px-3 py-2 text-sm text-live">
      {error.message}
      {d?.requiredEnv && <div className="mt-1 text-xs opacity-80">Needs server configuration: {d.requiredEnv.join(", ")}</div>}
      {d?.upgrade && (
        <Link className="ml-2 underline" href="/seller/ai">
          See plans
        </Link>
      )}
    </div>
  );
}

export function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" aria-label="Loading" />;
}

export function Loading() {
  return (
    <div className="grid place-items-center py-16">
      <Spinner />
    </div>
  );
}

export function NotConfigured({ what, env }: { what: string; env: string[] }) {
  return (
    <div className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
      <b>{what} isn't connected yet.</b> The server needs: <code className="text-xs">{env.join(", ")}</code>
    </div>
  );
}

export function ModeBadge({ mode }: { mode: string }) {
  if (mode === "AI_HOST") return <span className="chip bg-ai text-white">AI host</span>;
  if (mode === "HUMAN_AI_COHOST") return <span className="chip bg-ai/15 text-ai">Human + AI</span>;
  return <span className="chip bg-line text-ink">Human host</span>;
}
