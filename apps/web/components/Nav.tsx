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
  const [menu, setMenu] = useState(false);
  const signOut = async () => {
    setMenu(false);
    await api("/auth/logout", { body: {} }).catch(() => {});
    clearTokens();
    router.push("/");
  };
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
          <Link href="/videos">Videos</Link>
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
                <Link href="/seller" className="btn-primary hidden sm:inline-flex">
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
              <button className="hidden text-muted hover:text-ink sm:block" onClick={signOut}>
                Sign out
              </button>
              {/* Phones: Sell/Admin/Sign out are hidden above, so they live in this menu. */}
              <div className="relative sm:hidden">
                <button
                  className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-line font-bold text-muted"
                  aria-label="Account menu"
                  aria-expanded={menu}
                  onClick={() => setMenu((m) => !m)}
                >
                  {me.user.displayName.slice(0, 1).toUpperCase()}
                </button>
                {menu && (
                  <div className="panel absolute right-0 mt-2 w-52 p-2 shadow-lg" onClick={() => setMenu(false)}>
                    <p className="truncate px-3 py-2 text-xs text-muted">Signed in as {me.user.email}</p>
                    <Link href="/live" className="block rounded px-3 py-2 hover:bg-line">Live</Link>
                    <Link href="/videos" className="block rounded px-3 py-2 hover:bg-line">Videos</Link>
                    <Link href="/auctions" className="block rounded px-3 py-2 hover:bg-line">Auctions</Link>
                    <Link href="/orders" className="block rounded px-3 py-2 hover:bg-line">Orders</Link>
                    <Link href={isSeller ? "/seller" : "/sell"} className="block rounded px-3 py-2 hover:bg-line">{isSeller ? "Studio" : "Sell"}</Link>
                    {isAdmin && <Link href="/admin" className="block rounded px-3 py-2 hover:bg-line">Admin</Link>}
                    <button className="block w-full rounded px-3 py-2 text-left text-muted hover:bg-line" onClick={signOut}>Sign out</button>
                  </div>
                )}
              </div>
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

