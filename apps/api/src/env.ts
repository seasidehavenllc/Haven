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
  ALLOW_TEST_PAYMENTS: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  STRIPE_SECRET_KEY: z.string().optional(),
  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  UPCITEMDB_USER_KEY: z.string().optional(),
});

export const env = Env.parse(process.env);
export const isProd = env.NODE_ENV === "production";
/** Test payments are never allowed in production, regardless of flags. */
export const testPaymentsAllowed = !isProd && env.ALLOW_TEST_PAYMENTS;
