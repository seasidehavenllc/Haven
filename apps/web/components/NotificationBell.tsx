"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useRealtime } from "@/lib/hooks";

/** Unread count from the server, bumped live by `notification:new` over the user's socket room. */
export function NotificationBell() {
  const [count, setCount] = useState(0);
  const path = usePathname();
  useEffect(() => {
    api<{ count: number }>("/notifications/unread-count")
      .then((r) => setCount(r.count))
      .catch(() => {});
  }, [path]);
  useRealtime(null, { "notification:new": () => setCount((c) => c + 1) });
  return (
    <Link href="/notifications" className="btn-ghost relative px-3" aria-label={count ? `Notifications, ${count} unread` : "Notifications"}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {count > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-live px-1 text-[11px] font-bold text-white">{count > 99 ? "99+" : count}</span>}
    </Link>
  );
}
