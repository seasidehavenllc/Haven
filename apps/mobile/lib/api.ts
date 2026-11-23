import * as SecureStore from "expo-secure-store";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

type Tokens = { accessToken: string; refreshToken?: string };
const KEY = "haven.auth";
let cache: Tokens | null | undefined;
const listeners = new Set<() => void>();
export const onAuthChange = (f: () => void) => (listeners.add(f), () => void listeners.delete(f));

async function read(): Promise<Tokens | null> {
  if (cache !== undefined) return cache;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    cache = raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    cache = null;
  }
  return cache;
}
export async function saveTokens(t: Tokens) {
  cache = { ...(await read()), ...t } as Tokens;
  await SecureStore.setItemAsync(KEY, JSON.stringify(cache));
  listeners.forEach((f) => f());
}
export async function clearTokens() {
  cache = null;
  await SecureStore.deleteItemAsync(KEY);
  listeners.forEach((f) => f());
}
export const accessToken = async () => (await read())?.accessToken ?? null;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  const t = await read();
  if (!t?.refreshToken) return false;
  refreshing ??= fetch(`${API_URL}/auth/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: t.refreshToken }) })
    .then(async (r) => {
      if (!r.ok) {
        await clearTokens();
        return false;
      }
      await saveTokens(await r.json());
      return true;
    })
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  const token = await accessToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? (init.body !== undefined || init.form ? "POST" : "GET"),
    headers,
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
  if (res.status === 401 && retry && (await refresh())) return api<T>(path, init, false);
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json?.error ?? "error", json?.message ?? `Request failed (${res.status})`, json?.details);
  return json as T;
}

export const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

/** Revoke the refresh token on the server, then forget both tokens on the device. */
export async function logout() {
  const t = await read();
  // Imported lazily to avoid a require cycle (push.ts uses api()).
  await (await import("./push")).unregisterPush();
  if (t?.refreshToken) await api("/auth/logout", { body: { refreshToken: t.refreshToken } }).catch(() => {});
  await clearTokens();
}
