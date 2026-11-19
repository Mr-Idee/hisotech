# HI-SOTECH Solar Platform — Local Setup & cPanel Deployment

The `php-cpanel/` package contains the production PHP/MySQL API and its web root. MySQL administration is done through phpMyAdmin; authorization is enforced by the API, not database row-level security.

## Local PHP/MySQL setup

1. Create an empty MySQL database in phpMyAdmin and import `schema.sql`.
2. Copy `hiso_private/config.example.php` to `hiso_private/.env.php`. Set the local database values, `APP_URL`, and a long random `SETUP_SECRET`. Keep `.env.php` outside the web root and never commit or share it.
3. Serve `public_html/` with PHP 8.2+ and visit the local site. The private directory must remain a sibling of `public_html/`.
4. Configure PHP `post_max_size` to at least `32M` and `upload_max_filesize` to at least `4M` for installation photos.

## cPanel deployment

1. In **cPanel → MySQL Database Wizard**, create a database and a dedicated user with only the required database privileges. Import `schema.sql` into the empty database using phpMyAdmin.
2. Keep the Git checkout separate from the live document root. Create `/home/<cpanel_user>/hiso_private/.env.php` from `config.example.php`; set the database name/user/password, the exact HTTPS `APP_URL`, a unique `SETUP_SECRET`, `SESSION_SECURE => true`, and `ALLOW_DEMO_LOGIN => false`. Do not put credentials in the web root or source control.
3. Create a separate deployment directory such as `/home/<cpanel_user>/site/`, upload the generated cPanel document-root ZIP there, and extract it. The ZIP should place `index.html`, `.htaccess`, frontend assets, and `api/index.php` directly in that directory. Alternatively, build with `npm run build`, copy the contents of `dist/` there, then copy `php-cpanel/public_html/.htaccess` and `php-cpanel/public_html/api/index.php` to the corresponding deployment paths.
4. In **cPanel → Domains**, set the domain's Document Root to the deployment directory (for example `/home/<cpanel_user>/site/`). Keep `hiso_private/` as a sibling of that directory. This lets the API resolve the private config outside the web root and avoids overwriting the Git checkout.
5. Enable AutoSSL/HTTPS before enabling the HTTPS redirect directives in `.htaccess`.
6. Select PHP 8.2+ in cPanel and enable `pdo_mysql`, `gd`, `fileinfo`, and `mbstring`. Set `post_max_size` to at least `32M` and `upload_max_filesize` to at least `4M`.
7. Before serving customers, configure PHP mail delivery and test that the configured sender can deliver one-time sign-in links to verified customer email addresses. If the host's `mail()` delivery is unreliable, configure a supported mail transport before launch.
8. Configure daily database backups to a private directory outside the web root, and periodically test restoring a backup.

## Initial administrator

The schema does not create staff accounts. After deploying over HTTPS and setting `SETUP_SECRET`, make a one-time `POST /api/setup/first-admin` request with JSON fields `setupSecret`, `name`, `email`, `phone`, and a unique password of at least 14 characters. The endpoint creates the first superadmin only when the users table is empty, then signs in that administrator. Use a secure password manager and do not put the setup secret or password in browser code, source control, or support logs.

After setup, clear or rotate `SETUP_SECRET` in the private configuration. The setup endpoint also rejects later attempts once an account exists. Create additional staff accounts from the protected workspace, and assign only the permissions they need.

The schema includes clearly labeled demonstration records and catalog values; replace or remove them and verify all prices, inventory, customer records, payment statuses, and invoice settings before using the database operationally. Sample invoices contain an invalid demo account number and must never be used for payment.

## Customer email sign-in

Set `APP_URL` to the exact public HTTPS origin and configure a valid `MAIL_FROM` address in the private configuration. PHP uses the host's configured `mail()` transport. Customer sign-in links are short-lived and single-use; do not enable customer access until email delivery is verified.

## Image storage and access

Customer/site photos are validated and normalized by the API, stored under `hiso_private/storage/`, and served through authenticated routes. Keep this directory outside `public_html`; do not expose it through a static web server or CDN. The browser compresses field photos before upload, and the API enforces per-file and total request limits.
