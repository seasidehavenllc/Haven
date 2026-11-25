import { describe, expect, it } from "vitest";
import { buyer, client, seller } from "./helpers";

async function liveShow() {
  const s = await seller();
  const p = await s.call("POST", "/seller/products", { title: "Red flannel shirt", brand: "Acme", description: "Soft and warm", tags: ["flannel"], variants: [{ name: "Large", priceCents: 1800, quantity: 2 }] });
  const st = await s.call("POST", "/seller/streams", { title: "Flannel Friday", mode: "HUMAN", productIds: [p.json.id] });
  await s.call("POST", `/seller/streams/${st.json.id}/start`);
  return { s, p: p.json, id: st.json.id as string, handle: `u_${s.tag}` };
}

describe("live chat replies", () => {
  it("quotes the message a viewer replies to, and only from the same show", async () => {
    const { id } = await liveShow();
    const a = await buyer();
    const b = await buyer();
    const first = await a.call("POST", `/streams/${id}/chat`, { body: "What size is it?" });
    const reply = await b.call("POST", `/streams/${id}/chat`, { body: "Looks like a large", replyToId: first.json.id });
    expect(reply.status).toBe(200);
    expect(reply.json.replyTo.body).toBe("What size is it?");
    expect(reply.json.replyTo.user.displayName).toBe(`User ${a.tag}`);
    const view = await (await client())("GET", `/streams/${id}`);
    expect(view.json.chat.find((m: any) => m.id === reply.json.id).replyTo.id).toBe(first.json.id);

    const other = await liveShow();
    expect((await b.call("POST", `/streams/${other.id}/chat`, { body: "hi", replyToId: first.json.id })).status).toBe(400);
  });

  it("drops the quote when the host hides the original message", async () => {
    const { s, id } = await liveShow();
    const a = await buyer();
    const first = await a.call("POST", `/streams/${id}/chat`, { body: "rude thing" });
    const reply = await s.call("POST", `/streams/${id}/chat`, { body: "Please be kind", replyToId: first.json.id });
    await s.call("POST", `/seller/streams/${id}/chat/${first.json.id}/hide`);
    const view = await (await client())("GET", `/streams/${id}`);
    expect(view.json.chat.find((m: any) => m.id === reply.json.id).replyTo).toBeNull();
  });
});

describe("live feed data", () => {
  it("lists live shows with the host's profile and item count, and says if you follow the host", async () => {
    const { s, id } = await liveShow();
    const list = await (await client())("GET", "/streams");
    const row = list.json.find((x: any) => x.id === id);
    expect(row.seller.user.handle).toBe(`u_${s.tag}`);
    expect(row._count.products).toBe(1);
    const b = await buyer();
    expect((await b.call("GET", `/streams/${id}`)).json.followingHost).toBe(false);
    await b.call("POST", `/users/${s.userId}/follow`);
    expect((await b.call("GET", `/streams/${id}`)).json.followingHost).toBe(true);
  });
});

describe("profiles with a shop", () => {
  it("shows a seller's shop stats, live show and upcoming shows", async () => {
    const { s, id, handle } = await liveShow();
    await s.call("POST", "/seller/streams", { title: "Sunday sale", mode: "HUMAN", scheduledFor: new Date(Date.now() + 86400000).toISOString() });
    const p = await (await client())("GET", `/users/${handle}`);
    expect(p.status).toBe(200);
    expect(p.json.seller.storefront.name).toBe(`Shop ${s.tag}`);
    expect(p.json.seller.stats).toMatchObject({ products: 1, unitsSold: 0, orders: 0, reviewCount: 0 });
    expect(p.json.seller.liveNow.id).toBe(id);
    expect(p.json.seller.upcoming.map((x: any) => x.title)).toContain("Sunday sale");
  });

  it("gives buyers a profile without a shop", async () => {
    const b = await buyer();
    const p = await (await client())("GET", `/users/u_${b.tag}`);
    expect(p.json.seller).toBeNull();
    expect((await (await client())("GET", `/users/u_${b.tag}/products`)).json.products).toEqual([]);
  });

  it("searches and sorts the shop on a profile", async () => {
    const { s, handle } = await liveShow();
    await s.call("POST", "/seller/products", { title: "Blue mug", description: "Ceramic", variants: [{ name: "Default", priceCents: 900, quantity: 1 }] });
    await s.call("POST", "/seller/products", { title: "Gold ring", description: "Shiny", variants: [{ name: "Size 7", priceCents: 5000, quantity: 1 }] });
    const anon = await client();
    const all = await anon("GET", `/users/${handle}/products`);
    expect(all.json.total).toBe(3);
    expect((await anon("GET", `/users/${handle}/products?q=flannel`)).json.products.map((p: any) => p.title)).toEqual(["Red flannel shirt"]);
    expect((await anon("GET", `/users/${handle}/products?q=acme`)).json.total).toBe(1);
    expect((await anon("GET", `/users/${handle}/products?q=size 7`)).json.products[0].title).toBe("Gold ring");
    const low = await anon("GET", `/users/${handle}/products?sort=price_low`);
    expect(low.json.products.map((p: any) => p.title)).toEqual(["Blue mug", "Red flannel shirt", "Gold ring"]);
    const page = await anon("GET", `/users/${handle}/products?sort=price_high&limit=2`);
    expect(page.json.products[0].title).toBe("Gold ring");
    expect(page.json.next).toBe(2);
  });
});

describe("editing your profile", () => {
  it("changes name, username, bio and photos, and refuses a taken username", async () => {
    const a = await buyer();
    const b = await buyer();
    const r = await a.call("PATCH", "/me/profile", { displayName: "Kody", handle: `New_${a.tag}`, bio: "I sell flannel", avatarUrl: "https://example.com/a.jpg", coverUrl: "https://example.com/c.jpg" });
    expect(r.status).toBe(200);
    expect(r.json.user.handle).toBe(`new_${a.tag}`);
    const p = await (await client())("GET", `/users/new_${a.tag}`);
    expect(p.json).toMatchObject({ displayName: "Kody", bio: "I sell flannel", avatarUrl: "https://example.com/a.jpg", coverUrl: "https://example.com/c.jpg" });
    expect((await a.call("GET", "/me")).json.user.coverUrl).toBe("https://example.com/c.jpg");
    expect((await b.call("PATCH", "/me/profile", { handle: `new_${a.tag}` })).status).toBe(409);
    expect((await b.call("PATCH", "/me/profile", { handle: "bad name!" })).status).toBe(400);
    expect((await a.call("PATCH", "/me/profile", { coverUrl: null })).json.user.coverUrl).toBeNull();
  });
});

describe("follower lists", () => {
  it("lists followers and following with who you follow, and leaves out blocked people", async () => {
    const { s, handle } = await liveShow();
    const a = await buyer();
    const b = await buyer();
    await a.call("POST", `/users/${s.userId}/follow`);
    await b.call("POST", `/users/${s.userId}/follow`);
    await s.call("POST", `/users/${a.userId}/follow`);
    const followers = await a.call("GET", `/users/${handle}/followers`);
    expect(followers.json.total).toBe(2);
    expect(followers.json.users.map((u: any) => u.handle).sort()).toEqual([`u_${a.tag}`, `u_${b.tag}`].sort());
    expect(followers.json.users.find((u: any) => u.handle === `u_${a.tag}`).isMe).toBe(true);
    const following = await b.call("GET", `/users/u_${a.tag}/following`);
    expect(following.json.users[0]).toMatchObject({ handle, isSeller: true, followedByMe: true });
    await s.call("POST", `/users/u_${b.tag}/block`);
    expect((await s.call("GET", `/users/${handle}/followers`)).json.users.map((u: any) => u.handle)).toEqual([`u_${a.tag}`]);
  });
});

describe("removing listings", () => {
  it("hides or deletes a listing from the shop and from an open show", async () => {
    const { s, p, id, handle } = await liveShow();
    const anon = await client();
    expect((await s.call("PATCH", `/seller/products/${p.id}`, { status: "DRAFT" })).status).toBe(200);
    expect((await anon("GET", `/users/${handle}/products`)).json.total).toBe(0);
    expect((await anon("GET", `/streams/${id}`)).json.products.filter((x: any) => !x.hidden).length).toBe(0);
    await s.call("PATCH", `/seller/products/${p.id}`, { status: "ACTIVE" });
    expect((await anon("GET", `/users/${handle}/products`)).json.total).toBe(1);
    await s.call("PATCH", `/seller/products/${p.id}`, { status: "ARCHIVED" });
    expect((await anon("GET", `/users/${handle}/products`)).json.total).toBe(0);
    expect((await anon("GET", `/products/${p.id}`)).status).toBe(404);
    const b = await buyer();
    expect((await b.call("PATCH", `/seller/products/${p.id}`, { status: "ACTIVE" })).status).toBe(403);
  });
});
