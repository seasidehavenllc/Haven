"use client";
import { useState } from "react";
import { api } from "@/lib/api";

export type ReportTarget = "video" | "comment" | "stream" | "chat" | "user" | "product";
const REASONS = ["Spam or scam", "Harassment or hate", "Nudity or sexual content", "Violence or dangerous acts", "Something else"];

/** Tell every page to reload who's signed in, so block lists apply everywhere at once. */
const refreshMe = () => window.dispatchEvent(new Event("haven-auth"));

export async function blockUser(handle: string) {
  await api(`/users/${handle}/block`, { body: {} });
  refreshMe();
}
export async function unblockUser(handle: string) {
  await api(`/users/${handle}/block`, { method: "DELETE" });
  refreshMe();
}

/**
 * A small "•••" menu with Report and (optionally) Block. Everything happens inline, with no
 * browser pop-ups.
 */
export function SafetyMenu({ target, targetId, what, handle, className = "", light = false }: { target: ReportTarget; targetId: string; what: string; handle?: string; className?: string; light?: boolean }) {
  const [step, setStep] = useState<"closed" | "menu" | "report" | "block" | "done">("closed");
  const [reason, setReason] = useState(REASONS[0]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      setMsg(done);
      setStep("done");
    } catch (e: any) {
      setMsg(e?.message ?? "Something went wrong. Try again.");
      setStep("done");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`relative ${className}`}>
      <button type="button" aria-label={`More options for ${what}`} aria-expanded={step !== "closed"} onClick={() => setStep(step === "closed" ? "menu" : "closed")} className={`px-1 text-lg leading-none ${light ? "text-white/80 hover:text-white" : "text-muted hover:text-ink"}`}>
        •••
      </button>
      {step !== "closed" && (
        <div className="panel absolute right-0 z-40 mt-1 w-64 space-y-2 p-3 text-left text-sm text-ink shadow-lg">
          {step === "menu" && (
            <>
              <button type="button" className="block w-full rounded px-2 py-1.5 text-left hover:bg-line" onClick={() => setStep("report")}>
                Report {what}
              </button>
              {handle && (
                <button type="button" className="block w-full rounded px-2 py-1.5 text-left text-live hover:bg-line" onClick={() => setStep("block")}>
                  Block @{handle}
                </button>
              )}
            </>
          )}
          {step === "report" && (
            <>
              <p className="font-medium">Why are you reporting {what}?</p>
              <select className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">
                {REASONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setStep("closed")}>
                  Cancel
                </button>
                <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => run(() => api("/reports", { body: { targetType: target, targetId, reason } }), "Thanks. Haven's team reviews reports within 24 hours.")}>
                  Send report
                </button>
              </div>
            </>
          )}
          {step === "block" && handle && (
            <>
              <p>
                <b>Block @{handle}?</b> You won't see each other's videos, comments or chat, and they can't follow you or comment on your videos. They aren't told.
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setStep("closed")}>
                  Cancel
                </button>
                <button type="button" className="rounded-xl bg-live px-3 py-1.5 text-xs font-semibold text-white" disabled={busy} onClick={() => run(() => blockUser(handle), `You blocked @${handle}.`)}>
                  Block
                </button>
              </div>
            </>
          )}
          {step === "done" && (
            <div className="flex items-start justify-between gap-2">
              <p>{msg}</p>
              <button type="button" className="text-muted" aria-label="Close" onClick={() => setStep("closed")}>
                ✕
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
