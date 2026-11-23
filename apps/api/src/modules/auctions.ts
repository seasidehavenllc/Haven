import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuctionInput, BidInput, AddressInput, formatMoney } from "@glint/shared";
import { prisma } from "../db";
import { requireSeller, requireUser } from "../lib/auth";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { parse } from "../lib/validate";
import { emit } from "../realtime";
import { placeOrder } from "./commerce";

const ANTI_SNIPE_MS = 15_000;

type AuctionRow = {
  id: string;
  sellerId: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  startingPriceCents: number;
  minIncrementCents: number;
  currentPriceCents: number | null;
  leadingBidId: string | null;
};

/**
 * Place a bid. The auction row is locked (SELECT ... FOR UPDATE) so simultaneous bids are
 * serialized; all checks use server time and server state. Idempotent per bidder+key.
 */
export async function placeBid(auctionId: string, bidderId: string, amountCents: number, idempotencyKey: string) {
  const prior = await prisma.auctionBid.findUnique({ where: { bidderId_idempotencyKey: { bidderId, idempotencyKey } } });
  if (prior) return { bid: prior, replay: true };
  const res = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<AuctionRow[]>`SELECT id, "sellerId", status::text AS status, "startsAt", "endsAt", "startingPriceCents", "minIncrementCents", "currentPriceCents", "leadingBidId" FROM "Auction" WHERE id = ${auctionId} FOR UPDATE`;
    const a = rows[0];
    if (!a) throw notFound("Auction");
    const now = new Date();
    if (a.status === "SCHEDULED" && a.startsAt <= now && a.endsAt > now) a.status = "LIVE";
    if (a.status !== "LIVE" || a.endsAt <= now) throw conflict("Bidding is closed");
    const seller = await tx.sellerAccount.findUniqueOrThrow({ where: { id: a.sellerId } });
    if (seller.userId === bidderId) throw forbidden("Sellers can't bid on their own auctions");
    const min = a.currentPriceCents == null ? a.startingPriceCents : a.currentPriceCents + a.minIncrementCents;
    if (amountCents < min) throw conflict(`Bid must be at least ${formatMoney(min)}`, { minimumCents: min });
    const prevLeader = a.leadingBidId ? await tx.auctionBid.findUnique({ where: { id: a.leadingBidId } }) : null;
    if (prevLeader?.bidderId === bidderId) throw conflict("You are already the highest bidder");
    const bid = await tx.auctionBid.create({ data: { auctionId, bidderId, amountCents, idempotencyKey } });
    const extend = a.endsAt.getTime() - now.getTime() < ANTI_SNIPE_MS;
    const updated = await tx.auction.update({
      where: { id: auctionId },
      data: {
        status: "LIVE",
        currentPriceCents: amountCents,
        leadingBidId: bid.id,
        version: { increment: 1 },
        ...(extend ? { endsAt: new Date(now.getTime() + ANTI_SNIPE_MS) } : {}),
      },
    });
    if (prevLeader)
      await tx.notification.create({
        data: { userId: prevLeader.bidderId, type: "auction.outbid", title: "You've been outbid", body: `New high bid ${formatMoney(amountCents)}`, link: `/auctions/${auctionId}` },
      });
    return { bid, auction: updated, prevLeaderId: prevLeader?.bidderId };
  });
  emit(`auction:${auctionId}`, "auction:bid", { auctionId, amountCents, bidId: res.bid.id, endsAt: res.auction.endsAt, bidderId });
  if (res.auction.streamId) emit(`stream:${res.auction.streamId}`, "auction:bid", { auctionId, amountCents, endsAt: res.auction.endsAt });
  if (res.prevLeaderId) emit(`user:${res.prevLeaderId}`, "notification", { type: "auction.outbid", auctionId });
  return { bid: res.bid, replay: false };
}

/** Close auctions whose end time has passed. Safe to run concurrently (row lock + status check). */
export async function closeDueAuctions() {
  const due = await prisma.auction.findMany({ where: { status: { in: ["LIVE", "SCHEDULED"] }, endsAt: { lte: new Date() } }, select: { id: true } });
  for (const { id } of due) {
    const closed = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM "Auction" WHERE id = ${id} FOR UPDATE`;
      const a = rows[0];
      if (!a || a.status === "ENDED" || a.status === "CANCELLED") return null;
      const auc = await tx.auction.findUniqueOrThrow({ where: { id }, include: { leadingBid: true } });
      const reserveMet = auc.leadingBid ? auc.reservePriceCents == null || auc.leadingBid.amountCents >= auc.reservePriceCents : false;
      return tx.auction.update({ where: { id }, data: { status: "ENDED", reserveMet, winnerId: reserveMet ? auc.leadingBid!.bidderId : null } });
    });
    if (!closed) continue;
    emit(`auction:${id}`, "auction:closed", { auctionId: id, winnerId: closed.winnerId, priceCents: closed.currentPriceCents, reserveMet: closed.reserveMet });
    if (closed.winnerId)
      await prisma.notification.create({
        data: { userId: closed.winnerId, type: "auction.won", title: "You won an auction", body: `Complete checkout for ${formatMoney(closed.currentPriceCents ?? 0)}`, link: `/auctions/${id}` },
      });
  }
  return due.length;
}

export async function auctionRoutes(app: FastifyInstance) {
  app.post("/seller/auctions", async (req) => {
    const { seller } = await requireSeller(req);
    const input = parse(AuctionInput, req.body);
    const p = await prisma.product.findFirst({ where: { id: input.productId, sellerId: seller.id, status: "ACTIVE" }, include: { variants: true } });
    if (!p) throw notFound("Product");
    if (!p.variants.some((v) => v.quantity > 0)) throw badRequest("Product has no stock to auction");
    if (input.reservePriceCents && input.reservePriceCents < input.startingPriceCents) throw badRequest("Reserve must be at or above the starting price");
    if (input.streamId && !(await prisma.livestream.findFirst({ where: { id: input.streamId, sellerId: seller.id } }))) throw badRequest("Unknown stream");
    const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
    return prisma.auction.create({
      data: {
        sellerId: seller.id,
        productId: p.id,
        streamId: input.streamId,
        startingPriceCents: input.startingPriceCents,
        minIncrementCents: input.minIncrementCents,
        reservePriceCents: input.reservePriceCents,
        startsAt,
        endsAt: new Date(startsAt.getTime() + input.durationSeconds * 1000),
        status: startsAt <= new Date() ? "LIVE" : "SCHEDULED",
      },
    });
  });

  app.get("/auctions", async () =>
    prisma.auction.findMany({
      where: { status: { in: ["LIVE", "SCHEDULED"] } },
      include: { product: { include: { media: { take: 1 } } }, _count: { select: { bids: true } } },
      orderBy: { endsAt: "asc" },
      take: 60,
    }),
  );

  app.get("/auctions/:id", async (req) => {
    const a = await prisma.auction.findUnique({
      where: { id: (req.params as { id: string }).id },
      include: {
        product: { include: { media: true, variants: true } },
        bids: { orderBy: { amountCents: "desc" }, take: 20, include: { bidder: { select: { handle: true } } } },
      },
    });
    if (!a) throw notFound("Auction");
    // The reserve amount stays private; only whether it has been met is public.
    const { reservePriceCents, ...rest } = a;
    return {
      ...rest,
      hasReserve: reservePriceCents != null,
      reserveMet: reservePriceCents == null ? null : (a.currentPriceCents ?? 0) >= reservePriceCents,
      serverTime: new Date(),
    };
  });

  app.post("/auctions/:id/bids", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const u = requireUser(req);
    const input = parse(BidInput, req.body);
    return placeBid((req.params as { id: string }).id, u.id, input.amountCents, input.idempotencyKey);
  });

  /** Winner checkout at the server-recorded winning price. */
  app.post("/auctions/:id/checkout", async (req) => {
    const u = requireUser(req);
    const { address } = parse(z.object({ address: AddressInput }), req.body);
    const a = await prisma.auction.findUnique({ where: { id: (req.params as { id: string }).id }, include: { product: { include: { variants: true } } } });
    if (!a || a.status !== "ENDED" || a.winnerId !== u.id) throw forbidden("Only the winning bidder can check out");
    const variant = a.product.variants.find((v) => v.quantity > 0);
    if (!variant) throw conflict("Item is no longer in stock; the seller has been notified");
    return placeOrder({
      buyerId: u.id,
      lines: [{ variantId: variant.id, quantity: 1, unitPriceCents: a.currentPriceCents! }],
      address,
      idempotencyKey: `auction:${a.id}`,
      streamId: a.streamId ?? undefined,
    });
  });
}
