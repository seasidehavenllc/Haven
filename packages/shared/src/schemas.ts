import { z } from "zod";
import { ProductConditions, Roles, StreamModes, CohostModes } from "./enums";

const slug = z.string().min(2).max(60).regex(/^[a-z0-9-]+$/, "lowercase letters, numbers and dashes only");

export const RegisterInput = z.object({
  email: z.string().email().max(200),
  password: z.string().min(10, "at least 10 characters").max(200),
  displayName: z.string().min(1).max(80),
  handle: z.string().min(3).max(30).regex(/^[a-z0-9_]+$/, "lowercase letters, numbers and underscores"),
  role: z.enum(["BUYER", "SELLER", "CREATOR"]).default("BUYER"),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({ email: z.string().email(), password: z.string().min(1) });

export const StorefrontInput = z.object({
  name: z.string().min(2).max(80),
  slug,
  description: z.string().max(2000).optional(),
  logoUrl: z.string().url().optional(),
  bannerUrl: z.string().url().optional(),
  shippingPolicy: z.string().max(4000).optional(),
  returnPolicy: z.string().max(4000).optional(),
});
export type StorefrontInput = z.infer<typeof StorefrontInput>;

export const VariantInput = z.object({
  sku: z.string().max(64).optional(),
  name: z.string().min(1).max(120),
  options: z.record(z.string()).default({}),
  priceCents: z.number().int().nonnegative(),
  quantity: z.number().int().nonnegative(),
});

export const ProductInput = z.object({
  title: z.string().min(3).max(160),
  description: z.string().max(10000).default(""),
  categoryId: z.string().optional(),
  brand: z.string().max(80).optional(),
  model: z.string().max(80).optional(),
  condition: z.enum(ProductConditions).default("NEW"),
  tags: z.array(z.string().max(40)).max(30).default([]),
  imageUrls: z.array(z.string()).max(12).default([]),
  shippingWeightGrams: z.number().int().positive().optional(),
  status: z.enum(["DRAFT", "ACTIVE"]).default("ACTIVE"),
  variants: z.array(VariantInput).min(1).max(100),
});
export type ProductInput = z.infer<typeof ProductInput>;

export const ProductQuery = z.object({
  q: z.string().max(200).optional(),
  category: z.string().optional(),
  store: z.string().optional(),
  minPrice: z.coerce.number().int().optional(),
  maxPrice: z.coerce.number().int().optional(),
  inStock: z.coerce.boolean().optional(),
  sort: z.enum(["newest", "price_asc", "price_desc"]).default("newest"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});

export const CartItemInput = z.object({ variantId: z.string(), quantity: z.number().int().min(1).max(99) });

export const AddressInput = z.object({
  name: z.string().min(1).max(120),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  region: z.string().min(1).max(100),
  postalCode: z.string().min(2).max(20),
  country: z.string().length(2),
});

export const CheckoutInput = z.object({
  address: AddressInput,
  /** Client-generated key; resubmitting the same key returns the same order. */
  idempotencyKey: z.string().min(8).max(100),
  streamId: z.string().optional(),
  affiliateCode: z.string().optional(),
});

/** Seller confirms (or edits) a scan draft before publishing. Price is mandatory and human-confirmed. */
export const PublishDraftInput = z.object({
  title: z.string().min(3).max(160),
  description: z.string().max(10000),
  categoryId: z.string().optional(),
  brand: z.string().max(80).nullable().optional(),
  model: z.string().max(80).nullable().optional(),
  condition: z.enum(ProductConditions),
  tags: z.array(z.string()).max(30).default([]),
  priceCents: z.number().int().positive(),
  priceConfirmed: z.literal(true, { errorMap: () => ({ message: "Seller must confirm the price" }) }),
  quantity: z.number().int().min(1),
  shippingWeightGrams: z.number().int().positive().optional(),
  addToLiveMenu: z.boolean().default(true),
});

export const StreamInput = z.object({
  title: z.string().min(3).max(140),
  description: z.string().max(2000).optional(),
  mode: z.enum(StreamModes),
  cohostMode: z.enum(CohostModes).default("SILENT"),
  scheduledFor: z.string().datetime().optional(),
  aiAgentId: z.string().optional(),
  productIds: z.array(z.string()).max(200).default([]),
});

export const AuctionInput = z.object({
  productId: z.string(),
  startingPriceCents: z.number().int().positive(),
  minIncrementCents: z.number().int().positive(),
  reservePriceCents: z.number().int().positive().optional(),
  startsAt: z.string().datetime().optional(),
  durationSeconds: z.number().int().min(30).max(60 * 60 * 24 * 14),
  streamId: z.string().optional(),
});

export const BidInput = z.object({ amountCents: z.number().int().positive(), idempotencyKey: z.string().min(8).max(100) });

export const RoleEnum = z.enum(Roles);
