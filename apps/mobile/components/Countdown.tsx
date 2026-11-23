import { useEffect, useState } from "react";
import { T } from "./ui";

/** Time left until `to`, corrected by the server's clock offset so every phone shows the same end time. */
export function Countdown({ to, skewMs = 0, size = 15, color }: { to: string; skewMs?: number; size?: number; color?: string }) {
  const [now, setNow] = useState(() => Date.now() + skewMs);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + skewMs), 1000);
    return () => clearInterval(t);
  }, [skewMs]);
  const left = Math.max(0, new Date(to).getTime() - now);
  const sec = Math.floor(left / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const text = left === 0 ? "Ending…" : d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${pad(m)}m` : `${m}:${pad(ss)}`;
  return (
    <T size={size} weight="700" color={color ?? (sec < 60 && left > 0 ? "#ff4d6d" : undefined)}>
      {text}
    </T>
  );
}
