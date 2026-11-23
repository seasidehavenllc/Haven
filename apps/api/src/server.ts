import { buildApp } from "./app";
import { env } from "./env";
import { initRealtime } from "./realtime";
import { closeDueAuctions } from "./modules/auctions";
import { expireStaleCheckouts } from "./modules/commerce";
import { renewSubscriptions } from "./modules/billing";

const app = await buildApp();
await app.ready();
initRealtime(app.server);
await app.listen({ port: env.PORT, host: "0.0.0.0" });

/**
 * Background jobs. In-process timers are fine for one instance; for horizontal scaling move
 * these to a queue worker (BullMQ on REDIS_URL) so each job runs once cluster-wide.
 * Every job is idempotent and uses row locks, so overlapping runs are safe.
 */
const every = (ms: number, name: string, fn: () => Promise<unknown>) =>
  setInterval(() => fn().catch((e) => app.log.error({ err: e }, `job ${name} failed`)), ms).unref();
every(1_000, "auctions.close", closeDueAuctions);
every(60_000, "checkout.expire", expireStaleCheckouts);
every(10 * 60_000, "subscriptions.renew", renewSubscriptions);
