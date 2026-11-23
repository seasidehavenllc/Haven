import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { api, accessToken, API_URL, onAuthChange } from "./api";

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

export type Me = {
  user: { id: string; handle: string; displayName: string; roles: string[]; email: string };
  seller: null | { id: string; businessName: string; storefront: { slug: string; name: string } | null; plan: { key: string; name: string } | null; aiDisabled: boolean };
};

const MeCtx = createContext<{ me: Me | null; ready: boolean; reload: () => Promise<void> }>({ me: null, ready: false, reload: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const load = useCallback(async () => {
    if (!(await accessToken())) {
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
    resetSocket();
  }, []);
  useEffect(() => {
    load();
    return onAuthChange(() => void load());
  }, [load]);
  return <MeCtx.Provider value={{ me, ready, reload: load }}>{children}</MeCtx.Provider>;
}
export const useMe = () => useContext(MeCtx);

let shared: Socket | null = null;
/** Reconnect so the server sees the new token; listeners and room re-joins (on "connect") carry over. */
function resetSocket() {
  shared?.disconnect().connect();
}
function socket() {
  // Token is read lazily on each (re)connect so a fresh login is picked up.
  shared ??= io(API_URL, { auth: (cb) => void accessToken().then((token) => cb({ token })), transports: ["websocket"] });
  return shared;
}

/** Subscribe to a realtime room. All writes still go through REST; the socket only delivers updates. */
export function useRealtime(room: string | null, handlers: Record<string, (p: any) => void>, opts?: { host?: boolean }) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const s = socket();
    const fns = Object.keys(ref.current).map((e) => [e, (p: any) => ref.current[e]?.(p)] as const);
    fns.forEach(([e, f]) => s.on(e, f));
    const join = () => room && s.emit("subscribe", room, opts ?? {});
    join();
    s.on("connect", join);
    return () => {
      if (room) s.emit("unsubscribe", room);
      s.off("connect", join);
      fns.forEach(([e, f]) => s.off(e, f));
    };
  }, [room]);
}
