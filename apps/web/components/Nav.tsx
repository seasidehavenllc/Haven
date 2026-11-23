"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMe } from "@/lib/hooks";
import { api, clearTokens } from "@/lib/api";
import { HavenMark } from "./HavenMark";
import { NotificationBell } from "./NotificationBell";

export function Nav() {
  const { me } = useMe();
  const router = useRouter();
  const [q, setQ] = useState("");
  const isSeller = !!me?.seller;
  const isAdmin = me?.user.roles.includes("ADMIN");
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-display text-xl font-bold" aria-label="Haven home">
          <HavenMark size={30} className="text-white" />
          Haven
        </Link>
        <nav className="hidden gap-4 text-sm font-medium md:flex">
          <Link href="/live">Live</Link>
          <Link href="/auctions">Auctions</Link>
          <Link href="/assistant" className="text-ai">
            Ask AI
          </Link>
        </nav>
        <form
          className="ml-auto flex-1 md:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/search?q=${encodeURIComponent(q)}`);
          }}
        >
          <input className="input rounded-full" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        </form>
        <div className="flex items-center gap-2 text-sm">
          {me ? (
            <>
              <NotificationBell />
              <Link href="/cart" className="btn-ghost px-3">
                Cart
              </Link>
              {isSeller ? (
                <Link href="/seller" className="btn-primary">
                  Studio
                </Link>
              ) : (
                <Link href="/sell" className="btn-ghost hidden sm:inline-flex">
                  Sell
                </Link>
              )}
              {isAdmin && (
                <Link href="/admin" className="btn-ghost hidden sm:inline-flex">
                  Admin
                </Link>
              )}
              <button
                className="hidden text-muted hover:text-ink sm:block"
                onClick={async () => {
                  await api("/auth/logout", { body: {} }).catch(() => {});
                  clearTokens();
                  router.push("/");
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="btn-ghost">
                Sign in
              </Link>
              <Link href="/register" className="btn-primary hidden sm:inline-flex">
                Join
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

