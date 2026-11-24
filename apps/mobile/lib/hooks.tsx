import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { api, accessToken, API_URL, ApiError, onAuthChange } from "./api";

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
  user: { id: string; handle: string; displayName: string; avatarUrl?: string | null; roles: string[]; email: string; hasPassword?: boolean; staffRole?: "OWNER" | "MANAGER" | "SUPPORT" | null };
  /** People this account blocked or was blocked by. Their content is hidden both ways. */
  blockedUserIds?: string[];
  /** The approved-seller check: true only when Haven approved this person to sell and go live. */
  canSell?: boolean;
  sellerApplication?: { status: "DRAFT" | "SUBMITTED" | "NEEDS_INFO" | "APPROVED" | "REJECTED"; decisionNote: string | null } | null;
  seller: null | { id: string; businessName: string; status?: string; storefront: { slug: string; name: string } | null; plan: { key: string; name: string } | null; aiDisabled: boolean };
};

type MeState = {
  me: Me | null;
  /** True once we know whether someone is signed in. */
  ready: boolean;
  /** Set when a saved sign-in couldn't be checked because the server didn't answer (not when it was rejected). */
  offline: Error | null;
  reload: () => Promise<void>;
};
const MeCtx = createContext<MeState>({ me: null, ready: false, offline: null, reload: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState<Error | null>(null);
  const load = useCallback(async () => {
    if (!(await accessToken())) {
      setMe(null);
      setOffline(null);
      setReady(true);
      return;
    }
    try {
      setMe(await api<Me>("/me"));
      setOffline(null);
      setReady(true);
    } catch (e) {
      // A rejected sign-in (401/403) means signed out. Anything else (no connection, server waking up)
      // keeps the saved sign-in and lets the splash screen offer a retry instead of a login form.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setMe(null);
        setOffline(null);
        setReady(true);
      } else {
        setOffline(e as Error);
      }
    }
    resetSocket();
  }, []);
  useEffect(() => {
    load();
    return onAuthChange(() => void load());
  }, [load]);
  return <MeCtx.Provider value={{ me, ready, offline, reload: load }}>{children}</MeCtx.Provider>;
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
