"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useApi, useMe } from "@/lib/hooks";
import { ErrorNote, Loading } from "@/components/ui";
import { AuditTab, has, OrdersTab, RoleBanner, SellerApplicationsTab, SellersTab, ShowsTab, StaffTab, UserDetail, type Staff } from "./sections";

const usd = (n: number | null | undefined, d = 2) => (n == null ? "—" : `$${n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`);
type Tab = { name: string; show: (s: Staff) => boolean };
// Each person only sees the sections their role allows. The server checks every request as well.
const TABS: Tab[] = [
  { name: "Overview", show: () => true },
  { name: "Orders", show: (s) => has(s, "orders.view") },
  { name: "People", show: (s) => has(s, "users.view") },
  { name: "Reports", show: (s) => has(s, "reports.view") },
  { name: "Seller applications", show: (s) => has(s, "sellers.view") },
  { name: "Sellers", show: (s) => has(s, "sellers.manage") },
  { name: "Live shows", show: (s) => has(s, "shows.manage") },
  { name: "AI profitability", show: (s) => has(s, "finance.view") },
  { name: "AI providers", show: (s) => has(s, "ai.manage") },
  { name: "Plans & pricing", show: (s) => has(s, "ai.manage") },
  { name: "Staff", show: (s) => has(s, "staff.manage") },
  { name: "Audit log", show: (s) => has(s, "audit.view") },
];

export default function Admin() {
  const { me, ready } = useMe();
  const router = useRouter();
  const staff = useApi<Staff>(ready && me?.user.staffRole ? "/admin/me" : null, [ready, me?.user.staffRole]);
  const [tab, setTab] = useState("Overview");
  useEffect(() => {
    if (ready && !me?.user.staffRole) router.push("/");
  }, [ready, me, router]);
  if (!ready || !me?.user.staffRole || !staff.data?.role) return staff.error ? <ErrorNote error={staff.error} /> : <Loading />;
  const s = staff.data;
  const tabs = TABS.filter((t) => t.show(s));
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold">Platform control</h1>
      <RoleBanner staff={s} />
      <nav className="flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button key={t.name} onClick={() => setTab(t.name)} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium ${tab === t.name ? "bg-brand text-brand-ink" : "hover:bg-card"}`}>
            {t.name}
          </button>
        ))}
      </nav>
      {tab === "Overview" && <Overview staff={s} />}
      {tab === "Orders" && <OrdersTab staff={s} />}
      {tab === "People" && <Users staff={s} />}
      {tab === "Reports" && <Reports staff={s} />}
      {tab === "Seller applications" && <SellerApplicationsTab staff={s} />}
      {tab === "Sellers" && <SellersTab />}
      {tab === "Live shows" && <ShowsTab />}
      {tab === "AI profitability" && <Profitability />}
      {tab === "AI providers" && <Providers />}
      {tab === "Plans & pricing" && <Plans />}
      {tab === "Staff" && <StaffTab />}
      {tab === "Audit log" && <AuditTab />}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="panel p-4">
      <div className="label">{label}</div>
      <div className="font-display text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

function Overview({ staff }: { staff: Staff }) {
  const o = useApi<any>("/admin/overview");
  if (o.loading) return <Loading />;
  if (o.error) return <ErrorNote error={o.error} />;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Users" value={o.data.users} />
        <Stat label="Sellers" value={o.data.sellers} />
        <Stat label="Live now" value={o.data.liveStreams} />
        {o.data.gmvUsd != null ? (
          <Stat label="GMV" value={usd(o.data.gmvUsd)} sub={`${o.data.orders} orders · fees ${usd(o.data.marketplaceFeesUsd)} · test orders excluded`} />
        ) : (
          <Stat label="Orders" value={o.data.orders} sub="test orders excluded" />
        )}
        <Stat label="Active listings" value={o.data.products} />
        <Stat label="Open reports" value={o.data.openReports} sub={o.data.openReports ? "act within 24 hours" : undefined} />
      </div>
      {has(staff, "settings.manage") && <Settings />}
    </div>
  );
}

function Settings() {
  const s = useApi<any>("/admin/settings");
  const [err, setErr] = useState<any>(null);
  const [form, setForm] = useState<any>(null);
  useEffect(() => {
    if (s.data)
      setForm({ fee: s.data.marketplaceFeeBps / 100, daily: s.data.aiDailyBudgetUsd ?? "", monthly: s.data.aiMonthlyBudgetUsd ?? "", manager: s.data.managerRefundLimitCents / 100, support: s.data.supportRefundLimitCents / 100 });
  }, [s.data]);
  if (s.loading || !form) return <Loading />;
  const save = (body: unknown) => api("/admin/settings", { method: "PATCH", body }).then(s.reload).catch(setErr);
  return (
    <>
      <div className={`panel flex flex-wrap items-center justify-between gap-3 p-4 ${s.data.aiEmergencyDisabled ? "border-live bg-live/5" : ""}`}>
        <div>
          <div className="font-semibold">AI emergency switch</div>
          <div className="text-sm text-muted">{s.data.aiEmergencyDisabled ? "All AI features are OFF for every seller and buyer." : "AI features are running normally."}</div>
        </div>
        <button className={s.data.aiEmergencyDisabled ? "btn-primary" : "btn bg-live text-white"} onClick={() => save({ aiEmergencyDisabled: !s.data.aiEmergencyDisabled })}>
          {s.data.aiEmergencyDisabled ? "Turn AI back on" : "Turn off all AI"}
        </button>
      </div>
      <div className="panel grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-6">
        <div>
          <label className="label">Marketplace fee (%)</label>
          <input className="input" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} />
        </div>
        <div>
          <label className="label">AI daily provider budget ($)</label>
          <input className="input" placeholder="No limit" value={form.daily} onChange={(e) => setForm({ ...form, daily: e.target.value })} />
        </div>
        <div>
          <label className="label">AI monthly provider budget ($)</label>
          <input className="input" placeholder="No limit" value={form.monthly} onChange={(e) => setForm({ ...form, monthly: e.target.value })} />
        </div>
        <div>
          <label className="label">Manager refund limit ($/order)</label>
          <input className="input" value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} />
        </div>
        <div>
          <label className="label">Support refund limit ($/order)</label>
          <input className="input" value={form.support} onChange={(e) => setForm({ ...form, support: e.target.value })} />
        </div>
        <button
          className="btn-primary self-end"
          onClick={() =>
            save({
              marketplaceFeeBps: Math.round(Number(form.fee) * 100),
              aiDailyBudgetUsd: form.daily === "" ? null : Number(form.daily),
              aiMonthlyBudgetUsd: form.monthly === "" ? null : Number(form.monthly),
              managerRefundLimitUsd: Number(form.manager),
              supportRefundLimitUsd: Number(form.support),
            })
          }
        >
          Save
        </button>
      </div>
      <ErrorNote error={err} />
    </>
  );
}

function Profitability() {
  const [days, setDays] = useState(30);
  const [includeTest, setIncludeTest] = useState(false);
  // Computed once per range choice; recomputing on every render changed the URL and refetched in a loop.
  const from = useMemo(() => new Date(Date.now() - days * 864e5).toISOString(), [days]);
  const { data: p, loading } = useApi<any>(`/admin/ai/profitability?from=${encodeURIComponent(from)}&includeTest=${includeTest}`, [days, includeTest]);
  if (loading || !p) return <Loading />;
  const t = p.totals;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select className="input w-40" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[1, 7, 30, 90, 365].map((d) => (
            <option key={d} value={d}>
              Last {d} day{d > 1 ? "s" : ""}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} /> Include test-mode revenue
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="AI revenue" value={usd(t.revenueUsd)} sub={includeTest ? "includes test payments" : "real payments only"} />
        <Stat label="Provider cost" value={usd(t.providerCostUsd, 4)} sub={`${t.operations} AI operations`} />
        <Stat label="Gross margin" value={usd(t.grossMarginUsd)} sub={t.grossMarginPct == null ? "no revenue yet" : `${t.grossMarginPct.toFixed(1)}%`} />
        <Stat label="Credits consumed" value={t.creditsConsumed.toLocaleString()} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Avg cost / photo scan" value={usd(p.averages.costPerProductScanUsd, 4)} />
        <Stat label="Avg cost / assistant chat" value={usd(p.averages.costPerAssistantConversationUsd, 4)} />
        <Stat label="Avg cost / co-host call" value={usd(p.averages.costPerCohostCallUsd, 4)} />
        <Stat label="Avg cost / AI-host minute" value={usd(p.averages.costPerAiHostMinuteUsd, 4)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Table title="Cost by feature" rows={p.costByFeature} cols={[["feature", "Feature"], ["ops", "Ops"], ["credits", "Credits"], ["costUsd", "Cost", (v: number) => usd(v, 4)]]} />
        <Table title="Cost by provider / model" rows={p.costByProvider} cols={[["provider", "Provider"], ["model", "Model"], ["ops", "Ops"], ["costUsd", "Cost", (v: number) => usd(v, 4)]]} />
        <Table title="Revenue by plan" rows={p.revenueByPlan} cols={[["plan", "Plan"], ["usd", "Revenue", (v: number) => usd(v)]]} />
        <Table title="Cost by plan" rows={p.costByPlan} cols={[["plan", "Plan"], ["ops", "Ops"], ["costUsd", "Cost", (v: number) => usd(v, 4)]]} />
        <Table title="Highest-cost sellers" rows={p.topSellers} cols={[["name", "Seller"], ["ops", "Ops"], ["costUsd", "Cost", (v: number) => usd(v, 4)], ["anomalous", "Flag", (v: boolean) => (v ? "⚠ unusual" : "")]]} />
        <Table title="Outcomes" rows={p.statusCounts} cols={[["status", "Status"], ["reason", "Reason"], ["count", "Count"]]} />
      </div>
    </div>
  );
}

function Table({ title, rows, cols }: { title: string; rows: any[]; cols: [string, string, ((v: any) => any)?][] }) {
  return (
    <div className="panel p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {rows.length ? <Rows rows={rows.map((r) => cols.map(([k, , f]) => (f ? f(r[k]) : (r[k] ?? "—"))))} heads={cols.map(([, l]) => l)} /> : <p className="text-sm text-muted">No data in this window.</p>}
    </div>
  );
}

/** A table on wide screens; on phones each row becomes a small card of "label: value" lines, so nothing runs off screen. */
function Rows({ heads, rows }: { heads: string[]; rows: React.ReactNode[][] }) {
  return (
    <>
      <table className="hidden w-full text-left text-sm sm:table">
        <thead className="text-xs text-muted">
          <tr>{heads.map((h) => <th key={h} className="py-1 pr-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className="break-words py-1.5 pr-3">{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
      <div className="divide-y divide-line sm:hidden">
        {rows.map((r, i) => (
          <dl key={i} className="space-y-1 py-2 text-sm">
            {r.map((c, j) => (
              <div key={j} className="flex items-center justify-between gap-3">
                <dt className="shrink-0 text-xs text-muted">{heads[j]}</dt>
                <dd className="min-w-0 break-words text-right">{c}</dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
    </>
  );
}

const NAMES: Record<string, string> = {
  LLM_TEXT: "Text",
  LLM_AGENT: "Live host",
  VISION_PRODUCT_ID: "Photo scan",
  SPEECH_TO_TEXT: "Speech to text",
  TEXT_TO_SPEECH: "Voice",
  AVATAR_VIDEO: "Avatar video",
  TTS_CHARACTERS: "Voice (per 1k characters)",
  COHOST_MINUTE: "AI co-host minute",
  AI_HOST_MINUTE: "AI host minute",
};
const label = (k: string) => NAMES[k] ?? k.charAt(0) + k.slice(1).toLowerCase().replace(/_/g, " ");

function Toggle({ on, onChange, label: l }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={l}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition ${on ? "bg-brand" : "bg-line"}`}
    >
      <span className={`inline-block h-6 w-6 rounded-full bg-white shadow transition ${on ? "translate-x-7" : "translate-x-1"}`} />
    </button>
  );
}

function Providers() {
  const p = useApi<any[]>("/admin/ai/providers");
  const r = useApi<any[]>("/admin/ai/routing");
  const [err, setErr] = useState<any>(null);
  if (p.loading || r.loading) return <Loading />;
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">Secrets live in server environment variables. This page only shows whether each one is set.</p>
      <ErrorNote error={err} />
      <div className="grid gap-3 md:grid-cols-2">
        {p.data?.map((x) => (
          <div key={x.id} className="panel min-w-0 space-y-2 break-words p-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 font-semibold">{x.name}</div>
              <div className="flex items-center gap-2 text-xs text-muted">
                {x.enabled ? "On" : "Off"}
                <Toggle
                  on={x.enabled}
                  label={`${x.name} enabled`}
                  onChange={(v) => {
                    setErr(null);
                    p.setData((d: any[] | null) => d && d.map((y) => (y.id === x.id ? { ...y, enabled: v } : y)));
                    api(`/admin/ai/providers/${x.id}`, { method: "PATCH", body: { enabled: v } })
                      .then(p.reload)
                      .catch((e) => {
                        setErr(e);
                        p.reload();
                      });
                  }}
                />
              </div>
            </div>
            <div className="text-xs">
              <code className="break-all">{x.credentialEnvVar}</code>: {x.credentialConfigured ? <span className="text-ok">set</span> : <span className="text-live">missing</span>} · adapter {x.adapterAvailable ? <span className="text-ok">ready</span> : <span className="text-warn">planned</span>}
            </div>
            <div className="text-xs text-muted">
              This month: {x.month.calls} calls · {x.month.failures} failures · {usd(x.month.costUsd, 4)}
              {x.month.avgLatencyMs != null && ` · ${Math.round(x.month.avgLatencyMs)} ms avg`}
              {x.monthlySpendLimitUsd != null && ` · limit ${usd(x.monthlySpendLimitUsd)}`}
            </div>
            {!!x.models.length && (
              <ul className="space-y-1 text-xs">
                {x.models.map((m: any) => (
                  <li key={m.id} className="rounded-lg bg-paper/60 px-2 py-1">
                    <span className="break-all font-medium">{m.modelId}</span>
                    <span className="text-muted">
                      {" "}· {label(m.capability)} ·{" "}
                      {m.unitName ? `$${(m.unitCostMicros / 1e6).toFixed(3)} per ${m.unitName}` : `$${(m.inputCostMicrosPerMTok / 1e6).toFixed(2)} in / $${(m.outputCostMicrosPerMTok / 1e6).toFixed(2)} out per M tokens`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      <div className="panel p-4">
        <h3 className="mb-2 text-sm font-semibold">Routing (tried in priority order, with fallback)</h3>
        <Rows
          heads={["Feature", "Model", "Priority", "Min plan tier", "On"]}
          rows={(r.data ?? []).map((x) => [
            label(x.feature),
            <span key="m" className="break-all">
              {x.model?.provider.key}/{x.model?.modelId}
            </span>,
            x.priority,
            x.minPlanTier,
            <Toggle
              key="t"
              on={x.enabled}
              label={`${x.feature} via ${x.model?.modelId}`}
              onChange={(v) => {
                setErr(null);
                r.setData((d: any[] | null) => d && d.map((y) => (y.id === x.id ? { ...y, enabled: v } : y)));
                api(`/admin/ai/routing/${x.id}`, { method: "PATCH", body: { enabled: v } })
                  .then(r.reload)
                  .catch((e) => {
                    setErr(e);
                    r.reload();
                  });
              }}
            />,
          ])}
        />
      </div>
    </div>
  );
}

function Plans() {
  const { data, loading, reload } = useApi<any>("/admin/ai/plans");
  const [err, setErr] = useState<any>(null);
  if (loading || !data) return <Loading />;
  return (
    <div className="space-y-5">
      <ErrorNote error={err} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {data.plans.map((p: any) => (
          <PlanEditor key={p.id} plan={p} onSave={(body) => api(`/admin/ai/plans/${p.id}`, { method: "PATCH", body }).then(reload).catch(setErr)} />
        ))}
      </div>
      <div className="panel p-4">
        <h3 className="mb-2 text-sm font-semibold">Credit cost per feature</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.featurePrices.map((f: any) => (
            <FeaturePrice key={f.feature} f={f} onSave={(credits) => api(`/admin/ai/feature-prices/${f.feature}`, { method: "PUT", body: { creditsPerUnit: credits, unitName: f.unitName } }).then(reload).catch(setErr)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PlanEditor({ plan, onSave }: { plan: any; onSave: (b: any) => void }) {
  const [price, setPrice] = useState(String(plan.monthlyPriceCents / 100));
  const [credits, setCredits] = useState(String(plan.monthlyCredits));
  const [rollover, setRollover] = useState(String(plan.rolloverPercent));
  return (
    <div className="panel space-y-2 p-4 text-sm">
      <div className="flex justify-between">
        <b>{plan.name}</b>
        <span className="text-xs text-muted">{plan._count.subscriptions} sellers</span>
      </div>
      <label className="label">Monthly price ($)</label>
      <input className="input" value={price} onChange={(e) => setPrice(e.target.value)} />
      <label className="label">Credits / month</label>
      <input className="input" value={credits} onChange={(e) => setCredits(e.target.value)} />
      <label className="label">Rollover %</label>
      <input className="input" value={rollover} onChange={(e) => setRollover(e.target.value)} />
      <button className="btn-ghost w-full" onClick={() => onSave({ monthlyPriceCents: Math.round(Number(price) * 100), monthlyCredits: Number(credits), rolloverPercent: Number(rollover) })}>
        Save
      </button>
    </div>
  );
}

function FeaturePrice({ f, onSave }: { f: any; onSave: (c: number) => void }) {
  const [v, setV] = useState(String(f.creditsPerUnit));
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-line p-2 text-sm">
      <span className="w-full font-medium">{label(f.feature)}</span>
      <input className="input w-20" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, ""))} aria-label={`Credits for ${label(f.feature)}`} />
      <span className="min-w-0 flex-1 text-xs text-muted">credits / {f.unitName}</span>
      <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => onSave(Number(v))}>
        Save
      </button>
    </div>
  );
}

function Users({ staff }: { staff: Staff }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<any>(null);
  const { data, loading, reload } = useApi<any[]>(`/admin/users?q=${encodeURIComponent(q)}`, [q]);
  if (open) return <UserDetail id={open} staff={staff} onBack={() => setOpen(null)} />;
  const canSuspend = has(staff, "users.suspend");
  const canBan = has(staff, "users.ban");
  const setStatus = (u: any, status: string) => {
    setErr(null);
    api(`/admin/users/${u.id}`, { method: "PATCH", body: { status } }).then(reload).catch(setErr);
  };
  return (
    <div className="space-y-3">
      <input className="input max-w-sm" placeholder="Search email or @handle" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorNote error={err} />
      {loading ? (
        <Loading />
      ) : (
        <div className="divide-y divide-line rounded-2xl border border-line bg-card text-sm">
          {data?.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-3 p-3">
              <button className="min-w-0 flex-1 break-words text-left" onClick={() => setOpen(u.id)}>
                <b>@{u.handle}</b> <span className="break-all text-muted">{u.email}</span>
                <div className="text-xs text-muted">
                  {u.staffRole ? `staff: ${u.staffRole.toLowerCase()}` : u.roles.filter((r: string) => r !== "ADMIN").join(", ").toLowerCase()}
                  {u.seller && ` · seller: ${u.seller.businessName} (${u.seller.status.toLowerCase()})`}
                </div>
              </button>
              {canSuspend && (!u.staffRole || staff.role === "OWNER") && (u.status !== "BANNED" || canBan) ? (
                <select className="input w-full sm:w-36" value={u.status} onChange={(e) => setStatus(u, e.target.value)}>
                  {["ACTIVE", "SUSPENDED", ...(canBan ? ["BANNED"] : [])].map((s) => (
                    <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
                  ))}
                </select>
              ) : (
                <span className="chip">{u.status.charAt(0) + u.status.slice(1).toLowerCase()}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const KIND: Record<string, string> = { video: "Video", comment: "Comment", chat: "Live chat message", stream: "Live stream", product: "Listing", user: "Person" };

/** Reported things, oldest first. Apple expects reports to be acted on within 24 hours. */
function Reports({ staff }: { staff: Staff }) {
  const r = useApi<any[]>("/admin/reports/open");
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (g: any, action: "remove" | "suspend_owner" | "dismiss") => {
    setErr(null);
    setBusy(`${g.targetType}:${g.targetId}`);
    try {
      await api("/admin/reports/resolve", { body: { targetType: g.targetType, targetId: g.targetId, action } });
      r.setData((d: any[] | null) => d && d.filter((x) => !(x.targetType === g.targetType && x.targetId === g.targetId)));
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };
  if (r.loading) return <Loading />;
  if (r.error) return <ErrorNote error={r.error} />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Act on every report within 24 hours. Removing content tells the person who posted it. Suspending signs them out everywhere and stops them signing in.</p>
      <ErrorNote error={err} />
      {!r.data?.length && <p className="panel p-4 text-sm text-muted">No open reports.</p>}
      {r.data?.map((g) => {
        const hours = Math.floor((Date.now() - new Date(g.firstReportedAt).getTime()) / 3600_000);
        const key = `${g.targetType}:${g.targetId}`;
        return (
          <div key={key} className="panel min-w-0 space-y-2 break-words p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b>
                {KIND[g.targetType] ?? g.targetType}
                {g.preview?.by && <span className="font-normal text-muted"> by @{g.preview.by}</span>}
              </b>
              <span className={`text-xs ${hours >= 20 ? "text-live" : "text-muted"}`}>
                {g.reports.length} report{g.reports.length === 1 ? "" : "s"} · first {hours < 1 ? "under an hour" : `${hours}h`} ago
              </span>
            </div>
            {g.preview ? (
              <div className="flex gap-3 rounded-xl bg-paper/60 p-3">
                {g.preview.image && <img src={g.preview.image} alt="" className="h-20 w-14 shrink-0 rounded object-cover" />}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="whitespace-pre-wrap">{g.preview.text}</p>
                  <p className="text-xs text-muted">
                    Status: {String(g.preview.status).toLowerCase()} ·{" "}
                    <a href={g.preview.link} target="_blank" rel="noreferrer" className="underline">
                      Open
                    </a>
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-muted">This item no longer exists.</p>
            )}
            <ul className="space-y-0.5 text-xs text-muted">
              {g.reports.map((x: any) => (
                <li key={x.id}>
                  “{x.reason}” from @{x.reporter}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              {has(staff, "content.moderate") && g.targetType !== "user" && g.preview && (
                <button className="rounded-xl bg-live px-3 py-1.5 text-xs font-semibold text-white" disabled={busy === key} onClick={() => act(g, "remove")}>
                  Remove
                </button>
              )}
              {has(staff, "users.suspend") && g.preview && (
                <button className="btn-ghost px-3 py-1.5 text-xs text-live" disabled={busy === key} onClick={() => act(g, "suspend_owner")}>
                  Suspend @{g.preview.by}
                </button>
              )}
              {has(staff, "content.moderate") && (
                <button className="btn-ghost px-3 py-1.5 text-xs" disabled={busy === key} onClick={() => act(g, "dismiss")}>
                  Dismiss
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
