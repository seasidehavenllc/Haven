"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api, saveTokens } from "@/lib/api";
import { ErrorNote } from "./ui";
import { SocialButtons } from "./SocialButtons";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/";
  const [form, setForm] = useState({ email: "", password: "", displayName: "", handle: "", role: "BUYER" });
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setForm({ ...form, [k]: e.target.value });
  return (
    <form
      className="mx-auto max-w-sm space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          const body = mode === "login" ? { email: form.email, password: form.password } : form;
          const r = await api(`/auth/${mode}`, { body });
          saveTokens(r);
          router.push(mode === "register" && form.role === "SELLER" ? "/sell" : next);
        } catch (e) {
          setErr(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1 className="font-display text-3xl font-bold">{mode === "login" ? "Welcome back" : "Join Haven"}</h1>
      {mode === "register" && (
        <div className="grid grid-cols-2 gap-2">
            {[
              ["BUYER", "I want to shop"],
              ["SELLER", "I want to sell"],
            ].map(([v, l]) => (
              <button type="button" key={v} onClick={() => setForm({ ...form, role: v! })} className={`btn-ghost py-3 ${form.role === v ? "border-brand bg-brand/10" : ""}`}>
                {l}
              </button>
            ))}
        </div>
      )}
      <SocialButtons role={form.role as "BUYER" | "SELLER"} onDone={(r) => router.push(r.created && form.role === "SELLER" ? "/sell" : next)} />
      {mode === "register" && (
        <>
          <div>
            <label className="label" htmlFor="dn">Name</label>
            <input id="dn" className="input" value={form.displayName} onChange={set("displayName")} required />
          </div>
          <div>
            <label className="label" htmlFor="handle">Username</label>
            <input id="handle" className="input" value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} required minLength={3} />
          </div>
        </>
      )}
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" className="input" type="email" autoComplete="email" value={form.email} onChange={set("email")} required />
      </div>
      <div>
        <label className="label" htmlFor="pw">Password</label>
        <input id="pw" className="input" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={form.password} onChange={set("password")} required minLength={mode === "register" ? 10 : 1} />
        {mode === "register" && <p className="mt-1 text-xs text-muted">At least 10 characters.</p>}
      </div>
      <ErrorNote error={err} />
      <button className="btn-primary w-full py-3" disabled={busy}>
        {busy ? "One moment…" : mode === "login" ? "Sign in" : "Create account"}
      </button>
      <p className="text-center text-sm text-muted">
        {mode === "login" ? (
          <>
            New here? <Link href="/register" className="underline">Create an account</Link>
          </>
        ) : (
          <>
            Have an account? <Link href="/login" className="underline">Sign in</Link>
          </>
        )}
      </p>
    </form>
  );
}
