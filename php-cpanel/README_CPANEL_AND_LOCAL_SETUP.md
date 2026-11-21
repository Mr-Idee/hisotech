# HI-SOTECH Solar Platform — Local Setup & cPanel Deployment

The `php-cpanel/` package contains the production PHP/MySQL API and its web root. MySQL administration is done through phpMyAdmin; authorization is enforced by the API, not database row-level security.

## Local PHP/MySQL setup

1. Create an empty MySQL database in phpMyAdmin and import `schema.sql`.
2. From `php-cpanel/`, run `composer install --no-dev --classmap-authoritative` to install the locked mail dependency. Copy `hiso_private/config.example.php` to `hiso_private/.env.php`. Set the local database values, `APP_URL`, and a long random `SETUP_SECRET`. Keep `.env.php` outside the web root and never commit or share it.
3. Serve `public_html/` with PHP 8.2+ and visit the local site. The private directory must remain a sibling of `public_html/`.
4. Configure PHP `post_max_size` to at least `32M` and `upload_max_filesize` to at least `4M` for installation photos.

## cPanel deployment

### Updating through cPanel Git

This repository keeps the production document-root files in its root so cPanel Git can deploy the `main` branch directly. Set the repository path and domain document root to `/home/hisotech/app.hisotechsolarinverters.com/hisotech`. After **Update from Remote**, click **Deploy HEAD Commit** so `.cpanel.yml` runs and repairs the web permissions.

The deployment task sets the repository root to `0755`, the public assets/API directories to traversable/readable permissions, and the entry files to `0644`. This is required because cPanel created the repository folder as `0700`, causing LiteSpeed to show a directory listing and return 404 for the files inside it. It also synchronizes the PHP runtime files and copies the locked Composer dependencies into the private directory beside this document root. It leaves `.env.php` and private storage untouched.

For future releases, run `npm run build`; it compiles from `index.source.html` and synchronizes the production frontend into the repository root and `dist/`. Commit both source changes and the generated document-root files to `main`, push, then use **Update from Remote** followed by **Deploy HEAD Commit** in cPanel. Keep `/home/hisotech/app.hisotechsolarinverters.com/hiso_private/.env.php` outside the repository and never add credentials to Git.

1. In **cPanel → MySQL Database Wizard**, create a database and a dedicated user with only the required database privileges. Import `schema.sql` into the empty database using phpMyAdmin.
2. Create `/home/hisotech/app.hisotechsolarinverters.com/hiso_private/` beside the repository document root. Keep the private `config.php` (copied from `config.example.php` as `.env.php` and loaded by the configured bootstrap) there. The Git deployment copies the locked `vendor/` dependencies and the PHP runtime files into this private directory. In File Manager, set the database name/user/password, exact HTTPS `APP_URL`, private SMTP password, WhatsApp Cloud API phone-number ID and access token, VAPID subject/public/private key, a unique `SETUP_SECRET`, and `SESSION_SECURE => true`. Never commit or share credentials.
3. Keep the Git repository as the document root at `/home/hisotech/app.hisotechsolarinverters.com/hisotech`; the `main` branch contains the compiled root `index.html`, assets, API entrypoint, and `.htaccess`.
4. Configure PHP 8.2+ and required extensions below. Use cPanel Git's **Update from Remote** and **Deploy HEAD Commit** for subsequent releases; no ZIP extraction is required for the Git-based deployment.
5. Enable AutoSSL/HTTPS before enabling the HTTPS redirect directives in `.htaccess`.
6. Select PHP 8.2+ in cPanel and enable `pdo_mysql`, `gd`, `fileinfo`, and `mbstring`. Set `post_max_size` to at least `32M` and `upload_max_filesize` to at least `4M`.
7. Configure authenticated SMTP in the private `.env.php` using the domain mail settings: `MAIL_HOST` = `app.hisotechsolarinverters.com`, `MAIL_PORT` = `465`, `MAIL_USERNAME` and `MAIL_FROM` = `admin@app.hisotechsolarinverters.com`, `MAIL_ENCRYPTION` = `ssl`, and `MAIL_PASSWORD` = the email account password. Enter the password only in cPanel File Manager or another private server-side configuration channel; do not send it in chat or commit it. Before serving customers, test delivery of one-time sign-in links over HTTPS.
8. Configure daily database backups to a private directory outside the web root, and periodically test restoring a backup.

## Existing database migration

For databases imported from an earlier version, first create and verify a restorable phpMyAdmin backup. Then import `migrations/001-username-and-demo-cleanup.sql` once. It adds the nullable unique username and catalog grade columns and deletes only records matching the original seeded demonstration IDs and identifiers. Do not import this migration into a database already created from the current `schema.sql`; the columns are already present. The migration does not remove other customer or operational records.

The current homepage editor uses `homepage_sections`; that table is included in `schema.sql` for fresh installs and `migrations/002-homepage-sections.sql` for older databases. Import `migrations/003-communications-integrations.sql` and then `migrations/004-whatsapp-consent-lifecycle.sql` once on an existing database after taking a verified backup. Import `migrations/005-platform-settings.sql` once to enable invoice bank details and configurable estimator settings. Migration `005` is already included in `schema.sql` for fresh installs. Do not rerun migrations that have already been applied.

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
