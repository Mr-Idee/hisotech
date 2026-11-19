# HI-SOTECH Solar Platform

Corporate solar website, load estimator, customer portal, and operations workspace. The PHP/MySQL cPanel package is in [`php-cpanel/README_CPANEL_AND_LOCAL_SETUP.md`](php-cpanel/README_CPANEL_AND_LOCAL_SETUP.md).

## Local preview

Requires Node.js 22+.

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set preview-only values. Customer email sign-in requires `APP_URL`, `MAIL_FROM`, and `SMTP_URL`; do not commit `.env`.
3. Start the development server with `npm run dev`.

The Node/SQLite server is for local preview and binds to `127.0.0.1` by default; set `HOST` to override the bind address. For cPanel production use PHP/MySQL, keep the database credentials and setup secret in `php-cpanel/hiso_private/.env.php`, outside `public_html`, and follow the deployment guide.
