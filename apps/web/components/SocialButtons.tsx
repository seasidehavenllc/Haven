"use client";
import { useEffect, useRef, useState } from "react";
import { api, saveTokens } from "@/lib/api";
import { ErrorNote } from "./ui";

/**
 * Sign in with Apple / Google on the web. Each button only shows when both this site has its public
 * client id and the API says that provider is configured. The provider gives us an ID token, which the
 * API verifies; nothing secret lives in the browser.
 */
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const APPLE_SERVICES_ID = process.env.NEXT_PUBLIC_APPLE_SERVICES_ID;
const APPLE_REDIRECT_URI = process.env.NEXT_PUBLIC_APPLE_REDIRECT_URI;

declare global {
  interface Window {
    google?: any;
    AppleID?: any;
  }
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Couldn't load ${new URL(src).host}`));
    document.head.appendChild(s);
  });
}

const randomNonce = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

export function SocialButtons({ role, onDone }: { role: "BUYER" | "SELLER"; onDone: (r: { created: boolean }) => void }) {
  const [on, setOn] = useState<{ apple: boolean; google: boolean } | null>(null);
  const [err, setErr] = useState<any>(null);
  const googleBox = useRef<HTMLDivElement>(null);
  const roleRef = useRef(role);
  roleRef.current = role;

  useEffect(() => {
    api<{ apple: boolean; google: boolean }>("/auth/providers")
      .then((p) => setOn({ apple: p.apple && !!APPLE_SERVICES_ID && !!APPLE_REDIRECT_URI, google: p.google && !!GOOGLE_CLIENT_ID }))
      .catch(() => setOn({ apple: false, google: false }));
  }, []);

  const finish = async (provider: "apple" | "google", body: Record<string, unknown>) => {
    setErr(null);
    try {
      const r = await api(`/auth/${provider}`, { body: { ...body, role: roleRef.current } });
      saveTokens(r);
      onDone(r);
    } catch (e) {
      setErr(e);
    }
  };

  useEffect(() => {
    if (!on?.google || !googleBox.current) return;
    const nonce = randomNonce();
    loadScript("https://accounts.google.com/gsi/client")
      .then(() => {
        window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, nonce, callback: (r: { credential: string }) => finish("google", { idToken: r.credential, nonce }) });
        window.google.accounts.id.renderButton(googleBox.current, { theme: "filled_black", size: "large", shape: "pill", text: "continue_with", width: 384 });
      })
      .catch(setErr);
  }, [on?.google]);

  async function apple() {
    setErr(null);
    try {
      await loadScript("https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js");
      const nonce = randomNonce();
      window.AppleID.auth.init({ clientId: APPLE_SERVICES_ID, scope: "name email", redirectURI: APPLE_REDIRECT_URI, usePopup: true, nonce });
      const r = await window.AppleID.auth.signIn();
      const n = r.user?.name;
      await finish("apple", { idToken: r.authorization.id_token, nonce, name: n ? [n.firstName, n.lastName].filter(Boolean).join(" ") || undefined : undefined });
    } catch (e: any) {
      // Closing the popup isn't an error worth showing.
      if (e?.error !== "popup_closed_by_user") setErr(e instanceof Error ? e : new Error("Apple sign-in didn't finish"));
    }
  }

  if (!on || (!on.apple && !on.google)) return null;
  return (
    <div className="space-y-2">
      {on.apple && (
        <button type="button" onClick={apple} className="flex w-full items-center justify-center gap-2 rounded-full bg-white py-3 font-semibold text-black">
          <svg width="16" height="18" viewBox="0 0 814 1000" aria-hidden fill="currentColor">
            <path d="M788 341c-6 4-108 62-108 190 0 149 131 201 135 203-1 3-21 72-69 142-43 62-88 124-156 124s-86-40-165-40c-77 0-104 41-166 41s-106-57-156-127C45 791 0 666 0 548c0-191 124-292 246-292 65 0 119 43 160 43 39 0 100-45 174-45 28 0 129 2 196 97zM554 157c31-37 53-88 53-139 0-7-1-14-2-20-50 2-110 34-146 76-28 32-55 83-55 135 0 8 1 15 2 18 3 1 9 2 14 2 45 0 101-30 134-72z" />
          </svg>
          Continue with Apple
        </button>
      )}
      {on.google && <div ref={googleBox} className="flex justify-center" />}
      <ErrorNote error={err} />
      <div className="flex items-center gap-3 py-1 text-xs text-muted">
        <span className="h-px flex-1 bg-line" />
        or with email
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
