import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import Busboy from 'busboy';
import nodemailer from 'nodemailer';
import webpush from 'web-push';
import { createServer as createViteServer } from 'vite';
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
  getPublicEstimatorSettings,
  getPublicDocument,
  getPublicTracking,
  getUploadedCatalogImage,
  getUserBySessionToken,
  hydrateWorkspace,
  issueInvoice,
  markNotificationsRead,
  createNotification,
  deletePushSubscription,
  getStaffWhatsAppConsents,
  getWhatsAppConsentContact,
  getLifecycleNotificationTargets,
  getPaymentInvoiceId,
  getActiveStaffIds,
  getPushSubscriptions,
  getPushSubscribedCustomers,
  getVerifiedCustomerIds,
  listMarketingContacts,
  listWhatsAppConsentContacts,
  logCommunicationDelivery,
  recordPayment,
  releaseInstallation,
  revokeCustomerLoginLink,
  saveCustomerEquipment,
  saveCustomerProfile,
  saveQuotation,
  saveRoleDefinition,
  saveStaffMember,
  savePlatformSettings,
  submitCustomerTicket,
  verifyCustomerLoginLink,
  submitInstallationReport,
  updateServiceTicket,
  updateCustomerConsents,
  updateCustomerWhatsAppUpdates,
  updateStaffWhatsAppConsents,
  updateStoreOrderStatus,
  upsertPushSubscription,
  writeAudit,
  upsertCatalogItem,
  verifyPayment,
} from './src/server/db';
import {
  isValidE164,
  validateMessage,
  validateNewsletterAttachment,
  validateWhatsAppAttachment,
} from './src/lib/communications';
import type { NewsletterAttachment } from './src/lib/communications';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const COOKIE_NAME = 'hiso_preview_session';
const CUSTOMER_COOKIE_NAME = 'hiso_customer_session';
const UPLOAD_DIR = path.resolve(process.cwd(), '.hiso_uploads');

type WhatsAppTemplateConfig = {
  name: string;
  language: string;
  headerFormat?: 'IMAGE' | 'DOCUMENT';
};

class WhatsAppConfigurationError extends Error {}

function allowCommunicationsAction(userId: string, action: string, limit: number): boolean {
  return checkAuthRateLimit(`communications:${userId}:${action}`, limit, 60 * 60);
}

function getWhatsAppConfiguration(templateKey: string, mediaMime?: string): {
  phoneNumberId: string;
  accessToken: string;
  version: string;
  template: WhatsAppTemplateConfig;
} {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
  const version = process.env.WHATSAPP_API_VERSION || 'v21.0';
  let templates: Record<string, unknown> = {};
  try {
    templates = JSON.parse(process.env.WHATSAPP_TEMPLATES_JSON || '{}');
  } catch {
    throw new WhatsAppConfigurationError('Private WhatsApp template configuration is invalid.');
  }
  const rawTemplate = templates[templateKey];
  if (!phoneNumberId || !accessToken || !/^v\d{2}\.\d+$/.test(version) || !rawTemplate || typeof rawTemplate !== 'object') {
    throw new WhatsAppConfigurationError(`WhatsApp provider credentials and approved "${templateKey}" template are not configured on the private server.`);
  }
  const template = rawTemplate as Record<string, unknown>;
  const name = typeof template.name === 'string' ? template.name.trim() : '';
  const language = typeof template.language === 'string' ? template.language.trim() : '';
  const headerFormat = template.headerFormat;
  if (!/^[a-z0-9_]{1,512}$/.test(name) || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)
      || (headerFormat !== undefined && headerFormat !== 'IMAGE' && headerFormat !== 'DOCUMENT')) {
    throw new WhatsAppConfigurationError(`Private "${templateKey}" WhatsApp template configuration is invalid.`);
  }
  if (mediaMime && headerFormat !== (mediaMime === 'application/pdf' ? 'DOCUMENT' : 'IMAGE')) {
    throw new WhatsAppConfigurationError(`The approved "${templateKey}" template header must match the selected image or PDF attachment.`);
  }
  if (!mediaMime && headerFormat) {
    throw new WhatsAppConfigurationError(`The approved "${templateKey}" template requires a matching image or PDF attachment.`);
  }
  return { phoneNumberId, accessToken, version, template: { name, language, headerFormat: headerFormat as WhatsAppTemplateConfig['headerFormat'] } };
}

async function uploadWhatsAppMedia(
  config: ReturnType<typeof getWhatsAppConfiguration>,
  attachment: { name: string; mimeType: string; data: string },
): Promise<string> {
  const bytes = Buffer.from(attachment.data, 'base64');
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', attachment.mimeType);
  form.append('file', new Blob([bytes], { type: attachment.mimeType }), attachment.name);
  const response = await fetch(`https://graph.facebook.com/${config.version}/${encodeURIComponent(config.phoneNumberId)}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.accessToken}` },
    body: form,
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`WhatsApp media upload failed (HTTP ${response.status}).`);
  const result = await response.json() as { id?: unknown };
  if (typeof result.id !== 'string' || !result.id) throw new Error('WhatsApp media upload returned no media identifier.');
  return result.id;
}

async function sendWhatsAppTemplate(
  config: ReturnType<typeof getWhatsAppConfiguration>,
  phone: string,
  message: string,
  media?: { id: string; mimeType: string },
): Promise<void> {
  const components: Record<string, unknown>[] = [
    { type: 'body', parameters: [{ type: 'text', text: message }] },
  ];
  if (media) {
    const format = media.mimeType === 'application/pdf' ? 'document' : 'image';
    components.unshift({ type: 'header', parameters: [{ type: format, [format]: { id: media.id } }] });
  }
  const response = await fetch(`https://graph.facebook.com/${config.version}/${encodeURIComponent(config.phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone.slice(1),
      type: 'template',
      template: {
        name: config.template.name,
        language: { code: config.template.language },
        components,
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`WhatsApp template delivery failed (HTTP ${response.status}).`);
}

async function sendLifecycleWhatsApp(
  eventKey: 'new_enquiry' | 'quote_status' | 'invoice_status' | 'ticket_status' | 'installation_status',
  entity: 'enquiry' | 'quote' | 'invoice' | 'ticket' | 'installation',
  entityId: string,
  message: string,
): Promise<void> {
  const targets = getLifecycleNotificationTargets(entity, entityId);
  for (const target of targets) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target.email)) {
      logCommunicationDelivery({
        eventKey, recipientType: target.recipientType, recipientId: target.recipientId,
        channel: 'email', status: 'skipped', errorCode: 'recipient_email_unavailable',
      });
    } else if (!process.env.SMTP_URL || !process.env.MAIL_FROM) {
      logCommunicationDelivery({
        eventKey, recipientType: target.recipientType, recipientId: target.recipientId,
        channel: 'email', status: 'not_configured', errorCode: 'smtp_credentials_missing',
      });
    } else {
      try {
        const transport = nodemailer.createTransport(process.env.SMTP_URL);
        await transport.sendMail({
          from: process.env.MAIL_FROM,
          to: target.email,
          subject: `HI-SOTECH update: ${eventKey.replaceAll('_', ' ')}`,
          text: message,
        });
        logCommunicationDelivery({
          eventKey, recipientType: target.recipientType, recipientId: target.recipientId,
          channel: 'email', status: 'sent',
        });
      } catch {
        logCommunicationDelivery({
          eventKey, recipientType: target.recipientType, recipientId: target.recipientId,
          channel: 'email', status: 'failed', errorCode: 'smtp_delivery_failed',
        });
      }
    }

    const pushIds = target.pushOwnerType === 'staff' && target.pushOwnerId
      ? getPushSubscriptions([target.pushOwnerId], [])
      : target.pushOwnerType === 'customer' && target.pushOwnerId
        ? getPushSubscriptions([], [target.pushOwnerId])
        : [];
    if (!pushIds.length) {
        logCommunicationDelivery({
          eventKey, recipientType: target.recipientType, recipientId: target.recipientId,
          channel: 'push', status: 'skipped', errorCode: 'no_active_subscription',
        });
    } else {
        const subject = process.env.VAPID_SUBJECT || '';
        const publicKey = process.env.VAPID_PUBLIC_KEY || '';
        const privateKey = process.env.VAPID_PRIVATE_KEY || '';
        if (!/^(mailto:[^@\s]+@[^/\s]+|https:\/\/[^/\s]+)$/.test(subject)
            || !validVapidKeyPair(publicKey, privateKey)) {
          logCommunicationDelivery({
            eventKey, recipientType: target.recipientType, recipientId: target.recipientId,
            channel: 'push', status: 'not_configured', errorCode: 'vapid_configuration_missing',
          });
        } else {
          try {
            webpush.setVapidDetails(subject, publicKey, privateKey);
            await Promise.all(pushIds.map((subscription) =>
              webpush.sendNotification({
                endpoint: subscription.endpoint,
                keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
              }, JSON.stringify({
                title: 'HI-SOTECH update',
                body: message.slice(0, 500),
                url: target.recipientType === 'customer' ? '/#customer' : '/#workspace',
              }))
            ));
            logCommunicationDelivery({
              eventKey, recipientType: target.recipientType, recipientId: target.recipientId,
              channel: 'push', status: 'sent',
            });
          } catch {
            logCommunicationDelivery({
              eventKey, recipientType: target.recipientType, recipientId: target.recipientId,
              channel: 'push', status: 'failed', errorCode: 'push_delivery_failed',
            });
          }
        }
    }

    if (target.whatsappOperational) {
      try {
        const config = getWhatsAppConfiguration(eventKey);
        await sendWhatsAppTemplate(config, target.phone, message.slice(0, 1024));
        logCommunicationDelivery({
          eventKey, recipientType: target.recipientType, recipientId: target.recipientId, channel: 'whatsapp', status: 'sent',
        });
      } catch (error) {
        const notConfigured = error instanceof WhatsAppConfigurationError;
        logCommunicationDelivery({
          eventKey,
          recipientType: target.recipientType,
          recipientId: target.recipientId,
          channel: 'whatsapp',
          status: notConfigured ? 'not_configured' : 'failed',
          errorCode: notConfigured ? 'template_or_credentials_missing' : 'provider_delivery_failed',
        });
      }
    } else {
      logCommunicationDelivery({
        eventKey, recipientType: target.recipientType, recipientId: target.recipientId,
        channel: 'whatsapp', status: 'skipped', errorCode: 'no_active_operational_consent',
      });
    }
  }
}

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

function validVapidKeyPair(publicKey: string, privateKey: string): boolean {
  try {
    const publicBytes = Buffer.from(publicKey, 'base64url');
    const privateBytes = Buffer.from(privateKey, 'base64url');
    if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) return false;
    const sec1Key = Buffer.concat([
      Buffer.from('30770201010420', 'hex'),
      privateBytes,
      Buffer.from('a00a06082a8648ce3d030107a144034200', 'hex'),
      publicBytes,
    ]);
    const privateKeyObject = crypto.createPrivateKey({ key: sec1Key, format: 'der', type: 'sec1' });
    const derivedPublic = crypto.createPublicKey(privateKeyObject).export({ format: 'der', type: 'spki' }).subarray(-65);
    return crypto.timingSafeEqual(publicBytes, derivedPublic);
  } catch {
    return false;
  }
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

import { getHomepageSections, saveHomepageSections } from './src/server/db';

const homepageSectionIds = ['hero', 'workflow', 'about', 'services', 'projects', 'pricing'] as const;
type HomepageSectionId = (typeof homepageSectionIds)[number];
type HomepageSectionData = { heading: string; body: string; enabled: boolean };

function validateHomepageSections(value: unknown): Record<string, HomepageSectionData> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const result: Record<string, HomepageSectionData> = {};
  for (const id of homepageSectionIds) {
    const section = source[id];
    if (!section || typeof section !== 'object' || Array.isArray(section)) return null;
    const fields = section as Record<string, unknown>;
    if (
      typeof fields.heading !== 'string' ||
      fields.heading.trim().length === 0 ||
      fields.heading.length > 180 ||
      typeof fields.body !== 'string' ||
      fields.body.length > 1200 ||
      typeof fields.enabled !== 'boolean'
    ) return null;
    result[id] = {
      heading: fields.heading.trim(),
      body: fields.body.trim(),
      enabled: fields.enabled,
    };
  }
  return result;
}

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
  app.get('/api/push/config', (_req, res) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY || '';
    const privateKey = process.env.VAPID_PRIVATE_KEY || '';
    const subject = process.env.VAPID_SUBJECT || '';
    if (!validVapidKeyPair(publicKey, privateKey) || !/^(mailto:[^@\s]+@[^@\s]+|https:\/\/[^/\s]+)$/.test(subject)) {
      res.status(503).json({ error: 'Web Push is not configured correctly on the private server.' });
      return;
    }
    res.json({ publicKey });
  });

  app.get('/api/public/bootstrap', (_req, res) => {
    res.json({ catalog: getPublicCatalog(), estimatorSettings: getPublicEstimatorSettings() });
  });

  app.post('/api/public/enquiries', async (req, res) => {
    const { customerName, phone, location, whatsappUpdatesConsent, whatsappMarketingConsent } = req.body ?? {};
    if (!customerName?.trim() || !phone?.trim() || !location?.trim()) {
      res.status(422).json({ error: 'Name, phone number, and site location are required.' });
      return;
    }
    if ((whatsappUpdatesConsent !== undefined && typeof whatsappUpdatesConsent !== 'boolean')
        || (whatsappMarketingConsent !== undefined && typeof whatsappMarketingConsent !== 'boolean')) {
      res.status(422).json({ error: 'WhatsApp consent choices are invalid.' });
      return;
    }
    if ((whatsappUpdatesConsent || whatsappMarketingConsent) && !isValidE164(phone)) {
      res.status(422).json({ error: 'WhatsApp consent requires a valid E.164 phone number.' });
      return;
    }
    try {
      const created = createPublicEnquiry(req.body);
      await sendLifecycleWhatsApp('new_enquiry', 'enquiry', created.id, `New enquiry ${created.refCode} received. Our team will follow up.`);
      res.status(201).json(created);
    } catch (error) {
      res.status(422).json({ error: (error as Error).message });
    }
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

  app.post('/api/public/accept-invoice', async (req, res) => {
    const invoiceId = String(req.body?.invoiceId || '');
    acceptInvoiceByCustomer(invoiceId);
    await sendLifecycleWhatsApp('invoice_status', 'invoice', invoiceId, 'Your invoice was acknowledged.');
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

  app.post('/api/customer/communications/consent', (req, res) => {
    const token = parseCookies(req.headers.cookie)[CUSTOMER_COOKIE_NAME];
    const session = getCustomerBySessionToken(token);
    if (!session) {
      res.status(401).json({ error: 'Verified customer sign-in required.' });
      return;
    }
    const { email, whatsapp, whatsappUpdates } = req.body ?? {};
    if (typeof email !== 'boolean' || typeof whatsapp !== 'boolean' || typeof whatsappUpdates !== 'boolean') {
      res.status(422).json({ error: 'Email, WhatsApp marketing, and WhatsApp service-update consent choices are required.' });
      return;
    }
    if ((whatsapp || whatsappUpdates) && !isValidE164(session.profile.phone)) {
      res.status(422).json({ error: 'Save a valid E.164 phone number (+country code and digits) before opting in to WhatsApp.' });
      return;
    }
    updateCustomerConsents(session.profile.id, { email, whatsapp });
    try {
      updateCustomerWhatsAppUpdates(session.profile.id, whatsappUpdates);
    } catch (error) {
      res.status(422).json({ error: (error as Error).message });
      return;
    }
    res.json({ ok: true, emailMarketingConsent: email, whatsappMarketingConsent: whatsapp, whatsappUpdatesConsent: whatsappUpdates });
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

  app.post('/api/customer/tickets', async (req, res) => {
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
      const ticket = submitCustomerTicket(session.profile.id, req.body);
      await sendLifecycleWhatsApp('ticket_status', 'ticket', ticket.ticketCode, `Service ticket ${ticket.ticketCode} was received.`);
      res.status(201).json(ticket);
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
  app.get('/api/website/content', (_req, res) => {
    res.json({ homepage: getHomepageSections() });
  });

  app.post('/api/website/content', (req, res) => {
    const { user } = getSessionUser(req);
    if (!user || user.role !== 'superadmin') {
      res.status(user ? 403 : 401).json({ error: 'Superuser access required.' });
      return;
    }

    const homepage = validateHomepageSections(req.body?.homepage);
    if (!homepage) {
      res.status(422).json({ error: 'Homepage sections are invalid.' });
      return;
    }

    saveHomepageSections(homepage, user.id);
    res.json({ homepage: getHomepageSections() });
  });

  app.get('/api/workspace/bootstrap', (req, res) => {
    const { user } = getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    res.json(hydrateWorkspace(user));
  });

  app.post('/api/workspace/settings', (req, res) => {
    const { user } = getSessionUser(req);
    if (!user || !(user.role === 'superadmin' || user.role === 'admin'
        || (hasPermission(user, 'manage_storefront') && hasPermission(user, 'manage_invoices')))) {
      res.status(user ? 403 : 401).json({ error: user ? 'Platform settings permission required.' : 'Authentication required.' });
      return;
    }
    try {
      const settings = savePlatformSettings(user, req.body);
      res.json({ settings });
    } catch (error) {
      res.status(422).json({ error: (error as Error).message });
    }
  });

  app.get('/api/communications/my-whatsapp-consent', (req, res) => {
    const { user } = getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    res.json(getStaffWhatsAppConsents(user.id));
  });

  app.post('/api/communications/my-whatsapp-consent', (req, res) => {
    const { user } = getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const { operational, marketing } = req.body ?? {};
    if (typeof operational !== 'boolean' || typeof marketing !== 'boolean') {
      res.status(422).json({ error: 'Explicit operational and marketing consent choices are required.' });
      return;
    }
    try {
      res.json(updateStaffWhatsAppConsents(user.id, { operational, marketing }));
    } catch (error) {
      res.status(422).json({ error: (error as Error).message });
    }
  });

  app.get('/api/communications/contacts', (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'manage_communications')) {
      res.status(user ? 403 : 401).json({ error: 'Communications permission required.' });
      return;
    }
    res.json({
      email: listMarketingContacts('email'),
      whatsapp: listWhatsAppConsentContacts('marketing'),
      whatsappOperational: listWhatsAppConsentContacts('operational'),
      pushCustomers: getPushSubscribedCustomers(),
      myWhatsappConsents: getStaffWhatsAppConsents(user!.id),
    });
  });

  app.post('/api/communications/whatsapp', async (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'manage_communications')) {
      res.status(user ? 403 : 401).json({ error: 'Communications permission required.' });
      return;
    }
    if (!allowCommunicationsAction(user!.id, 'whatsapp-single', 30)) {
      res.status(429).json({ error: 'WhatsApp send limit reached. Try again later.' });
      return;
    }
    const recipientType = req.body?.recipientType;
    const recipientId = typeof req.body?.recipientId === 'string' ? req.body.recipientId : '';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const messageError = validateMessage(message);
    if (messageError) {
      res.status(422).json({ error: messageError });
      return;
    }
    if (!['customer', 'staff', 'enquiry'].includes(recipientType) || !recipientId) {
      res.status(422).json({ error: 'Select a recipient with active WhatsApp marketing consent.' });
      return;
    }
    const contact = getWhatsAppConsentContact(recipientType, recipientId, 'marketing');
    if (!contact) {
      res.status(422).json({ error: 'This recipient has not opted in to WhatsApp marketing or has withdrawn consent.' });
      return;
    }
    if (!isValidE164(contact.phone)) {
      res.status(422).json({ error: 'The opted-in recipient phone number must be in E.164 format.' });
      return;
    }
    const attachments = req.body?.attachments ?? [];
    if (!Array.isArray(attachments) || attachments.length > 1) {
      res.status(422).json({ error: 'A WhatsApp message may include at most one validated image or PDF attachment.' });
      return;
    }
    let media: { id: string; mimeType: string } | undefined;
    try {
      let config = getWhatsAppConfiguration('manual', attachments[0]?.mimeType);
      if (attachments.length) {
        const validationError = validateWhatsAppAttachment(attachments[0]);
        if (validationError || attachments[0].size > 2 * 1024 * 1024) {
          res.status(422).json({ error: validationError || 'WhatsApp media must not exceed 2MB.' });
          return;
        }
        const mediaId = await uploadWhatsAppMedia(config, attachments[0]);
        media = { id: mediaId, mimeType: attachments[0].mimeType };
      }
      await sendWhatsAppTemplate(config, contact.phone, message, media);
      writeAudit(user!, 'SEND_WHATSAPP_MARKETING', recipientType, recipientId, 'Sent approved-template WhatsApp marketing message.');
      res.json({ ok: true });
    } catch (error) {
      const message = (error as Error).message;
      if (error instanceof WhatsAppConfigurationError) {
        res.status(503).json({ error: message });
        return;
      }
      res.status(502).json({ error: message.includes('HTTP ') ? message : 'WhatsApp message could not be delivered. Check private provider configuration and status.' });
    }
  });

  app.post('/api/communications/whatsapp-newsletter', async (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'manage_communications')) {
      res.status(user ? 403 : 401).json({ error: 'Communications permission required.' });
      return;
    }
    if (!allowCommunicationsAction(user!.id, 'whatsapp-newsletter', 3)) {
      res.status(429).json({ error: 'WhatsApp newsletter limit reached. Try again later.' });
      return;
    }
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const recipients = req.body?.recipients;
    const attachments = req.body?.attachments ?? [];
    const messageError = validateMessage(message);
    if (messageError || message.length > 1024) {
      res.status(422).json({ error: messageError || 'WhatsApp template content may not exceed 1024 characters.' });
      return;
    }
    if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > 200
        || recipients.some((r: any) => !['customer', 'staff', 'enquiry'].includes(r?.recipientType)
          || typeof r?.recipientId !== 'string' || r.recipientId.length > 36)) {
      res.status(422).json({ error: 'Select between 1 and 200 recipients with recorded WhatsApp marketing consent.' });
      return;
    }
    if (!Array.isArray(attachments) || attachments.length > 1) {
      res.status(422).json({ error: 'A WhatsApp newsletter may include at most one image or PDF attachment.' });
      return;
    }
    const resolved = recipients.map((r: { recipientType: 'customer' | 'staff' | 'enquiry'; recipientId: string }) =>
      getWhatsAppConsentContact(r.recipientType, r.recipientId, 'marketing'));
    if (resolved.some((contact) => !contact)) {
      res.status(422).json({ error: 'One or more recipients lack active WhatsApp marketing consent.' });
      return;
    }
    let config: ReturnType<typeof getWhatsAppConfiguration>;
    try {
      config = getWhatsAppConfiguration('newsletter', attachments[0]?.mimeType);
    } catch (error) {
      res.status(503).json({ error: (error as Error).message });
      return;
    }
    if (attachments.length) {
      const validationError = validateWhatsAppAttachment(attachments[0]);
      if (validationError || attachments[0].size > 2 * 1024 * 1024) {
        res.status(422).json({ error: validationError || 'WhatsApp media must not exceed 2MB.' });
        return;
      }
    }
    try {
      const mediaId = attachments.length ? await uploadWhatsAppMedia(config, attachments[0]) : '';
      let delivered = 0;
      for (const contact of resolved) {
        await sendWhatsAppTemplate(config, contact!.phone, message, mediaId
          ? { id: mediaId, mimeType: attachments[0].mimeType }
          : undefined);
        delivered += 1;
      }
      writeAudit(user!, 'SEND_WHATSAPP_NEWSLETTER', 'Newsletter', crypto.randomUUID(), `Sent to ${delivered} marketing-consented recipient(s).`);
      res.json({ ok: true, delivered });
    } catch (error) {
      const text = (error as Error).message;
      res.status(502).json({ error: text.includes('HTTP ') ? text : 'WhatsApp newsletter delivery failed; provider configuration and status were not logged.' });
    }
  });

  app.post('/api/communications/newsletter', async (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'manage_communications')) {
      res.status(user ? 403 : 401).json({ error: 'Communications permission required.' });
      return;
    }
    if (!allowCommunicationsAction(user!.id, 'email-newsletter', 3)) {
      res.status(429).json({ error: 'Newsletter send limit reached. Try again later.' });
      return;
    }
    const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const attachments = req.body?.attachments;
    if (!subject || subject.length > 180 || /[\r\n]/.test(subject) || !message || message.length > 10000) {
      res.status(422).json({ error: 'Newsletter subject (max 180 characters) and message (max 10000 characters) are required.' });
      return;
    }
    if (!Array.isArray(attachments) || attachments.length > 3) {
      res.status(422).json({ error: 'A newsletter may include at most three image or PDF attachments.' });
      return;
    }
    let totalBytes = 0;
    for (const attachment of attachments) {
      const validationError = validateNewsletterAttachment(attachment);
      if (validationError) {
        res.status(422).json({ error: validationError });
        return;
      }
      totalBytes += attachment.size;
    }
    if (totalBytes > 4 * 1024 * 1024) {
      res.status(422).json({ error: 'Combined newsletter attachments may not exceed 4MB.' });
      return;
    }
    const smtpUrl = process.env.SMTP_URL || '';
    const mailFrom = process.env.MAIL_FROM || '';
    if (!smtpUrl || !mailFrom) {
      res.status(503).json({ error: 'Newsletter SMTP is not configured on the private server.' });
      return;
    }
    const recipients = listMarketingContacts('email');
    if (!recipients.length) {
      res.status(422).json({ error: 'No verified customers have active email marketing consent.' });
      return;
    }
    try {
      const transport = nodemailer.createTransport(smtpUrl);
      let delivered = 0;
      for (let offset = 0; offset < recipients.length; offset += 40) {
        const batch = recipients.slice(offset, offset + 40);
        await transport.sendMail({
          from: mailFrom,
          to: mailFrom,
          bcc: batch.map((recipient) => recipient.email),
          subject,
          text: message,
          attachments: attachments.map((attachment: { name: string; mimeType: string; data: string }) => ({
            filename: attachment.name,
            content: Buffer.from(attachment.data, 'base64'),
            contentType: attachment.mimeType,
          })),
        });
        delivered += batch.length;
      }
      writeAudit(user!, 'SEND_OPTED_IN_NEWSLETTER', 'Newsletter', crypto.randomUUID(), `Sent newsletter to ${delivered} consented recipients.`);
      res.json({ ok: true, delivered });
    } catch {
      res.status(502).json({ error: 'Newsletter delivery failed; check the private SMTP configuration and mail server status.' });
    }
  });

  app.post('/api/communications/push', async (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'manage_communications')) {
      res.status(user ? 403 : 401).json({ error: 'Communications permission required.' });
      return;
    }
    if (!allowCommunicationsAction(user!.id, 'push', 60)) {
      res.status(429).json({ error: 'Push notification limit reached. Try again later.' });
      return;
    }
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    const targetIds = req.body?.userIds;
    const customerTargetIds = req.body?.customerIds ?? [];
    if (!title || title.length > 120 || !body || body.length > 500) {
      res.status(422).json({ error: 'Push title (max 120 characters) and body (max 500 characters) are required.' });
      return;
    }
    if (!Array.isArray(targetIds) || !Array.isArray(customerTargetIds)
      || targetIds.length + customerTargetIds.length < 1 || targetIds.length + customerTargetIds.length > 50
      || [...targetIds, ...customerTargetIds].some((id: unknown) => typeof id !== 'string' || id.length > 36)) {
      res.status(422).json({ error: 'Select between 1 and 50 staff or subscribed customer recipients.' });
      return;
    }
    const vapidSubject = process.env.VAPID_SUBJECT || '';
    const vapidPublic = process.env.VAPID_PUBLIC_KEY || '';
    const vapidPrivate = process.env.VAPID_PRIVATE_KEY || '';
    if (!/^(mailto:[^@\s]+@[^@\s]+|https:\/\/[^/\s]+)$/.test(vapidSubject)
      || !validVapidKeyPair(vapidPublic, vapidPrivate)) {
      res.status(503).json({ error: 'VAPID Web Push is not configured correctly on the private server.' });
      return;
    }
    const recipients = getActiveStaffIds([...new Set(targetIds as string[])]);
    const customerRecipients = getVerifiedCustomerIds([...new Set(customerTargetIds as string[])]);
    if (!recipients.length && !customerRecipients.length) {
      res.status(422).json({ error: 'No active staff or verified customer recipients were found.' });
      return;
    }
    const subscriptions = getPushSubscriptions(recipients, customerRecipients);
    if (!subscriptions.length) {
      res.status(422).json({ error: 'None of the selected users have an active Web Push subscription.' });
      return;
    }
    try {
      webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
      const results = await Promise.all(subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification({
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
          }, JSON.stringify({
            title,
            body,
            url: subscription.owner_type === 'customer' ? '/#customer' : '/#workspace',
          }), { TTL: 60 });
          return true;
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) deletePushSubscription(subscription.endpoint);
          return false;
        }
      }));
      const delivered = results.filter(Boolean).length;
      for (const targetId of recipients) {
        createNotification(targetId, title, body, 'communications', 'push');
      }
      writeAudit(user!, 'SEND_WEB_PUSH', 'User', 'multiple', `Sent push notification to ${delivered} subscribed devices.`);
      res.json({ ok: true, delivered, failed: results.length - delivered });
    } catch {
      res.status(503).json({ error: 'Web Push delivery failed. Verify the private VAPID keys and subject.' });
    }
  });

  app.post('/api/push/subscriptions', (req, res) => {
    const { user } = getSessionUser(req);
    const customerToken = parseCookies(req.headers.cookie)[CUSTOMER_COOKIE_NAME];
    const customer = user ? null : getCustomerBySessionToken(customerToken);
    if (!user && !customer) {
      res.status(401).json({ error: 'Sign in to subscribe to notifications.' });
      return;
    }
    const subscription = req.body?.subscription;
    const ownerType = user ? 'staff' : 'customer';
    const ownerId = user ? user.id : customer!.profile.id;
    const endpoint = typeof subscription?.endpoint === 'string' ? subscription.endpoint : '';
    const keys = subscription?.keys;
    let endpointUrl: URL;
    try {
      endpointUrl = new URL(endpoint);
    } catch {
      res.status(422).json({ error: 'Invalid push subscription endpoint.' });
      return;
    }
    const host = endpointUrl.hostname.toLowerCase();
    const allowedHost = host === 'fcm.googleapis.com' || host.endsWith('.push.services.mozilla.com')
      || host.endsWith('.notify.windows.com') || host === 'web.push.apple.com';
    if (endpointUrl.protocol !== 'https:' || !allowedHost || endpointUrl.username || endpointUrl.password
      || (endpointUrl.port && endpointUrl.port !== '443') || endpointUrl.hash
      || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string'
      || endpoint.length > 2048 || keys.p256dh.length > 255 || keys.auth.length > 255) {
      res.status(422).json({ error: 'Push subscription data is invalid.' });
      return;
    }
    if (!/^[A-Za-z0-9_-]{80,100}$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]{20,30}$/.test(keys.auth)) {
      res.status(422).json({ error: 'Push subscription keys are invalid.' });
      return;
    }
    upsertPushSubscription(ownerType, ownerId, { endpoint, p256dh: keys.p256dh, auth: keys.auth });
    res.json({ ok: true });
  });

  app.delete('/api/push/subscriptions', (req, res) => {
    const { user } = getSessionUser(req);
    const customer = user ? null : getCustomerBySessionToken(parseCookies(req.headers.cookie)[CUSTOMER_COOKIE_NAME]);
    if (!user && !customer) {
      res.status(401).json({ error: 'Sign in to manage notification subscriptions.' });
      return;
    }
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
    if (!endpoint || endpoint.length > 2048) {
      res.status(422).json({ error: 'Invalid push subscription endpoint.' });
      return;
    }
    deletePushSubscription(endpoint, user
      ? { type: 'staff', id: user.id }
      : { type: 'customer', id: customer!.profile.id });
    res.json({ ok: true });
  });

  app.post('/api/enquiries', async (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'manage_enquiries')) {
      res.status(403).json({ error: 'Enquiry management permission required.' });
      return;
    }
    const enquiry = createStaffEnquiry(user!, req.body);
    await sendLifecycleWhatsApp('new_enquiry', 'enquiry', enquiry.id, `New enquiry ${enquiry.refCode} received. Our team will follow up.`);
    res.status(201).json(enquiry);
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

  app.post('/api/documents/send-email', async (req, res) => {
    const { user } = getSessionUser(req);
    const type = req.body?.type === 'invoice' ? 'invoice' : req.body?.type === 'quote' ? 'quote' : null;
    const id = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!type || !id || id.length > 80
        || (type === 'invoice' && !hasPermission(user, 'manage_invoices'))
        || (type === 'quote' && !hasPermission(user, 'draft_quotes') && !hasPermission(user, 'manage_invoices'))) {
      res.status(403).json({ error: 'Your role does not permit sending this document.' });
      return;
    }
    if (!allowCommunicationsAction(user.id, 'document-email', 10)) {
      res.status(429).json({ error: 'Too many document emails. Please try again later.' });
      return;
    }
    const document = getPublicDocument(type, id);
    const recipient = document && typeof document.email === 'string' ? document.email.trim() : '';
    const candidate = req.body?.attachment;
    if (!document || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      res.status(422).json({ error: 'The customer email address is not available for this document.' });
      return;
    }
    if (!candidate || typeof candidate !== 'object'
        || typeof candidate.name !== 'string' || typeof candidate.mimeType !== 'string'
        || typeof candidate.data !== 'string' || !Number.isInteger(candidate.size)) {
      res.status(422).json({ error: 'A valid PDF attachment is required.' });
      return;
    }
    const attachment: NewsletterAttachment = {
      name: candidate.name,
      mimeType: candidate.mimeType,
      data: candidate.data,
      size: candidate.size,
    };
    const attachmentError = validateNewsletterAttachment(attachment);
    if (attachmentError || attachment.mimeType !== 'application/pdf' || !attachment.name.toLowerCase().endsWith('.pdf')) {
      res.status(422).json({ error: attachmentError || 'The document must be a validated PDF file.' });
      return;
    }
    if (!process.env.SMTP_URL || !process.env.MAIL_FROM) {
      res.status(503).json({ error: 'Email delivery is not configured on the private server.' });
      return;
    }
    const safeCode = String(document.documentCode).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80);
    try {
      const transport = nodemailer.createTransport(process.env.SMTP_URL);
      await transport.sendMail({
        from: process.env.MAIL_FROM,
        to: recipient,
        subject: `HI-SOTECH ${type === 'invoice' ? 'Invoice' : 'Quotation'} ${safeCode}`,
        text: `Please find the HI-SOTECH ${type === 'invoice' ? 'invoice' : 'quotation'} ${safeCode} attached as a PDF.`,
        attachments: [{
          filename: `${safeCode}.pdf`,
          content: Buffer.from(attachment.data, 'base64'),
          contentType: 'application/pdf',
        }],
      });
      res.json({ ok: true });
    } catch {
      res.status(502).json({ error: 'The document email could not be sent. Please try again later.' });
    }
  });

  app.post('/api/quotes/approve', async (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'approve_quotes')) {
      res.status(403).json({ error: 'Director or Super Admin approval permission required.' });
      return;
    }
    try {
      const result = decideQuotation(user!, req.body.quoteId, req.body.decision);
      await sendLifecycleWhatsApp('quote_status', 'quote', req.body.quoteId, `Quotation ${req.body.quoteId} status: ${result.status}.`);
      res.json(result);
    } catch (err) {
      res.status(422).json({ error: (err as Error).message });
    }
  });

  app.post('/api/invoices', async (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'manage_invoices')) {
      res.status(403).json({ error: 'Invoice management permission required.' });
      return;
    }
    try {
      const invoice = issueInvoice(user!, req.body.quotationId);
      await sendLifecycleWhatsApp('invoice_status', 'invoice', invoice.id, `Invoice ${invoice.invoiceCode} has been issued.`);
      await sendLifecycleWhatsApp('quote_status', 'quote', req.body.quotationId, 'Your approved quotation has been converted to an invoice.');
      res.status(201).json(invoice);
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

  app.post('/api/payments/verify', async (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'verify_payments')) {
      res.status(403).json({ error: 'Director or Super Admin payment verification permission required.' });
      return;
    }
    try {
      const result = verifyPayment(user!, req.body.paymentId, req.body.decision, req.body.reason);
      const payment = getPaymentInvoiceId(req.body.paymentId);
      if (payment) {
        await sendLifecycleWhatsApp('invoice_status', 'invoice', payment.invoiceId, `A payment receipt for your invoice was ${String(result.status).toLowerCase()}.`);
      }
      res.json(result);
    } catch (err) {
      res.status(422).json({ error: (err as Error).message });
    }
  });

  app.post('/api/installations/release', async (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'release_installations')) {
      res.status(403).json({ error: 'Director or Super Admin release permission required.' });
      return;
    }
    try {
      const installation = releaseInstallation(user!, req.body);
      await sendLifecycleWhatsApp('installation_status', 'installation', installation.id, `Installation ${installation.jobCode} has been scheduled.`);
      res.status(201).json(installation);
    } catch (err) {
      res.status(422).json({ error: (err as Error).message });
    }
  });

  app.post('/api/installations/assign', async (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'manage_enquiries') && !hasPermission(user, 'release_installations')) {
      res.status(403).json({ error: 'Dispatch assignment permission required.' });
      return;
    }
    assignInstallation(user!, req.body.installationId, req.body.engineerId);
    await sendLifecycleWhatsApp('installation_status', 'installation', String(req.body.installationId || ''), 'Your installation has been assigned to a field engineer.');
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
      const reportResult = submitInstallationReport(user!, reportBody, upload.photos);
      await sendLifecycleWhatsApp('installation_status', 'installation', reportBody.installationId, `Installation update: stage ${reportBody.stageNumber}, ${reportBody.activityTitle}.`);
      res.status(201).json(reportResult);
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

  app.post('/api/tickets/update', async (req, res) => {
    const { user } = getSessionUser(req);
    if (!hasPermission(user, 'manage_tickets')) {
      res.status(403).json({ error: 'Help Desk / Service ticket permission required.' });
      return;
    }
    try {
      updateServiceTicket(user!, req.body);
      await sendLifecycleWhatsApp('ticket_status', 'ticket', String(req.body?.ticketId || ''), `Service ticket status changed to ${String(req.body?.status || 'updated')}.`);
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
