import * as SecureStore from "expo-secure-store";

/** The server's base URL, without trailing slashes, so `${API_URL}/auth/login` never becomes "//auth/login". */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL?.trim() || "http://localhost:4000").replace(/\/+$/, "");

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
  if (init.form) return upload<T>(path, init.form, headers, retry);
  const method = init.method ?? (init.body !== undefined ? "POST" : "GET");
  let res: Response;
  try {
    res = await send(`${API_URL}${path}`, { method, headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
  } catch (e) {
    // iOS drops idle keep-alive connections ("The network connection was lost"). A read is safe to
    // send again, and the second try opens a fresh connection.
    if (method !== "GET") throw e;
    await new Promise((r) => setTimeout(r, 600));
    res = await send(`${API_URL}${path}`, { method, headers });
  }
  if (res.status === 401 && retry && (await refresh())) return api<T>(path, init, false);
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json?.error ?? "error", json?.message ?? `Request failed (${res.status})`, json?.details);
  return json as T;
}

/** One request that gives up after 30 seconds instead of spinning forever. Network failures throw a plain Error. */
async function send(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e: any) {
    throw new Error(e?.name === "AbortError" ? "Network request timed out" : "Network request failed");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Multipart uploads (photos, videos) go through React Native's XMLHttpRequest, which sends
 * `{ uri, name, type }` file parts straight from disk. Expo's fetch rejects those parts with
 * "Unsupported FormDataPart implementation".
 */
function upload<T>(path: string, form: FormData, headers: Record<string, string>, retry: boolean): Promise<T> {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}${path}`);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.timeout = 180_000;
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => reject(new Error("Network request failed"));
    xhr.ontimeout = () => reject(new Error("Network request timed out"));
    xhr.send(form);
  }).then(async ({ status, text }) => {
    if (status === 401 && retry && (await refresh())) {
      const token = await accessToken();
      return upload<T>(path, form, token ? { authorization: `Bearer ${token}` } : {}, false);
    }
    const json = text ? JSON.parse(text) : null;
    if (status < 200 || status >= 300) throw new ApiError(status, json?.error ?? "error", json?.message ?? `Request failed (${status})`, json?.details);
    return json as T;
  });
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
