# What Haven needs from Kody

This is the running list of things only you can do: accounts, keys, decisions and merges. Everything
else Claude keeps building. Each item says what it unlocks, so you can do the ones that matter most first.

Keys go in the API server's environment (see `apps/api/.env.example`), never in the code or the apps.

## Merge, in order

Each pull request builds on the one before it, so merge them oldest first.

1. **#2** Rebrand to Haven, plus preview fixes.
2. **#3** Notifications (inbox, push, email, settings).
3. **#4** Shipping (seller rates, labels, tracking).

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

## Accounts and keys

| What it turns on | What to get | Env vars |
| --- | --- | --- |
| AI scanner, listings, assistant, co-host | Anthropic API key (console.anthropic.com) | `ANTHROPIC_API_KEY` |
| Live video | LiveKit Cloud project | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| Real payments and seller payouts | Stripe account with Connect enabled | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Emails (orders, shipping, auction wins) | Resend account, with seasidehavenllc.com (or a subdomain) verified | `RESEND_API_KEY`, `EMAIL_FROM` |
| Phone push notifications | An Expo account, then run `eas init` in `apps/mobile` (adds the project id to `app.json`) | none on the server unless you turn on Expo's enhanced push security (`EXPO_ACCESS_TOKEN`) |
| Shipping labels and live rates | Shippo or EasyPost account. Then point its tracking webhook at `https://<api>/webhooks/shipping/shippo?token=...` (or `/easypost`) | `SHIPPO_API_KEY` or `EASYPOST_API_KEY`, `SHIPPING_WEBHOOK_TOKEN` |
| Sign in with Apple | Apple Developer account ($99/yr), a Services ID | `APPLE_CLIENT_ID` |
| Sign in with Google | Google Cloud OAuth client | `GOOGLE_OAUTH_CLIENT_ID` |
| Barcode lookups in the scanner | UPCitemdb key (optional) | `UPCITEMDB_USER_KEY` |
| App Store and Play Store builds | Apple Developer and Google Play Console accounts | |

## Brand

- The logo was traced from the image you sent. If you have the original vector file (SVG, AI or PDF),
  send it and Claude will swap it in for a crisper mark.
