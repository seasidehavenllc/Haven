// Records API responses from a running Haven API (seeded with demo data) into a JSON file the static
// demo site serves instead of a backend. Usage: node scripts/demo-snapshot.mjs [apiUrl] [email] [password]
import { cpSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const API = process.argv[2] ?? "http://localhost:4000";
const email = process.argv[3] ?? "jordan@haven.local";
const password = process.argv[4] ?? "demo-password-123";
const login = await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
if (!login.accessToken) throw new Error("Login failed: " + JSON.stringify(login));
const auth = { authorization: `Bearer ${login.accessToken}` };

const out = {};
async function get(path) {
  if (path in out) return out[path];
  const r = await fetch(API + path, { headers: auth });
  if (!r.ok) {
    console.warn("skip", path, r.status);
    return null;
  }
  out[path] = await r.json();
  return out[path];
}

for (const p of ["/me", "/capabilities", "/categories", "/cart", "/cart/totals", "/orders", "/notifications", "/videos/feed?tab=following"]) await get(p);
const streams = (await get("/streams")) ?? [];
const auctions = (await get("/auctions")) ?? [];
const all = await get("/products?pageSize=48");
await get("/products?pageSize=24");
const feed = await get("/videos/feed?tab=foryou");
for (const s of streams) await get(`/streams/${s.id}`);
for (const a of auctions) await get(`/auctions/${a.id}`);
const slugs = new Set();
const handles = new Set();
for (const p of all.items) {
  const d = await get(`/products/${p.id}`);
  if (d?.product?.seller?.storefront?.slug) slugs.add(d.product.seller.storefront.slug);
}
for (const v of feed?.videos ?? []) {
  await get(`/videos/${v.id}`);
  await get(`/videos/${v.id}/comments`);
  handles.add(v.creator.handle);
}
for (const s of slugs) await get(`/stores/${s}`);
for (const h of handles) {
  await get(`/users/${h}`);
  await get(`/users/${h}/videos`);
}

// Point uploaded files at the copy shipped with the site.
const json = JSON.stringify({ snapshotAt: new Date().toISOString(), responses: out }).replaceAll(`${API}/uploads/`, "/demo-uploads/");
const dest = join(here, "../lib/demo-data.json");
writeFileSync(dest, json);
const uploads = join(here, "../../api/uploads");
const pub = join(here, "../public/demo-uploads");
if (existsSync(pub)) rmSync(pub, { recursive: true });
if (existsSync(uploads)) cpSync(uploads, pub, { recursive: true });
console.log(`Saved ${Object.keys(out).length} responses (${Math.round(json.length / 1024)} KB) to ${dest}`);
console.log("ids:", JSON.stringify({ streams: streams.map((s) => s.id), auctions: auctions.map((a) => a.id), products: all.items.map((p) => p.id), stores: [...slugs], videos: (feed?.videos ?? []).map((v) => v.id), users: [...handles] }));
