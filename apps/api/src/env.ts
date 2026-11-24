import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  PUBLIC_API_URL: z.string().default("http://localhost:4000"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  UPLOAD_DIR: z.string().default("uploads"),
  /** S3-compatible storage (Cloudflare R2, AWS S3, Backblaze B2...). Used when STORAGE_DRIVER=s3. */
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Public address the bucket's files are served from, e.g. https://media.seasidehavenllc.com */
  CDN_BASE_URL: z.string().url().optional(),
  ALLOW_TEST_PAYMENTS: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  STRIPE_SECRET_KEY: z.string().optional(),
  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  UPCITEMDB_USER_KEY: z.string().optional(),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
});

export const env = Env.parse(process.env);
export const isProd = env.NODE_ENV === "production";
/** Test payments are never allowed in production, regardless of flags. */
export const testPaymentsAllowed = !isProd && env.ALLOW_TEST_PAYMENTS;
