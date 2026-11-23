# Haven

AI-first social commerce: live shopping (human host, human + AI co-host, or AI host), AI photo-to-listing, auctions, a marketplace, and an AI shopping assistant. It runs on the web, iOS and Android from one shared backend.

Packages are named `@haven/api`, `@haven/web`, `@haven/mobile` and `@haven/shared`.

| Folder | What it is |
| --- | --- |
| `apps/api` | Node 22 + Fastify 5 + Prisma 6 (Postgres). REST plus Socket.io realtime. All business rules, money, AI routing and billing live here. |
| `apps/web` | Next.js 15 + React 19 + Tailwind 4: buyer site, seller dashboard and studio, admin. |
| `apps/mobile` | Expo SDK 58 (React Native 0.88, expo-router): iOS and Android apps. |
| `packages/shared` | zod schemas, enums and money helpers shared by all three. |
| `docs/PLATFORM.md` | Architecture, AI provider design and costs, plans and credits, security, the phased plan, and current status. |

## Run it locally

You need Node 22, pnpm 10 and Postgres 16.

```bash
pnpm install

# Database
createdb commerce            # or use any Postgres URL
cp apps/api/.env.example apps/api/.env
#   set DATABASE_URL and JWT_SECRET (openssl rand -base64 48)
#   for local testing without Stripe, set ALLOW_TEST_PAYMENTS=true
pnpm --filter @haven/api exec prisma migrate deploy
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-password' pnpm db:seed

# API on :4000, web on :3000
pnpm dev:api
cp apps/web/.env.example apps/web/.env.local
pnpm dev:web

# Mobile: on a real phone, set EXPO_PUBLIC_API_URL to your computer's LAN IP
cp apps/mobile/.env.example apps/mobile/.env
pnpm dev:mobile
```

The seed only creates configuration: categories, AI plans, credit prices, credit packs, AI providers and routing, and the admin account if you pass `ADMIN_EMAIL` and `ADMIN_PASSWORD`. It never creates fake products, sellers, reviews or orders.

## Tests

```bash
createdb commerce_test
DATABASE_URL=postgresql://…/commerce_test pnpm test
```

The test setup refuses to run against a database whose name doesn't end in `_test`, because it drops and recreates the schema.

## What needs credentials

Every integration below is built as an adapter. Without its env var the feature reports "not configured" in the API (`GET /capabilities`) and in the UI. It never fakes a result. See `apps/api/.env.example` for the full list.

| Feature | Env vars |
| --- | --- |
| AI scanning, listing writing, co-host, shopping assistant | `ANTHROPIC_API_KEY` (and/or `OPENAI_API_KEY`, then enable it in Admin → AI) |
| Live video | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| Payments and seller payouts | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Barcode lookup | `UPCITEMDB_USER_KEY` (the free tier works without a key, with low limits) |
| Production media storage | `STORAGE_DRIVER=s3` and `S3_*`, `CDN_BASE_URL` |
| Transcription, AI voice, AI avatar (Phase 2) | `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `HEYGEN_API_KEY` |
| Shipping labels (Phase 2) | `SHIPPO_API_KEY` or `EASYPOST_API_KEY` |
| Sign in with Apple / Google, push, email (Phase 2) | `APPLE_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_ID`, `EXPO_ACCESS_TOKEN`, `RESEND_API_KEY` |
