import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { StorefrontInput } from "@haven/shared";
import { prisma } from "../db";
import { requireSeller, requireUser } from "../lib/auth";
import { conflict, forbidden, notFound } from "../lib/errors";
import { parse } from "../lib/validate";
import { audit } from "../lib/audit";
import { notify } from "../notify";

/** Units sold count orders that were paid for and not cancelled or refunded. Test orders don't count. */
const SOLD = ["PAID", "FULFILLING", "SHIPPED", "DELIVERED"] as const;

/** What a seller's profile shows about their shop: real counts only, plus their live and upcoming shows. */
async function shopSummary(sellerId: string) {
  const [products, sold, orders, rating, shows] = await Promise.all([
    prisma.product.count({ where: { sellerId, status: "ACTIVE" } }),
    prisma.orderItem.aggregate({ where: { order: { sellerId, isTest: false, status: { in: [...SOLD] } } }, _sum: { quantity: true } }),
    prisma.order.count({ where: { sellerId, isTest: false, status: { in: [...SOLD] } } }),
    prisma.review.aggregate({ where: { product: { sellerId } }, _avg: { rating: true }, _count: true }),
    prisma.livestream.findMany({
      where: { sellerId, status: { in: ["LIVE", "PAUSED", "SCHEDULED"] } },
      orderBy: [{ status: "asc" }, { scheduledFor: "asc" }],
      take: 10,
      select: {
        id: true,
        title: true,
        status: true,
        scheduledFor: true,
        products: { where: { hidden: false }, orderBy: { position: "asc" }, take: 1, select: { product: { select: { media: { orderBy: { position: "asc" }, take: 1, select: { url: true } } } } } },
      },
    }),
  ]);
  const show = (s: (typeof shows)[number]) => ({ id: s.id, title: s.title, status: s.status, scheduledFor: s.scheduledFor, coverUrl: s.products[0]?.product.media[0]?.url ?? null });
  return {
    stats: { products, unitsSold: sold._sum.quantity ?? 0, orders, rating: rating._avg.rating, reviewCount: rating._count },
    liveNow: shows.filter((s) => s.status === "LIVE" || s.status === "PAUSED").map(show)[0] ?? null,
    upcoming: shows.filter((s) => s.status === "SCHEDULED").map(show),
  };
}

export async function sellerRoutes(app: FastifyInstance) {
  /**
   * Opening a store used to be instant. Selling now needs an approved application
   * (see sellerApplications.ts), so this only points older app versions to it.
   */
  app.post("/sellers", async (req) => {
    const u = requireUser(req);
    if (await prisma.sellerAccount.findUnique({ where: { userId: u.id } })) throw conflict("You already have a seller account");
    throw forbidden("To sell on Haven, apply from the Sell tab. Our team reviews every new seller.");
  });

  app.patch("/sellers/me/storefront", async (req) => {
    const { user, seller } = await requireSeller(req);
    const input = parse(StorefrontInput.partial(), req.body);
    if (input.slug) {
      const taken = await prisma.storefront.findFirst({ where: { slug: input.slug, sellerId: { not: seller.id } } });
      if (taken) throw conflict("That store URL is taken");
    }
    const sf = await prisma.storefront.update({ where: { sellerId: seller.id }, data: input });
    await audit(prisma, { actorId: user.id, action: "storefront.update", targetType: "storefront", targetId: sf.id });
    return sf;
  });

  /** Public storefront page data. */
  app.get("/stores/:slug", async (req) => {
    const { slug } = req.params as { slug: string };
    const sf = await prisma.storefront.findUnique({
      where: { slug },
      include: { seller: { include: { user: { select: { id: true, handle: true, displayName: true, avatarUrl: true } } } } },
    });
    if (!sf || sf.seller.status !== "APPROVED") throw notFound("Store");
    const [products, streams, followers, rating] = await Promise.all([
      prisma.product.findMany({
        where: { sellerId: sf.sellerId, status: "ACTIVE" },
        include: { variants: true, media: { orderBy: { position: "asc" }, take: 1 } },
        orderBy: { createdAt: "desc" },
        take: 48,
      }),
      prisma.livestream.findMany({ where: { sellerId: sf.sellerId, status: { in: ["LIVE", "SCHEDULED"] } }, orderBy: { scheduledFor: "asc" }, take: 10 }),
      prisma.follow.count({ where: { followeeId: sf.seller.userId } }),
      prisma.review.aggregate({ where: { product: { sellerId: sf.sellerId } }, _avg: { rating: true }, _count: true }),
    ]);
    return {
      storefront: { ...sf, seller: undefined },
      owner: sf.seller.user,
      products,
      streams,
      followers,
      reviews: { average: rating._avg.rating, count: rating._count },
    };
  });

  /** Public profile: only public fields and real counts. */
  app.get("/users/:handle", async (req) => {
    const u = await prisma.user.findUnique({
      where: { handle: (req.params as { handle: string }).handle },
      select: {
        id: true,
        handle: true,
        displayName: true,
        avatarUrl: true,
        coverUrl: true,
        bio: true,
        createdAt: true,
        seller: {
          select: {
            id: true,
            status: true,
            businessName: true,
            createdAt: true,
            storefront: { select: { slug: true, name: true, logoUrl: true, bannerUrl: true, description: true, shippingPolicy: true, returnPolicy: true } },
          },
        },
        _count: { select: { followers: true, following: true } },
      },
    });
    if (!u) throw notFound("User");
    const [videoCount, mine, block, shop] = await Promise.all([
      prisma.video.count({ where: { creatorId: u.id, status: "READY" } }),
      req.user ? prisma.follow.findUnique({ where: { followerId_followeeId: { followerId: req.user.id, followeeId: u.id } } }) : null,
      req.user ? prisma.userBlock.findMany({ where: { OR: [{ blockerId: req.user.id, blockedId: u.id }, { blockerId: u.id, blockedId: req.user.id }] } }) : [],
      u.seller?.status === "APPROVED" ? shopSummary(u.seller.id) : null,
    ]);
    const { _count, seller, ...rest } = u;
    const blockedByMe = block.some((b) => b.blockerId === req.user?.id);
    return {
      ...rest,
      // Only approved sellers show a shop on their profile.
      seller: seller?.status === "APPROVED" ? { businessName: seller.businessName, since: seller.createdAt, storefront: seller.storefront, ...shop } : null,
      followerCount: _count.followers,
      followingCount: _count.following,
      videoCount,
      followedByMe: !!mine,
      isMe: req.user?.id === u.id,
      blockedByMe,
      blocked: block.length > 0,
    };
  });

  /**
   * The shop on someone's profile: their active products, searchable by name, brand, tag or description
   * (so "red", "small" or "nike" find things), newest first or by price, a page at a time.
   */
  app.get("/users/:handle/products", async (req) => {
    const q = parse(
      z.object({ q: z.string().trim().max(80).optional(), sort: z.enum(["new", "price_low", "price_high"]).default("new"), offset: z.coerce.number().int().min(0).max(5000).default(0), limit: z.coerce.number().int().min(1).max(60).default(24) }),
      req.query ?? {},
    );
    const u = await prisma.user.findUnique({ where: { handle: (req.params as { handle: string }).handle }, select: { id: true, seller: { select: { id: true, status: true } } } });
    if (!u) throw notFound("User");
    if (!u.seller || u.seller.status !== "APPROVED") return { products: [], total: 0, next: null };
    if (req.user && (await prisma.userBlock.findFirst({ where: { OR: [{ blockerId: req.user.id, blockedId: u.id }, { blockerId: u.id, blockedId: req.user.id }] } })))
      return { products: [], total: 0, next: null };
    const words = (q.q ?? "").split(/\s+/).filter(Boolean).slice(0, 6);
    const where = {
      sellerId: u.seller.id,
      status: "ACTIVE" as const,
      AND: words.map((w) => ({
        OR: [
          { title: { contains: w, mode: "insensitive" as const } },
          { brand: { contains: w, mode: "insensitive" as const } },
          { description: { contains: w, mode: "insensitive" as const } },
          { tags: { has: w.toLowerCase() } },
          { variants: { some: { name: { contains: w, mode: "insensitive" as const } } } },
        ],
      })),
    };
    const include = { variants: { orderBy: { createdAt: "asc" as const } }, media: { orderBy: { position: "asc" as const }, take: 1 } };
    let products;
    let total: number;
    if (q.sort === "new") {
      [products, total] = await Promise.all([prisma.product.findMany({ where, include, orderBy: { createdAt: "desc" }, skip: q.offset, take: q.limit }), prisma.product.count({ where })]);
    } else {
      // Price lives on variants, so sort the (capped) matches here by each product's lowest price.
      const all = await prisma.product.findMany({ where, include, orderBy: { createdAt: "desc" }, take: 1000 });
      const low = (p: (typeof all)[number]) => (p.variants.length ? Math.min(...p.variants.map((v) => v.priceCents)) : Number.MAX_SAFE_INTEGER);
      all.sort((a, b) => (q.sort === "price_low" ? low(a) - low(b) : low(b) - low(a)));
      total = all.length;
      products = all.slice(q.offset, q.offset + q.limit);
    }
    const end = q.offset + products.length;
    return { products, total, next: end < total ? end : null };
  });

  /** Change your own name, username, bio, profile photo and cover photo. Send only what changes; null clears a photo or bio. */
  app.patch("/me/profile", async (req) => {
    const u = requireUser(req);
    const photo = z.string().trim().url().max(1000).nullable().optional();
    const input = parse(
      z.object({
        displayName: z.string().trim().min(1).max(60).optional(),
        handle: z.string().trim().toLowerCase().min(3).max(30).regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers and underscores").optional(),
        bio: z.string().trim().max(300).nullable().optional(),
        avatarUrl: photo,
        coverUrl: photo,
      }),
      req.body ?? {},
    );
    if (input.handle) {
      const taken = await prisma.user.findFirst({ where: { handle: input.handle, NOT: { id: u.id } }, select: { id: true } });
      if (taken) throw conflict("That username is taken");
    }
    const data = { ...input, ...(input.bio === "" ? { bio: null } : {}) };
    const user = await prisma.user.update({ where: { id: u.id }, data, select: { id: true, handle: true, displayName: true, avatarUrl: true, coverUrl: true, bio: true } });
    return { user };
  });

  /** Who follows someone, or who they follow, newest first. Blocked people are left out. */
  for (const kind of ["followers", "following"] as const) {
    app.get(`/users/:handle/${kind}`, async (req) => {
      const q = parse(z.object({ offset: z.coerce.number().int().min(0).max(10000).default(0), limit: z.coerce.number().int().min(1).max(100).default(50) }), req.query ?? {});
      const u = await prisma.user.findUnique({ where: { handle: (req.params as { handle: string }).handle }, select: { id: true } });
      if (!u) throw notFound("User");
      const hidden = req.user
        ? (await prisma.userBlock.findMany({ where: { OR: [{ blockerId: req.user.id }, { blockedId: req.user.id }] }, select: { blockerId: true, blockedId: true } })).map((b) =>
            b.blockerId === req.user!.id ? b.blockedId : b.blockerId,
          )
        : [];
      const person = { status: "ACTIVE" as const, id: { notIn: hidden } };
      const where = kind === "followers" ? { followeeId: u.id, follower: person } : { followerId: u.id, followee: person };
      const sel = { select: { id: true, handle: true, displayName: true, avatarUrl: true, bio: true, seller: { select: { status: true } } } };
      const [rows, total] = await Promise.all([
        prisma.follow.findMany({ where, orderBy: { createdAt: "desc" }, skip: q.offset, take: q.limit, include: kind === "followers" ? { follower: sel } : { followee: sel } }),
        prisma.follow.count({ where }),
      ]);
      type Person = { id: string; handle: string; displayName: string; avatarUrl: string | null; bio: string | null; seller: { status: string } | null };
      const people = rows.map((r) => ((r as { follower?: Person }).follower ?? (r as { followee?: Person }).followee) as Person);
      const mine = req.user ? await prisma.follow.findMany({ where: { followerId: req.user.id, followeeId: { in: people.map((p) => p.id) } }, select: { followeeId: true } }) : [];
      const followed = new Set(mine.map((m) => m.followeeId));
      const users = people.map(({ seller, ...p }) => ({ ...p, isSeller: seller?.status === "APPROVED", followedByMe: followed.has(p.id), isMe: req.user?.id === p.id }));
      const end = q.offset + users.length;
      return { users, total, next: end < total ? end : null };
    });
  }

  app.post("/users/:id/follow", async (req) => {
    const u = requireUser(req);
    const { id } = req.params as { id: string };
    if (id === u.id) throw conflict("You cannot follow yourself");
    if (!(await prisma.user.findUnique({ where: { id, status: "ACTIVE" }, select: { id: true } }))) throw notFound("User");
    if (await prisma.userBlock.findFirst({ where: { OR: [{ blockerId: u.id, blockedId: id }, { blockerId: id, blockedId: u.id }] } })) throw conflict("You can't follow this person");
    const n = await prisma.$executeRaw`INSERT INTO "Follow" ("followerId", "followeeId") VALUES (${u.id}, ${id}) ON CONFLICT DO NOTHING`;
    if (n) {
      const me = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { displayName: true, handle: true } });
      await notify({ userId: id, type: "social.follow", title: `${me.displayName} followed you`, link: `/u/${me.handle}`, data: { userId: u.id } });
    }
    return { following: true };
  });
  app.delete("/users/:id/follow", async (req) => {
    const u = requireUser(req);
    const { id } = req.params as { id: string };
    await prisma.follow.deleteMany({ where: { followerId: u.id, followeeId: id } });
    return { following: false };
  });
}
