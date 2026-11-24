import type { FastifyInstance } from "fastify";
import type { SellerApplication } from "@prisma/client";
import { z } from "zod";
import { ageFrom, ApplicationAddress, can, SELLER_TERMS_VERSION, SellerApplicationInput, SellerTerms } from "@haven/shared";
import { prisma, type Tx } from "../db";
import { env } from "../env";
import { requireStaff, requireUser } from "../lib/auth";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { parse } from "../lib/validate";
import { audit } from "../lib/audit";
import { grantAllowance } from "../ai/ledger";
import { notify } from "../notify";
import { connectAccountStatus, connectOnboardingLink, createConnectAccount, payoutsMode } from "../payments";
import { maskEmail } from "./admin";

/**
 * Seller applications.
 *
 *   Applicant (Sell tab)             Staff (admin panel → Seller applications)
 *   ─────────────────────            ─────────────────────────────────────────
 *   fill in details  → DRAFT
 *   set up payouts (Stripe)
 *   agree to terms
 *   send             → SUBMITTED  →  approve  → APPROVED  (seller account + storefront created)
 *                                 →  reject   → REJECTED  (reason shown; they can apply again)
 *                                 →  ask      → NEEDS_INFO (question shown; they edit and send again)
 *
 * Owners and managers decide (sellers.manage). Support can look (sellers.view). Every decision is in
 * the audit log and the applicant gets a notification.
 */

const EDITABLE = new Set(["DRAFT", "NEEDS_INFO", "REJECTED"]);
const MIN_AGE = 18;

const firstWebOrigin = () => env.WEB_ORIGIN.split(",")[0]!.trim().replace(/\/+$/, "");

/** What's still missing before the application can be sent. Empty means ready. */
export async function missingRequirements(a: SellerApplication) {
  const missing: { key: string; label: string }[] = [];
  const addr = ApplicationAddress.safeParse(a.address);
  if (a.legalName.length < 2 || a.phone.length < 7 || !a.dateOfBirth || !addr.success) missing.push({ key: "identity", label: "Your legal name, phone, date of birth and address" });
  else if (ageFrom(a.dateOfBirth) < MIN_AGE) missing.push({ key: "age", label: `You must be ${MIN_AGE} or older to sell` });
  if (a.businessName.length < 2 || a.storeName.length < 2 || a.storeSlug.length < 3) missing.push({ key: "business", label: "Your business and store name" });
  else if (!(await slugAvailable(a.storeSlug, a.userId))) missing.push({ key: "slug", label: "That store address is taken. Pick another" });
  if (!a.categories.length || a.description.length < 20) missing.push({ key: "products", label: "What you sell" });
  if (payoutsMode() !== "off" && !a.payoutsDetailsDone) missing.push({ key: "payouts", label: "Set up payouts with Stripe" });
  if (!a.termsAcceptedAt || a.termsVersion !== SELLER_TERMS_VERSION) missing.push({ key: "terms", label: "Agree to the seller terms" });
  return missing;
}

async function slugAvailable(slug: string, userId: string) {
  const [store, other] = await Promise.all([
    prisma.storefront.findUnique({ where: { slug }, select: { id: true } }),
    prisma.sellerApplication.findFirst({ where: { storeSlug: slug, userId: { not: userId }, status: { in: ["SUBMITTED", "NEEDS_INFO"] } }, select: { id: true } }),
  ]);
  return !store && !other;
}

/** If the applicant came back from Stripe, check how far they got. Never throws. */
async function refreshPayouts(a: SellerApplication): Promise<SellerApplication> {
  if (!a.stripeAccountId || a.payoutsEnabled || payoutsMode() !== "stripe") return a;
  try {
    const st = await connectAccountStatus(a.stripeAccountId);
    if (st.detailsSubmitted === a.payoutsDetailsDone && st.payoutsEnabled === a.payoutsEnabled) return a;
    return prisma.sellerApplication.update({ where: { id: a.id }, data: { payoutsDetailsDone: st.detailsSubmitted, payoutsEnabled: st.payoutsEnabled } });
  } catch (e) {
    console.error("[sellers] couldn't read Stripe account", e);
    return a;
  }
}

/** The applicant's own view: everything they entered plus what's left to do. */
async function applicantView(a: SellerApplication) {
  return { ...a, dateOfBirth: a.dateOfBirth?.toISOString().slice(0, 10) ?? null, missing: await missingRequirements(a) };
}

/**
 * Turn an approved application into a seller account with a storefront and the free Starter AI
 * plan. Also used by tests to make sellers quickly.
 */
export async function createSellerAccount(
  tx: Tx,
  opts: { userId: string; businessName: string; storefront: { name: string; slug: string; description?: string }; stripeAccountId?: string | null; payoutsEnabled?: boolean },
) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: opts.userId } });
  await tx.user.update({ where: { id: opts.userId }, data: { roles: Array.from(new Set([...user.roles, "SELLER"])) as any } });
  const seller = await tx.sellerAccount.create({
    data: {
      userId: opts.userId,
      businessName: opts.businessName,
      status: "APPROVED",
      stripeAccountId: opts.stripeAccountId ?? null,
      payoutsEnabled: opts.payoutsEnabled ?? false,
      storefront: { create: opts.storefront },
    },
    include: { storefront: true },
  });
  const starter = await tx.aiPlan.findFirst({ where: { tier: 0, active: true }, orderBy: { monthlyPriceCents: "asc" } });
  if (starter) {
    const now = new Date();
    const end = new Date(now);
    end.setUTCMonth(end.getUTCMonth() + 1);
    await tx.sellerSubscription.create({ data: { sellerId: seller.id, planId: starter.id, currentPeriodStart: now, currentPeriodEnd: end } });
    await grantAllowance(tx, seller.id, starter.monthlyCredits, now.toISOString().slice(0, 10), `${starter.name} monthly allowance`);
  }
  return seller;
}

const blankDraft = { legalName: "", phone: "", address: {}, businessName: "", storeName: "", storeSlug: "", description: "", categories: [], socialLinks: [], sampleImageUrls: [] };

export async function sellerApplicationRoutes(app: FastifyInstance) {
  // ───────────── Applicant ─────────────

  /** The Sell tab calls this to decide what to show: the form, the status, or the selling tools. */
  app.get("/sellers/application", async (req) => {
    const u = requireUser(req);
    const [seller, found] = await Promise.all([
      prisma.sellerAccount.findUnique({ where: { userId: u.id }, select: { id: true, status: true } }),
      prisma.sellerApplication.findUnique({ where: { userId: u.id } }),
    ]);
    const a = found ? await refreshPayouts(found) : null;
    return {
      canSell: seller?.status === "APPROVED",
      seller,
      application: a ? await applicantView(a) : null,
      payoutsMode: payoutsMode(),
      terms: { version: SELLER_TERMS_VERSION, points: SellerTerms },
    };
  });

  /** Save what the applicant has so far. Any subset of fields; checked in full when they send it. */
  app.put("/sellers/application", async (req) => {
    const u = requireUser(req);
    if (await prisma.sellerAccount.findUnique({ where: { userId: u.id }, select: { id: true } })) throw conflict("You already have a seller account");
    const input = parse(SellerApplicationInput.partial(), req.body);
    const existing = await prisma.sellerApplication.findUnique({ where: { userId: u.id } });
    if (existing && !EDITABLE.has(existing.status)) throw conflict(existing.status === "SUBMITTED" ? "Your application is in review. You can edit it if we ask for more info." : "Your application was already approved");
    if (input.dateOfBirth && ageFrom(input.dateOfBirth) < MIN_AGE) throw badRequest(`You must be ${MIN_AGE} or older to sell on Haven`);
    if (input.storeSlug && !(await slugAvailable(input.storeSlug, u.id))) throw conflict("That store address is taken");
    const { agreeToTerms, dateOfBirth, ...fields } = input;
    const data = {
      ...fields,
      ...(dateOfBirth ? { dateOfBirth: new Date(`${dateOfBirth}T00:00:00Z`) } : {}),
      ...(agreeToTerms === true ? { termsAcceptedAt: new Date(), termsVersion: SELLER_TERMS_VERSION } : agreeToTerms === false ? { termsAcceptedAt: null, termsVersion: null } : {}),
      // Editing after a rejection starts a new application.
      ...(existing?.status === "REJECTED" ? { status: "DRAFT" as const, decisionNote: null, reviewedAt: null, reviewerId: null } : {}),
    };
    const a = existing
      ? await prisma.sellerApplication.update({ where: { id: existing.id }, data })
      : await prisma.sellerApplication.create({ data: { ...blankDraft, ...data, userId: u.id } });
    return applicantView(a);
  });

  /**
   * Start or continue payout setup. With Stripe this returns a link to Stripe's hosted form, where the
   * applicant verifies their identity and adds their tax number and bank. Haven never sees those.
   */
  app.post("/sellers/application/payouts", async (req) => {
    const u = requireUser(req);
    const a = await prisma.sellerApplication.findUnique({ where: { userId: u.id }, include: { user: { select: { email: true } } } });
    if (!a) throw badRequest("Fill in your details first");
    if (!EDITABLE.has(a.status) && a.status !== "SUBMITTED") throw conflict("Your application was already decided");
    const mode = payoutsMode();
    if (mode === "off") return { mode, done: false, message: "Payouts aren't connected on Haven yet. You can still send your application." };
    if (mode === "test") {
      const updated = await prisma.sellerApplication.update({ where: { id: a.id }, data: { stripeAccountId: a.stripeAccountId ?? `acct_test_${a.id}`, payoutsDetailsDone: true, payoutsEnabled: true } });
      return { mode, done: true, application: await applicantView(updated) };
    }
    let accountId = a.stripeAccountId;
    if (!accountId) {
      const country = ApplicationAddress.safeParse(a.address).data?.country ?? "US";
      accountId = await createConnectAccount({ applicationId: a.id, userId: u.id, email: a.user.email, businessType: a.businessType, country });
      await prisma.sellerApplication.update({ where: { id: a.id }, data: { stripeAccountId: accountId } });
    }
    const web = firstWebOrigin();
    const url = await connectOnboardingLink(accountId, `${web}/sell?payouts=done`, `${web}/sell?payouts=retry`);
    return { mode, done: false, url };
  });

  /** Send the application to the Haven team. */
  app.post("/sellers/application/submit", async (req) => {
    const u = requireUser(req);
    const found = await prisma.sellerApplication.findUnique({ where: { userId: u.id } });
    if (!found) throw badRequest("Fill in your application first");
    if (!EDITABLE.has(found.status)) throw conflict(found.status === "SUBMITTED" ? "Your application is already in review" : "Your application was already approved");
    if (found.status === "REJECTED") throw conflict("Update your application before sending it again");
    const a = await refreshPayouts(found);
    const missing = await missingRequirements(a);
    if (missing.length) throw badRequest(`Before you send it: ${missing.map((m) => m.label.toLowerCase()).join("; ")}`, { missing });
    const resent = a.status === "NEEDS_INFO";
    const updated = await prisma.sellerApplication.update({ where: { id: a.id }, data: { status: "SUBMITTED", submittedAt: new Date() } });
    await audit(prisma, { actorId: u.id, action: resent ? "seller.application.resubmit" : "seller.application.submit", targetType: "seller_application", targetId: a.id, ip: req.ip });
    // Tell the people who can decide.
    const deciders = await prisma.user.findMany({ where: { staffRole: { in: ["OWNER", "MANAGER"] }, status: "ACTIVE" }, select: { id: true } });
    if (deciders.length)
      await notify(deciders.map((d) => ({ userId: d.id, type: "admin.seller_application", title: resent ? `${a.businessName} updated their seller application` : `New seller application: ${a.businessName}`, body: a.categories.join(", "), link: "/admin", data: { applicationId: a.id } })));
    return applicantView(updated);
  });

  // ───────────── Staff ─────────────

  app.get("/admin/seller-applications", async (req) => {
    await requireStaff(req, "sellers.view");
    const q = parse(z.object({ status: z.enum(["SUBMITTED", "NEEDS_INFO", "APPROVED", "REJECTED", "DRAFT"]).default("SUBMITTED") }), req.query);
    const [rows, counts] = await Promise.all([
      prisma.sellerApplication.findMany({
        where: { status: q.status },
        // The queue is first come, first served; decided ones show newest first.
        orderBy: q.status === "SUBMITTED" ? { submittedAt: "asc" } : { updatedAt: "desc" },
        take: 200,
        select: {
          id: true, status: true, businessName: true, storeName: true, businessType: true, categories: true, submittedAt: true, reviewedAt: true, updatedAt: true,
          payoutsDetailsDone: true, sampleImageUrls: true,
          user: { select: { handle: true, displayName: true, avatarUrl: true } },
        },
      }),
      prisma.sellerApplication.groupBy({ by: ["status"], _count: true }),
    ]);
    return { applications: rows, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) };
  });

  app.get("/admin/seller-applications/:id", async (req) => {
    const staff = await requireStaff(req, "sellers.view");
    const a = await prisma.sellerApplication.findUnique({
      where: { id: (req.params as { id: string }).id },
      include: {
        user: { select: { id: true, email: true, handle: true, displayName: true, avatarUrl: true, createdAt: true, status: true, _count: { select: { orders: true } } } },
        reviewer: { select: { handle: true, displayName: true } },
      },
    });
    if (!a) throw notFound("Application");
    const [history, reportsAgainst] = await Promise.all([
      prisma.auditLog.findMany({ where: { targetType: "seller_application", targetId: a.id }, orderBy: { createdAt: "asc" }, select: { action: true, data: true, createdAt: true, actor: { select: { handle: true } } } }),
      prisma.report.count({ where: { targetType: "user", targetId: a.userId } }),
    ]);
    const pii = can(staff.staffRole, "pii.view");
    const addr = (a.address ?? {}) as Record<string, string>;
    await audit(prisma, { actorId: staff.id, action: "admin.seller_application.view", targetType: "seller_application", targetId: a.id, ip: req.ip });
    return {
      ...a,
      age: a.dateOfBirth ? ageFrom(a.dateOfBirth) : null,
      dateOfBirth: pii ? (a.dateOfBirth?.toISOString().slice(0, 10) ?? null) : null,
      phone: pii ? a.phone : a.phone ? `•••${a.phone.replace(/\D/g, "").slice(-2)}` : "",
      address: pii ? addr : { city: addr.city, region: addr.region, country: addr.country, masked: true },
      user: { ...a.user, email: pii ? a.user.email : maskEmail(a.user.email) },
      stripeAccountId: a.stripeAccountId ? `•••${a.stripeAccountId.slice(-6)}` : null,
      payoutsMode: payoutsMode(),
      reportsAgainst,
      history: history.filter((h) => h.action !== "admin.seller_application.view"),
      piiMasked: !pii,
      canDecide: can(staff.staffRole, "sellers.manage"),
    };
  });

  /** Approve: creates the seller account and storefront in one step, then tells the applicant. */
  app.post("/admin/seller-applications/:id/approve", async (req) => {
    const staff = await requireStaff(req, "sellers.manage");
    const { note } = parse(z.object({ note: z.string().trim().max(1000).optional() }), req.body ?? {});
    const id = (req.params as { id: string }).id;
    const a = await prisma.sellerApplication.findUnique({ where: { id }, include: { user: { select: { status: true } } } });
    if (!a) throw notFound("Application");
    if (a.status !== "SUBMITTED") throw conflict(`This application is ${a.status.toLowerCase().replace("_", " ")}, not waiting for a decision`);
    if (a.userId === staff.id) throw forbidden("You can't approve your own application");
    if (a.user.status !== "ACTIVE") throw conflict("This account is suspended or banned");
    if (await prisma.storefront.findUnique({ where: { slug: a.storeSlug } })) throw conflict("Their store address was taken since they applied. Ask them for another one");
    const seller = await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction so two staff clicking at once approve it once.
      const claimed = await tx.sellerApplication.updateMany({ where: { id, status: "SUBMITTED" }, data: { status: "APPROVED", reviewedAt: new Date(), reviewerId: staff.id, decisionNote: note || null } });
      if (!claimed.count) throw conflict("Someone else just decided this application");
      const seller = await createSellerAccount(tx, {
        userId: a.userId,
        businessName: a.businessName,
        storefront: { name: a.storeName, slug: a.storeSlug, description: a.description.slice(0, 2000) },
        stripeAccountId: a.stripeAccountId?.startsWith("acct_test_") ? null : a.stripeAccountId,
        payoutsEnabled: a.payoutsEnabled,
      });
      await audit(tx, { actorId: staff.id, action: "admin.seller_application.approve", targetType: "seller_application", targetId: id, data: { sellerId: seller.id, businessName: a.businessName, note }, ip: req.ip });
      return seller;
    });
    await notify({ userId: a.userId, type: "seller.application", title: "You're approved to sell on Haven 🎉", body: "Open the Sell tab to list items and go live.", link: "/sell", data: { status: "APPROVED" } });
    return { ok: true, status: "APPROVED", sellerId: seller.id };
  });

  app.post("/admin/seller-applications/:id/reject", async (req) => {
    const staff = await requireStaff(req, "sellers.manage");
    const { reason } = parse(z.object({ reason: z.string().trim().min(5, "Give the applicant a reason").max(1000) }), req.body);
    return decide(staff.id, (req.params as { id: string }).id, "REJECTED", reason, req.ip);
  });

  app.post("/admin/seller-applications/:id/request-info", async (req) => {
    const staff = await requireStaff(req, "sellers.manage");
    const { message } = parse(z.object({ message: z.string().trim().min(5, "Say what you need from them").max(1000) }), req.body);
    return decide(staff.id, (req.params as { id: string }).id, "NEEDS_INFO", message, req.ip);
  });
}

async function decide(staffId: string, id: string, to: "REJECTED" | "NEEDS_INFO", note: string, ip: string) {
  const a = await prisma.sellerApplication.findUnique({ where: { id } });
  if (!a) throw notFound("Application");
  if (a.userId === staffId) throw forbidden("You can't decide your own application");
  const done = await prisma.sellerApplication.updateMany({ where: { id, status: "SUBMITTED" }, data: { status: to, reviewedAt: new Date(), reviewerId: staffId, decisionNote: note } });
  if (!done.count) throw conflict("This application isn't waiting for a decision");
  await audit(prisma, { actorId: staffId, action: to === "REJECTED" ? "admin.seller_application.reject" : "admin.seller_application.request_info", targetType: "seller_application", targetId: id, data: { businessName: a.businessName, note }, ip });
  await notify({
    userId: a.userId,
    type: "seller.application",
    title: to === "REJECTED" ? "Your seller application wasn't approved" : "We need a bit more info for your seller application",
    body: note,
    link: "/sell",
    data: { status: to },
  });
  return { ok: true, status: to };
}
