import { Server } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { verifyAccessToken } from "./lib/auth";
import { env } from "./env";

/**
 * Realtime fan-out. Clients only *subscribe* over sockets; every mutation goes through
 * the REST API (validated server-side) and is then broadcast here.
 * For multi-instance deployments add @socket.io/redis-adapter (REDIS_URL).
 */
let io: Server | null = null;
const viewers = new Map<string, Set<string>>(); // streamId -> socket ids

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
