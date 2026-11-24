import { Server } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { verifyAccessToken } from "./lib/auth";
import { env } from "./env";
import { prisma } from "./db";

/**
 * Realtime fan-out. Clients only *subscribe* over sockets; every mutation goes through
 * the REST API (validated server-side) and is then broadcast here.
 * For multi-instance deployments add @socket.io/redis-adapter (REDIS_URL).
 */
let io: Server | null = null;
const viewers = new Map<string, Set<string>>(); // streamId -> socket ids
/** When each signed-in viewer was last announced in a show, so reconnects don't spam "joined" lines. */
const announced = new Map<string, number>(); // `${streamId}:${userId}` -> ms
const ANNOUNCE_EVERY_MS = 10 * 60_000;

export function initRealtime(server: HttpServer) {
  io = new Server(server, { cors: { origin: env.WEB_ORIGIN.split(",").map((o) => o.trim()), credentials: true } });
  io.on("connection", async (socket) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (token) {
      try {
        const u = await verifyAccessToken(token);
        socket.data.userId = u.id;
        socket.join(`user:${u.id}`);
        if (u.sellerId) socket.join(`seller:${u.sellerId}`);
      } catch {
        /* anonymous viewer */
      }
    }
    socket.on("subscribe", (room: unknown, opts?: { host?: boolean }) => {
      if (typeof room !== "string" || !/^(stream|auction|product):[a-z0-9]+$/i.test(room)) return;
      socket.join(room);
      // The host's own studio connection is not counted as a viewer.
      if (room.startsWith("stream:") && !opts?.host) {
        const id = room.slice(7);
        if (!viewers.has(id)) viewers.set(id, new Set());
        viewers.get(id)!.add(socket.id);
        emit(room, "stream:viewers", { streamId: id, count: viewers.get(id)!.size });
        if (socket.data.userId) void announceJoin(id, socket.data.userId as string);
      }
    });
    socket.on("unsubscribe", (room: unknown) => {
      if (typeof room !== "string") return;
      socket.leave(room);
      leaveStream(room, socket.id);
    });
    socket.on("disconnect", () => {
      for (const id of viewers.keys()) leaveStream(`stream:${id}`, socket.id);
    });
  });
  return io;
}

/** "Maya joined" in the show's chat. Only signed-in viewers are named; the app hides people the viewer blocked. */
async function announceJoin(streamId: string, userId: string) {
  const key = `${streamId}:${userId}`;
  const now = Date.now();
  if (now - (announced.get(key) ?? 0) < ANNOUNCE_EVERY_MS) return;
  announced.set(key, now);
  if (announced.size > 50_000) for (const [k, t] of announced) if (now - t > ANNOUNCE_EVERY_MS) announced.delete(k);
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { handle: true, displayName: true } });
    if (u) emit(`stream:${streamId}`, "stream:joined", { streamId, userId, handle: u.handle, displayName: u.displayName });
  } catch {
    /* a missed join line is harmless */
  }
}

function leaveStream(room: string, sid: string) {
  if (!room.startsWith("stream:")) return;
  const id = room.slice(7);
  const set = viewers.get(id);
  if (set?.delete(sid)) emit(room, "stream:viewers", { streamId: id, count: set.size });
}

/** Real connected-socket count. Never inflated. */
export const viewerCount = (streamId: string) => viewers.get(streamId)?.size ?? 0;

export function emit(room: string, event: string, payload: unknown) {
  io?.to(room).emit(event, payload);
}
