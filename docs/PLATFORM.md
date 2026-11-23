# Haven platform: architecture, plan and status

This document covers what was built in Phase 1, how it fits together, what it costs to run, and what comes next. Any dollar figure marked *estimate* comes from public price lists as of November 2026. Check it against your own provider contracts before you set final prices.

## 1. Starting point

The environment held no existing code: the Haven repo was empty and there was no prior app to reuse. Everything here is new, built as a pnpm monorepo so that web, iOS and Android share one API, one data model and one set of validation schemas (`packages/shared`).

## 2. Architecture

```
 Web (Next.js)      iOS / Android (Expo)
        \                /
         REST + Socket.io (subscribe only)
                 |
          API (Fastify, Node 22)
   auth · catalog · cart/checkout · scanner · streams
   auctions · AI gateway · billing · admin · realtime
        |            |              |
    Postgres     Object storage   External adapters
    (Prisma)     (local / S3)     AI · LiveKit · Stripe · UPC · shipping
```

Key rules the code follows:

- **The server decides everything that matters.** Prices, stock, fees, bid validity, auction end times and AI permissions are all computed on the server. Clients only display them.
- **Realtime is read-only.** Every change goes through REST and is then broadcast to rooms (`stream:`, `product:`, `auction:`, `seller:`, `user:`). Clients cannot push state through the socket.
- **Money is integer cents** everywhere. AI provider costs are integer micro-dollars.
- **Concurrency is enforced in the database.** Stock uses a guarded `UPDATE … WHERE quantity >= n`, so overselling is impossible (tested with 8 buyers racing for 3 units). Bids lock the auction row and extend it by 15 seconds against sniping. AI credits use a per-seller advisory lock, so concurrent calls cannot overdraw.
- **Idempotency keys** on checkout and credit purchases, so a retried request never charges twice.
- **Append-only ledgers** for AI credits (`AiCreditTransaction`), plus usage records, billing charges and an admin audit log.

### Live shopping modes

| Mode | What happens |
| --- | --- |
| Human host | Seller presents. No AI. |
| Human + AI co-host | Seller presents. The AI privately answers the host's questions from real stream data (menu, stock, chat). It speaks publicly only if the host turns on "AI can answer viewers", and then every AI message is labeled. Host controls: pause, takeover, and a voice trigger ("AI, …") using the browser's speech recognition. |
| AI host | An AI salesperson runs the show. Viewers always see a disclosure banner. Phase 1 builds the agent records, plan gating and chat replies. Voice and avatar output is Phase 2 (see §8). |

**Automatic live menu:** creating a show adds every active product that has "live menu" on. Newly published scans join running shows automatically. The host can pin, hide or remove items, and buy-now refuses hidden or off-menu items.

### AI photo-to-listing

1. Upload 1–8 photos of one item, or a batch with one photo per item (up to 25). An optional barcode can be added.
2. Images are checked by their actual file signature (not the extension), hashed, and checked for duplicates.
3. The AI returns a strict JSON listing: title, description, category, brand/model with confidence, condition, tags, and questions for the seller. The prompt forbids inventing brands or specs.
4. Price: if the marketplace has 3 or more comparable sold or listed items, the estimate is grounded in them. Otherwise any AI range is labeled an estimate. **The draft price is always empty.** Publishing requires the seller to type a price and confirm it (`priceConfirmed: true` is enforced server-side).
5. If the AI call fails, the credits are refunded automatically.

## 3. AI provider architecture

All AI calls go through one gateway (`apps/api/src/ai/gateway.ts`).

1. **Authorize.** Checks, in order: the global kill switch, the platform daily/monthly spend budget, that the seller is active with AI on, that the plan includes the feature, per-plan limits, the seller's own daily and monthly caps, and the credit balance. Denied attempts are recorded with a reason.
2. **Reserve** credits inside the ledger lock.
3. **Route.** Providers are tried in priority order from `AiRoutingRule`, per capability (vision, text, transcription, TTS, avatar). A retryable error falls through to the next provider.
4. **Record** an `AiUsageRecord` with tokens, latency, provider and the provider cost in micro-dollars.
5. **Refund** the reservation if every provider fails.

Provider keys live only in server env vars. The database stores the *name* of the env var, never the secret. Admin pages show "credential configured: yes/no" and never the value. Sellers and buyers never see provider names or costs.

Adapters built: Anthropic (default: `claude-sonnet-5-5` for scans, `claude-haiku-5-5` for quick text) and OpenAI (disabled by default). Deepgram, ElevenLabs and HeyGen are registered as planned providers and switched off until their adapters ship in Phase 2.

## 4. Operating costs per AI action *(estimates)*

| Action | Credits charged | Revenue at $0.01/credit | Provider cost *(estimate)* | Notes |
| --- | --- | --- | --- | --- |
| Photo scan (vision + listing) | 5 | $0.05 | $0.01–0.03 | About 3–6k input tokens with images and 1k output on Sonnet 5.5 ($2 / $10 per MTok). |
| Listing rewrite | 2 | $0.02 | under $0.01 | Haiku 5.5. |
| Price suggestion | 1 | $0.01 | under $0.005 | Grounded in marketplace data first. |
| Shopping assistant | 0 (platform-paid) | none | about $0.002 per query | Two Haiku calls. Budget-capped. |
| AI co-host, per minute | 4 | $0.04 | $0.01–0.02 | Transcription plus occasional LLM calls. |
| AI host, per minute | 30 | $0.30 | $0.15–0.30 | TTS and LLM. An avatar adds 25 credits/min ($0.25) to cover HeyGen-class streaming avatars. Re-check before launch. |

Credit value: packs sell at $10 / 1,000 credits, so 1 credit is about 1¢. Plan credits work out to roughly 1.3–1.5¢ each. All prices are editable in Admin → Plans & pricing without a deploy. The admin profitability dashboard shows real revenue against real provider cost by feature, provider, plan and seller, and flags sellers whose cost runs more than 5× the median. Test-mode charges are excluded.

Fixed infrastructure (rough, small scale): managed Postgres $15–50/mo, API hosting $20–50/mo, S3 + CDN $5–30/mo, and LiveKit Cloud billed per participant-minute. Stripe charges 2.9% + 30¢ per card payment plus Connect payout fees.

## 5. Subscriptions and credits

| Plan | Price | Credits / month | Rollover | Includes |
| --- | --- | --- | --- | --- |
| Starter | Free | 100 (about 20 scans) | none | Scanning, listing writing, price suggestions |
| Seller Pro | $29 | 2,000 | none | + AI co-host, transcription, AI voice |
| Business | $79 | 6,000 | 25% | + 1 AI salesperson, AI host, AI avatar |
| Enterprise | $199 | 18,000 | 50% | + 5 AI salespeople, longer AI-host sessions |

- Credit packs: 1,000 for $10, 5,000 for $45, 20,000 for $160. Purchased credits never expire and are spent after plan credits.
- Upgrades apply immediately. Downgrades happen at renewal. A failed renewal marks the plan past due and stops paid features.
- Sellers can set daily and monthly credit caps and switch AI off for their store entirely.
- The marketplace fee is 8% of each order (`marketplaceFeeBps`, editable by an admin).

## 6. Security and billing requirements

What's in place:

- Passwords are hashed with bcrypt.
- Access tokens last 15 minutes. Refresh tokens rotate, are stored hashed, and reusing a revoked one signs the user out everywhere.
- Every role check reloads the user from the database, so a suspended user loses access immediately.
- All input is validated with zod on the server. Rate limits apply globally, with tighter limits on auth, buy-now and bids.
- Uploads are checked by their file contents, capped at 15 MB, and served with `nosniff`.
- The Stripe webhook signature is verified with HMAC and a timestamp tolerance.
- Security headers are set. CORS allows only the web origin.
- The test payment provider is impossible in production, and test orders are flagged and excluded from revenue everywhere.
- Admin actions are audit-logged.

Before taking real money:

1. Finish Stripe Connect onboarding (seller KYC, payouts) and the Stripe Billing subscription flow. Plans currently switch through the test provider in dev.
2. Move uploads to S3 with signed URLs, and add image moderation.
3. Add Redis for rate-limit storage and the Socket.io adapter once more than one API instance runs.
4. Add a privacy policy and terms, plus sales-tax handling (Stripe Tax). AI-host disclosure is already shown.
5. Get an external security review, add dependency scanning in CI, and set up database backups with point-in-time recovery.

## 7. Phased plan

**Phase 1 (this PR): foundation and core loop**
API, data model, auth, catalog, cart and checkout with server-side pricing, the oversell-proof inventory, the scanner, the automatic live menu, live shows with chat and the co-host, auctions, the AI gateway with plans, credits and limits, the admin with profitability, the website, and the mobile app core.

**Phase 2: connect the real services**
- LiveKit video in web and mobile (a mobile dev build with `@livekit/react-native`)
- Stripe Connect payouts and Billing for plans; the Stripe payment sheet on mobile
- Deepgram transcription, ElevenLabs voice, and an avatar provider for the AI host
- Shippo/EasyPost labels, and push and email notifications
- Sign in with Apple and Google
- S3 storage

**Phase 3: growth features**
Short-form video feed, affiliates and creator commissions (schema exists), DMs, reviews UI, seller analytics, search ranking, moderation queue tooling, and App Store / Play Store release builds (EAS).

**Phase 4: scale and polish**
Multi-instance realtime (Redis), background job queue, observability, load testing, localization, and accessibility audit.

## 8. Status: what works today

**Working and tested** (17 API integration tests, a production web build, and a Playwright browser run of the full buyer and seller flow; the mobile app typechecks and bundles for iOS and Android):
- Accounts, sessions, roles, seller onboarding with Starter credits
- Products, variants, stock, media upload, search, storefronts, follows, wishlist
- Cart, checkout and buy-now with server prices, the 8% fee and idempotency (Stripe or dev test payments)
- Live shows: create, go live, pause, end; realtime chat, viewer counts, pin, menu hide/remove, live stock updates
- Co-host: private Q&A grounded in stream data, public replies only when the host allows, labeled as AI
- Auctions with concurrent-safe bidding, anti-sniping, closing, and winner checkout
- AI plans, credits, packs, caps, kill switch, platform budgets, refunds on failure, profitability dashboard
- Admin: settings, providers and routing, pricing, users and sellers, product removal, audit log

**Built but needs credentials to run for real:**
- AI scan, listing writing, co-host and assistant need `ANTHROPIC_API_KEY`. Not yet exercised against the live API in this environment.
- Live video needs the LiveKit keys. Tokens are generated; the player UI is Phase 2.
- Real payments need the Stripe keys. PaymentIntents and the webhook are written; Connect payouts are Phase 2.
- Barcode lookup works keyless at low limits; `UPCITEMDB_USER_KEY` raises them.

**Not built yet:** AI host voice and avatar output, short-form video feed, affiliates UI, DMs, shipping labels, push and email, social sign-in, and store release builds.
