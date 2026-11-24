"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api, accessToken, API_URL } from "./api";
import { DEMO, demoJoin, demoOn } from "./demo";

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(!!path);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

export type Me = { canSell?: boolean; sellerApplication?: { status: string; decisionNote: string | null } | null; blockedUserIds?: string[]; user: { id: string; handle: string; displayName: string; roles: string[]; email: string; hasPassword?: boolean; staffRole?: "OWNER" | "MANAGER" | "SUPPORT" | null }; seller: null | { id: string; businessName: string; status?: string; storefront: { slug: string; name: string } | null; plan: { key: string; name: string } | null; aiDisabled: boolean } };

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const load = useCallback(async () => {
    if (!accessToken()) {
      setMe(null);
      setReady(true);
      return;
    }
    try {
      setMe(await api<Me>("/me"));
    } catch {
      setMe(null);
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => {
    load();
    const h = () => load();
    window.addEventListener("haven-auth", h);
    return () => window.removeEventListener("haven-auth", h);
  }, [load]);
  return { me, ready, reload: load };
}

let shared: Socket | null = null;
let sharedToken: string | null = null;
const rooms = new Map<string, { host?: boolean }>();
/**
 * One socket per tab. After sign in or out it reconnects with the new token so the server puts it in
 * the right `user:` room, and on every (re)connect it re-joins the rooms open components asked for.
 */
function socket() {
  if (!shared) {
    sharedToken = accessToken();
    shared = io(API_URL, { auth: { token: sharedToken }, transports: ["websocket", "polling"] });
    shared.on("connect", () => rooms.forEach((o, r) => shared!.emit("subscribe", r, o)));
  }
  return shared;
}
if (typeof window !== "undefined")
  window.addEventListener("haven-auth", () => {
    const t = accessToken();
    if (!shared || t === sharedToken) return;
    sharedToken = t;
    shared.auth = { token: t };
    shared.disconnect().connect();
  });

/** Subscribe to a realtime room and handle events. */
export function useRealtime(room: string | null, handlers: Record<string, (p: any) => void>, opts?: { host?: boolean }) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (DEMO) {
      const offs = Object.keys(ref.current).map((e) => demoOn(e, (p) => ref.current[e]?.(p)));
      const leave = room ? demoJoin(room) : () => {};
      return () => (offs.forEach((f) => f()), leave());
    }
    const s = socket();
    const evts = Object.keys(ref.current);
    const fns = evts.map((e) => [e, (p: any) => ref.current[e]?.(p)] as const);
    fns.forEach(([e, f]) => s.on(e, f));
    if (room) {
      rooms.set(room, opts ?? {});
      s.emit("subscribe", room, opts ?? {});
    }
    return () => {
      if (room) {
        rooms.delete(room);
        s.emit("unsubscribe", room);
      }
      fns.forEach(([e, f]) => s.off(e, f));
    };
  }, [room]);
}
