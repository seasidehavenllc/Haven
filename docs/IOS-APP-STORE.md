# Getting Haven into the App Store

The iPhone app is built on Expo's servers (EAS Build) from GitHub. You never need a Mac or a terminal.

| Setting | Value |
| --- | --- |
| App name | Haven |
| Bundle ID | `com.seasidehaven.haven` |
| Expo account / project | `skoobydoobees-team` / `haven` (project ID `21477736-dc27-483c-9e87-d82b7c53730c`) |
| API the app talks to | `https://api.seasidehavenllc.com` (set in `apps/mobile/eas.json`) |
| App Store Connect app ID | `6838728110` (set as `ascAppId` in `apps/mobile/eas.json`) |
| Build numbers | Counted up automatically by Expo on each production build |

## One-time setup

1. **Expo token.** On expo.dev, go to Account settings → Access tokens → Create token. In GitHub, go to
   Haven → Settings → Secrets and variables → Actions → New repository secret. Name it `EXPO_TOKEN` and
   paste the token.
2. **App Store Connect record.** At appstoreconnect.apple.com, go to Apps → + → New App. Choose iOS, name
   it Haven, choose the bundle ID `com.seasidehaven.haven`, and use any SKU (for example `haven-ios`).
   If the bundle ID isn't in the list, the first build creates it. Come back and make the app afterwards.
3. **Signing.** Expo already holds the Apple team that SkoobysKillfeed uses. The first build for this new
   bundle ID needs Expo to create its signing files. Do one of these:
   - On expo.dev → Haven → Credentials → iOS, add the bundle ID and let Expo generate the certificate and
     profile using your Apple login.
   - Or create an App Store Connect API key (App Store Connect → Users and Access → Integrations → App
     Store Connect API → +, with Admin access). Add these GitHub secrets: `ASC_API_KEY_P8` (the whole .p8
     file's text), `ASC_KEY_ID`, `ASC_ISSUER_ID`, and `APPLE_TEAM_ID`. The workflow then makes the signing
     files and submits by itself. If you already made a key for SkoobysKillfeed, reuse it.
4. **Stripe keys on Render.** Set `STRIPE_PUBLISHABLE_KEY` (`pk_test_…`) next to `STRIPE_SECRET_KEY`
   (`sk_test_…`) so the card form appears in the app.

## Each build

Merging a pull request to main that changes the iPhone app (`apps/mobile` or `packages/shared`) starts a
production build and TestFlight upload by itself. To build without a merge, go to GitHub → Actions → **Build
iOS app** → Run workflow, choose `production` and leave "Send the finished build" ticked. The finished build goes to TestFlight by itself, using the App Store Connect API key Expo saved
for Haven during the first `eas submit`. The build appears on expo.dev under Haven → Builds after about 15 to 25 minutes. It then
appears in App Store Connect → TestFlight after Apple finishes processing, which usually takes another
10 to 30 minutes. Install TestFlight on your iPhone to try it.

## Before you press "Submit for Review"

Apple rejects apps that miss these.

- [x] **Delete account inside the app:** Me → Delete account (website: Settings → Account).
- [x] **Report and block** for videos, comments, live chat, live streams, listings and people (the ••• menus,
      long-press a chat message, or the profile's Block and Report buttons). Reports land in **Admin → Reports**.
      Apple expects you to act on them **within 24 hours**, and the Terms promise that.
- [x] **Privacy policy and terms:** sales.seasidehavenllc.com/privacy and /terms, linked in the app, at sign-up
      and in the site footer. Use the privacy URL in App Store Connect → App Privacy. The contact address on both
      pages is info@seasidehavenllc.com (set in `apps/web/lib/legal.ts`) (confirmed by Kody).
- [ ] Screenshots: 6.9-inch iPhone screenshots (1320 × 2868). Also iPad screenshots, because the app
      supports iPad. Take them in TestFlight on your phone.
- [ ] App Store listing: subtitle, description, keywords, support URL, category (Shopping), and age
      rating (answer the questionnaire; user-generated content and live video usually mean 12+ or higher).
- [ ] App Privacy questionnaire: email, name, purchases, photos/videos, user content, device ID for push.
      Card numbers go to Stripe, not Haven.
- [ ] A demo login for Apple's reviewer (a normal buyer account with something in the store to buy), and
      notes saying payments run in Stripe test mode if that's still the case.
- [x] Payments: Haven sells physical goods, so paying with Stripe is allowed. AI credit packs and plans are
      digital purchases that Apple would require In-App Purchase for. The iPhone app doesn't sell them,
      so sellers buy them on the website. Keep it that way, and don't add a "buy credits" link in the app.
