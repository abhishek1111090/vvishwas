# VISHWAS PHP API on Plesk (AdAbhishek1.in)

Your plan has PHP 8.4 and PostgreSQL but no Node.js and no SSH, so the API runs
as PHP. Same endpoints as the Node server; the app doesn't change.

```
/var/www/vhosts/adabhishek1.in/
├── httpdocs/api/index.php, .htaccess   ← the ONLY public files (copied from server-php/public/api)
├── vishwas-app/                        ← Git deployment of the repository (NOT public)
│   └── server-php/src/…                   application code
└── vishwas-private/                    ← NOT public
    ├── config.php                         database password, keys
    └── recordings/                        uploaded audio / video / photos
```

## 1. Back up
Websites & Domains → AdAbhishek1.in → **Backup & Restore** → Back Up (files + databases).

## 2. Code via Git (outside httpdocs)
1. Dashboard → **Git** → the repository's settings (gear/“Repository settings”).
2. **Deployment path:** change `httpdocs` to a new folder **`vishwas-app`** (at the subscription root,
   not inside httpdocs — otherwise the whole project would be published on the website).
3. Deployment mode: Manual is fine. Click **Pull Updates**, then **Deploy now**.
4. Files → check `vishwas-app/server-php/src/main.php` exists.

## 3. Private settings
1. **Files** → go up to the subscription root (the folder that contains `httpdocs`).
2. Create folder **`vishwas-private`**.
3. Copy `vishwas-app/server-php/config.example.php` into `vishwas-private/`, rename it **`config.php`**,
   open it in the File Manager editor and fill in:
   - `app_key`: a long random string (same value goes into the app build as `EXPO_PUBLIC_VISHWAS_API_KEY`)
   - `database.dsn`: `pgsql:host=localhost;port=5432;dbname=<exact name from Databases → Connection info>`
   - `database.user`: `vvishwas` · `database.password`: that user's password
   - leave the folders as they are; `public_url` = `https://adabhishek1.in/api`
   - optional: `mail_enabled => true` for password-reset emails; Twilio keys for SMS/WhatsApp
4. Never put this file inside httpdocs and never commit it to GitHub.

## 4. Public entry point
1. Files → `httpdocs` → create folder **`api`**.
2. Copy `vishwas-app/server-php/public/api/index.php` and `.htaccess` into `httpdocs/api/`.

## 5. PHP settings
Websites & Domains → AdAbhishek1.in → **PHP** (or Hosting & DNS → PHP Settings):
- PHP version **8.4**
- `post_max_size` = **256M**, `upload_max_filesize` = **256M**,
  `max_execution_time` = **300**, `memory_limit` = **256M**
- The PHP build must include **pdo_pgsql** and **curl** (standard on Plesk; if the health
  check below reports a database error, ask your host to enable `pdo_pgsql`).

## 6. Web server
**Apache & nginx Settings**:
- Keep **Proxy mode** on (nginx → Apache), so `httpdocs/api/.htaccess` is used.
- In **Additional nginx directives** add: `client_max_body_size 210m;`
- If your host serves PHP by nginx only (no Apache), add instead:
  ```nginx
  client_max_body_size 210m;
  location /api/ { try_files $uri /api/index.php$is_args$args; }
  ```

## 7. Check it — works before the domain is registered
Open in a browser:
`http://adabhishek1.in.94-136-187-4.plesk.page/api/health`

| You see | Meaning |
|---|---|
| `{"ok":true,"db":"ok",...}` | Deployed, connected to PostgreSQL, tables created. |
| `{"ok":true,"db":"unavailable"}` | Wrong database name/user/password in config.php, or `pdo_pgsql` missing. |
| `{"code":"NOT_CONFIGURED"…}` | `vishwas-private/config.php` not found at the subscription root. |
| 404 / Plesk page | `httpdocs/api/` files missing, or the .htaccess isn't applied (step 6). |
| HTTP 500 | Plesk → Logs: the error line starts with `[vishwas]`. |

(The app itself only connects over HTTPS, so it needs step 8.)

## 8. Domain + HTTPS (needed by the app)
1. Register `adabhishek1.in` at a domain registrar (it is currently unregistered) and point it to
   `94.136.187.4` (A records for `adabhishek1.in` and `www`).
2. When Plesk no longer shows “Domain is not resolvable”: **SSL/TLS Certificates** → Let's Encrypt
   (domain + www) → turn on the HTTP→HTTPS redirect.
3. `https://adabhishek1.in/api/health` should then return `{"ok":true,"db":"ok",...}`.

## 9. Build the app against it
```
cd mobile
eas env:create --name EXPO_PUBLIC_VISHWAS_API_KEY --value <app_key from config.php> --environment production
eas build --profile production --platform ios
```
`eas.json` already uses `https://adabhishek1.in/api` for preview/production builds.

## Updating later
Git → Pull Updates → Deploy now. `httpdocs/api` only needs re-copying if `public/api` changes.
Database changes are applied automatically (additive migrations, never destructive).
