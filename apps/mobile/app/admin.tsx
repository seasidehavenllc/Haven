import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Alert, Image, ScrollView, View } from "react-native";
import { formatMoney, StaffRoleInfo, type StaffPermission, type StaffRole } from "@haven/shared";
import { api } from "@/lib/api";
import { useApi, useMe } from "@/lib/hooks";
import { Btn, Chip, Empty, ErrorNote, Field, Loading, Notice, T, s, useColors } from "@/components/ui";

const SITE = "https://sales.seasidehavenllc.com";
type Staff = { role: StaffRole | null; permissions: StaffPermission[]; refundLimitCents: number | null };
const nice = (x: string) => x.charAt(0) + x.slice(1).toLowerCase().replace(/_/g, " ");

/**
 * Admin on the phone: the essentials for each staff role. The full panel is on the web.
 * The server checks every action against the person's role, whatever this screen shows.
 */
export default function AdminScreen() {
  const c = useColors();
  const { me } = useMe();
  const staff = useApi<Staff>(me?.user.staffRole ? "/admin/me" : null, [me?.user.staffRole]);
  const [section, setSection] = useState<"home" | "orders" | "reports" | "applications">("home");
  if (!me?.user.staffRole) return <View style={s.screen}><Empty title="Staff only">This area is for the Haven team.</Empty></View>;
  if (staff.loading || !staff.data) return staff.error ? <View style={s.screen}><ErrorNote error={staff.error} /></View> : <Loading />;
  const st = staff.data;
  if (!st.role) return <View style={s.screen}><Empty title="Staff only">Your staff role was removed.</Empty></View>;
  const has = (p: StaffPermission) => st.permissions.includes(p);
  if (section === "orders") return <Orders staff={st} onBack={() => setSection("home")} />;
  if (section === "reports") return <Reports canAct={has("content.moderate")} onBack={() => setSection("home")} />;
  if (section === "applications") return <Applications onBack={() => setSection("home")} />;
  return (
    <ScrollView contentContainerStyle={s.screen}>
      <View style={[s.card, { borderColor: c.line, backgroundColor: c.card }]}>
        <Chip label={StaffRoleInfo[st.role].name} color={c.brand} />
        <T size={13} color={c.muted}>{StaffRoleInfo[st.role].summary}</T>
        {st.refundLimitCents != null && has("orders.refund") && <T size={13} color={c.muted}>Refund limit: {formatMoney(st.refundLimitCents)} per order.</T>}
      </View>
      <Overview />
      {has("orders.view") && <Btn kind="ghost" icon="receipt-outline" title="Find an order" onPress={() => setSection("orders")} />}
      {has("sellers.view") && <Btn kind="ghost" icon="storefront-outline" title="Seller applications" onPress={() => setSection("applications")} />}
      {has("reports.view") && <Btn kind="ghost" icon="flag-outline" title="Reports to review" onPress={() => setSection("reports")} />}
      <Btn kind="ghost" icon="desktop-outline" title="Open the full admin panel" onPress={() => WebBrowser.openBrowserAsync(`${SITE}/admin`)} />
      <T size={12} color={c.muted}>The full panel on the web has {[has("users.view") && "people", has("sellers.manage") && "sellers", has("shows.manage") && "live shows", has("staff.manage") && "staff roles", has("audit.view") && "the audit log", has("finance.view") && "finances"].filter(Boolean).join(", ")}.</T>
    </ScrollView>
  );
}

function Overview() {
  const c = useColors();
  const o = useApi<any>("/admin/overview");
  if (o.loading) return <Loading />;
  if (o.error) return <ErrorNote error={o.error} />;
  const stats: [string, string | number][] = [
    ["Users", o.data.users],
    ["Sellers", o.data.sellers],
    ["Live now", o.data.liveStreams],
    ["Open reports", o.data.openReports],
    o.data.gmvUsd != null ? ["Sales", `$${Math.round(o.data.gmvUsd).toLocaleString()}`] : ["Orders", o.data.orders],
    ["Listings", o.data.products],
  ];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {stats.map(([label, value]) => (
        <View key={label} style={[s.card, { borderColor: c.line, backgroundColor: c.card, width: "47%", gap: 2 }]}>
          <T size={12} color={c.muted}>{label}</T>
          <T size={22} weight="800">{String(value)}</T>
        </View>
      ))}
    </View>
  );
}

function Orders({ staff, onBack }: { staff: Staff; onBack: () => void }) {
  const c = useColors();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const list = useApi<any[]>(search ? `/admin/orders?q=${encodeURIComponent(search)}` : null, [search]);
  if (open) return <OrderDetail id={open} staff={staff} onBack={() => setOpen(null)} />;
  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      <Btn kind="ghost" icon="chevron-back" title="Admin" onPress={onBack} />
      <Field label="Order number, buyer email or @handle" value={q} onChangeText={setQ} autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => setSearch(q.trim())} />
      <Btn title="Search" onPress={() => setSearch(q.trim())} disabled={!q.trim()} />
      {list.loading ? <Loading /> : list.error ? <ErrorNote error={list.error} /> : search && !list.data?.length ? <Empty title="No orders found" /> : null}
      {list.data?.map((o) => (
        <View key={o.id} style={[s.card, { borderColor: c.line, backgroundColor: c.card }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <T weight="700">#{o.id.slice(-6)} · {o.seller.businessName}</T>
            <T weight="700">{formatMoney(o.totalCents)}</T>
          </View>
          <T size={13} color={c.muted}>@{o.buyer.handle} · {o.buyer.email} · {nice(o.status)}</T>
          <Btn kind="ghost" title="Open" onPress={() => setOpen(o.id)} />
        </View>
      ))}
    </ScrollView>
  );
}

function OrderDetail({ id, staff, onBack }: { id: string; staff: Staff; onBack: () => void }) {
  const c = useColors();
  const o = useApi<any>(`/admin/orders/${id}`);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  if (o.loading) return <Loading />;
  if (o.error || !o.data) return <View style={s.screen}><ErrorNote error={o.error} /></View>;
  const d = o.data;
  const a = d.shippingAddress ?? {};
  const cents = Math.round(Number(amount) * 100);
  const refund = () =>
    Alert.alert("Refund this order?", `${formatMoney(cents)} goes back to @${d.buyer.handle}'s card. This can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Refund",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          setErr(null);
          try {
            await api(`/admin/orders/${id}/refund`, { body: { amountCents: cents, reason } });
            setAmount("");
            setReason("");
            await o.reload();
          } catch (e) {
            setErr(e);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  const send = async () => {
    setErr(null);
    try {
      await api(`/admin/users/${d.buyer.id}/message`, { body: { body: msg, orderId: d.id } });
      setMsg("");
      setSent(true);
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      <Btn kind="ghost" icon="chevron-back" title="Orders" onPress={onBack} />
      <View style={[s.card, { borderColor: c.line, backgroundColor: c.card }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <T weight="800">Order #{d.id.slice(-6)}</T>
          <Chip label={nice(d.status)} color={c.line} text={c.ink} />
        </View>
        <T size={13} color={c.muted}>{new Date(d.createdAt).toLocaleString()} · {d.seller.businessName}</T>
        {d.items.map((it: any, i: number) => <T key={i} size={13}>{it.quantity} × {it.titleSnapshot}</T>)}
        <T weight="700">Total {formatMoney(d.totalCents)}{d.refundedCents ? ` · refunded ${formatMoney(d.refundedCents)}` : ""}</T>
        <T size={13} color={c.muted}>@{d.buyer.handle} · {d.buyer.email}</T>
        <T size={13} color={c.muted}>{[a.name, a.line1, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(", ")}</T>
        {d.piiMasked && <T size={12} color={c.muted}>Contact details are hidden for your role.</T>}
      </View>
      {staff.permissions.includes("orders.refund") && d.refundableCents > 0 && (
        <View style={[s.card, { borderColor: c.line, backgroundColor: c.card }]}>
          <T weight="700">Refund</T>
          <T size={13} color={c.muted}>You can refund up to {formatMoney(d.refundableCents)} on this order.</T>
          <Field label="Amount ($)" keyboardType="decimal-pad" value={amount} onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ""))} />
          <Field label="Reason (the seller sees this)" value={reason} onChangeText={setReason} />
          <Btn kind="danger" title={cents > 0 ? `Refund ${formatMoney(cents)}` : "Refund"} busy={busy} disabled={!(cents > 0) || cents > d.refundableCents || reason.trim().length < 3} onPress={refund} />
        </View>
      )}
      {staff.permissions.includes("users.message") && (
        <View style={[s.card, { borderColor: c.line, backgroundColor: c.card }]}>
          <T weight="700">Message @{d.buyer.handle}</T>
          <Field value={msg} onChangeText={(t) => { setMsg(t); setSent(false); }} multiline style={{ minHeight: 80, paddingTop: 10 }} />
          <Btn title={sent ? "Sent" : "Send"} disabled={msg.trim().length < 2} onPress={send} />
        </View>
      )}
      <ErrorNote error={err} />
    </ScrollView>
  );
}

const KIND: Record<string, string> = { video: "Video", comment: "Comment", chat: "Live chat message", stream: "Live stream", product: "Listing", user: "Person" };

function Reports({ canAct, onBack }: { canAct: boolean; onBack: () => void }) {
  const c = useColors();
  const r = useApi<any[]>("/admin/reports/open");
  const [err, setErr] = useState<any>(null);
  const act = async (g: any, action: "remove" | "dismiss") => {
    setErr(null);
    try {
      await api("/admin/reports/resolve", { body: { targetType: g.targetType, targetId: g.targetId, action } });
      r.setData((d) => d && d.filter((x) => !(x.targetType === g.targetType && x.targetId === g.targetId)));
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <ScrollView contentContainerStyle={s.screen}>
      <Btn kind="ghost" icon="chevron-back" title="Admin" onPress={onBack} />
      {!canAct && <Notice>Your role can see reports. A manager or the owner acts on them.</Notice>}
      <ErrorNote error={err} />
      {r.loading ? <Loading /> : !r.data?.length ? <Empty title="No open reports" /> : r.data.map((g) => (
        <View key={`${g.targetType}:${g.targetId}`} style={[s.card, { borderColor: c.line, backgroundColor: c.card }]}>
          <T weight="700">{KIND[g.targetType] ?? g.targetType}{g.preview?.by ? ` by @${g.preview.by}` : ""}</T>
          <T size={13}>{g.preview?.text ?? "This item no longer exists."}</T>
          {g.reports.map((x: any) => <T key={x.id} size={12} color={c.muted}>“{x.reason}” from @{x.reporter}</T>)}
          {canAct && (
            <View style={{ flexDirection: "row", gap: 8 }}>
              {g.targetType !== "user" && g.preview && <Btn kind="danger" title="Remove" onPress={() => act(g, "remove")} style={{ flex: 1 }} />}
              <Btn kind="ghost" title="Dismiss" onPress={() => act(g, "dismiss")} style={{ flex: 1 }} />
            </View>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const APP_TABS = [
  ["SUBMITTED", "Waiting"],
  ["NEEDS_INFO", "Asked"],
  ["APPROVED", "Approved"],
  ["REJECTED", "Rejected"],
] as const;

/** Seller applications: owners and managers decide, support can look. The server enforces both. */
function Applications({ onBack }: { onBack: () => void }) {
  const c = useColors();
  const [tab, setTab] = useState<string>("SUBMITTED");
  const [open, setOpen] = useState<string | null>(null);
  const list = useApi<{ applications: any[]; counts: Record<string, number> }>(`/admin/seller-applications?status=${tab}`, [tab]);
  if (open) return <ApplicationDetail id={open} onBack={() => (setOpen(null), list.reload())} />;
  return (
    <ScrollView contentContainerStyle={s.screen}>
      <Btn kind="ghost" icon="chevron-back" title="Admin" onPress={onBack} />
      <View style={{ flexDirection: "row", gap: 6 }}>
        {APP_TABS.map(([k, label]) => (
          <Btn key={k} style={{ flex: 1, paddingHorizontal: 4 }} kind={tab === k ? "primary" : "ghost"} title={`${label}${list.data?.counts[k] ? ` ${list.data.counts[k]}` : ""}`} onPress={() => setTab(k)} />
        ))}
      </View>
      {list.loading ? <Loading /> : list.error ? <ErrorNote error={list.error} /> : !list.data?.applications.length ? <Empty title={tab === "SUBMITTED" ? "No applications waiting" : "None"} /> : null}
      {list.data?.applications.map((a) => (
        <View key={a.id} style={[s.card, { borderColor: c.line, backgroundColor: c.card }]}>
          <T weight="700">{a.businessName} <T size={13} color={c.muted}>@{a.user.handle}</T></T>
          <T size={13} color={c.muted}>{a.categories.join(", ")}</T>
          <T size={12} color={c.muted}>{a.submittedAt ? `Sent ${new Date(a.submittedAt).toLocaleString()}` : ""}{a.payoutsDetailsDone ? " · payouts set up" : ""}</T>
          <Btn kind="ghost" title="Open" onPress={() => setOpen(a.id)} />
        </View>
      ))}
    </ScrollView>
  );
}

function ApplicationDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const c = useColors();
  const d = useApi<any>(`/admin/seller-applications/${id}`);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<any>(null);
  if (d.loading) return <Loading />;
  if (d.error || !d.data) return <View style={s.screen}><ErrorNote error={d.error} /></View>;
  const a = d.data;
  const addr = a.address ?? {};
  const act = async (path: string, body: unknown) => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/admin/seller-applications/${id}/${path}`, { body });
      setNote("");
      await d.reload();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  const confirm = (title: string, msg: string, go: () => void) => Alert.alert(title, msg, [{ text: "Cancel", style: "cancel" }, { text: "Yes", onPress: go }]);
  const line = (label: string, value: any) => (value ? <T size={13}><T size={13} color={c.muted}>{label}: </T>{value}</T> : null);
  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Btn kind="ghost" icon="chevron-back" title="Applications" onPress={onBack} />
      <View style={[s.card, { borderColor: c.line, backgroundColor: c.card }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <T weight="800" size={18}>{a.businessName}</T>
          <Chip label={nice(a.status)} color={c.line} text={c.ink} />
        </View>
        {line("Account", `@${a.user.handle} · joined ${new Date(a.user.createdAt).toLocaleDateString()}`)}
        {line("Legal name", a.legalName)}
        {line("Email", a.user.email)}
        {line("Phone", a.phone)}
        {line("Age", a.age)}
        {line("Address", [addr.line1, addr.city, addr.region, addr.postalCode, addr.country].filter(Boolean).join(", "))}
        {line("Track record", `${a.user._count.orders} orders · ${a.reportsAgainst} reports against them`)}
        {a.piiMasked && <T size={12} color={c.muted}>Contact details are hidden for your role.</T>}
      </View>
      <View style={[s.card, { borderColor: c.line, backgroundColor: c.card }]}>
        {line("Type", a.businessType === "BUSINESS" ? "Registered business" : "Individual")}
        {line("Store", `${a.storeName} (/${a.storeSlug})`)}
        {line("Payouts", a.payoutsMode === "off" ? "Stripe isn't connected on Haven yet" : a.payoutsEnabled ? "Stripe verified" : a.payoutsDetailsDone ? "Stripe still verifying" : "Not set up")}
        {line("Terms", a.termsAcceptedAt ? `agreed ${new Date(a.termsAcceptedAt).toLocaleDateString()}` : "not agreed")}
        {line("Sells", a.categories.join(", "))}
        <T size={13}>{a.description}</T>
        {line("Inventory", a.inventorySize)}
        {line("Experience", a.experience)}
        {a.socialLinks.map((l: string) => <T key={l} size={13} color={c.brandLight} onPress={() => WebBrowser.openBrowserAsync(l)}>{l}</T>)}
        {!!a.sampleImageUrls.length && (
          <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
            {a.sampleImageUrls.map((u: string) => <Image key={u} source={{ uri: u }} style={{ width: 96, height: 96, borderRadius: 10 }} />)}
          </ScrollView>
        )}
      </View>
      {a.history.map((h: any, i: number) => (
        <T key={i} size={12} color={c.muted}>{new Date(h.createdAt).toLocaleString()} · @{h.actor?.handle ?? "system"} · {h.action.split(".").pop()?.replace("_", " ")}{h.data?.note ? `: “${h.data.note}”` : ""}</T>
      ))}
      {a.status === "SUBMITTED" && !a.canDecide && <Notice>Your role can look. An owner or manager decides.</Notice>}
      {a.status === "SUBMITTED" && a.canDecide && (
        <View style={[s.card, { borderColor: c.line, backgroundColor: c.card }]}>
          <Field label="Message to the applicant (needed to reject or ask)" value={note} onChangeText={setNote} multiline style={{ minHeight: 70, paddingTop: 10 }} />
          <Btn title="Approve" busy={busy} onPress={() => confirm(`Approve ${a.businessName}?`, "They can list items and go live right away.", () => act("approve", { note: note.trim() || undefined }))} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Btn style={{ flex: 1 }} kind="ghost" title="Ask for info" disabled={busy || note.trim().length < 5} onPress={() => act("request-info", { message: note.trim() })} />
            <Btn style={{ flex: 1 }} kind="danger" title="Reject" disabled={busy || note.trim().length < 5} onPress={() => confirm("Reject this application?", "They'll see your message and can apply again.", () => act("reject", { reason: note.trim() }))} />
          </View>
        </View>
      )}
      {a.status !== "SUBMITTED" && a.decisionNote && <Notice tone="ai">{a.decisionNote}</Notice>}
      <ErrorNote error={err} />
    </ScrollView>
  );
}
