import type { FastifyInstance } from "fastify";
import { StorefrontInput } from "@haven/shared";
import { prisma } from "../db";
import { requireSeller, requireUser } from "../lib/auth";
import { conflict, forbidden, notFound } from "../lib/errors";
import { parse } from "../lib/validate";
import { audit } from "../lib/audit";
import { notify } from "../notify";

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
        bio: true,
        createdAt: true,
        seller: { select: { storefront: { select: { slug: true, name: true, logoUrl: true } } } },
        _count: { select: { followers: true, following: true } },
      },
    });
    if (!u) throw notFound("User");
    const [videoCount, mine, block] = await Promise.all([
      prisma.video.count({ where: { creatorId: u.id, status: "READY" } }),
      req.user ? prisma.follow.findUnique({ where: { followerId_followeeId: { followerId: req.user.id, followeeId: u.id } } }) : null,
      req.user ? prisma.userBlock.findMany({ where: { OR: [{ blockerId: req.user.id, blockedId: u.id }, { blockerId: u.id, blockedId: req.user.id }] } }) : [],
    ]);
    const { _count, ...rest } = u;
    const blockedByMe = block.some((b) => b.blockerId === req.user?.id);
    return { ...rest, followerCount: _count.followers, followingCount: _count.following, videoCount, followedByMe: !!mine, isMe: req.user?.id === u.id, blockedByMe, blocked: block.length > 0 };
  });

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
