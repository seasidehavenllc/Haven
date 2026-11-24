"use client";
import { useState } from "react";
import { formatMoney, StaffRoleInfo, StaffRoles, type StaffPermission, type StaffRole } from "@haven/shared";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { ErrorNote, Loading } from "@/components/ui";

export type Staff = { role: StaffRole; permissions: StaffPermission[]; refundLimitCents: number | null };
export const has = (s: Staff, p: StaffPermission) => s.permissions.includes(p);
const when = (d: string) => new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const status = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

/** What a role can do, in plain words, at the top of the panel. */
export function RoleBanner({ staff }: { staff: Staff }) {
  return (
    <div className="panel flex flex-wrap items-center gap-3 p-3 text-sm">
      <span className="chip bg-brand text-brand-ink">{StaffRoleInfo[staff.role].name}</span>
      <span className="min-w-0 flex-1 text-muted">
        {StaffRoleInfo[staff.role].summary}
        {staff.refundLimitCents != null && has(staff, "orders.refund") && ` Refund limit: ${formatMoney(staff.refundLimitCents)} per order.`}
      </span>
    </div>
  );
}

// ── Staff (owner only) ──
export function StaffTab() {
  const list = useApi<any[]>("/admin/staff");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("SUPPORT");
  const [found, setFound] = useState<any>(null);
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const lookup = async () => {
    setErr(null);
    setFound(null);
    try {
      setFound(await api(`/admin/staff/lookup?email=${encodeURIComponent(email.trim())}`));
    } catch (e) {
      setErr(e);
    }
  };
  const give = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api("/admin/staff", { body: { email: email.trim(), role } });
      setFound(null);
      setEmail("");
      list.reload();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (u: any) => {
    if (!confirm(`Take away @${u.handle}'s ${StaffRoleInfo[u.staffRole as StaffRole].name} role? They lose admin access right away.`)) return;
    setErr(null);
    await api(`/admin/staff/${u.id}`, { method: "DELETE" }).then(list.reload).catch(setErr);
  };
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        {StaffRoles.map((r) => (
          <div key={r} className="panel p-4 text-sm">
            <div className="font-semibold">{StaffRoleInfo[r].name}</div>
            <p className="mt-1 text-muted">{StaffRoleInfo[r].summary}</p>
          </div>
        ))}
      </div>
      <div className="panel space-y-3 p-4">
        <h3 className="text-sm font-semibold">Add someone to the team</h3>
        <p className="text-sm text-muted">They need a Haven account first. Enter the email they signed up with, check it's the right person, then pick a role. It works right away, with no sign-out needed.</p>
        <div className="flex flex-wrap gap-2">
          <input className="input min-w-0 flex-1" type="email" placeholder="their@email.com" value={email} onChange={(e) => { setEmail(e.target.value); setFound(null); }} />
          <select className="input w-full sm:w-48" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
            {StaffRoles.map((r) => (
              <option key={r} value={r}>{StaffRoleInfo[r].name}</option>
            ))}
          </select>
          <button className="btn-ghost" onClick={lookup} disabled={!email.includes("@")}>Find account</button>
        </div>
        {found && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-paper/60 p-3 text-sm">
            <div className="min-w-0 flex-1">
              <b>{found.displayName}</b> <span className="text-muted">@{found.handle} · joined {new Date(found.createdAt).toLocaleDateString()}</span>
              {found.staffRole && <div className="text-xs text-muted">Currently: {StaffRoleInfo[found.staffRole as StaffRole].name}</div>}
            </div>
            <button className="btn-primary" disabled={busy} onClick={give}>
              Make @{found.handle} {StaffRoleInfo[role].name}
            </button>
          </div>
        )}
        <ErrorNote error={err} />
      </div>
      {list.loading ? (
        <Loading />
      ) : (
        <div className="divide-y divide-line rounded-2xl border border-line bg-card text-sm">
          {list.data?.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1 break-words">
                <b>{u.displayName}</b> <span className="text-muted">@{u.handle}</span>
                <div className="break-all text-xs text-muted">{u.email}{u.status !== "ACTIVE" && ` · ${status(u.status)}`}</div>
              </div>
              <span className="chip">{StaffRoleInfo[u.staffRole as StaffRole].name}</span>
              <button className="btn-ghost px-3 py-1.5 text-xs text-live" onClick={() => remove(u)}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Audit log (owner only) ──
const ACTIONS: Record<string, string> = {
  "staff.role.set": "Gave a staff role",
  "staff.role.remove": "Removed a staff role",
  "admin.user.status": "Changed an account's status",
  "admin.user.view": "Opened a person's details",
  "admin.user.message": "Messaged a person",
  "admin.order.refund": "Refunded an order",
  "admin.order.refund_failed": "Refund failed",
  "admin.seller.update": "Updated a seller",
  "admin.product.remove": "Removed a listing",
  "admin.settings.update": "Changed platform settings",
  "moderation.stream.end": "Ended a live show",
  "moderation.video.remove": "Removed a video",
  "moderation.report.remove": "Removed reported content",
  "moderation.report.suspend_owner": "Suspended a reported person",
  "moderation.report.dismiss": "Dismissed a report",
};
export function AuditTab() {
  const [hideViews, setHideViews] = useState(true);
  const { data, loading, error } = useApi<any[]>("/admin/audit");
  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  const rows = (data ?? []).filter((r) => !(hideViews && r.action === "admin.user.view"));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted">Every action staff take in the admin panel, newest first. Entries can't be edited or deleted.</p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={hideViews} onChange={(e) => setHideViews(e.target.checked)} /> Hide "opened a person's details"
        </label>
      </div>
      {!rows.length && <p className="panel p-4 text-sm text-muted">Nothing yet.</p>}
      <div className="divide-y divide-line rounded-2xl border border-line bg-card text-sm">
        {rows.map((r) => (
          <div key={r.id} className="space-y-1 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b>
                {r.actor ? `@${r.actor.handle}` : "System"}
                {r.actor?.staffRole && <span className="font-normal text-muted"> ({StaffRoleInfo[r.actor.staffRole as StaffRole]?.name})</span>}
                <span className="font-normal"> · {ACTIONS[r.action] ?? r.action}</span>
              </b>
              <span className="text-xs text-muted">{when(r.createdAt)}</span>
            </div>
            {(r.targetType || r.data) && (
              <div className="break-all text-xs text-muted">
                {r.targetType && `${r.targetType} ${r.targetId}`}
                {r.data && ` · ${JSON.stringify(r.data)}`}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Orders ──
export function OrdersTab({ staff }: { staff: Staff }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const { data, loading } = useApi<any[]>(`/admin/orders?q=${encodeURIComponent(q)}`, [q]);
  if (open) return <OrderDetail id={open} staff={staff} onBack={() => setOpen(null)} />;
  return (
    <div className="space-y-3">
      <input className="input max-w-md" placeholder="Order number, buyer email or @handle, or shop name" value={q} onChange={(e) => setQ(e.target.value)} />
      {loading ? (
        <Loading />
      ) : (
        <div className="divide-y divide-line rounded-2xl border border-line bg-card text-sm">
          {!data?.length && <p className="p-4 text-muted">No orders found.</p>}
          {data?.map((o) => (
            <button key={o.id} className="flex w-full flex-wrap items-center gap-3 p-3 text-left hover:bg-paper/60" onClick={() => setOpen(o.id)}>
              <div className="min-w-0 flex-1 break-words">
                <b>#{o.id.slice(-6)}</b> <span className="text-muted">· {o.seller.businessName} · @{o.buyer.handle}</span>
                <div className="break-all text-xs text-muted">{o.buyer.email} · {when(o.createdAt)}{o.isTest && " · TEST"}</div>
              </div>
              <span className="chip">{status(o.status)}</span>
              <b>{formatMoney(o.totalCents)}</b>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OrderDetail({ id, staff, onBack }: { id: string; staff: Staff; onBack: () => void }) {
  const { data: o, loading, error, reload } = useApi<any>(`/admin/orders/${id}`);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(false);
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  const a = o.shippingAddress ?? {};
  const cents = Math.round(Number(amount) * 100);
  const refund = async () => {
    if (!confirm(`Refund ${formatMoney(cents)} to @${o.buyer.handle}? This sends money back to their card and can't be undone.`)) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/admin/orders/${id}/refund`, { body: { amountCents: cents, reason, restock } });
      setAmount("");
      setReason("");
      reload();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4 text-sm">
      <button className="btn-ghost px-3 py-1.5 text-xs" onClick={onBack}>← All orders</button>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="panel space-y-1 p-4">
          <div className="flex items-center justify-between">
            <b>Order #{o.id.slice(-6)}</b>
            <span className="chip">{status(o.status)}</span>
          </div>
          <div className="text-muted">{when(o.createdAt)} · {o.seller.businessName}{o.isTest && " · TEST"}</div>
          <ul className="pt-2">
            {o.items.map((it: any, i: number) => (
              <li key={i}>{it.quantity} × {it.titleSnapshot} · {formatMoney(it.unitPriceCents)}</li>
            ))}
          </ul>
          <div className="pt-2">
            Shipping {formatMoney(o.shippingCents)} · <b>Total {formatMoney(o.totalCents)}</b>
            {o.platformFeeCents != null && <span className="text-muted"> · Haven fee {formatMoney(o.platformFeeCents)}</span>}
          </div>
          {o.payment && <div className="text-xs text-muted">Paid with {o.payment.provider} ({o.payment.ref})</div>}
        </div>
        <div className="panel space-y-1 p-4">
          <b>Buyer</b>
          <div>{o.buyer.displayName} · @{o.buyer.handle}</div>
          <div className="break-all text-muted">{o.buyer.email}</div>
          <b className="block pt-2">Ship to</b>
          <div className="text-muted">
            {[a.name, a.line1, a.line2, `${a.city ?? ""}, ${a.region ?? ""} ${a.postalCode ?? ""}`, a.country].filter(Boolean).join(" · ")}
          </div>
          {o.piiMasked && <p className="text-xs text-muted">Contact details are hidden for your role.</p>}
          {o.shipments.map((s: any, i: number) => (
            <div key={i} className="text-xs">
              {s.carrier} {s.service} · {status(s.status)} {s.trackingUrl ? <a className="underline" href={s.trackingUrl} target="_blank" rel="noreferrer">{s.trackingNumber}</a> : s.trackingNumber}
            </div>
          ))}
        </div>
      </div>
      <div className="panel space-y-3 p-4">
        <h3 className="font-semibold">Refunds</h3>
        {o.refunds.length ? (
          <ul className="space-y-1">
            {o.refunds.map((r: any) => (
              <li key={r.id}>
                {formatMoney(r.amountCents)} · {status(r.status)} · {when(r.createdAt)} <span className="text-muted">· {r.reason}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">No refunds yet.</p>
        )}
        {has(staff, "orders.refund") && o.refundableCents > 0 && (
          <div className="space-y-2 border-t border-line pt-3">
            <p className="text-muted">You can refund up to {formatMoney(o.refundableCents)} on this order.</p>
            <div className="flex flex-wrap gap-2">
              <input className="input w-32" inputMode="decimal" placeholder="Amount ($)" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
              <input className="input min-w-0 flex-1" placeholder="Reason (the seller sees this)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button className="btn-ghost text-xs" onClick={() => setAmount(String(o.refundableCents / 100))}>Max</button>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Put the items back in stock if this refunds the whole order
            </label>
            <button className="btn-primary" disabled={busy || !(cents > 0) || cents > o.refundableCents || reason.trim().length < 3} onClick={refund}>
              Refund {cents > 0 ? formatMoney(cents) : ""}
            </button>
          </div>
        )}
        <ErrorNote error={err} />
      </div>
      {has(staff, "users.message") && <MessageBox userId={o.buyer.id} handle={o.buyer.handle} orderId={o.id} />}
    </div>
  );
}

export function MessageBox({ userId, handle, orderId }: { userId: string; handle: string; orderId?: string }) {
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<any>(null);
  const send = async () => {
    setErr(null);
    try {
      await api(`/admin/users/${userId}/message`, { body: { body, orderId } });
      setBody("");
      setSent(true);
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <div className="panel space-y-2 p-4 text-sm">
      <h3 className="font-semibold">Message @{handle}</h3>
      <p className="text-muted">Arrives as a notification from Haven support (and by push and email if they allow it).</p>
      <textarea className="input min-h-24" value={body} onChange={(e) => { setBody(e.target.value); setSent(false); }} />
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={body.trim().length < 2} onClick={send}>Send</button>
        {sent && <span className="text-ok">Sent</span>}
      </div>
      <ErrorNote error={err} />
    </div>
  );
}

// ── Sellers ──
export function SellersTab() {
  const [filter, setFilter] = useState("");
  const { data, loading, setData } = useApi<any[]>(`/admin/sellers${filter ? `?status=${filter}` : ""}`, [filter]);
  const [err, setErr] = useState<any>(null);
  const update = (s: any, body: any) => {
    setErr(null);
    api<any>(`/admin/sellers/${s.id}`, { method: "PATCH", body })
      .then((r) => setData((d: any[] | null) => d && d.map((x) => (x.id === s.id ? { ...x, ...r } : x))))
      .catch(setErr);
  };
  return (
    <div className="space-y-3">
      <select className="input w-48" value={filter} onChange={(e) => setFilter(e.target.value)}>
        <option value="">All sellers</option>
        {["PENDING_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"].map((s) => (
          <option key={s} value={s}>{status(s)}</option>
        ))}
      </select>
      <ErrorNote error={err} />
      {loading ? (
        <Loading />
      ) : (
        <div className="divide-y divide-line rounded-2xl border border-line bg-card text-sm">
          {!data?.length && <p className="p-4 text-muted">No sellers.</p>}
          {data?.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <b>{s.businessName}</b> <span className="text-muted">@{s.user.handle}</span>
                <div className="text-xs text-muted">{s._count.products} listings · {s._count.orders} orders · since {new Date(s.createdAt).toLocaleDateString()}</div>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={!s.aiDisabled} onChange={(e) => update(s, { aiDisabled: !e.target.checked })} /> AI on
              </label>
              <select className="input w-full sm:w-44" value={s.status} onChange={(e) => update(s, { status: e.target.value })}>
                {["PENDING_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"].map((x) => (
                  <option key={x} value={x}>{status(x)}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Live shows ──
export function ShowsTab() {
  const { data, loading, reload } = useApi<any[]>("/admin/streams");
  const [err, setErr] = useState<any>(null);
  const end = async (s: any) => {
    const reason = prompt(`Why are you ending "${s.title}"? The seller sees this.`);
    if (!reason || reason.trim().length < 3) return;
    setErr(null);
    await api(`/admin/streams/${s.id}/end`, { body: { reason } }).then(reload).catch(setErr);
  };
  if (loading) return <Loading />;
  return (
    <div className="space-y-3">
      <ErrorNote error={err} />
      <div className="divide-y divide-line rounded-2xl border border-line bg-card text-sm">
        {!data?.length && <p className="p-4 text-muted">No live or scheduled shows.</p>}
        {data?.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <b>{s.title}</b> <span className="text-muted">· {s.seller.businessName} (@{s.seller.user.handle})</span>
              <div className="text-xs text-muted">{status(s.mode)} · <a className="underline" href={`/live/${s.id}`} target="_blank" rel="noreferrer">Watch</a></div>
            </div>
            <span className={`chip ${s.status === "LIVE" ? "bg-live text-white" : ""}`}>{status(s.status)}</span>
            <button className="btn-ghost px-3 py-1.5 text-xs text-live" onClick={() => end(s)}>End show</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── One person ──
export function UserDetail({ id, staff, onBack }: { id: string; staff: Staff; onBack: () => void }) {
  const { data: u, loading, error } = useApi<any>(`/admin/users/${id}`);
  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  return (
    <div className="space-y-4 text-sm">
      <button className="btn-ghost px-3 py-1.5 text-xs" onClick={onBack}>← All people</button>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="panel space-y-1 p-4">
          <b className="text-base">{u.displayName}</b>
          <div className="text-muted">@{u.handle} · {status(u.status)} · joined {new Date(u.createdAt).toLocaleDateString()}</div>
          <div className="break-all">{u.email}</div>
          {u.seller && <div>Seller: {u.seller.businessName} ({status(u.seller.status)})</div>}
          {u.staffRole && <div>Staff: {StaffRoleInfo[u.staffRole as StaffRole].name}</div>}
          {u.piiMasked && <p className="text-xs text-muted">Contact details are hidden for your role.</p>}
        </div>
        <div className="panel space-y-1 p-4">
          <b>Addresses</b>
          {!u.addresses.length && <p className="text-muted">None saved.</p>}
          {u.addresses.map((a: any, i: number) => (
            <div key={a?.id ?? i} className="text-muted">{[a.name, a.line1, a.line2, `${a.city}, ${a.region} ${a.postalCode}`, a.country].filter(Boolean).join(" · ")}</div>
          ))}
        </div>
      </div>
      {has(staff, "orders.view") && (
        <div className="panel p-4">
          <b>Recent orders</b>
          {!u.orders.length && <p className="text-muted">No orders.</p>}
          <ul className="mt-1 space-y-1">
            {u.orders.map((o: any) => (
              <li key={o.id}>
                #{o.id.slice(-6)} · {o.seller.businessName} · {formatMoney(o.totalCents)} · {status(o.status)} <span className="text-muted">· {when(o.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {has(staff, "users.message") && <MessageBox userId={u.id} handle={u.handle} />}
    </div>
  );
}
