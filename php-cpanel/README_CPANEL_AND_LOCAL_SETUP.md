# HI-SOTECH Solar Platform — Local Setup & cPanel Deployment

The `php-cpanel/` package contains the production PHP/MySQL API and its web root. MySQL administration is done through phpMyAdmin; authorization is enforced by the API, not database row-level security.

## Local PHP/MySQL setup

1. Create an empty MySQL database in phpMyAdmin and import `schema.sql`.
2. From `php-cpanel/`, run `composer install --no-dev --classmap-authoritative` to install the locked mail dependency. Copy `hiso_private/config.example.php` to `hiso_private/.env.php`. Set the local database values, `APP_URL`, and a long random `SETUP_SECRET`. Keep `.env.php` outside the web root and never commit or share it.
3. Serve `public_html/` with PHP 8.2+ and visit the local site. The private directory must remain a sibling of `public_html/`.
4. Configure PHP `post_max_size` to at least `32M` and `upload_max_filesize` to at least `4M` for installation photos.

## cPanel deployment

### Updating through cPanel Git

This repository includes `.cpanel.yml` for cPanel's Git deployment hook. In cPanel **Git™ Version Control**, connect the repository and set the deployment directory to the domain's public document root. Enable **Deploy Head Commit** or the cPanel repository Update action. A successful deployment copies `dist/` to the document root, replaces `api/index.php`, and installs `.htaccess`.

Before deployment, configure the private sibling directory `/home/<cpanel_user>/hiso_private/` and its `.env.php`. Never configure that private directory in Git or add credentials to this repository. After pushing source changes, run the production build locally or in CI so `dist/` is current, commit `dist/`, and update the repository in cPanel.

The cPanel deployment directory for this domain is the repository folder itself: `/home/hisotech/app.hisotechsolarinverters.com/hisotech`. Set cPanel's Git deployment path to this exact folder, or leave repository deployment enabled and use the included absolute-copy tasks. cPanel should list the deployment task output when the update is run. If cPanel says that deployment succeeded but the browser still serves old assets, verify that the repository is tracking `origin/main`, not a stale branch, and clear the PWA service worker/cache before retrying the deployment.

1. In **cPanel → MySQL Database Wizard**, create a database and a dedicated user with only the required database privileges. Import `schema.sql` into the empty database using phpMyAdmin.
2. From `php-cpanel/`, run `composer install --no-dev --classmap-authoritative`; Composer places `vendor/` inside `hiso_private/`. Create `/home/<cpanel_user>/hiso_private/` as a sibling of the document root. Copy all runtime files from `php-cpanel/hiso_private/` into it (including the generated `vendor/` directory, or extract an updated private runtime ZIP), then copy `config.example.php` to `.env.php`. In File Manager, enable viewing hidden files so `.env.php` is visible. Set the database name/user/password, exact HTTPS `APP_URL`, private SMTP password, WhatsApp Cloud API phone-number ID and access token, VAPID subject/public/private key, a unique `SETUP_SECRET`, and `SESSION_SECURE => true`. Keep this directory and `.env.php` outside the Git checkout and web root; never commit or share credentials.
3. Recommended: create a separate deployment directory such as `/home/<cpanel_user>/site/`, upload the generated cPanel document-root ZIP there, and extract it. In **cPanel → Domains**, set the domain's Document Root to this directory. Keep `hiso_private/` as its sibling.
4. If the Git checkout must remain the document root, extract the deployment ZIP directly into that directory. It will replace the source `index.html` with the compiled site and add the API and security `.htaccess`; the rules deny web access to Git metadata and source/configuration paths. A later Git deployment may replace the compiled `index.html`, so rebuild and re-extract after source deployments.
5. The deployment ZIP places the frontend `index.html`, `.htaccess`, assets, and `api/index.php` directly at the document root. Alternatively, build with `npm run build`, copy the contents of `dist/` there, then copy `php-cpanel/public_html/.htaccess` and `php-cpanel/public_html/api/index.php` to the corresponding deployment paths.
6. Enable AutoSSL/HTTPS before enabling the HTTPS redirect directives in `.htaccess`.
7. Select PHP 8.2+ in cPanel and enable `pdo_mysql`, `gd`, `fileinfo`, and `mbstring`. Set `post_max_size` to at least `32M` and `upload_max_filesize` to at least `4M`.
8. Configure authenticated SMTP in the private `.env.php` using the domain mail settings: `MAIL_HOST` = `app.hisotechsolarinverters.com`, `MAIL_PORT` = `465`, `MAIL_USERNAME` and `MAIL_FROM` = `admin@app.hisotechsolarinverters.com`, `MAIL_ENCRYPTION` = `ssl`, and `MAIL_PASSWORD` = the email account password. Enter the password only in cPanel File Manager or another private server-side configuration channel; do not send it in chat or commit it. Before serving customers, test delivery of one-time sign-in links over HTTPS.
9. Configure daily database backups to a private directory outside the web root, and periodically test restoring a backup.

## Existing database migration

For databases imported from an earlier version, first create and verify a restorable phpMyAdmin backup. Then import `migrations/001-username-and-demo-cleanup.sql` once. It adds the nullable unique username and catalog grade columns and deletes only records matching the original seeded demonstration IDs and identifiers. Do not import this migration into a database already created from the current `schema.sql`; the columns are already present. The migration does not remove other customer or operational records.

The current homepage editor uses `homepage_sections`; that table is included in `schema.sql` for fresh installs and `migrations/002-homepage-sections.sql` for older databases. Import `migrations/003-communications-integrations.sql` and then `migrations/004-whatsapp-consent-lifecycle.sql` once on an existing database after taking a verified backup. Do not rerun migration `001` or `002` if already applied.

## Communications integrations

The customer portal has separate, unchecked WhatsApp service-update and marketing consent choices. Public enquiries also have separate optional checkboxes for service updates and marketing; staff members must opt themselves in from the communications workspace. Number changes revoke existing consent. Newsletter and one-to-one WhatsApp recipients are resolved server-side from current consent and phone records. Staff communications actions require `manage_communications`.

For WhatsApp, privately set `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, and `WHATSAPP_API_VERSION` from your Meta WhatsApp Cloud API app. Set `WHATSAPP_TEMPLATES_JSON` in the private PHP config or Node `.env` only after Meta approves the templates; use the keys `manual`, `newsletter`, `new_enquiry`, `quote_status`, `invoice_status`, `ticket_status`, and `installation_status`, each with `name` and `language` (plus `headerFormat: "IMAGE"` or `"DOCUMENT"` for media templates). Each template must contain exactly one body text parameter (`{{1}}`), populated from the message composer. Until credentials and the requested approved template are configured, sends fail explicitly without making a Graph API request. WhatsApp media accepts one signature-validated JPEG/PNG/PDF file up to 2MB and requires the approved template's matching media header. No provider calls are made in tests.

For Web Push, generate a VAPID key pair in a trusted local environment with `npx web-push generate-vapid-keys`. Keep the private key secret. Set `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, and `VAPID_PRIVATE_KEY` only in the private server config (`.env.php` for PHP/MySQL, `.env` for the Node/SQLite preview). The public key is served to the browser solely to create a subscription; the private key is never returned. PHP requires the cURL and OpenSSL extensions. Delivery is not attempted until VAPID settings and customer/staff subscriptions exist.

## Initial administrator

The schema does not create staff accounts. After deploying over HTTPS and setting `SETUP_SECRET` in the private configuration, open `https://<your-domain>/#workspace?setup=superuser` or select **Create the first Super Admin account** on the staff sign-in screen. The setup page is enabled only while the users table is empty and the private secret is configured. Enter that secret directly into the form; it is never included in the frontend bundle or status response. The form creates the first superadmin and signs in that administrator. Sign in later with the username or email. Use a secure password manager and do not put the setup secret or password in browser code, source control, or support logs.

After setup, clear or rotate `SETUP_SECRET` in the private configuration. The setup endpoint also rejects later attempts once an account exists. Create additional staff accounts from the protected workspace, and assign only the permissions they need.

New schema imports no longer create demonstration customers, enquiries, quotations, invoices, tracking records, or catalog products. Add and verify products, grades, prices, stock quantities, tax rates, and payment instructions in the protected workspace before accepting customer orders.

## Customer email sign-in

Set `APP_URL` to the exact public HTTPS origin and configure the authenticated SMTP settings in the private configuration. Customer sign-in links are short-lived and single-use; do not enable customer access until email delivery is verified.

## Image storage and access

Customer/site photos are validated and normalized by the API, stored under `hiso_private/storage/`, and served through authenticated routes. Keep this directory outside `public_html`; do not expose it through a static web server or CDN. The browser compresses field photos before upload, and the API enforces per-file and total request limits.
