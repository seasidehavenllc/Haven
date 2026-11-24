import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/db";
import { admin, buyer, getApp } from "./helpers";

beforeAll(async () => {
  await getApp();
});

async function staffMember(role: "MANAGER" | "SUPPORT") {
  const owner = await admin();
  const person = await buyer();
  expect((await owner.call("POST", "/admin/staff", { email: `${person.tag}@test.dev`, role })).status).toBe(200);
  return person;
}

const full = (tag: string) => ({
  legalName: "Riley Shaw",
  phone: "+1 555 123 4567",
  dateOfBirth: "1990-05-01",
  address: { line1: "1 Main St", city: "Springfield", region: "IL", postalCode: "62701", country: "US" },
  businessType: "INDIVIDUAL",
  businessName: `Riley's Finds ${tag}`,
  storeName: `Riley's Finds`,
  storeSlug: `riley-${tag}`,
  categories: ["Trading cards", "Sneakers"],
  description: "Graded sports cards and deadstock sneakers, sourced from estate sales.",
  socialLinks: ["https://instagram.com/rileyfinds"],
  agreeToTerms: true,
});

/** A shopper who has filled in and sent a complete application. */
async function applicant() {
  const b = await buyer();
  expect((await b.call("PUT", "/sellers/application", full(b.tag))).status).toBe(200);
  expect((await b.call("POST", "/sellers/application/payouts")).json).toMatchObject({ mode: "test", done: true });
  const sent = await b.call("POST", "/sellers/application/submit");
  expect(sent.status).toBe(200);
  expect(sent.json.status).toBe("SUBMITTED");
  return { ...b, applicationId: sent.json.id as string };
}

describe("seller applications", () => {
  it("a shopper can't sell or go live until approved, then can", async () => {
    const b = await buyer();
    // The old instant "open a store" is closed.
    expect((await b.call("POST", "/sellers", { businessName: "Quick", storefront: { name: "Quick", slug: `quick-${b.tag}` } })).status).toBe(403);
    expect((await b.call("POST", "/seller/streams", { title: "My show", mode: "HUMAN" })).status).toBe(403);
    expect((await b.call("POST", "/seller/products", { title: "Thing", variants: [{ name: "Default", priceCents: 100, quantity: 1 }] })).status).toBe(403);
    expect((await b.call("GET", "/me")).json).toMatchObject({ canSell: false, sellerApplication: null });

    // A draft saves with only some fields, and says what's missing.
    const draft = await b.call("PUT", "/sellers/application", { legalName: "Riley Shaw" });
    expect(draft.status).toBe(200);
    expect(draft.json.missing.map((m: any) => m.key)).toEqual(["identity", "business", "products", "payouts", "terms"]);
    const early = await b.call("POST", "/sellers/application/submit");
    expect(early.status).toBe(400);

    // Under 18 is refused.
    expect((await b.call("PUT", "/sellers/application", { dateOfBirth: `${new Date().getUTCFullYear() - 16}-01-01` })).status).toBe(400);

    await b.call("PUT", "/sellers/application", full(b.tag));
    expect((await b.call("POST", "/sellers/application/payouts")).json.done).toBe(true);
    const sent = await b.call("POST", "/sellers/application/submit");
    expect(sent.json).toMatchObject({ status: "SUBMITTED", missing: [] });
    // Can't edit while in review, and still can't sell.
    expect((await b.call("PUT", "/sellers/application", { storeName: "Changed" })).status).toBe(409);
    expect((await b.call("POST", "/seller/streams", { title: "My show", mode: "HUMAN" })).status).toBe(403);

    const owner = await admin();
    const queue = await owner.call("GET", "/admin/seller-applications");
    expect(queue.json.applications.some((a: any) => a.id === sent.json.id)).toBe(true);
    const ok = await owner.call("POST", `/admin/seller-applications/${sent.json.id}/approve`, {});
    expect(ok.status).toBe(200);
    // Approving twice doesn't make two stores.
    expect((await owner.call("POST", `/admin/seller-applications/${sent.json.id}/approve`, {})).status).toBe(409);

    const me = (await b.call("GET", "/me")).json;
    expect(me).toMatchObject({ canSell: true, seller: { status: "APPROVED", storefront: { slug: `riley-${b.tag}` } }, sellerApplication: { status: "APPROVED" } });
    // Same token as before approval: the server checks the database, not the token.
    expect((await b.call("POST", "/seller/streams", { title: "My first show", mode: "HUMAN" })).status).toBe(200);

    const n = await prisma.notification.findFirst({ where: { userId: b.userId, type: "seller.application" } });
    expect(n?.title).toMatch(/approved/i);
    const log = await owner.call("GET", `/admin/audit?targetId=${sent.json.id}`);
    expect(log.json.map((e: any) => e.action)).toEqual(expect.arrayContaining(["admin.seller_application.approve"]));
  });

  it("staff can ask for more info, and the applicant edits and sends it again", async () => {
    const a = await applicant();
    const m = await staffMember("MANAGER");
    expect((await m.call("POST", `/admin/seller-applications/${a.applicationId}/request-info`, { message: "Please add a link to where you sell now." })).status).toBe(200);
    const mine = (await a.call("GET", "/sellers/application")).json;
    expect(mine.application).toMatchObject({ status: "NEEDS_INFO", decisionNote: "Please add a link to where you sell now." });
    expect((await a.call("PUT", "/sellers/application", { socialLinks: ["https://ebay.com/usr/riley"] })).status).toBe(200);
    expect((await a.call("POST", "/sellers/application/submit")).json.status).toBe("SUBMITTED");
    const detail = (await m.call("GET", `/admin/seller-applications/${a.applicationId}`)).json;
    expect(detail.history.map((h: any) => h.action)).toEqual(["seller.application.submit", "admin.seller_application.request_info", "seller.application.resubmit"]);
    // Managers see contact details masked.
    expect(detail.piiMasked).toBe(true);
    expect(detail.phone).not.toContain("555");
    expect(detail.age).toBeGreaterThanOrEqual(18);
  });

  it("a rejection needs a reason, the applicant sees it, and they can apply again", async () => {
    const a = await applicant();
    const owner = await admin();
    expect((await owner.call("POST", `/admin/seller-applications/${a.applicationId}/reject`, { reason: "" })).status).toBe(400);
    expect((await owner.call("POST", `/admin/seller-applications/${a.applicationId}/reject`, { reason: "We couldn't verify the items are authentic." })).status).toBe(200);
    const mine = (await a.call("GET", "/sellers/application")).json;
    expect(mine).toMatchObject({ canSell: false, application: { status: "REJECTED", decisionNote: "We couldn't verify the items are authentic." } });
    expect((await a.call("POST", "/seller/streams", { title: "Show", mode: "HUMAN" })).status).toBe(403);
    // Editing starts a new application.
    const again = await a.call("PUT", "/sellers/application", { description: "Graded cards with PSA certificates for every slab, plus receipts." });
    expect(again.json.status).toBe("DRAFT");
    expect((await a.call("POST", "/sellers/application/submit")).json.status).toBe("SUBMITTED");
  });

  it("support can view the queue but not decide; shoppers can't see it at all", async () => {
    const a = await applicant();
    const sup = await staffMember("SUPPORT");
    expect((await sup.call("GET", "/admin/seller-applications")).status).toBe(200);
    const d = await sup.call("GET", `/admin/seller-applications/${a.applicationId}`);
    expect(d.json).toMatchObject({ canDecide: false, piiMasked: false, phone: "+1 555 123 4567" });
    expect((await sup.call("POST", `/admin/seller-applications/${a.applicationId}/approve`, {})).status).toBe(403);
    expect((await sup.call("POST", `/admin/seller-applications/${a.applicationId}/reject`, { reason: "Not today, sorry." })).status).toBe(403);
    expect((await sup.call("POST", `/admin/seller-applications/${a.applicationId}/request-info`, { message: "More please." })).status).toBe(403);
    const shopper = await buyer();
    expect((await shopper.call("GET", "/admin/seller-applications")).status).toBe(403);
  });

  it("a store address can't be claimed twice", async () => {
    const a = await applicant();
    const b = await buyer();
    const slug = (await prisma.sellerApplication.findUniqueOrThrow({ where: { id: a.applicationId } })).storeSlug;
    expect((await b.call("PUT", "/sellers/application", { storeSlug: slug })).status).toBe(409);
  });

  it("a suspended seller loses selling at once", async () => {
    const a = await applicant();
    const owner = await admin();
    const { sellerId } = (await owner.call("POST", `/admin/seller-applications/${a.applicationId}/approve`, {})).json;
    expect((await a.call("POST", "/seller/streams", { title: "Show", mode: "HUMAN" })).status).toBe(200);
    await owner.call("PATCH", `/admin/sellers/${sellerId}`, { status: "SUSPENDED" });
    expect((await a.call("POST", "/seller/streams", { title: "Show 2", mode: "HUMAN" })).status).toBe(403);
    expect((await a.call("GET", "/me")).json.canSell).toBe(false);
  });
});
