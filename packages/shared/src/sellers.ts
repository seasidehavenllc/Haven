import { z } from "zod";

/**
 * Selling on Haven is by application. Anyone can shop; to list items or go live a person applies
 * from the Sell tab and a Haven owner or manager approves them. The server enforces this on every
 * selling route (requireSeller / requireApprovedSeller in apps/api/src/lib/auth.ts).
 */

export const SellerCategories = [
  "Clothing & shoes",
  "Sneakers",
  "Handbags & accessories",
  "Jewelry & watches",
  "Trading cards",
  "Sports memorabilia",
  "Toys & collectibles",
  "Comics & books",
  "Coins & money",
  "Electronics",
  "Video games",
  "Home & kitchen",
  "Beauty",
  "Vintage & antiques",
  "Wholesale & liquidation",
  "Other",
] as const;

export const InventorySizes = ["1-25", "26-100", "101-500", "500+"] as const;

export const SELLER_TERMS_VERSION = "2026-11-24";

/** The seller terms in plain words. Shown in full before the applicant agrees. */
export const SellerTerms: string[] = [
  "You sell only items you own or are allowed to sell, and you describe them honestly, including condition and flaws.",
  "No counterfeits, replicas, stolen goods, weapons, drugs, recalled products or anything else Haven's prohibited items list bans.",
  "You ship within 2 business days of a sale with tracking, using Haven's shipping labels or your own.",
  "Prices you say on a live show or video are the prices you charge. No hidden fees.",
  "Haven takes the marketplace fee shown in your seller dashboard from each sale. Payouts go to the bank account you connect through Stripe.",
  "You handle returns, damaged items and buyer questions quickly and politely. Haven can refund a buyer when an order goes wrong.",
  "You follow the community rules on live shows, in chat and in videos. No harassment, hate or adult content.",
  "Haven can pause or close your selling for breaking these terms, for fraud, or when a lot of buyers report problems.",
  "You're responsible for your own taxes. Stripe may send you a 1099-K form.",
];

/** What each status means to the applicant, in plain words. */
export const ApplicationStatusInfo = {
  DRAFT: { label: "Not sent yet", summary: "Finish the steps below and send your application." },
  SUBMITTED: { label: "In review", summary: "Our team is reviewing your application. This usually takes 1 to 2 business days. We'll notify you." },
  NEEDS_INFO: { label: "More info needed", summary: "We need a bit more from you. Update your application and send it again." },
  APPROVED: { label: "Approved", summary: "You're approved to sell and go live." },
  REJECTED: { label: "Not approved", summary: "Your application wasn't approved this time." },
} as const;
export type SellerApplicationStatus = keyof typeof ApplicationStatusInfo;

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ().-]{7,20}$/, "Enter a phone number with area code");

export const ApplicationAddress = z.object({
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().min(2).max(100),
  region: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().min(3).max(20),
  country: z.string().trim().length(2).default("US"),
});

/**
 * Fields the applicant fills in. Every field is optional while saving a draft; `missingRequirements`
 * says what still has to be done before it can be sent.
 */
export const SellerApplicationInput = z.object({
  legalName: z.string().trim().min(2).max(120),
  phone,
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  address: ApplicationAddress,
  businessType: z.enum(["INDIVIDUAL", "BUSINESS"]),
  businessName: z.string().trim().min(2).max(120),
  storeName: z.string().trim().min(2).max(80),
  storeSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "3-40 letters, numbers or dashes"),
  categories: z.array(z.enum(SellerCategories)).min(1).max(6),
  description: z.string().trim().min(20, "Tell us a little more (20 characters or more)").max(2000),
  inventorySize: z.enum(InventorySizes).optional().nullable(),
  experience: z.string().trim().max(1000).optional().nullable(),
  socialLinks: z.array(z.string().trim().url().max(300)).max(5).default([]),
  sampleImageUrls: z.array(z.string().url().max(500)).max(6).default([]),
  agreeToTerms: z.boolean().optional(),
});
export type SellerApplicationInput = z.infer<typeof SellerApplicationInput>;

/** Whole years between a YYYY-MM-DD birth date and now. */
export function ageFrom(dateOfBirth: string | Date, now = new Date()) {
  const d = typeof dateOfBirth === "string" ? new Date(`${dateOfBirth.slice(0, 10)}T00:00:00Z`) : dateOfBirth;
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

/**
 * The one check other features use to decide whether someone can sell or go live, from the
 * `/auth/me` response (`me.canSell` is the same thing, computed by the server).
 */
export const canSell = (me: { seller?: { status?: string } | null } | null | undefined) => me?.seller?.status === "APPROVED";
