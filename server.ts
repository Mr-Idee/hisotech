import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import Busboy from 'busboy';
import nodemailer from 'nodemailer';
import JSZip from 'jszip';
import { build as viteBuild, createServer as createViteServer } from 'vite';
import { hasPermission } from './src/lib/solar';
import {
  acceptInvoiceByCustomer,
  acknowledgeInstallation,
  assignInstallation,
  authenticateUser,
  checkAuthRateLimit,
  createPublicEnquiry,
  createCustomerLoginLink,
  createStaffEnquiry,
  createStoreOrder,
  decideQuotation,
  deleteCatalogItem,
  destroySession,
  destroyCustomerSession,
  getCustomerBySessionToken,
  getPhotoFile,
  getPublicCatalog,
  getPublicDocument,
  getPublicTracking,
  getUploadedCatalogImage,
  getUserBySessionToken,
  hydrateWorkspace,
  issueInvoice,
  markNotificationsRead,
  recordPayment,
  releaseInstallation,
  revokeCustomerLoginLink,
  saveCustomerEquipment,
  saveCustomerProfile,
  saveQuotation,
  saveRoleDefinition,
  saveStaffMember,
  submitCustomerTicket,
  verifyCustomerLoginLink,
  submitInstallationReport,
  updateServiceTicket,
  updateStoreOrderStatus,
  upsertCatalogItem,
  verifyPayment,
} from './src/server/db';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const COOKIE_NAME = 'hiso_preview_session';
const CUSTOMER_COOKIE_NAME = 'hiso_customer_session';
const UPLOAD_DIR = path.resolve(process.cwd(), '.hiso_uploads');

interface StagedReportPhoto {
  path: string;
  originalName: string;
  mimeType: string;
}

async function parseInstallationReportUpload(req: express.Request): Promise<{
  report: Record<string, unknown>;
  photos: StagedReportPhoto[];
}> {
  const photos: StagedReportPhoto[] = [];
  const tasks: Promise<void>[] = [];
  let reportData = '';
  let totalBytes = 0;
  let parseError: Error | null = null;
  let settled = false;

  const cleanup = () => {
    for (const photo of photos) {
      if (fs.existsSync(photo.path)) fs.unlinkSync(photo.path);
    }
  };

  return new Promise((resolve, reject) => {
    const fail = (error: Error) => {
      parseError = parseError || error;
    };
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { files: 8, fileSize: 4 * 1024 * 1024, fields: 1, parts: 9 },
      });
    } catch {
      reject(new Error('Invalid image upload request.'));
      return;
    }

    parser.on('field', (name, value, info) => {
      if (name !== 'report' || info.valueTruncated || value.length > 100_000 || reportData) {
        fail(new Error('Invalid field report data.'));
        return;
      }
      reportData = value;
    });

    parser.on('file', (fieldName, stream, info) => {
      if (fieldName !== 'photos[]' || info.mimeType !== 'image/jpeg') {
        fail(new Error('Only compressed JPEG site photos are accepted.'));
        stream.resume();
        return;
      }
      const tempPath = path.join(UPLOAD_DIR, `incoming-${crypto.randomUUID()}.jpg`);
      stream.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > 24 * 1024 * 1024) {
          fail(new Error('Photo upload exceeds the 24MB request limit.'));
        }
      });
      stream.on('limit', () => fail(new Error('A site photo exceeds the 4MB limit.')));
      const task = pipeline(stream, fs.createWriteStream(tempPath, { flags: 'wx' }))
        .then(() => {
          if (stream.truncated) {
            fail(new Error('A site photo exceeds the 4MB limit.'));
          } else {
            photos.push({
              path: tempPath,
              originalName: info.filename || 'site-photo.jpg',
              mimeType: info.mimeType,
            });
          }
        })
        .catch((error: Error) => {
          fail(error);
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        });
      tasks.push(task);
    });

    parser.on('filesLimit', () => fail(new Error('A field report can include at most 8 photos.')));
    parser.on('fieldsLimit', () => fail(new Error('Invalid field report data.')));
    parser.on('partsLimit', () => fail(new Error('Too many upload parts.')));
    parser.on('error', (error: Error) => fail(error));
    parser.on('close', () => {
      void Promise.all(tasks).then(() => {
        if (settled) return;
        settled = true;
        if (parseError) {
          cleanup();
          reject(parseError);
          return;
        }
        try {
          const report = JSON.parse(reportData) as Record<string, unknown>;
          if (!report || typeof report !== 'object' || Array.isArray(report)) {
            throw new Error('Invalid field report data.');
          }
          resolve({ report, photos });
        } catch {
          cleanup();
          reject(new Error('Invalid field report data.'));
        }
      });
    });
    req.pipe(parser);
  });
}

async function sendCustomerLoginLink(email: string, token: string): Promise<void> {
  const { APP_URL, MAIL_FROM, SMTP_URL } = process.env;
  if (!APP_URL || !MAIL_FROM || !SMTP_URL) {
    throw new Error('Customer email sign-in is not configured. Set APP_URL, MAIL_FROM, and SMTP_URL.');
  }
  const appUrl = new URL(APP_URL);
  if (process.env.NODE_ENV === 'production' && appUrl.protocol !== 'https:') {
    throw new Error('Customer email sign-in requires an HTTPS APP_URL in production.');
  }
  appUrl.hash = `customer?token=${encodeURIComponent(token)}`;

  const transport = nodemailer.createTransport(SMTP_URL);
  await transport.sendMail({
    from: MAIL_FROM,
    to: email,
    subject: 'Your HI-SOTECH customer sign-in link',
    text: `Use this one-time link to access your HI-SOTECH customer portal:\n\n${appUrl.toString()}\n\nThe link expires in 15 minutes and can only be used once. If you did not request it, you can ignore this message.`,
  });
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    out[k] = v;
  }
  return out;
}

const ZIP_SKIP_NAMES = new Set([
  '.aistudio',
  'aistudio',
  '.DS_Store',
  'node_modules',
  '.git',
  '.playwright-cli',
  'dev-dist',
]);

function addDirToZip(zipFolder: JSZip, fsDir: string): void {
  if (!fs.existsSync(fsDir)) return;
  const isPrivateDataDir = path.basename(fsDir) === 'hiso_private';
  for (const entry of fs.readdirSync(fsDir, { withFileTypes: true })) {
    if (ZIP_SKIP_NAMES.has(entry.name) || entry.name === '.env' || entry.name.startsWith('.env.')
      || entry.name.startsWith('.hiso_preview.sqlite')
      || (isPrivateDataDir && ['storage', 'backups'].includes(entry.name))) {
      continue;
    }
    const full = path.join(fsDir, entry.name);
    if (entry.isDirectory()) {
      const sub = zipFolder.folder(entry.name);
      if (sub) addDirToZip(sub, full);
    } else {
      zipFolder.file(entry.name, fs.readFileSync(full));
    }
  }
}

let pendingDistBuild: Promise<void> | null = null;

async function ensureBuiltDist(): Promise<string> {
  const distDir = path.resolve(process.cwd(), 'dist');
  const distIndex = path.join(distDir, 'index.html');
  if (!fs.existsSync(distIndex)) {
    if (!pendingDistBuild) {
      pendingDistBuild = viteBuild().then(() => undefined).finally(() => {
        pendingDistBuild = null;
      });
    }
    await pendingDistBuild;
  }
  return distDir;
}

async function createCpanelZip(): Promise<JSZip> {
  const zip = new JSZip();
  const phpDir = path.resolve(process.cwd(), 'php-cpanel');
  addDirToZip(zip, phpDir);

  const distDir = await ensureBuiltDist();
  const pubHtml = zip.folder('public_html');
  if (pubHtml && fs.existsSync(distDir)) {
    addDirToZip(pubHtml, distDir);
  }
  return zip;
}

async function createSourceZip(): Promise<JSZip> {
  const zip = new JSZip();
  const rootDir = process.cwd();
  await ensureBuiltDist();

  const rootFiles = [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'vite.config.ts',
    'index.html',
    'metadata.json',
    'server.ts',
    '.env.example',
    '.gitignore',
  ];
  for (const file of rootFiles) {
    const full = path.join(rootDir, file);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      zip.file(file, fs.readFileSync(full));
    }
  }

  for (const dirName of ['src', 'public', 'php-cpanel', 'dist']) {
    const fullDir = path.join(rootDir, dirName);
    if (fs.existsSync(fullDir)) {
      const folder = zip.folder(dirName);
      if (folder) addDirToZip(folder, fullDir);
    }
  }
  return zip;
}

const NOOP_VITE_CLIENT_JS = `
export function injectQuery(url) { return url; }
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
const styleSheets = new Map();
export function updateStyle(id, content) {
  let style = styleSheets.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    styleSheets.set(id, style);
  } else {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = styleSheets.get(id);
  if (style) {
    style.remove();
    styleSheets.delete(id);
  }
}
export class ErrorOverlay extends HTMLElement {}
`;

async function startServer() {
  const app = express();
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
      );
    }
    next();
  });
  app.use(express.json({ limit: '18mb' }));

  const getSessionUser = (req: express.Request) => {
    const cookies = parseCookies(req.headers.cookie);
    return {
      token: cookies[COOKIE_NAME],
      user: getUserBySessionToken(cookies[COOKIE_NAME]),
    };
  };

  // --- Public API ---
  app.get('/api/public/bootstrap', (_req, res) => {
    res.json({ catalog: getPublicCatalog() });
  });

  app.post('/api/public/enquiries', (req, res) => {
    const { customerName, phone, location } = req.body ?? {};
    if (!customerName?.trim() || !phone?.trim() || !location?.trim()) {
      res.status(422).json({ error: 'Name, phone number, and site location are required.' });
      return;
    }
    const created = createPublicEnquiry(req.body);
    res.status(201).json(created);
  });

  app.post('/api/public/orders', (req, res) => {
    const { customerName, phone, deliveryAddress, location, items } = req.body ?? {};
    if (!customerName?.trim() || !phone?.trim() || !(deliveryAddress?.trim() || location?.trim())) {
      res.status(422).json({ error: 'Customer name, phone number, and delivery address are required.' });
      return;
    }
    if (!Array.isArray(items) || items.length === 0) {
      res.status(422).json({ error: 'Cart is empty. Add at least one item before placing an order.' });
      return;
    }
    try {
      const created = createStoreOrder({
        customerName: String(customerName),
        email: String(req.body?.email || ''),
        phone: String(phone),
        location: String(location || deliveryAddress),
        deliveryAddress: String(deliveryAddress || location),
        deliveryMethod:
          req.body?.deliveryMethod === 'Abuja Warehouse Pickup'
            ? 'Abuja Warehouse Pickup'
            : 'Nationwide Delivery',
        paymentMethod:
          req.body?.paymentMethod === 'Pay on Delivery (Abuja)'
            ? 'Pay on Delivery (Abuja)'
            : 'Bank Transfer on Invoice',
        notes: String(req.body?.notes || ''),
        items,
      });
      res.status(201).json(created);
    } catch (err) {
      res.status(422).json({ error: (err as Error).message });
    }
  });

  app.get('/api/public/track', (req, res) => {
    const ref = String(req.query.ref || '');
    const result = getPublicTracking(ref);
    if (!result) {
      res.status(404).json({ error: `No enquiry or order found for reference "${ref}".` });
      return;
    }
    res.json(result);
  });

  app.post('/api/public/accept-invoice', (req, res) => {
    acceptInvoiceByCustomer(String(req.body?.invoiceId || ''));
    res.json({ accepted: true });
  });

  app.get('/api/public/documents', (req, res) => {
    const type = req.query.type === 'invoice' ? 'invoice' : 'quote';
    const id = String(req.query.id || '');
    const doc = getPublicDocument(type, id);
    if (!doc) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }
    res.json(doc);
  });

  // --- Customer Portal API ---
  app.post('/api/customer/login-link', async (req, res) => {
    if (!process.env.APP_URL || !process.env.MAIL_FROM || !process.env.SMTP_URL) {
      res.status(503).json({ error: 'Customer email sign-in is not configured yet.' });
      return;
    }
    try {
      const request = createCustomerLoginLink(req.body ?? {}, req.ip || req.socket.remoteAddress || 'unknown');
      if (request.token && request.email) {
        try {
          await sendCustomerLoginLink(request.email, request.token);
        } catch {
          revokeCustomerLoginLink(request.token);
          res.status(503).json({ error: 'The sign-in email could not be sent. Please try again later.' });
          return;
        }
      }
      res.status(202).json({
        ok: true,
        message: 'If this email can access the customer portal, a one-time sign-in link will arrive shortly.',
      });
    } catch (err) {
      const message = (err as Error).message;
      res.status(message.startsWith('Too many') ? 429 : 422).json({ error: message });
    }
  });

  app.post('/api/customer/verify', (req, res) => {
    try {
      const verified = verifyCustomerLoginLink(String(req.body?.token || ''));
      res.cookie(CUSTOMER_COOKIE_NAME, verified.sessionToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 86400 * 1000,
      });
      const { sessionToken: _sessionToken, ...portal } = verified;
      res.json(portal);
    } catch (err) {
      res.status(422).json({ error: (err as Error).message });
    }
  });

  app.get('/api/customer/session', (req, res) => {
    const token = parseCookies(req.headers.cookie)[CUSTOMER_COOKIE_NAME];
    const session = getCustomerBySessionToken(token);
    res.json(session
      ? { authenticated: true, ...session }
      : { authenticated: false, profile: null, equipment: [], tickets: [] });
  });

  app.post('/api/customer/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie)[CUSTOMER_COOKIE_NAME];
    destroyCustomerSession(token);
    res.clearCookie(CUSTOMER_COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    res.json({ ok: true });
  });

  app.post('/api/customer/profile', (req, res) => {
    const token = parseCookies(req.headers.cookie)[CUSTOMER_COOKIE_NAME];
    const session = getCustomerBySessionToken(token);
    if (!session) {
      res.status(401).json({ error: 'Verified customer sign-in required.' });
      return;
    }
    try {
      const body = req.body ?? {};
      if (!String(body.name || '').trim() || String(body.name).length > 120 ||
          String(body.phone || '').length > 40 || String(body.location || '').length > 190 ||
          String(body.company || '').length > 150 || String(body.refCode || '').length > 32) {
        res.status(422).json({ error: 'Customer profile details are invalid or too long.' });
        return;
      }
      res.json({ profile: saveCustomerProfile({ ...body, customerId: session.profile.id }) });
    } catch (err) {
      res.status(422).json({ error: (err as Error).message });
    }
  });

  app.post('/api/customer/equipment', (req, res) => {
    const token = parseCookies(req.headers.cookie)[CUSTOMER_COOKIE_NAME];
    const session = getCustomerBySessionToken(token);
    if (!session) {
      res.status(401).json({ error: 'Verified customer sign-in required.' });
      return;
    }
    try {
      const body = req.body ?? {};
      if (!String(body.equipmentType || '').trim() || !String(body.brandModel || '').trim() ||
          String(body.equipmentType).length > 120 || String(body.brandModel).length > 180 ||
          String(body.serialNumber || '').length > 120 || String(body.capacityKw || '').length > 40 ||
          String(body.notes || '').length > 2000) {
        res.status(422).json({ error: 'Equipment details are invalid or too long.' });
        return;
      }
      res.json({ equipment: saveCustomerEquipment(session.profile.id, body) });
    } catch (err) {
      res.status(422).json({ error: (err as Error).message });
    }
  });

  app.post('/api/customer/tickets', (req, res) => {
    const token = parseCookies(req.headers.cookie)[CUSTOMER_COOKIE_NAME];
    const session = getCustomerBySessionToken(token);
    if (!session) {
      res.status(401).json({ error: 'Verified customer sign-in required.' });
      return;
    }
    const { subject, description, category, priority } = req.body ?? {};
    if (!subject?.trim() || !description?.trim() || subject.length > 160 || description.length > 3000 ||
        !['Service Request', 'Complaint', 'Warranty Claim', 'Preventive Maintenance'].includes(category) ||
        !['Normal', 'Urgent'].includes(priority)) {
      res.status(422).json({ error: 'Subject and description are required.' });
      return;
    }
    try {
      res.status(201).json(submitCustomerTicket(session.profile.id, req.body));
    } catch (err) {
      res.status(422).json({ error: (err as Error).message });
    }
  });

  // --- Staff Auth API ---
  app.post('/api/auth/login', (req, res) => {
    const { identifier, password } = req.body ?? {};
    const normalizedIdentifier = String(identifier || '').trim().toLowerCase();
    if (normalizedIdentifier.length > 190 || String(password || '').length > 128) {
      res.status(422).json({ error: 'Invalid email or password.' });
      return;
    }
    const address = req.ip || req.socket.remoteAddress || 'unknown';
    const allowed = checkAuthRateLimit(`staff-ip:${address}`, 10, 15 * 60)
      && checkAuthRateLimit(`staff-identifier:${normalizedIdentifier}`, 5, 15 * 60);
    if (!allowed) {
      res.status(429).json({ error: 'Too many sign-in attempts. Please try again later.' });
      return;
    }
    const auth = authenticateUser(normalizedIdentifier, String(password || ''));
    if (!auth) {
      res.status(401).json({ error: 'Invalid staff email or password.' });
      return;
    }
    res.cookie(COOKIE_NAME, auth.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 86400 * 1000,
    });
    res.json({ user: auth.user });
  });

  app.post('/api/auth/logout', (req, res) => {
    const { token } = getSessionUser(req);
    destroySession(token);
    res.clearCookie(COOKIE_NAME);
    res.json({ ok: true });
  });

  app.get('/api/auth/session', (req, res) => {
    const { user } = getSessionUser(req);
    res.json({ authenticated: Boolean(user), user: user ?? null });
  });

  app.get('/api/auth/me', (req, res) => {
    const { user } = getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    res.json({ user });
  });

  // --- Protected Workspace API (Permission-Based RBAC) ---
  app.get('/api/workspace/bootstrap', (req, res) => {
    const { user } = getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    res.json(hydrateWorkspace(user));
  });

  app.post('/api/enquiries', (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'manage_enquiries')) {
      res.status(403).json({ error: 'Enquiry management permission required.' });
      return;
    }
    res.status(201).json(createStaffEnquiry(user!, req.body));
  });

  app.post('/api/catalog', (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'manage_storefront')) {
      res.status(403).json({ error: 'Store pricing permission required.' });
      return;
    }
    try {
      const result = upsertCatalogItem(user!, req.body);
      res.json({ ok: true, imagePath: result.imagePath });
    } catch (err) {
      res.status(422).json({ error: (err as Error).message });
    }
  });

  app.post('/api/catalog/delete', (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'manage_storefront')) {
      res.status(403).json({ error: 'Store permission required.' });
      return;
    }
    deleteCatalogItem(user!, String(req.body?.sku || ''));
    res.json({ ok: true });
  });

  app.post('/api/quotes', (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'draft_quotes')) {
      res.status(403).json({ error: 'Quotation drafting permission required.' });
      return;
    }
    try {
      res.json(saveQuotation(user!, req.body));
    } catch (err) {
      res.status(422).json({ error: (err as Error).message });
    }
  });

  app.post('/api/quotes/approve', (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'approve_quotes')) {
      res.status(403).json({ error: 'Director or Super Admin approval permission required.' });
      return;
    }
    try {
      res.json(decideQuotation(user!, req.body.quoteId, req.body.decision));
    } catch (err) {
      res.status(422).json({ error: (err as Error).message });
    }
  });

  app.post('/api/invoices', (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'manage_invoices')) {
      res.status(403).json({ error: 'Invoice management permission required.' });
      return;
    }
    try {
      res.status(201).json(issueInvoice(user!, req.body.quotationId));
    } catch (err) {
      res.status(422).json({ error: (err as Error).message });
    }
  });

  app.post('/api/payments', (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'manage_invoices')) {
      res.status(403).json({ error: 'Payment logging permission required.' });
      return;
    }
    res.status(201).json(recordPayment(user!, req.body));
  });

  app.post('/api/payments/verify', (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'verify_payments')) {
      res.status(403).json({ error: 'Director or Super Admin payment verification permission required.' });
      return;
    }
    try {
      res.json(verifyPayment(user!, req.body.paymentId, req.body.decision, req.body.reason));
    } catch (err) {
      res.status(422).json({ error: (err as Error).message });
    }
  });

  app.post('/api/installations/release', (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'release_installations')) {
      res.status(403).json({ error: 'Director or Super Admin release permission required.' });
      return;
    }
    try {
      res.status(201).json(releaseInstallation(user!, req.body));
    } catch (err) {
      res.status(422).json({ error: (err as Error).message });
    }
  });

  app.post('/api/installations/assign', (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'manage_enquiries') && !hasPermission(user, 'release_installations')) {
      res.status(403).json({ error: 'Dispatch assignment permission required.' });
      return;
    }
    assignInstallation(user!, req.body.installationId, req.body.engineerId);
    res.json({ ok: true });
  });

  app.post('/api/installations/ack', (req, res) => {
    const { user } = getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    acknowledgeInstallation(user, req.body.installationId);
    res.json({ ok: true });
  });

  app.post('/api/installations/report', async (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'update_installations')) {
      res.status(403).json({ error: 'Field report permission required.' });
      return;
    }
    let upload: Awaited<ReturnType<typeof parseInstallationReportUpload>> | undefined;
    try {
      upload = await parseInstallationReportUpload(req);
      const report = upload.report;
      if (typeof report.installationId !== 'string' || typeof report.activityTitle !== 'string' ||
          typeof report.reportText !== 'string' || typeof report.isCustomerVisible !== 'boolean' ||
          typeof report.advanceStage !== 'boolean' || typeof report.stageNumber !== 'number' ||
          !Number.isInteger(report.stageNumber)) {
        throw new Error('Field report details are invalid.');
      }
      const reportBody = {
        installationId: report.installationId,
        stageNumber: report.stageNumber,
        activityTitle: report.activityTitle,
        reportText: report.reportText,
        isCustomerVisible: report.isCustomerVisible,
        advanceStage: report.advanceStage,
      };
      res.status(201).json(submitInstallationReport(user!, reportBody, upload.photos));
    } catch (err) {
      if (upload) {
        for (const photo of upload.photos) {
          if (fs.existsSync(photo.path)) fs.unlinkSync(photo.path);
        }
      }
      const message = (err as Error).message;
      res.status(message.startsWith('You can only') ? 403 : 422).json({ error: message });
    }
  });

  app.post('/api/tickets/update', (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'manage_tickets')) {
      res.status(403).json({ error: 'Help Desk / Service ticket permission required.' });
      return;
    }
    try {
      updateServiceTicket(user!, req.body);
      res.json({ ok: true });
    } catch (err) {
      res.status(422).json({ error: (err as Error).message });
    }
  });

  app.post('/api/orders/update', (req, res) => {
    const { user } = getSessionUser(req);
    if (
      !hasPermission(user, 'manage_storefront') &&
      !hasPermission(user, 'manage_enquiries') &&
      !hasPermission(user, 'manage_invoices')
    ) {
      res.status(403).json({ error: 'Order management permission required.' });
      return;
    }
    try {
      updateStoreOrderStatus(user!, req.body);
      res.json({ ok: true });
    } catch (err) {
      res.status(422).json({ error: (err as Error).message });
    }
  });

  app.post('/api/roles', (req, res) => {
    const { user } = getSessionUser(req);
    if (user?.role !== 'superadmin' || !hasPermission(user, 'manage_roles')) {
      res.status(403).json({ error: 'Only Super Admin can create or edit roles.' });
      return;
    }
    try {
      res.status(201).json(saveRoleDefinition(user!, req.body));
    } catch (err) {
      res.status(422).json({ error: (err as Error).message });
    }
  });

  app.post('/api/staff', (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'manage_staff')) {
      res.status(403).json({ error: 'Staff management permission required.' });
      return;
    }
    if (!req.body?.id && user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Only Super Admin can create staff accounts.' });
      return;
    }
    try {
      res.json(saveStaffMember(user!, req.body));
    } catch (err) {
      res.status(422).json({ error: (err as Error).message });
    }
  });

  app.post('/api/notifications/read', (req, res) => {
    const { user } = getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    markNotificationsRead(user.id);
    res.json({ ok: true });
  });

  app.get('/api/files/:photoId', (req, res) => {
    const { user } = getSessionUser(req);
    const file = getPhotoFile(req.params.photoId, Boolean(user));
    if (!file) {
      res.status(404).send('Not found');
      return;
    }
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(file.filePath);
  });

  app.get('/api/catalog-image/:filename', (req, res) => {
    const file = getUploadedCatalogImage(req.params.filename);
    if (!file) {
      res.status(404).send('Not found');
      return;
    }
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(file.filePath);
  });

  // --- Downloadable PHP + MySQL cPanel Package & Full Source Code (.zip) ---
  app.get('/api/package-manifest', async (_req, res) => {
    const [cpanelZip, sourceZip] = await Promise.all([createCpanelZip(), createSourceZip()]);
    const cpanelFiles = Object.values(cpanelZip.files)
      .filter((f) => !f.dir)
      .map((f) => f.name)
      .sort();
    const sourceFiles = Object.values(sourceZip.files)
      .filter((f) => !f.dir)
      .map((f) => f.name)
      .sort();
    res.json({
      cpanelCount: cpanelFiles.length,
      sourceCount: sourceFiles.length,
      cpanelFiles,
      sourceFiles,
    });
  });

  app.get('/api/cpanel-package.zip', async (_req, res) => {
    const zip = await createCpanelZip();
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="hisotech-php-mysql-cpanel.zip"');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  });

  app.get('/api/source-package.zip', async (_req, res) => {
    const zip = await createSourceZip();
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="hisotech-full-source-code.zip"');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  });

  app.use('/api', (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({
      error: process.env.NODE_ENV === 'production' ? 'Internal server error.' : message,
    });
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const hmrDisabled = process.env.DISABLE_HMR === 'true' || Boolean(process.env.CONTROL_PLANE_PORT);
    if (hmrDisabled) {
      app.get('/@vite/client', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send(NOOP_VITE_CLIENT_JS);
      });
    }
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server: httpServer },
        ws: hmrDisabled ? false : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, HOST, () => {
    console.log(`HI-SOTECH platform server listening on http://localhost:${PORT}`);
  });
}

startServer();
