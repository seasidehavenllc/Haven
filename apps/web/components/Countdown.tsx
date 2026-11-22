"use client";
import { useEffect, useState } from "react";

/** Display-only countdown. The server decides when bidding closes; `skewMs` corrects for clock drift. */
export function Countdown({ to, skewMs = 0 }: { to: string | Date; skewMs?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const ms = new Date(to).getTime() - (now + skewMs);
  if (ms <= 0) return <span className="font-semibold text-live">Ended</span>;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const txt = d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}:${String(sec).padStart(2, "0")}`;
  return <span className={s < 60 ? "font-semibold text-live" : ""}>{txt}</span>;
}
