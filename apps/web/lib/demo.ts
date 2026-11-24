"use client";
/**
 * Demo mode: the site runs with no server, on a snapshot of Haven's sample store (lib/demo-data.json,
 * made by scripts/demo-snapshot.mjs). Browsing works from the snapshot, and the cart, bids, chat, likes
 * and follows change in this browser only. Anything else explains that it needs the live server.
 * Turned on at build time with NEXT_PUBLIC_DEMO=1; production builds never include it.
 */
import snapshot from "./demo-data.json";

export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";
export const DEMO_TOKEN = "demo-session";

type Err = { status: number; code: string; message: string };
const needsServer = (): Err => ({ status: 503, code: "demo", message: "This is a demo with sample data. This part needs Haven's server, which isn't connected yet." });
const notFound = (): Err => ({ status: 404, code: "not_found", message: "Not found in the demo." });

let db: Record<string, any> | null = null;
const STATE_KEY = "haven.demo.state.v1";

/** Shift every timestamp so the sample data stays "now" (auction clocks, chat times) on any day. */
function load() {
  if (db) return db;
  const shift = Date.now() - new Date(snapshot.snapshotAt).getTime();
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
  const walk = (v: any): any => {
    if (typeof v === "string" && iso.test(v)) return new Date(new Date(v).getTime() + shift).toISOString();
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  db = walk(snapshot.responses) as Record<string, any>;
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null");
    if (saved?.cart) db["/cart"] = saved.cart;
  } catch {}
  return db;
}
function persist() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ cart: db!["/cart"] }));
  } catch {}
}

const clone = <T,>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)));
const me = () => load()["/me"];
const allProducts = (): any[] => load()["/products?pageSize=48"]?.items ?? [];
const variantById = (id: string) => {
  for (const p of allProducts()) {
    const v = p.variants.find((x: any) => x.id === id);
    if (v) return { ...v, product: p };
  }
  return null;
};

function cartTotals() {
  const items = load()["/cart"]?.items ?? [];
  const bySeller = new Map<string, any>();
  for (const i of items) {
    const sid = i.variant.product.sellerId;
    const s = bySeller.get(sid) ?? { sellerId: sid, name: i.variant.product.seller?.businessName ?? "Seller", subtotalCents: 0, items: 0, shippingCents: 0, freeShippingGapCents: null, totalCents: 0 };
    s.subtotalCents += i.variant.priceCents * i.quantity;
    s.items += i.quantity;
    s.totalCents = s.subtotalCents;
    bySeller.set(sid, s);
  }
  const sellers = [...bySeller.values()];
  const sub = sellers.reduce((n, s) => n + s.subtotalCents, 0);
  return { sellers, subtotalCents: sub, shippingCents: 0, totalCents: sub };
}

function products(qs: URLSearchParams) {
  const q = (qs.get("q") ?? "").toLowerCase();
  const cat = qs.get("category");
  const store = qs.get("store");
  const max = qs.get("maxPrice") ? Number(qs.get("maxPrice")) : null;
  const min = (p: any) => Math.min(...p.variants.map((v: any) => v.priceCents));
  let items = allProducts().filter(
    (p) =>
      (!q || `${p.title} ${p.description} ${p.brand ?? ""} ${(p.tags ?? []).join(" ")}`.toLowerCase().includes(q)) &&
      (!cat || p.category?.slug === cat) &&
      (!store || p.seller?.storefront?.slug === store) &&
      (qs.get("inStock") !== "true" || p.variants.some((v: any) => v.quantity > 0)) &&
      (max == null || min(p) <= max),
  );
  const sort = qs.get("sort");
  if (sort === "price_asc") items = [...items].sort((a, b) => min(a) - min(b));
  if (sort === "price_desc") items = [...items].sort((a, b) => min(b) - min(a));
  const size = Number(qs.get("pageSize") ?? 24);
  return { total: items.length, page: 1, pageSize: size, items: items.slice(0, size) };
}

/** Answers an API call from the snapshot. Throws an Err shape that api() turns into an ApiError. */
export async function demoApi(path: string, init: { method?: string; body?: any }): Promise<any> {
  const d = load();
  const method = (init.method ?? (init.body !== undefined ? "POST" : "GET")).toUpperCase();
  const [base, query = ""] = path.split("?");
  const qs = new URLSearchParams(query);
  const body = init.body ?? {};
  await new Promise((r) => setTimeout(r, 120)); // feel like a network call

  if (method === "GET") {
    if (path in d) return clone(d[path]);
    if (base === "/products") return products(qs);
    if (base === "/notifications") return qs.get("before") ? [] : clone(d["/notifications"]);
    if (base === "/videos/feed") return clone(d[qs.get("tab") === "following" ? "/videos/feed?tab=following" : "/videos/feed?tab=foryou"]);
    if (base === "/cart/totals") return cartTotals();
    if (base === "/streams" || base === "/auctions") return [];
    if (/^\/(products|streams|auctions|stores|videos|users)\//.test(base)) throw notFound();
    throw needsServer();
  }

  // Signing in, registering and social sign-in all land in the sample shopper's account.
  if (/^\/auth\/(login|register|google|apple)$/.test(base)) return { accessToken: DEMO_TOKEN, refreshToken: DEMO_TOKEN, user: me().user, created: false };
  if (base === "/auth/logout") return { ok: true };

  if (base === "/cart/items" && method === "POST") {
    const v = variantById(body.variantId);
    if (!v) throw notFound();
    const cart = d["/cart"];
    const line = cart.items.find((i: any) => i.variantId === v.id);
    const qty = (line?.quantity ?? 0) + (body.quantity ?? 1);
    if (qty > v.quantity) throw { status: 409, code: "insufficient_stock", message: `Only ${v.quantity} left` } as Err;
    if (line) line.quantity = qty;
    else cart.items.push({ id: `demo-${v.id}`, variantId: v.id, quantity: qty, variant: v });
    persist();
    return clone(cart);
  }
  const rm = base.match(/^\/cart\/items\/(.+)$/);
  if (rm && method === "DELETE") {
    d["/cart"].items = d["/cart"].items.filter((i: any) => i.variantId !== rm[1]);
    persist();
    return clone(d["/cart"]);
  }
  if (base === "/checkout") {
    const t = cartTotals();
    if (!t.sellers.length) throw { status: 400, code: "empty_cart", message: "Your cart is empty" } as Err;
    d["/cart"].items = [];
    persist();
    return { orders: t.sellers.map((s, i) => ({ id: `demo-order-${Date.now()}-${i}`, isTest: true, totalCents: s.totalCents })), demo: true };
  }

  const bid = base.match(/^\/auctions\/([^/]+)\/bids$/);
  if (bid) {
    const a = d[`/auctions/${bid[1]}`];
    if (!a || a.status !== "LIVE") throw { status: 409, code: "auction_closed", message: "This auction isn't open for bids" } as Err;
    const min = a.currentPriceCents == null ? a.startingPriceCents : a.currentPriceCents + a.minIncrementCents;
    if (body.amountCents < min) throw { status: 409, code: "bid_too_low", message: `Bid at least $${(min / 100).toFixed(2)}` } as Err;
    const b = { id: `demo-bid-${Date.now()}`, auctionId: a.id, bidderId: me().user.id, amountCents: body.amountCents, createdAt: new Date().toISOString(), bidder: { handle: me().user.handle } };
    a.bids = [b, ...a.bids];
    a.currentPriceCents = body.amountCents;
    const row = d["/auctions"]?.find((x: any) => x.id === a.id);
    if (row) {
      row.currentPriceCents = body.amountCents;
      row._count = { bids: (row._count?.bids ?? 0) + 1 };
    }
    return { bid: b, auction: clone(a) };
  }

  const chat = base.match(/^\/streams\/([^/]+)\/chat$/);
  if (chat) {
    const s = d[`/streams/${chat[1]}`];
    if (!s) throw notFound();
    const m = { id: `demo-msg-${Date.now()}`, streamId: s.id, body: String(body.body ?? "").slice(0, 500), isAi: false, createdAt: new Date().toISOString(), user: { handle: me().user.handle, displayName: me().user.displayName } };
    s.chat = [...s.chat, m];
    // The page shows its own message from the realtime echo, which the demo sends right away.
    demoEmit(`stream:${s.id}`, "stream:chat", m);
    return m;
  }

  const like = base.match(/^\/videos\/([^/]+)\/like$/);
  if (like) {
    const v = d[`/videos/${like[1]}`];
    if (!v) throw notFound();
    const on = method === "POST";
    if (v.likedByMe !== on) v.likeCount += on ? 1 : -1;
    v.likedByMe = on;
    for (const k of ["/videos/feed?tab=foryou", "/videos/feed?tab=following"]) {
      const f = d[k]?.videos?.find((x: any) => x.id === v.id);
      if (f) Object.assign(f, { likeCount: v.likeCount, likedByMe: on });
    }
    return { liked: on, likeCount: v.likeCount };
  }
  if (/^\/videos\/[^/]+\/view$/.test(base)) return { counted: false };
  if (/^\/users\/[^/]+\/follow$/.test(base)) return { following: method === "POST" };
  if (/^\/wishlist\//.test(base)) return { ok: true };

  throw needsServer();
}

// A tiny stand-in for the realtime socket, so demo actions show up the same way live ones do.
type Fn = (p: any) => void;
const listeners = new Map<string, Set<Fn>>();
const joined = new Set<string>();
export function demoOn(event: string, fn: Fn) {
  (listeners.get(event) ?? listeners.set(event, new Set()).get(event)!).add(fn);
  return () => void listeners.get(event)?.delete(fn);
}
export const demoJoin = (room: string) => (joined.add(room), () => void joined.delete(room));
function demoEmit(room: string, event: string, payload: any) {
  if (!joined.has(room)) return;
  setTimeout(() => listeners.get(event)?.forEach((f) => f(payload)), 0);
}
