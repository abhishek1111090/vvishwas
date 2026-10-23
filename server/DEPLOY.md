# Deploying the VISHWAS server on Plesk

Target: API at `https://adabhishek1.in/api`, Node.js (this folder), PostgreSQL
on the same server, recordings in a private folder outside `httpdocs`.

## What was verified from outside (no server login)

| Check | Result |
|---|---|
| `adabhishek1.in` DNS | **Does not exist.** The .in registry reports the name as *available for registration* — this is why Plesk shows "Domain is not resolvable". |
| `94.136.187.4` | Plesk server (nginx). Plesk panel on :8443, web on :80/:443, SSH on :22 open. |
| PostgreSQL :5432 from the internet | Closed/filtered — good; keep it that way. |
| PostgreSQL installed / Node.js extension / Git deploy settings | **Not verifiable without a Plesk login** — check in the steps below. |

## 1. Domain + HTTPS (required first)

1. Register `adabhishek1.in` (or confirm the exact spelling of the domain you own).
2. At the registrar, either point the nameservers to your Plesk server, or create DNS records:
   - `A  adabhishek1.in      → 94.136.187.4`
   - `A  www.adabhishek1.in  → 94.136.187.4`
3. Wait until `nslookup adabhishek1.in` returns `94.136.187.4`.
4. Plesk → Websites & Domains → adabhishek1.in → **SSL/TLS Certificates** → *Install* a free
   Let's Encrypt certificate (domain + www). Turn on **Permanent SEO-safe 301 redirect from HTTP to HTTPS**.

## 2. Back up the current site

Plesk → Websites & Domains → **Backup & Restore** → *Back Up* (files + databases) before deploying.

## 3. PostgreSQL

1. Plesk → **Databases → Add Database**. If PostgreSQL isn't offered as the type, the
   server administrator must install it (Tools & Settings → Updates → Add/Remove Components →
   *PostgreSQL server*), or use a managed PostgreSQL (e.g. Neon, Supabase, AWS RDS) and set
   `DATABASE_SSL=require`.
2. Database name e.g. `vishwas`; create a dedicated user (e.g. `vishwas_app`) with a strong password.
   Grant it rights on this database only.
3. Your connection string (enter it only in Plesk, never in Git):
   `DATABASE_URL=postgresql://vishwas_app:THE_PASSWORD@localhost:5432/vishwas`
4. Do **not** open port 5432 in the firewall — the API connects locally.

## 4. Private storage for recordings

Create a folder **outside** `httpdocs`, so the web server can never serve it directly, e.g.
`/var/www/vhosts/adabhishek1.in/vishwas-data` (File Manager → create folder at the
subscription root, permissions 700). Set `STORAGE_DIR` to that path. Include it in backups.

## 5. Get the code onto the server (Git)

Plesk → Websites & Domains → **Git**:
- Repository: `https://github.com/abhishek1111090/vvishwas.git`, branch `main`.
- **Deployment path: `/vishwas-app` — not `httpdocs`** (deploying into `httpdocs` would publish the
  whole repository on the website).
- Additional deployment actions:
  ```
  cd server && npm ci --omit=dev && npm run migrate
  ```

## 6. Run the API — choose one

**A. `/api` on the main domain (matches `https://adabhishek1.in/api`) — needs SSH**
1. SSH in as the subscription user, then in `/var/www/vhosts/adabhishek1.in/vishwas-app/server`
   create `.env` from `.env.example` (`chmod 600 .env`), and keep the app running with a
   process manager, e.g. `npx pm2 start index.js --name vishwas && npx pm2 save` (plus a
   reboot hook such as a `@reboot` cron line `cd …/server && npx pm2 resurrect`).
2. Plesk → adabhishek1.in → **Apache & nginx Settings → Additional nginx directives**:
   ```nginx
   location /api/ {
       proxy_pass http://127.0.0.1:8787;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       client_max_body_size 210m;
       proxy_request_buffering off;
       proxy_read_timeout 300s;
   }
   ```
   The existing website keeps working for every other path.

**B. Plesk Node.js extension on a subdomain (no SSH needed)**
1. Add subdomain `api.adabhishek1.in` (+ Let's Encrypt certificate).
2. Plesk → api.adabhishek1.in → **Node.js**: Application root `/vishwas-app/server`,
   startup file `index.js`, application mode `production`, *NPM install*, then add every
   variable from `.env.example` under **Custom environment variables**, and *Restart App*.
3. Use `PUBLIC_URL=https://api.adabhishek1.in` and build the app with
   `EXPO_PUBLIC_VISHWAS_API_URL=https://api.adabhishek1.in` (the server accepts both `/api/...`
   and `/...` paths). If the panel shows no Node.js menu, the extension isn't installed or
   your plan doesn't allow it — ask the host, or use option A.

## 7. Environment variables

See `.env.example`. Minimum: `VISHWAS_APP_KEY`, `DATABASE_URL`, `STORAGE_DIR`, `PUBLIC_URL`,
`TRUST_PROXY=1`. Optional: `SMTP_URL` + `MAIL_FROM` (password reset emails), Twilio variables
(SMS/WhatsApp alerts).

## 8. Verify on the server

```
curl https://adabhishek1.in/api/health          → {"ok":true,"db":"ok"}
```
Then in the app (built with the production URL): create an account, trigger a test SOS,
end it, and check History shows "Backed up to your VISHWAS server".

## 9. Build the app against production

```
cd mobile
eas env:create --name EXPO_PUBLIC_VISHWAS_API_KEY --value <same as VISHWAS_APP_KEY> --environment production
eas build --profile production --platform ios
```
(`eas.json` already sets `EXPO_PUBLIC_VISHWAS_API_URL=https://adabhishek1.in/api` for preview/production.)
