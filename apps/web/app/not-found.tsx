"use client";
import Link from "next/link";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import ProductView from "./_views/ProductView";
import LiveView from "./_views/LiveView";
import AuctionView from "./_views/AuctionView";
import StoreView from "./_views/StoreView";
import ProfileView from "./_views/ProfileView";
import VideoView from "./_views/VideoView";
import StudioView from "./_views/StudioView";
import SellerLayout from "./seller/layout";

/**
 * On a static host (GitHub Pages) a product, show, auction, store, profile or video that wasn't built
 * ahead of time comes here as the 404 page. It reads the real address and shows the right page, so links
 * from notifications, emails and shares all work. Anything else is a real "not found".
 */
const ROUTES: [RegExp, string, ComponentType<{ params: Promise<any> }>, boolean?][] = [
  [/^\/p\/([^/]+)\/?$/, "id", ProductView],
  [/^\/live\/([^/]+)\/?$/, "id", LiveView],
  [/^\/auctions\/([^/]+)\/?$/, "id", AuctionView],
  [/^\/store\/([^/]+)\/?$/, "slug", StoreView],
  [/^\/u\/([^/]+)\/?$/, "handle", ProfileView],
  [/^\/videos\/([^/]+)\/?$/, "id", VideoView],
  [/^\/seller\/streams\/([^/]+)\/?$/, "id", StudioView, true],
];

// use(params) needs the same promise on every render, so keep one per address.
const paramsCache = new Map<string, Promise<any>>();
const paramsFor = (path: string, value: Record<string, string>) => {
  if (!paramsCache.has(path)) paramsCache.set(path, Promise.resolve(value));
  return paramsCache.get(path)!;
};

export default function NotFound() {
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => setPath(window.location.pathname), []);
  const match = useMemo(() => {
    if (!path) return null;
    for (const [re, key, View, seller] of ROUTES) {
      const m = path.match(re);
      if (m && m[1] !== "_" && m[1] !== "new") return { View, seller, params: paramsFor(path, { [key]: decodeURIComponent(m[1]!) }) };
    }
    return null;
  }, [path]);

  if (!path) return null;
  if (match) {
    const page = <match.View params={match.params} />;
    return match.seller ? <SellerLayout>{page}</SellerLayout> : page;
  }
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="font-display text-3xl font-bold">Page not found</h1>
      <p className="mt-2 text-muted">That link doesn't go anywhere on Haven.</p>
      <Link href="/" className="btn-primary mt-6 inline-flex">
        Back to the shop
      </Link>
    </div>
  );
}
