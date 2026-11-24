# What Haven needs from Kody

This is the running list of things only you can do: accounts, keys, decisions and merges. Everything
else Claude keeps building. Each item says what it unlocks, so you can do the ones that matter most first.

Keys go in the API server's environment (see `apps/api/.env.example`), never in the code or the apps.

## Waiting for you to merge

- **#10** Website on GitHub Pages at sales.seasidehavenllc.com (a labelled demo until the server is up).
- **#11** Free server setup: Render blueprint, Supabase/R2 file storage, keep-awake ping, and [DEPLOY.md](DEPLOY.md).

Everything before these (#2 to #9) is merged.

## Decisions

- ~~**Where to host.**~~ Decided: free hosting, website on GitHub Pages at `sales.seasidehavenllc.com`,
  server on Render at `api.seasidehavenllc.com`, database and files on Supabase. Step-by-step setup and every
  DNS record are in [DEPLOY.md](DEPLOY.md).
- **Shipping defaults for new stores (decided).** New stores start with free shipping. Each seller can
  set their own per-order rate, extra-item rate and free-shipping threshold in Studio.
- **Who pays for labels (decided).** Labels are bought on Haven's Shippo/EasyPost account, and the cost
  is recorded against the seller in the seller ledger, to come out of their payouts. The deduction
  happens automatically once Stripe payouts to sellers are built.
- **AI voice prices (decided).** Voice is 10 credits per 1,000 characters (about $0.10). ElevenLabs costs
  around $0.06 per 1,000 characters at list price. Transcription stays 2 credits a minute and avatars
  25 a minute. Change any of these in Admin, under AI, in the feature prices section.

## Accounts and keys

| What it turns on | What to get | Env vars |
| --- | --- | --- |
| Haven online at sales.seasidehavenllc.com | Free Render and Supabase accounts (sign in with GitHub), plus DNS records `sales` and `api` at your registrar. Follow [DEPLOY.md](DEPLOY.md) | Set in Render; then the GitHub variable `HAVEN_API_URL` |
| AI scanner, listings, assistant, co-host | Anthropic API key (console.anthropic.com) | `ANTHROPIC_API_KEY` |
| Live video | LiveKit Cloud project | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| Real payments and seller payouts | Stripe account with Connect enabled | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Emails (orders, shipping, auction wins) | Resend account, with seasidehavenllc.com (or a subdomain) verified | `RESEND_API_KEY`, `EMAIL_FROM` |
| Phone push notifications | An Expo account, then run `eas init` in `apps/mobile` (adds the project id to `app.json`) | none on the server unless you turn on Expo's enhanced push security (`EXPO_ACCESS_TOKEN`) |
| Shipping labels and live rates | Shippo or EasyPost account. Then point its tracking webhook at `https://<api>/webhooks/shipping/shippo?token=...` (or `/easypost`) | `SHIPPO_API_KEY` or `EASYPOST_API_KEY`, `SHIPPING_WEBHOOK_TOKEN` |
| Sign in with Apple | Apple Developer account ($99/yr). Turn on Sign in with Apple for the app id `com.seasidehaven.haven`, and create a Services ID for the website with its return URL | API: `APPLE_CLIENT_ID` (bundle id and Services ID, comma-separated). Web: `NEXT_PUBLIC_APPLE_SERVICES_ID`, `NEXT_PUBLIC_APPLE_REDIRECT_URI` |
| Sign in with Google | Google Cloud project with OAuth client ids for web, iOS and Android | API: `GOOGLE_OAUTH_CLIENT_ID` (all three, comma-separated). Web: `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. Mobile: `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` |
| AI voice for AI hosts and co-hosts | ElevenLabs account (or use your OpenAI key). Then turn the provider on in Admin → AI providers | `ELEVENLABS_API_KEY` (or `OPENAI_API_KEY`) |
| Server-side mic transcription (the browser's own speech recognition works without it) | Deepgram account | `DEEPGRAM_API_KEY`, then turn Deepgram on in Admin |
| Video avatar for AI-hosted shows | HeyGen account with streaming avatars. Sessions and billing are built; the on-screen avatar player still needs HeyGen's web SDK, which Claude adds once there's a key to test with | `HEYGEN_API_KEY`, then turn HeyGen on in Admin |
| Barcode lookups in the scanner | UPCitemdb key (optional) | `UPCITEMDB_USER_KEY` |
| App Store and Play Store builds | Apple Developer and Google Play Console accounts | |

## Video hosting (later, when traffic grows)

Videos are stored as uploaded and played straight from storage. That's fine for launch. When volume grows,
pick Mux or Cloudflare Stream for adaptive streaming and thumbnails, and set `FFPROBE_PATH` on the server
so it measures every upload itself.

## Brand

- The logo was traced from the image you sent. If you have the original vector file (SVG, AI or PDF),
  send it and Claude will swap it in for a crisper mark.
