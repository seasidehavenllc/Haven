"use client";
import { DEMO, DEMO_TOKEN, demoApi } from "./demo";
/** The server's base URL, without trailing slashes, so `${API_URL}/auth/login` never becomes "//auth/login". */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:4000").replace(/\/+$/, "");

type Tokens = { accessToken: string; refreshToken?: string };
const KEY = "haven.auth";

function read(): Tokens | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}
export function saveTokens(t: Tokens) {
  const cur = read();
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...cur, ...t }));
  } catch {}
  window.dispatchEvent(new Event("haven-auth"));
}
export function clearTokens() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  window.dispatchEvent(new Event("haven-auth"));
}
export const accessToken = () => read()?.accessToken ?? null;

// The demo starts signed in as the sample shopper (signing out and back in works too).
if (DEMO && typeof window !== "undefined") {
  try {
    if (!sessionStorage.getItem("haven.demo.started")) {
      sessionStorage.setItem("haven.demo.started", "1");
      if (!read()) localStorage.setItem(KEY, JSON.stringify({ accessToken: DEMO_TOKEN, refreshToken: DEMO_TOKEN }));
    }
  } catch {}
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  const t = read();
  if (!t?.refreshToken) return false;
  refreshing ??= fetch(`${API_URL}/auth/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: t.refreshToken }) })
    .then(async (r) => {
      if (!r.ok) {
        clearTokens();
        return false;
      }
      saveTokens(await r.json());
      return true;
    })
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}, retry = true): Promise<T> {
  if (DEMO) {
    try {
      return (await demoApi(path, init)) as T;
    } catch (e: any) {
      throw new ApiError(e.status ?? 500, e.code ?? "error", e.message ?? "Demo error");
    }
  }
  const headers: Record<string, string> = {};
  const token = accessToken();
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

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
