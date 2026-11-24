/**
 * Staff roles for the admin panel. The server enforces these on every admin route; the web and
 * mobile apps only use them to decide which sections to show.
 *
 * OWNER    – everything, including staff roles, fees, payouts, AI settings, secrets and the audit log.
 * MANAGER  – day-to-day operations: moderation, listings, sellers, live shows, suspending people,
 *            orders and refunds up to a limit. Sees contact details masked. No money settings,
 *            no bans, no role changes, no audit log.
 * SUPPORT  – helping customers: look people up, see their orders and contact details, refund up to
 *            a smaller limit, and send them a message. Sees seller applications, can't decide them.
 *            No moderation, no settings, no finances.
 */
export const StaffRoles = ["OWNER", "MANAGER", "SUPPORT"] as const;
export type StaffRole = (typeof StaffRoles)[number];

export const StaffPermissions = [
  "staff.manage", // give or take away staff roles
  "audit.view", // see the log of every staff action
  "settings.manage", // marketplace fee, AI switch and budgets, refund limits
  "ai.manage", // AI providers, routing, plans and prices
  "finance.view", // GMV, fees, AI revenue and profitability
  "pii.view", // full emails, addresses and payment references (otherwise masked)
  "users.view",
  "users.suspend", // suspend or reactivate an account
  "users.ban", // ban permanently
  "users.message", // send a person a message from Haven support
  "orders.view",
  "orders.refund", // up to the role's refund limit
  "reports.view",
  "content.moderate", // remove videos, comments, chat and listings; resolve reports
  "sellers.view", // see seller applications and sellers (read only)
  "sellers.manage", // approve, reject or suspend seller accounts and applications; turn a seller's AI off
  "shows.manage", // see and end live shows
] as const;
export type StaffPermission = (typeof StaffPermissions)[number];

const MANAGER: StaffPermission[] = [
  "users.view",
  "users.suspend",
  "users.message",
  "orders.view",
  "orders.refund",
  "reports.view",
  "content.moderate",
  "sellers.view",
  "sellers.manage",
  "shows.manage",
];
const SUPPORT: StaffPermission[] = ["users.view", "users.message", "pii.view", "orders.view", "orders.refund", "reports.view", "sellers.view"];

export const RolePermissions: Record<StaffRole, readonly StaffPermission[]> = {
  OWNER: StaffPermissions,
  MANAGER,
  SUPPORT,
};

export const StaffRoleInfo: Record<StaffRole, { name: string; summary: string }> = {
  OWNER: { name: "Owner", summary: "Everything: staff roles, fees, AI settings, finances and the audit log." },
  MANAGER: { name: "Manager", summary: "Runs day-to-day: moderation, listings, seller applications and sellers, live shows, suspensions and refunds up to a limit. Contact details are masked. Can't change money settings, ban people or manage staff." },
  SUPPORT: { name: "Customer support", summary: "Helps customers: looks people up, sees their orders and contact details, sends messages and refunds up to a small limit. Can see seller applications but not decide them. No moderation, settings or finances." },
};

export const can = (role: StaffRole | null | undefined, p: StaffPermission) => !!role && RolePermissions[role].includes(p);
