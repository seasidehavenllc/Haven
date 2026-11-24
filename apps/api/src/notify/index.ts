import type { Notification } from "@prisma/client";
import { prisma, type Tx } from "../db";
import { env } from "../env";
import { emit } from "../realtime";

/**
 * One place to notify users. Every notification is stored (the in-app inbox is the source of truth),
 * pushed over the socket to the user's open tabs/apps, and then fanned out to push and email when
 * those adapters are configured and the user hasn't turned them off.
 */
export type NotifyInput = { userId: string; type: string; title: string; body?: string | null; link?: string | null; data?: Record<string, unknown> };

/** Types that are important enough to email. Everything else stays in-app and push. */
const EMAIL_TYPES = new Set(["order.new", "order.shipped", "order.delivered", "auction.won", "billing.payment_failed", "moderation.product_removed", "moderation.video_removed", "payout.sent", "order.refunded", "support.message"]);

/** Store notifications, respecting muted types. Use inside a transaction, then call `deliver` after commit. */
export async function createNotifications(db: Tx | typeof prisma, items: NotifyInput[]): Promise<Notification[]> {
  if (!items.length) return [];
  const prefs = await db.notificationPreference.findMany({ where: { userId: { in: [...new Set(items.map((i) => i.userId))] } } });
  const muted = new Map(prefs.map((p) => [p.userId, new Set(p.mutedTypes)]));
  const keep = items.filter((i) => !muted.get(i.userId)?.has(i.type));
  const out: Notification[] = [];
  for (const i of keep) out.push(await db.notification.create({ data: { userId: i.userId, type: i.type, title: i.title, body: i.body ?? null, link: i.link ?? null, data: (i.data as any) ?? undefined } }));
  return out;
}

/** Realtime + push + email for stored notifications. Never throws: delivery problems are logged, not surfaced. */
export async function deliver(rows: Notification[]) {
  if (!rows.length) return;
  for (const n of rows) emit(`user:${n.userId}`, "notification:new", n);
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const [prefs, devices, users] = await Promise.all([
    prisma.notificationPreference.findMany({ where: { userId: { in: userIds } } }),
    prisma.pushDevice.findMany({ where: { userId: { in: userIds } } }),
    rows.some((r) => EMAIL_TYPES.has(r.type)) && emailProvider.configured() ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, displayName: true } }) : Promise.resolve([]),
  ]);
  const pref = new Map(prefs.map((p) => [p.userId, p]));
  const pushes = rows.flatMap((n) =>
    pref.get(n.userId)?.push === false ? [] : devices.filter((d) => d.userId === n.userId).map((d) => ({ to: d.token, title: n.title, body: n.body ?? undefined, data: { link: n.link, type: n.type, id: n.id }, sound: "default" as const })),
  );
  const emails = rows.flatMap((n) => {
    if (!EMAIL_TYPES.has(n.type) || pref.get(n.userId)?.email === false) return [];
    const u = users.find((x) => x.id === n.userId);
    return u ? [{ to: u.email, name: u.displayName, n }] : [];
  });
  await Promise.allSettled([pushes.length ? pushProvider.send(pushes) : null, ...emails.map((e) => emailProvider.send(e.to, e.n.title, renderEmail(e.name, e.n)))]).then((rs) =>
    rs.forEach((r) => r.status === "rejected" && console.error("[notify] delivery failed:", r.reason)),
  );
}

export async function notify(items: NotifyInput | NotifyInput[]) {
  const rows = await createNotifications(prisma, Array.isArray(items) ? items : [items]);
  void deliver(rows);
  return rows;
}

// ── Push: Expo push service (works for iOS and Android apps built with Expo) ──

type PushMessage = { to: string; title: string; body?: string; data?: Record<string, unknown>; sound?: "default" };
export const pushProvider = {
  id: "expo",
  /** Expo's push API works without an access token unless "enhanced push security" is on in the Expo project. */
  configured: () => true,
  async send(messages: PushMessage[]) {
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...(env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}) },
        body: JSON.stringify(batch),
      });
      const json: any = await res.json().catch(() => null);
      // Tokens Expo reports as unregistered are dead; stop sending to them.
      const dead = (json?.data ?? []).map((t: any, idx: number) => (t?.details?.error === "DeviceNotRegistered" ? batch[idx]!.to : null)).filter(Boolean);
      if (dead.length) await prisma.pushDevice.deleteMany({ where: { token: { in: dead } } });
      if (!res.ok) throw new Error(`Expo push ${res.status}`);
    }
  },
};

// ── Email: Resend ──

export const emailProvider = {
  id: "resend",
  configured: () => !!env.RESEND_API_KEY && !!env.EMAIL_FROM,
  async send(to: string, subject: string, html: string) {
    if (!this.configured()) return;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, html }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => "")}`);
  },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
function renderEmail(name: string, n: Notification) {
  const url = n.link ? `${env.WEB_ORIGIN}${n.link}` : env.WEB_ORIGIN;
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:auto;padding:24px;background:#03060a;color:#f4f7fa;border-radius:16px">
<div style="font-weight:800;font-size:20px;margin-bottom:16px">Haven</div>
<p>Hi ${esc(name)},</p><p style="font-size:18px;font-weight:700">${esc(n.title)}</p>${n.body ? `<p style="color:#9aa9b7">${esc(n.body)}</p>` : ""}
<p><a href="${esc(url)}" style="display:inline-block;background:#149ab8;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600">Open Haven</a></p>
<p style="color:#9aa9b7;font-size:12px">You can change which emails you get in your notification settings.</p></div>`;
}
