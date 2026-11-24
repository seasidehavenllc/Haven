# Putting Haven online for free

Haven runs at **https://sales.seasidehavenllc.com** (the website) and **https://api.seasidehavenllc.com**
(the server). Everything below is on free plans.

| Part | Free service | What the free plan gives | Limits to know |
| --- | --- | --- | --- |
| Website | GitHub Pages | Unlimited for a public site, HTTPS included | Static files only (that's how the site is built) |
| Server (API, live chat, auctions) | Render, free web service | 512 MB RAM, 750 hours a month (enough for one always-on server) | Sleeps after 15 minutes without visitors; the "Keep the API awake" workflow pings it every 10 minutes. Restarts take ~1 minute |
| Database | Supabase, free project | 500 MB Postgres | A project with no activity for 7 days pauses; the keep-awake ping counts as activity |
| Photos and videos | Supabase Storage (same project) | 1 GB files, 2 GB transfer a month | Move to Cloudflare R2 (10 GB free) when you outgrow it; only settings change |

When sales grow, the first upgrades are Render Starter ($7/month, never sleeps) and Supabase Pro ($25/month).

## 1. Website (GitHub Pages)

1. GitHub → the Haven repository → **Settings → Pages**.
   - **Source:** GitHub Actions.
   - **Custom domain:** `sales.seasidehavenllc.com` → Save.
2. At your domain registrar, add:

   | Type | Name / Host | Value / Points to |
   | --- | --- | --- |
   | CNAME | `sales` | `seasidehavenllc.github.io` |

3. When GitHub shows the DNS check passed, tick **Enforce HTTPS**.

The **Deploy website to GitHub Pages** workflow publishes the site on every change to `main`. Until the server
is up, it builds a clearly labelled demo on sample data.

## 2. Database and file storage (Supabase)

1. Create a free account at supabase.com (Sign in with GitHub works) and a **New project**, named `haven`. Pick the region
   closest to your shoppers (US East if unsure) and save the database password somewhere safe.
2. **Database address:** Project → **Connect** → **Session pooler** → copy the connection string and
   put your database password in it. This is `DATABASE_URL`.
3. **Storage bucket:** Storage → **New bucket** → name `media`, turn **Public bucket** on.
4. **Storage keys:** Project Settings → Storage → **S3 access keys** → New access key. Note:
   - `S3_ENDPOINT` = the "Endpoint" shown there (`https://<project>.supabase.co/storage/v1/s3`)
   - `S3_REGION` = the "Region" shown there (for example `us-east-1`)
   - `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` = the new key (the secret is shown once)
   - `S3_BUCKET` = `media`
   - `CDN_BASE_URL` = `https://<project>.supabase.co/storage/v1/object/public/media`

## 3. Server (Render)

1. Create a free account at render.com with **Sign in with GitHub**, and let it see the Haven repository.
2. **New → Blueprint** → pick the Haven repository. Render reads `render.yaml` and asks for the values from
   step 2, plus `ADMIN_EMAIL` and `ADMIN_PASSWORD` for your own admin login (use a long password). `JWT_SECRET`
   is generated for you. Every start sets up the database tables and Haven's plans and prices by itself.
3. When the first deploy is green, open the service → **Settings → Custom Domains** → add
   `api.seasidehavenllc.com`. Render shows the record to add; it looks like this:

   | Type | Name / Host | Value / Points to |
   | --- | --- | --- |
   | CNAME | `api` | `haven-api.onrender.com` (use the exact name Render shows) |

4. Check it: https://api.seasidehavenllc.com/health should say `{"ok":true}`.

## 4. Point the website at the server

GitHub → Haven → **Settings → Secrets and variables → Actions → Variables → New repository variable**:

| Name | Value |
| --- | --- |
| `HAVEN_API_URL` | `https://api.seasidehavenllc.com` |

Then **Actions → Deploy website to GitHub Pages → Run workflow**. The demo banner disappears and the site
uses the real server. The same variable turns on the keep-awake ping.

## 5. Later, as you add accounts

Add each key in Render (service → Environment), then redeploy. The full list is in `apps/api/.env.example`;
`docs/FOR-KODY.md` says what each one turns on. Domain-specific settings:

- **Sign in with Google:** in the Google Cloud OAuth web client, add the authorized JavaScript origin
  `https://sales.seasidehavenllc.com`. Then set the repository variable `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
- **Sign in with Apple:** in the Services ID, add the domain `sales.seasidehavenllc.com` and return URL
  `https://sales.seasidehavenllc.com/login`. Then set the repository variables `NEXT_PUBLIC_APPLE_SERVICES_ID` and
  `NEXT_PUBLIC_APPLE_REDIRECT_URI` (`https://sales.seasidehavenllc.com/login`).
- **Email (Resend):** verify `seasidehavenllc.com` in Resend; it gives you 3–4 DNS records to add at your registrar.
  Then `EMAIL_FROM` can be `Haven <hello@seasidehavenllc.com>`.
- **Shipping tracking webhook:** `https://api.seasidehavenllc.com/webhooks/shipping/shippo?token=<SHIPPING_WEBHOOK_TOKEN>`.
- **Phone app:** build it with `EXPO_PUBLIC_API_URL=https://api.seasidehavenllc.com`.
