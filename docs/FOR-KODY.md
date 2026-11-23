# What Haven needs from Kody

This is the running list of things only you can do: accounts, keys, decisions and merges. Everything
else Claude keeps building. Each item says what it unlocks, so you can do the ones that matter most first.

Keys go in the API server's environment (see `apps/api/.env.example`), never in the code or the apps.

## Merge, in order

Each pull request builds on the one before it, so merge them oldest first.

1. ~~#2 Preview fixes~~ (merged). Its last commit, the Haven rebrand, was pushed after you merged, so it now rides along in #3.
2. **#3** Rebrand plus notifications (inbox, push, email, settings).
3. **#4** Shipping (seller rates, labels, tracking).
4. **#5** Sign in with Apple and Google.
5. **#6** Short-form shoppable video feed.
6. **#7** AI host voice, mic transcription and avatar sessions, plus the AI salespeople page.

## Decisions

- **Where to host the preview.** Haven needs a server for the API and Postgres, plus somewhere for the
  web app. Render, Railway or Fly.io can run the whole thing; Vercel suits the web app. Pick one and
  create the account, and Claude can wire up the deploy config.
- **Shipping defaults for new stores.** Each seller sets their own per-order rate, extra-item rate and
  free-shipping threshold. New stores start at $0 (free shipping) until they change it. Do you want a
  different starting default, like $5.99 per order?
- **Who pays for labels.** Labels are bought on Haven's Shippo/EasyPost account and the cost is recorded
  against the seller, to be taken out of payouts. That deduction gets wired up when Stripe payouts are
  connected. Confirm that's how you want it.
- **AI voice prices.** Voice is now 8 credits per 1,000 characters (about $0.08) because ElevenLabs costs
  around $0.06 per 1,000 characters at list price; the old 3 credits lost money. Transcription stays 2
  credits a minute and avatars 25 a minute. Change these in Admin if you'd like different margins.

## Accounts and keys

| What it turns on | What to get | Env vars |
| --- | --- | --- |
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
