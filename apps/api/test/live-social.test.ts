import { beforeAll, describe, expect, it } from "vitest";
import { address, buyer, client, enableTestAi, getApp, multipart, PNG, product, seller, testAi } from "./helpers";
import { priceFromSpeech } from "../src/modules/streams";

async function liveShow() {
  const s = await seller();
  const p = await product(s);
  const st = await s.call("POST", "/seller/streams", { title: "Hearts and chat", mode: "HUMAN", productIds: [p.id] });
  await s.call("POST", `/seller/streams/${st.json.id}/start`);
  return { s, p, id: st.json.id as string };
}

describe("live show hearts, pinned comment and chat mutes", () => {
  it("counts hearts from anyone while live, and caps a batch", async () => {
    const { id } = await liveShow();
    const anon = await client();
    const a = await anon("POST", `/streams/${id}/likes`, { count: 5 });
    expect(a.status).toBe(200);
    expect(a.json.total).toBe(5);
    const b = await buyer();
    expect((await b.call("POST", `/streams/${id}/likes`, { count: 3 })).json.total).toBe(8);
    expect((await anon("POST", `/streams/${id}/likes`, { count: 500 })).status).toBe(400);
    expect((await anon("GET", `/streams/${id}`)).json.likeCount).toBe(8);
  });

  it("refuses hearts before the show starts", async () => {
    const s = await seller();
    const st = await s.call("POST", "/seller/streams", { title: "Later", mode: "HUMAN" });
    expect((await (await client())("POST", `/streams/${st.json.id}/likes`, { count: 1 })).status).toBe(409);
  });

  it("lets the host pin a comment, and clears it when that comment is hidden", async () => {
    const { s, id } = await liveShow();
    const b = await buyer();
    const m = await b.call("POST", `/streams/${id}/chat`, { body: "Do you ship to Canada?" });
    expect((await s.call("POST", `/seller/streams/${id}/pin-message`, { messageId: m.json.id })).status).toBe(200);
    const view = await (await client())("GET", `/streams/${id}`);
    expect(view.json.pinnedMessage.body).toBe("Do you ship to Canada?");
    // Only the host can pin.
    expect((await b.call("POST", `/seller/streams/${id}/pin-message`, { messageId: m.json.id })).status).toBe(403);
    await s.call("POST", `/seller/streams/${id}/chat/${m.json.id}/hide`);
    expect((await (await client())("GET", `/streams/${id}`)).json.pinnedMessage).toBeNull();
  });

  it("mutes a viewer in one show: their chat closes and their messages go away, then unmute restores chat", async () => {
    const { s, id } = await liveShow();
    const b = await buyer();
    await b.call("POST", `/streams/${id}/chat`, { body: "spam spam" });
    expect((await s.call("POST", `/seller/streams/${id}/mutes`, { userId: b.userId })).status).toBe(200);
    const sent = await b.call("POST", `/streams/${id}/chat`, { body: "more spam" });
    expect(sent.status).toBe(403);
    const mine = await b.call("GET", `/streams/${id}`);
    expect(mine.json.youAreMuted).toBe(true);
    expect(mine.json.mutedUserIds).toBeUndefined();
    expect(mine.json.chat.some((c: any) => c.userId === b.userId)).toBe(false);
    expect((await s.call("GET", `/streams/${id}`)).json.mutedUserIds).toEqual([b.userId]);
    // Muting is per show: another show by the same host is unaffected.
    const other = await s.call("POST", "/seller/streams", { title: "Second show", mode: "HUMAN" });
    await s.call("POST", `/seller/streams/${other.json.id}/start`);
    expect((await b.call("POST", `/streams/${other.json.id}/chat`, { body: "hi" })).status).toBe(200);
    await s.call("DELETE", `/seller/streams/${id}/mutes/${b.userId}`);
    expect((await b.call("POST", `/streams/${id}/chat`, { body: "sorry" })).status).toBe(200);
  });

  it("won't let a viewer mute someone in a show they don't host", async () => {
    const { id } = await liveShow();
    const b = await buyer();
    const c = await buyer();
    expect((await b.call("POST", `/seller/streams/${id}/mutes`, { userId: c.userId })).status).toBe(403);
  });

  it("shows an auction started during the show on the show itself", async () => {
    const { s, p, id } = await liveShow();
    const a = await s.call("POST", "/seller/auctions", { productId: p.id, startingPriceCents: 1000, minIncrementCents: 100, durationSeconds: 120, streamId: id });
    expect(a.status).toBe(200);
    const view = await (await client())("GET", `/streams/${id}`);
    expect(view.json.auctions.map((x: any) => x.id)).toContain(a.json.id);
  });
});

describe("selling new items during a show", () => {
  beforeAll(async () => enableTestAi());

  async function quickList(s: Awaited<ReturnType<typeof seller>>, id: string, fields: Record<string, string>, photo = true) {
    const a = await getApp();
    const mp = multipart(photo ? [{ name: "item.png", data: PNG, type: "image/png" }] : [], fields);
    const res = await a.inject({ method: "POST", url: `/seller/streams/${id}/quick-list`, payload: mp.payload, headers: { ...mp.headers, authorization: `Bearer ${s.token}` } });
    return { status: res.statusCode, json: JSON.parse(res.body) };
  }

  it("reads the price out of what the host said", () => {
    expect(priceFromSpeech("Vintage denim jacket size M $45")).toBe(4500);
    expect(priceFromSpeech("this one is 12.50 dollars")).toBe(1250);
    expect(priceFromSpeech("Nike hoodie, price 30")).toBe(3000);
    expect(priceFromSpeech("size 10 sneakers")).toBeNull();
  });

  it("turns a photo and the host's words into a listing in the shop and the show, pinned and announced, ready to buy", async () => {
    const { s, id } = await liveShow();
    testAi.fail = false;
    const r = await quickList(s, id, { said: "white mug, $18", quantity: "3" });
    expect(r.status).toBe(200);
    expect(r.json.product.title).toBe("Ceramic coffee mug"); // AI wrote it from the photo
    expect(r.json.product.variants[0].priceCents).toBe(1800); // the host's price, never the AI's
    expect(testAi.lastPrompt).toContain("white mug, $18");
    const view = await (await client())("GET", `/streams/${id}`);
    expect(view.json.pinnedProductId).toBe(r.json.product.id);
    expect(view.json.products.map((p: any) => p.productId)).toContain(r.json.product.id);
    expect(view.json.chat.at(-1).body).toContain("Ceramic coffee mug for $18.00");
    // It's in the shop like any listing, and a viewer can buy it right away.
    expect((await (await client())("GET", `/products/${r.json.product.id}`)).status).toBe(200);
    const b = await buyer();
    const buy = await b.call("POST", "/buy-now", { variantId: r.json.product.variants[0].id, quantity: 1, address, idempotencyKey: crypto.randomUUID(), streamId: id });
    expect(buy.status).toBe(200);
  });

  it("lists many items back to back in one show", async () => {
    const { s, p, id } = await liveShow();
    for (const said of ["Red scarf $12", "Blue scarf $14", "Green scarf $16"]) expect((await quickList(s, id, { said, ai: "false" }, false)).status).toBe(200);
    const view = await (await client())("GET", `/streams/${id}`);
    expect(view.json.products.length).toBe(4);
    expect(view.json.products.map((x: any) => x.product.title)).toEqual([p.title, "Red scarf", "Blue scarf", "Green scarf"]);
  });

  it("falls back to the host's words when AI is down, and needs a price", async () => {
    const { s, id } = await liveShow();
    testAi.fail = true;
    const r = await quickList(s, id, { said: "Leather wallet 25 bucks" });
    testAi.fail = false;
    expect(r.status).toBe(200);
    expect(r.json.product.title).toBe("Leather wallet");
    expect(r.json.aiNote).toBeTruthy();
    expect((await quickList(s, id, { said: "Leather wallet" }, false)).status).toBe(400);
  });

  it("only the host can add items to their show", async () => {
    const { id } = await liveShow();
    const other = await seller();
    expect((await quickList(other, id, { said: "Fake $5", ai: "false" }, false)).status).toBe(404);
  });
});
