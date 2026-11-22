"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api, accessToken, API_URL } from "./api";

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

export type Me = { user: { id: string; handle: string; displayName: string; roles: string[]; email: string }; seller: null | { id: string; businessName: string; storefront: { slug: string; name: string } | null; plan: { key: string; name: string } | null; aiDisabled: boolean } };

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
    window.addEventListener("glint-auth", h);
    return () => window.removeEventListener("glint-auth", h);
  }, [load]);
  return { me, ready, reload: load };
}

let shared: Socket | null = null;
function socket() {
  if (!shared) shared = io(API_URL, { auth: { token: accessToken() }, transports: ["websocket", "polling"] });
  return shared;
}

/** Subscribe to a realtime room and handle events. */
export function useRealtime(room: string | null, handlers: Record<string, (p: any) => void>, opts?: { host?: boolean }) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const s = socket();
    const evts = Object.keys(ref.current);
    const fns = evts.map((e) => [e, (p: any) => ref.current[e]?.(p)] as const);
    fns.forEach(([e, f]) => s.on(e, f));
    if (room) s.emit("subscribe", room, opts ?? {});
    return () => {
      if (room) s.emit("unsubscribe", room);
      fns.forEach(([e, f]) => s.off(e, f));
    };
  }, [room]);
}
