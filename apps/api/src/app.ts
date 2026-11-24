import { notificationRoutes } from "./modules/notifications";
import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { mkdirSync } from "node:fs";
import { env, testPaymentsAllowed } from "./env";
import { prisma } from "./db";
import { attachUser, requireUser } from "./lib/auth";
import { HttpError } from "./lib/errors";
import { uploadRoot } from "./storage";
import { authRoutes } from "./modules/auth";
import { sellerRoutes } from "./modules/sellers";
import { catalogRoutes } from "./modules/catalog";
import { commerceRoutes } from "./modules/commerce";
import { scannerRoutes } from "./modules/scanner";
import { streamRoutes } from "./modules/streams";
import { auctionRoutes } from "./modules/auctions";
import { billingRoutes } from "./modules/billing";
import { adminRoutes } from "./modules/admin";
import { assistantRoutes } from "./modules/assistant";
import { featureAvailability } from "./ai/gateway";
import { activePaymentProvider } from "./payments";
import { videoProvider } from "./video";
import { shippingRoutes } from "./modules/shipping";
import { activeShippingProvider } from "./shipping";
import { socialConfigured } from "./lib/social";
import { videoRoutes } from "./modules/videos";
import { aiVoiceRoutes } from "./modules/aivoice";

// BigInt (micro-dollar costs) → JSON number
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
  return Number(this);
};

export async function buildApp() {
  const app = Fastify({
    logger: env.NODE_ENV === "test" ? false : { level: "info", redact: ["req.headers.authorization"] },
    bodyLimit: 1024 * 1024,
    trustProxy: true,
    // "https://api…//auth/login" (a base URL saved with a trailing slash) still reaches /auth/login.
    routerOptions: { ignoreDuplicateSlashes: true, ignoreTrailingSlash: true },
  });

  await app.register(cors, { origin: env.WEB_ORIGIN.split(",").map((o) => o.trim()), credentials: true });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute", allowList: () => env.NODE_ENV === "test" });
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 25 } });
  mkdirSync(uploadRoot, { recursive: true });
  await app.register(fastifyStatic, { root: uploadRoot, prefix: "/uploads/", decorateReply: false });

  app.decorateRequest("user", null);
  app.addHook("onRequest", async (req) => attachUser(req));
  app.addHook("onSend", async (_req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "strict-origin-when-cross-origin");
  });

  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.code, message: err.message, details: err.details });
    if ((err as FastifyError).statusCode === 429) return reply.code(429).send({ error: "rate_limited", message: "Too many requests. Slow down a little." });
    if ((err as FastifyError).statusCode && (err as FastifyError).statusCode! < 500) return reply.code((err as FastifyError).statusCode!).send({ error: "bad_request", message: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: "internal", message: "Something went wrong" });
  });

  app.get("/health", async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  });

  /** What is actually configured right now. Web/mobile use this to avoid showing broken features. */
  app.get("/capabilities", async () => ({
    payments: { provider: activePaymentProvider(), testMode: activePaymentProvider() === "test" || (!process.env.STRIPE_SECRET_KEY && testPaymentsAllowed) },
    video: { provider: videoProvider.id, configured: videoProvider.configured() },
    ai: await featureAvailability(),
    shipping: { configured: !!activeShippingProvider(), provider: activeShippingProvider()?.id ?? "manual", tracking: !!process.env.SHIPPING_WEBHOOK_TOKEN },
    push: { configured: true, provider: "expo" },
    email: { configured: !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM },
    socialSignIn: { apple: socialConfigured("apple"), google: socialConfigured("google") },
  }));

  await app.register(notificationRoutes);
  await app.register(shippingRoutes);
  await app.register(videoRoutes);
  await app.register(aiVoiceRoutes);
  await app.register(authRoutes);
  await app.register(sellerRoutes);
  await app.register(catalogRoutes);
  await app.register(commerceRoutes);
  await app.register(scannerRoutes);
  await app.register(streamRoutes);
  await app.register(auctionRoutes);
  await app.register(billingRoutes);
  await app.register(adminRoutes);
  await app.register(assistantRoutes);
  return app;
}
