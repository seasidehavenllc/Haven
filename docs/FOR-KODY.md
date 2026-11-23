# What Haven needs from Kody

This is the running list of things only you can do: accounts, keys, decisions and merges. Everything
else Claude keeps building. Each item says what it unlocks, so you can do the ones that matter most first.

Keys go in the API server's environment (see `apps/api/.env.example`), never in the code or the apps.

## Merge, in order

Each pull request builds on the one before it, so merge them oldest first.

1. **#2** Rebrand to Haven, plus preview fixes.
2. **Notifications** (inbox, push, email, settings).

## Decisions

- **Where to host the preview.** Haven needs a server for the API and Postgres, plus somewhere for the
  web app. Render, Railway or Fly.io can run the whole thing; Vercel suits the web app. Pick one and
  create the account, and Claude can wire up the deploy config.
- **How shipping is charged.** The code supports a flat rate per order, free shipping over an amount,
  and live carrier rates. Which should be the default for new stores?

## Accounts and keys

| What it turns on | What to get | Env vars |
| --- | --- | --- |
| AI scanner, listings, assistant, co-host | Anthropic API key (console.anthropic.com) | `ANTHROPIC_API_KEY` |
| Live video | LiveKit Cloud project | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| Real payments and seller payouts | Stripe account with Connect enabled | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Emails (orders, shipping, auction wins) | Resend account, with seasidehavenllc.com (or a subdomain) verified | `RESEND_API_KEY`, `EMAIL_FROM` |
| Phone push notifications | An Expo account, then run `eas init` in `apps/mobile` (adds the project id to `app.json`) | none on the server unless you turn on Expo's enhanced push security (`EXPO_ACCESS_TOKEN`) |
| Shipping labels and live rates | Shippo or EasyPost account | `SHIPPO_API_KEY` or `EASYPOST_API_KEY` |
| Sign in with Apple | Apple Developer account ($99/yr), a Services ID | `APPLE_CLIENT_ID` |
| Sign in with Google | Google Cloud OAuth client | `GOOGLE_OAUTH_CLIENT_ID` |
| Barcode lookups in the scanner | UPCitemdb key (optional) | `UPCITEMDB_USER_KEY` |
| App Store and Play Store builds | Apple Developer and Google Play Console accounts | |

## Brand

- The logo was traced from the image you sent. If you have the original vector file (SVG, AI or PDF),
  send it and Claude will swap it in for a crisper mark.
