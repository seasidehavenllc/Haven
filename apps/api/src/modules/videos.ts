import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { requireAdmin, requireUser } from "../lib/auth";
import { audit } from "../lib/audit";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { parse } from "../lib/validate";
import { notify } from "../notify";
import { MAX_VIDEO, storeUpload } from "../storage";
import { probeVideo } from "../storage/probe";

/**
 * Short-form shoppable videos. Anyone can post; products tagged on a video show as "shop" cards.
 * Counts are real: likes and comments are rows, views are unique viewers per day.
 */

const MAX_TAGS = 6;
const PAGE = 10;

const videoInclude = {
  creator: { select: { id: true, handle: true, displayName: true, avatarUrl: true, seller: { select: { id: true, storefront: { select: { slug: true, name: true } } } } } },
  products: {
    orderBy: { position: "asc" },
    include: {
      product: {
        select: {
          id: true,
          title: true,
          status: true,
          media: { orderBy: { position: "asc" }, take: 1 },
          variants: { select: { id: true, name: true, priceCents: true, quantity: true }, orderBy: { createdAt: "asc" } },
          seller: { select: { id: true, businessName: true, storefront: { select: { slug: true, name: true } } } },
        },
      },
    },
  },
} satisfies Prisma.VideoInclude;
type VideoRow = Prisma.VideoGetPayload<{ include: typeof videoInclude }>;

/** Add per-viewer fields and drop products that are no longer for sale. */
async function present(videos: VideoRow[], userId: string | null) {
  const ids = videos.map((v) => v.id);
  const [liked, following] = userId
    ? await Promise.all([
        prisma.videoLike.findMany({ where: { userId, videoId: { in: ids } }, select: { videoId: true } }),
        prisma.follow.findMany({ where: { followerId: userId, followeeId: { in: [...new Set(videos.map((v) => v.creatorId))] } }, select: { followeeId: true } }),
      ])
    : [[], []];
  const likedSet = new Set(liked.map((l) => l.videoId));
  const followSet = new Set(following.map((f) => f.followeeId));
  return videos.map(({ products, ...v }) => ({
    ...v,
    products: products.map((p) => p.product).filter((p) => p.status === "ACTIVE"),
    likedByMe: likedSet.has(v.id),
    followingCreator: followSet.has(v.creatorId),
  }));
}

const viewerKey = (req: FastifyRequest, day: string) => (req.user ? `u:${req.user.id}` : `ip:${createHash("sha256").update(`${req.ip}|${day}`).digest("hex").slice(0, 32)}`);

export async function videoRoutes(app: FastifyInstance) {
  /**
   * Post a video. Multipart: `video` (MP4/MOV/WebM, up to 100 MB), optional `poster` image, and fields
   * `caption`, `productIds` (JSON array), `durationSec`, `width`, `height`.
   */
  app.post("/videos", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req) => {
    const u = requireUser(req);
    const fields: Record<string, string> = {};
    let video: Awaited<ReturnType<typeof storeUpload>> | null = null;
    let poster: Awaited<ReturnType<typeof storeUpload>> | null = null;
    for await (const part of req.parts({ limits: { fileSize: MAX_VIDEO, files: 2 } })) {
      if (part.type === "file") {
        const buf = await part.toBuffer();
        if (part.fieldname === "video") {
          video = await storeUpload(buf, `videos/${u.id}`);
          if (!video.mime.startsWith("video/")) throw badRequest("The video file must be MP4, MOV or WebM");
        } else if (part.fieldname === "poster") {
          poster = await storeUpload(buf, `videos/${u.id}`);
          if (!poster.mime.startsWith("image/")) throw badRequest("The cover must be an image");
        }
      } else if (typeof part.value === "string") fields[part.fieldname] = part.value;
    }
    if (!video) throw badRequest("Add a video file");
    const meta = parse(
      z.object({
        caption: z.string().trim().max(500).default(""),
        productIds: z.array(z.string()).max(MAX_TAGS).default([]),
        durationSec: z.coerce.number().positive().max(600).optional(),
        width: z.coerce.number().int().positive().max(8000).optional(),
        height: z.coerce.number().int().positive().max(8000).optional(),
      }),
      { ...fields, productIds: fields.productIds ? JSON.parse(fields.productIds) : [] },
    );
    const probed = await probeVideo(video);
    if (probed === null) throw badRequest("We couldn't read that video. Try exporting it as MP4.");
    if (probed && probed.durationSec > 600) throw badRequest("Videos can be up to 10 minutes long");
    const productIds = [...new Set(meta.productIds)];
    if (productIds.length) {
      const me = await prisma.sellerAccount.findUnique({ where: { userId: u.id } });
      const found = await prisma.product.findMany({ where: { id: { in: productIds }, status: "ACTIVE" }, select: { id: true, sellerId: true } });
      if (found.length !== productIds.length) throw badRequest("Some tagged products aren't available");
      // Sellers tag their own products; shoppers and creators can tag anything for sale.
      if (me && found.some((p) => p.sellerId !== me.id)) throw forbidden("Sellers can only tag their own products");
    }
    const v = await prisma.video.create({
      data: {
        creatorId: u.id,
        caption: meta.caption,
        mediaUrl: video.url,
        posterUrl: poster?.url,
        mime: video.mime,
        bytes: video.bytes.length,
        durationSec: probed?.durationSec ?? meta.durationSec,
        width: probed?.width ?? meta.width,
        height: probed?.height ?? meta.height,
        products: { create: productIds.map((productId, position) => ({ productId, position })) },
      },
      include: videoInclude,
    });
    return (await present([v], u.id))[0];
  });

  /** Feed. `tab=foryou` ranks recent videos by engagement and freshness; `tab=following` is newest first from people you follow. */
  app.get("/videos/feed", async (req) => {
    const q = parse(z.object({ tab: z.enum(["foryou", "following"]).default("foryou"), page: z.coerce.number().int().min(0).max(50).default(0), before: z.string().datetime().optional() }), req.query ?? {});
    const userId = req.user?.id ?? null;
    if (q.tab === "following") {
      if (!userId) return { videos: [], next: null };
      const rows = await prisma.video.findMany({
        where: { status: "READY", creator: { followers: { some: { followerId: userId } } }, ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}) },
        orderBy: { createdAt: "desc" },
        take: PAGE,
        include: videoInclude,
      });
      return { videos: await present(rows, userId), next: rows.length === PAGE ? { before: rows.at(-1)!.createdAt.toISOString() } : null };
    }
    // Hacker-News style: engagement over age, last 60 days.
    const ranked = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Video"
      WHERE status = 'READY' AND "createdAt" > now() - interval '60 days'
      ORDER BY ("likeCount" * 3 + "commentCount" * 5 + "viewCount" * 0.2 + 1)
               / power(extract(epoch from (now() - "createdAt")) / 3600 + 2, 1.5) DESC, "createdAt" DESC
      OFFSET ${q.page * PAGE} LIMIT ${PAGE}`;
    const rows = await prisma.video.findMany({ where: { id: { in: ranked.map((r) => r.id) } }, include: videoInclude });
    const order = new Map(ranked.map((r, i) => [r.id, i]));
    rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return { videos: await present(rows, userId), next: rows.length === PAGE ? { page: q.page + 1 } : null };
  });

  app.get("/videos/:id", async (req) => {
    const v = await prisma.video.findFirst({ where: { id: (req.params as any).id, status: "READY" }, include: videoInclude });
    if (!v) throw notFound("Video");
    return (await present([v], req.user?.id ?? null))[0];
  });

  app.get("/users/:handle/videos", async (req) => {
    const user = await prisma.user.findUnique({ where: { handle: (req.params as any).handle }, select: { id: true } });
    if (!user) throw notFound("User");
    const rows = await prisma.video.findMany({ where: { creatorId: user.id, status: "READY" }, orderBy: { createdAt: "desc" }, take: 60, include: videoInclude });
    return present(rows, req.user?.id ?? null);
  });

  app.delete("/videos/:id", async (req) => {
    const u = requireUser(req);
    const n = await prisma.video.updateMany({ where: { id: (req.params as any).id, creatorId: u.id, status: "READY" }, data: { status: "REMOVED", removedReason: "Deleted by creator" } });
    if (!n.count) throw notFound("Video");
    return { ok: true };
  });

  // Likes: the row and the counter change in one transaction; repeats are no-ops.
  app.post("/videos/:id/like", async (req) => {
    const u = requireUser(req);
    const id = (req.params as any).id as string;
    const v = await prisma.video.findFirst({ where: { id, status: "READY" } });
    if (!v) throw notFound("Video");
    const added = await prisma.$transaction(async (tx) => {
      const n = await tx.$executeRaw`INSERT INTO "VideoLike" ("videoId", "userId") VALUES (${id}, ${u.id}) ON CONFLICT DO NOTHING`;
      if (n) await tx.video.update({ where: { id }, data: { likeCount: { increment: 1 } } });
      return n > 0;
    });
    if (added && v.creatorId !== u.id) {
      const me = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { displayName: true } });
      await notify({ userId: v.creatorId, type: "video.like", title: `${me.displayName} liked your video`, body: v.caption.slice(0, 80) || null, link: `/videos/${id}`, data: { videoId: id, userId: u.id } });
    }
    return { liked: true, likeCount: (await prisma.video.findUniqueOrThrow({ where: { id }, select: { likeCount: true } })).likeCount };
  });

  app.delete("/videos/:id/like", async (req) => {
    const u = requireUser(req);
    const id = (req.params as any).id as string;
    await prisma.$transaction(async (tx) => {
      const n = await tx.videoLike.deleteMany({ where: { videoId: id, userId: u.id } });
      if (n.count) await tx.video.update({ where: { id }, data: { likeCount: { decrement: n.count } } });
    });
    const v = await prisma.video.findUnique({ where: { id }, select: { likeCount: true } });
    return { liked: false, likeCount: v?.likeCount ?? 0 };
  });

  app.get("/videos/:id/comments", async (req) => {
    const { before } = parse(z.object({ before: z.string().datetime().optional() }), req.query ?? {});
    return prisma.videoComment.findMany({
      where: { videoId: (req.params as any).id, hidden: false, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { user: { select: { id: true, handle: true, displayName: true, avatarUrl: true } } },
    });
  });

  app.post("/videos/:id/comments", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const u = requireUser(req);
    const id = (req.params as any).id as string;
    const { body } = parse(z.object({ body: z.string().trim().min(1).max(300) }), req.body);
    const v = await prisma.video.findFirst({ where: { id, status: "READY" } });
    if (!v) throw notFound("Video");
    const c = await prisma.$transaction(async (tx) => {
      const c = await tx.videoComment.create({ data: { videoId: id, userId: u.id, body }, include: { user: { select: { id: true, handle: true, displayName: true, avatarUrl: true } } } });
      await tx.video.update({ where: { id }, data: { commentCount: { increment: 1 } } });
      return c;
    });
    if (v.creatorId !== u.id) await notify({ userId: v.creatorId, type: "video.comment", title: `${c.user.displayName} commented on your video`, body: body.slice(0, 120), link: `/videos/${id}`, data: { videoId: id, commentId: c.id } });
    return c;
  });

  /** The comment's author or the video's creator can remove a comment. */
  app.delete("/videos/:id/comments/:cid", async (req) => {
    const u = requireUser(req);
    const { id, cid } = req.params as { id: string; cid: string };
    const c = await prisma.videoComment.findFirst({ where: { id: cid, videoId: id, hidden: false }, include: { video: { select: { creatorId: true } } } });
    if (!c) throw notFound("Comment");
    if (c.userId !== u.id && c.video.creatorId !== u.id) throw forbidden();
    await prisma.$transaction([prisma.videoComment.update({ where: { id: cid }, data: { hidden: true } }), prisma.video.update({ where: { id }, data: { commentCount: { decrement: 1 } } })]);
    return { ok: true };
  });

  /** Count a view once per viewer per day. */
  app.post("/videos/:id/view", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
    const id = (req.params as any).id as string;
    const day = new Date().toISOString().slice(0, 10);
    const key = viewerKey(req, day);
    const counted = await prisma.$transaction(async (tx) => {
      const exists = await tx.video.findFirst({ where: { id, status: "READY" }, select: { creatorId: true } });
      if (!exists || (req.user && exists.creatorId === req.user.id)) return false;
      const n = await tx.$executeRaw`INSERT INTO "VideoView" ("videoId", "viewerKey", "day") VALUES (${id}, ${key}, ${day}) ON CONFLICT DO NOTHING`;
      if (n) await tx.video.update({ where: { id }, data: { viewCount: { increment: 1 } } });
      return n > 0;
    });
    return { counted };
  });

  app.post("/videos/:id/report", async (req) => {
    const u = requireUser(req);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
    const id = (req.params as any).id as string;
    if (!(await prisma.video.findUnique({ where: { id } }))) throw notFound("Video");
    const dup = await prisma.report.findFirst({ where: { reporterId: u.id, targetType: "video", targetId: id, status: "OPEN" } });
    if (dup) throw conflict("You've already reported this video");
    await prisma.report.create({ data: { reporterId: u.id, targetType: "video", targetId: id, reason } });
    return { ok: true };
  });

  app.post("/admin/videos/:id/remove", async (req) => {
    const admin = await requireAdmin(req);
    const id = (req.params as any).id as string;
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
    const v = await prisma.video.findUnique({ where: { id } });
    if (!v) throw notFound("Video");
    await prisma.$transaction([
      prisma.video.update({ where: { id }, data: { status: "REMOVED", removedReason: reason } }),
      prisma.report.updateMany({ where: { targetType: "video", targetId: id, status: "OPEN" }, data: { status: "ACTIONED" } }),
    ]);
    await audit(prisma, { actorId: admin.id, action: "moderation.video.remove", targetType: "video", targetId: id, data: { reason } });
    await notify({ userId: v.creatorId, type: "moderation.video_removed", title: "A video was removed", body: reason });
    return { ok: true };
  });
}
