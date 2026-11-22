"use client";
import { useState } from "react";
import { api, newKey } from "@/lib/api";
import { useApi, useRealtime } from "@/lib/hooks";
import { ErrorNote, Loading, Money } from "@/components/ui";

const FEATURE_LABEL: Record<string, string> = {
  PRODUCT_SCAN: "Photo scan",
  LISTING_GENERATION: "Listing writing",
  PRICE_SUGGESTION: "Price suggestion",
  SHOPPING_ASSISTANT: "Shopping assistant",
  COHOST_MINUTE: "AI co-host",
  AI_HOST_MINUTE: "AI salesperson",
  TRANSCRIPTION_MINUTE: "Live transcription",
  TTS_CHARACTERS: "AI voice",
  AVATAR_MINUTE: "AI avatar video",
};

export default function SellerAi() {
  const b = useApi<any>("/seller/ai/billing");
  const plans = useApi<any>("/ai/plans");
  const caps = useApi<any>("/capabilities");
  const [err, setErr] = useState<any>(null);
  const [note, setNote] = useState<string | null>(null);
  const [limits, setLimits] = useState<{ daily: string; monthly: string } | null>(null);
  useRealtime(null, { "credits:changed": () => b.reload() });
  if (b.loading || plans.loading) return <Loading />;
  if (!b.data || !plans.data) return <ErrorNote error={b.error ?? plans.error} />;
  const sub = b.data.subscription;
  const priceOf = (f: string) => plans.data.featurePrices.find((p: any) => p.feature === f);
  const testMode = caps.data?.payments.provider === "test";
  const lim = limits ?? { daily: b.data.limits?.dailyCreditCap?.toString() ?? "", monthly: b.data.limits?.monthlyCreditCap?.toString() ?? "" };

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold">AI plan & credits</h1>
      {testMode && <div className="rounded-xl bg-warn/10 p-3 text-sm text-warn">Payments are in test mode on this server: plan changes and credit purchases don't charge real money.</div>}
      {caps.data && !caps.data.payments.provider && <div className="rounded-xl bg-warn/10 p-3 text-sm text-warn">Paid plans and credit packs need Stripe to be connected on the server.</div>}
      <ErrorNote error={err} />
      {note && <div className="text-sm text-ok">{note}</div>}

      <div className="grid gap-3 md:grid-cols-3">
        <div className="panel p-4">
          <div className="label">Credits available</div>
          <div className="font-display text-4xl font-bold">{b.data.balance.total.toLocaleString()}</div>
          <div className="text-xs text-muted">
            {b.data.balance.allowance.toLocaleString()} from your plan · {b.data.balance.purchased.toLocaleString()} purchased (never expire)
          </div>
        </div>
        <div className="panel p-4">
          <div className="label">Plan</div>
          <div className="font-display text-2xl font-bold">{sub?.plan.name ?? "None"}</div>
          {sub && (
            <div className="text-xs text-muted">
              Renews {new Date(sub.currentPeriodEnd).toLocaleDateString()}
              {sub.cancelAtPeriodEnd && " · switching to Starter at renewal"}
              {sub.plan.rolloverPercent > 0 && ` · ${sub.plan.rolloverPercent}% of unused plan credits roll over`}
            </div>
          )}
        </div>
        <div className="panel p-4">
          <div className="label">Used this month</div>
          <div className="font-display text-2xl font-bold">{b.data.monthUsed.toLocaleString()} credits</div>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={!b.data.aiDisabled} onChange={(e) => api("/seller/ai/enabled", { method: "PUT", body: { enabled: e.target.checked } }).then(b.reload)} /> AI features on for my store
          </label>
        </div>
      </div>

      <section>
        <h2 className="mb-3 font-display text-xl font-semibold">Plans</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {plans.data.plans.map((p: any) => {
            const current = sub?.plan.key === p.key;
            return (
              <div key={p.id} className={`panel flex flex-col p-4 ${current ? "ring-2 ring-glint" : ""}`}>
                <div className="font-display text-lg font-bold">{p.name}</div>
                <div className="font-display text-3xl font-bold">
                  {p.monthlyPriceCents ? <Money cents={p.monthlyPriceCents} /> : "Free"}
                  {!!p.monthlyPriceCents && <span className="text-sm font-normal text-muted">/mo</span>}
                </div>
                <div className="text-sm">{p.monthlyCredits.toLocaleString()} credits / month</div>
                <ul className="mt-2 flex-1 space-y-1 text-xs text-muted">
                  {p.features.map((f: string) => (
                    <li key={f}>✓ {FEATURE_LABEL[f] ?? f}</li>
                  ))}
                  {p.limits?.maxAiAgents > 0 && <li>✓ {p.limits.maxAiAgents} AI salesperson{p.limits.maxAiAgents > 1 ? "s" : ""}</li>}
                </ul>
                <button
                  className={current ? "btn-ghost mt-3" : "btn-primary mt-3"}
                  disabled={current}
                  onClick={async () => {
                    setErr(null);
                    try {
                      const r = await api("/seller/ai/plan", { body: { planKey: p.key } });
                      setNote(r.scheduled ? `Switching to ${p.name} on ${new Date(r.effectiveAt).toLocaleDateString()}` : r.requiresPayment ? "Complete payment to activate." : `You're on ${p.name}`);
                      b.reload();
                    } catch (e) {
                      setErr(e);
                    }
                  }}
                >
                  {current ? "Current plan" : `Switch to ${p.name}`}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-4">
          <h2 className="mb-2 font-display text-lg font-semibold">Buy more credits</h2>
          <div className="grid grid-cols-3 gap-2">
            {plans.data.creditPacks.map((p: any) => (
              <button
                key={p.key}
                className="btn-ghost flex-col py-3"
                onClick={async () => {
                  setErr(null);
                  try {
                    const r = await api("/seller/ai/credits/purchase", { body: { packKey: p.key, idempotencyKey: newKey() } });
                    setNote(r.requiresPayment ? "Complete payment to add credits." : `Added ${p.credits.toLocaleString()} credits`);
                    b.reload();
                  } catch (e) {
                    setErr(e);
                  }
                }}
              >
                <span className="font-bold">{p.credits.toLocaleString()}</span>
                <span className="text-xs text-muted">
                  <Money cents={p.priceCents} />
                </span>
              </button>
            ))}
          </div>
          <h3 className="mb-1 mt-4 text-sm font-semibold">What things cost</h3>
          <ul className="grid grid-cols-2 gap-1 text-xs text-muted">
            {plans.data.featurePrices.map((f: any) => (
              <li key={f.feature}>
                {FEATURE_LABEL[f.feature] ?? f.feature}: <b className="text-ink">{f.creditsPerUnit}</b> / {f.unitName}
                {b.data.availability[f.feature] === false && " (not available yet)"}
              </li>
            ))}
          </ul>
        </div>
        <div className="panel p-4">
          <h2 className="mb-2 font-display text-lg font-semibold">Spending limits</h2>
          <p className="mb-3 text-xs text-muted">AI stops when you reach a limit, so nothing runs up a surprise bill.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Daily credit cap</label>
              <input className="input" inputMode="numeric" placeholder="No limit" value={lim.daily} onChange={(e) => setLimits({ ...lim, daily: e.target.value.replace(/\D/g, "") })} />
            </div>
            <div>
              <label className="label">Monthly credit cap</label>
              <input className="input" inputMode="numeric" placeholder="No limit" value={lim.monthly} onChange={(e) => setLimits({ ...lim, monthly: e.target.value.replace(/\D/g, "") })} />
            </div>
          </div>
          <button
            className="btn-ghost mt-3"
            onClick={() =>
              api("/seller/ai/limits", { method: "PUT", body: { dailyCreditCap: lim.daily ? Number(lim.daily) : null, monthlyCreditCap: lim.monthly ? Number(lim.monthly) : null, warnAtCredits: null } })
                .then(() => setNote("Limits saved"))
                .catch(setErr)
            }
          >
            Save limits
          </button>
        </div>
      </section>

      <section className="panel p-4">
        <h2 className="mb-2 font-display text-lg font-semibold">Usage history</h2>
        {b.data.usage.length ? (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1">When</th>
                <th>Feature</th>
                <th>Result</th>
                <th className="text-right">Credits</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {b.data.usage.map((u: any) => (
                <tr key={u.id}>
                  <td className="py-1.5">{new Date(u.createdAt).toLocaleString()}</td>
                  <td>{FEATURE_LABEL[u.feature] ?? u.feature}</td>
                  <td className={u.status === "SUCCEEDED" ? "text-ok" : "text-muted"}>{u.status === "SUCCEEDED" ? "done" : u.status === "FAILED" ? "failed (refunded)" : u.status === "DENIED" ? `blocked: ${u.denyReason?.replace(/_/g, " ")}` : u.status.toLowerCase()}</td>
                  <td className="text-right">{u.creditsCharged || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted">No AI usage yet.</p>
        )}
      </section>
    </div>
  );
}
