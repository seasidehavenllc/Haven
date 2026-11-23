"use client";
import Link from "next/link";
import { ModeBadge } from "./ui";

export function StreamCard({ s }: { s: any }) {
  const img = s.products?.[0]?.product?.media?.[0]?.url;
  return (
    <Link href={`/live/${s.id}`} className="group block">
      <div className="relative aspect-[9/14] overflow-hidden rounded-2xl bg-stage">
        {img && <img src={img} alt="" className="h-full w-full object-cover opacity-80 transition group-hover:opacity-100" />}
        <div className="absolute left-2 top-2 flex gap-1">
          {s.status === "LIVE" ? <span className="chip bg-live text-white">Live</span> : <span className="chip bg-paper text-ink">{s.scheduledFor ? new Date(s.scheduledFor).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : "Soon"}</span>}
          <ModeBadge mode={s.mode} />
        </div>
        {s.status === "LIVE" && <span className="chip absolute bottom-2 left-2 bg-black/60 text-white">{s.viewers} watching</span>}
      </div>
      <div className="mt-2 line-clamp-1 text-sm font-medium">{s.title}</div>
      <div className="text-xs text-muted">{s.seller?.businessName}</div>
    </Link>
  );
}
