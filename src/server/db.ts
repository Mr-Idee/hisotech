import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ALL_PERMISSIONS,
  buildQuoteLinesFromEstimate,
  calculateDocumentTotals,
  calculateInvoiceBalance,
  calculateSolarEstimate,
  calculateStoreOrderTotals,
  canUpdateStaffStatusOrRole,
  computeEstimateCostFromCatalog,
  hasPermission,
  ROLE_DEFAULT_PERMISSIONS,
  validateInstallationRelease,
} from '../lib/solar';
import { defaultEstimatorSettings, normalizeEstimatorSettings } from '../lib/estimator-settings';
import { customerEmailMatches } from '../lib/customer-access';
import { canAcknowledgeInstallation } from '../lib/access-control';
import type {
  AuditLogRecord,
  BankDetails,
  ApplianceItem,
  CatalogItem,
  CatalogItemType,
  CustomerEquipment,
  CustomerProfile,
  EnquiryRecord,
  EstimatorSettings,
  InstallationRecord,
  InvoiceRecord,
  LineItem,
  NotificationRecord,
  OrderDeliveryMethod,
  OrderPaymentMethod,
  PaymentRecord,
  PermissionKey,
  PlatformSettings,
  QuotationRecord,
  RoleDefinition,
  ServiceTicket,
  StaffMember,
  StaffStatus,
  StoreOrderRecord,
  StoreOrderStatus,
  TicketCategory,
  TicketStatus,
  UserRole,
  SolarEstimateResult,
  WorkspaceBootstrap,
} from '../lib/types';

const DB_PATH = path.resolve(process.cwd(), '.hiso_preview.sqlite');
const UPLOAD_DIR = path.resolve(process.cwd(), '.hiso_uploads');
const STAFF_PROFILE_DIR = path.join(UPLOAD_DIR, 'staff_profiles');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(STAFF_PROFILE_DIR)) {
  fs.mkdirSync(STAFF_PROFILE_DIR, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

function withTransaction<T>(action: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function closeDatabase(): void {
  db.close();
}

db.exec(`
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  permissions_json TEXT NOT NULL DEFAULT '[]',
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  initial_pin_hash TEXT,
  pin_expires_at TEXT,
  must_set_password INTEGER NOT NULL DEFAULT 0,
  profile_photo_filename TEXT,
  role TEXT NOT NULL,
  title TEXT NOT NULL,
  skills TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_items (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'equipment',
  category TEXT NOT NULL,
  grade TEXT NOT NULL DEFAULT 'Standard',
  unit TEXT NOT NULL,
  price_ngn REAL NOT NULL,
  stock_qty INTEGER NOT NULL,
  capacity_kw REAL,
  watts INTEGER,
  description TEXT NOT NULL DEFAULT '',
  image_path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS enquiries (
  id TEXT PRIMARY KEY,
  ref_code TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL,
  location TEXT NOT NULL,
  channel TEXT NOT NULL,
  need_summary TEXT NOT NULL,
  appliances_json TEXT NOT NULL DEFAULT '[]',
  estimate_json TEXT,
  status TEXT NOT NULL,
  archived_at TEXT,
  owner_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quotations (
  id TEXT PRIMARY KEY,
  quote_code TEXT NOT NULL UNIQUE,
  enquiry_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  status TEXT NOT NULL,
  revision_no INTEGER NOT NULL DEFAULT 1,
  scope TEXT NOT NULL,
  terms TEXT NOT NULL,
  note TEXT NOT NULL,
  discount_ngn REAL NOT NULL DEFAULT 0,
  tax_percent REAL NOT NULL DEFAULT 0,
  issued_date TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  items_json TEXT NOT NULL,
  revisions_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  invoice_code TEXT NOT NULL UNIQUE,
  quotation_id TEXT NOT NULL,
  enquiry_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  discount_ngn REAL NOT NULL DEFAULT 0,
  tax_percent REAL NOT NULL DEFAULT 0,
  total_ngn REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  bank_details_json TEXT NOT NULL,
  customer_accepted INTEGER NOT NULL DEFAULT 0,
  accepted_at TEXT,
  issued_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  items_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  payment_code TEXT NOT NULL UNIQUE,
  invoice_id TEXT NOT NULL,
  amount_ngn REAL NOT NULL,
  payment_date TEXT NOT NULL,
  method TEXT NOT NULL,
  reference TEXT NOT NULL,
  evidence_note TEXT NOT NULL,
  status TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  verified_by TEXT,
  verified_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS installations (
  id TEXT PRIMARY KEY,
  job_code TEXT NOT NULL UNIQUE,
  invoice_id TEXT NOT NULL,
  enquiry_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  location TEXT NOT NULL,
  system_summary TEXT NOT NULL,
  assigned_engineer_id TEXT,
  engineer_acknowledged INTEGER NOT NULL DEFAULT 0,
  current_stage INTEGER NOT NULL DEFAULT 1,
  target_date TEXT NOT NULL,
  release_type TEXT NOT NULL,
  release_note TEXT NOT NULL,
  released_by TEXT NOT NULL,
  released_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS installation_updates (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  stage_number INTEGER NOT NULL,
  activity_title TEXT NOT NULL,
  report_text TEXT NOT NULL,
  is_customer_visible INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS installation_photos (
  id TEXT PRIMARY KEY,
  update_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  ref_code TEXT NOT NULL DEFAULT '',
  email_verified_at TEXT,
  password_hash TEXT,
  initial_pin_hash TEXT,
  pin_expires_at TEXT,
  must_set_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_login_tokens (
  token_hash TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  token_hash TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_auth_rate_limits (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_equipment (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  equipment_type TEXT NOT NULL,
  brand_model TEXT NOT NULL,
  serial_number TEXT NOT NULL DEFAULT '',
  capacity_kw TEXT NOT NULL DEFAULT '',
  install_date TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_equipment_photos (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_tickets (
  id TEXT PRIMARY KEY,
  ticket_code TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  location TEXT NOT NULL,
  equipment_id TEXT,
  equipment_summary TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'Normal',
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Open',
  assigned_tech_id TEXT,
  assigned_tech_name TEXT,
  resolution_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS store_orders (
  id TEXT PRIMARY KEY,
  order_code TEXT NOT NULL UNIQUE,
  enquiry_id TEXT NOT NULL,
  ref_code TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL,
  location TEXT NOT NULL,
  delivery_address TEXT NOT NULL,
  delivery_method TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  items_json TEXT NOT NULL,
  subtotal_ngn REAL NOT NULL,
  delivery_fee_ngn REAL NOT NULL,
  tax_ngn REAL NOT NULL,
  total_ngn REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target_module TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS homepage_sections (
  section_id TEXT PRIMARY KEY,
  heading TEXT NOT NULL,
  body TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS platform_settings (
  id TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS communications_consents (
  customer_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  consented_at TEXT,
  revoked_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (customer_id, channel)
);

CREATE TABLE IF NOT EXISTS customer_contact_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_contact_group_members (
  group_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (group_id, customer_id)
);

CREATE TABLE IF NOT EXISTS whatsapp_recipient_consents (
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('customer', 'staff', 'enquiry')),
  recipient_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('operational', 'marketing')),
  phone_at_consent TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  revoked_at TEXT,
  consent_source TEXT NOT NULL,
  PRIMARY KEY (recipient_type, recipient_id, purpose)
);

CREATE TABLE IF NOT EXISTS communications_delivery_events (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('customer', 'staff', 'enquiry')),
  recipient_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'push', 'whatsapp')),
  status TEXT NOT NULL CHECK (status IN ('sent', 'not_configured', 'failed', 'skipped')),
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('staff', 'customer')),
  owner_id TEXT NOT NULL,
  endpoint_hash TEXT NOT NULL UNIQUE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`);

function ensureColumn(table: string, col: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

ensureColumn('catalog_items', 'item_type', "item_type TEXT NOT NULL DEFAULT 'equipment'");
ensureColumn('catalog_items', 'grade', "grade TEXT NOT NULL DEFAULT 'Standard'");
ensureColumn('catalog_items', 'watts', 'watts INTEGER');
ensureColumn('catalog_items', 'description', "description TEXT NOT NULL DEFAULT ''");
ensureColumn('invoices', 'status', "status TEXT NOT NULL DEFAULT 'Pending'");
ensureColumn('enquiries', 'archived_at', 'archived_at TEXT');
db.prepare("UPDATE enquiries SET status='New' WHERE status NOT IN ('New','Technical review')").run();
db.exec(`
  UPDATE invoices
  SET status = CASE
    WHEN (SELECT COALESCE(SUM(amount_ngn), 0) FROM payments WHERE invoice_id = invoices.id AND status = 'Confirmed') >= total_ngn THEN 'Completed'
    WHEN (SELECT COALESCE(SUM(amount_ngn), 0) FROM payments WHERE invoice_id = invoices.id AND status = 'Confirmed') > 0 THEN 'Confirmed'
    ELSE 'Pending'
  END
`);
db.exec(`
  UPDATE store_orders
  SET status = 'Completed'
  WHERE status = 'Delivered'
    AND EXISTS (SELECT 1 FROM invoices WHERE invoices.enquiry_id = store_orders.enquiry_id AND invoices.status = 'Completed')
`);
db.exec(`
  UPDATE enquiries
  SET status = 'Completed'
  WHERE EXISTS (SELECT 1 FROM store_orders WHERE store_orders.enquiry_id = enquiries.id AND store_orders.status = 'Completed')
`);
ensureColumn('customer_profiles', 'email_verified_at', 'email_verified_at TEXT');
ensureColumn('customer_profiles', 'password_hash', 'password_hash TEXT');
ensureColumn('customer_profiles', 'initial_pin_hash', 'initial_pin_hash TEXT');
ensureColumn('customer_profiles', 'pin_expires_at', 'pin_expires_at TEXT');
ensureColumn('customer_profiles', 'must_set_password', 'must_set_password INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'initial_pin_hash', 'initial_pin_hash TEXT');
ensureColumn('users', 'pin_expires_at', 'pin_expires_at TEXT');
ensureColumn('users', 'must_set_password', 'must_set_password INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'profile_photo_filename', 'profile_photo_filename TEXT');
ensureColumn('users', 'username', 'username TEXT');
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username ON users(username) WHERE username IS NOT NULL AND username <> ''");

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function makeInitialPin(): string {
  return String(crypto.randomInt(1000, 10000));
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [scheme, saltHex, hashHex] = storedHash.split('$');
  if (scheme === 'scrypt' && saltHex && hashHex && /^[a-f0-9]+$/i.test(saltHex) && /^[a-f0-9]{128}$/i.test(hashHex)) {
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  }
  const legacy = crypto.createHash('sha256').update('hiso_salt:' + password).digest('hex');
  const expectedLegacy = Buffer.from(storedHash, 'hex');
  const actualLegacy = Buffer.from(legacy, 'hex');
  return expectedLegacy.length === actualLegacy.length && crypto.timingSafeEqual(actualLegacy, expectedLegacy);
}

function isoDateOffset(days = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nextCode(table: string, col: string, prefix: string): string {
  const rows = db.prepare(`SELECT ${col} AS c FROM ${table}`).all() as { c: string }[];
  let max = 1000;
  for (const r of rows) {
    const n = Number(r.c.split('-').pop());
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${max + 1}`;
}

function saveBase64Upload(dataUrl: string, prefix = 'upload'): { filename: string; mimeType: string } | null {
  const match = dataUrl.match(/^data:(image\/(jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const ext = match[2] === 'png' ? 'png' : match[2] === 'webp' ? 'webp' : 'jpg';
  const filename = `${prefix}-${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), Buffer.from(match[3], 'base64'));
  return { filename, mimeType: match[1] };
}

function getJpegDimensions(binary: Buffer): { width: number; height: number } | null {
  if (binary.length < 4 || binary[0] !== 0xff || binary[1] !== 0xd8) return null;
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 4 < binary.length) {
    if (binary[offset] !== 0xff) return null;
    while (offset < binary.length && binary[offset] === 0xff) offset++;
    if (offset >= binary.length) return null;
    const marker = binary[offset++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if ([0xd8, 0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7].includes(marker)) continue;
    if (offset + 1 >= binary.length) return null;
    const length = binary.readUInt16BE(offset);
    if (length < 2 || offset + length > binary.length) return null;
    if (frameMarkers.has(marker)) {
      if (length < 7) return null;
      return {
        height: binary.readUInt16BE(offset + 3),
        width: binary.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  return null;
}

function seedRolesAndMigrateUsers(): void {
  const now = new Date().toISOString();
  const insRole = db.prepare(
    'INSERT OR IGNORE INTO roles (id, name, description, permissions_json, is_system, created_at) VALUES (?, ?, ?, ?, 1, ?)'
  );
  insRole.run(
    'superadmin',
    'Super Admin',
    'Full unrestricted control over all platform operations, dynamic role creation, staff accounts, Store, finance, and field delivery.',
    JSON.stringify(ALL_PERMISSIONS.map((p) => p.key)),
    now
  );
  insRole.run(
    'director',
    'Managing Director',
    'Executive approval of quotations, payment receipt verification, and authorization of installation job release.',
    JSON.stringify(ROLE_DEFAULT_PERMISSIONS.director),
    now
  );
  insRole.run(
    'admin',
    'Admin / Help Desk',
    'Enquiries intake, customer complaint & service help desk routing, Store pricing, quotation drafting, invoicing, and payment logging.',
    JSON.stringify(ROLE_DEFAULT_PERMISSIONS.admin),
    now
  );
  insRole.run(
    'technician',
    'Technician',
    'Field execution of assigned 5-stage solar installations, site photo uploads, and assigned customer service/repair tickets.',
    JSON.stringify(ROLE_DEFAULT_PERMISSIONS.technician),
    now
  );

  // Migrate any legacy V1 roles cleanly
  db.exec("UPDATE users SET role = 'director' WHERE role = 'md'");
  db.exec("UPDATE users SET role = 'technician' WHERE role = 'engineer'");

  const superExists = db.prepare("SELECT id FROM users WHERE role = 'superadmin' LIMIT 1").get();
  const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
  const bootstrapEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const bootstrapName = (process.env.BOOTSTRAP_ADMIN_NAME || 'Platform Administrator').trim();
  const bootstrapUsername = (process.env.BOOTSTRAP_ADMIN_USERNAME || '').trim().toLowerCase();
  const bootstrapPhone = (process.env.BOOTSTRAP_ADMIN_PHONE || '').trim();
  if (!superExists && bootstrapPassword.length >= 14
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bootstrapEmail) && bootstrapEmail.length <= 190
    && /^[a-z0-9._-]{3,50}$/.test(bootstrapUsername)
    && bootstrapName.length > 0 && bootstrapName.length <= 120 && bootstrapPhone.length <= 40) {
    const pw = hashPassword(bootstrapPassword);
    db.prepare(
      'INSERT OR IGNORE INTO users (id, name, username, email, phone, password_hash, role, title, skills, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      'super-admin',
      bootstrapName,
      bootstrapUsername,
      bootstrapEmail,
      bootstrapPhone,
      pw,
      'superadmin',
      'System Super Administrator',
      'Full platform administration, custom RBAC role creation, executive overrides',
      'Active',
      now
    );
  }
}

function removeKnownDemoRecords(): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    const demoUsers = db.prepare(
      "SELECT id FROM users WHERE id IN ('md-oseni', 'admin-idee', 'eng-kalu', 'eng-musa') AND email LIKE '%@example.invalid'"
    ).all() as { id: string }[];
    const demoUserIds = demoUsers.map((user) => user.id);
    if (demoUserIds.length > 0) {
      const placeholders = demoUserIds.map(() => '?').join(', ');
      db.prepare(`DELETE FROM sessions WHERE user_id IN (${placeholders})`).run(...demoUserIds);
      db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...demoUserIds);
    }

    db.prepare("DELETE FROM installation_photos WHERE update_id IN (SELECT u.id FROM installation_updates u JOIN installations i ON i.id = u.installation_id WHERE i.id = 'job-1001' AND i.job_code = 'JOB-1001' AND i.customer_name = 'Demo Customer')").run();
    db.prepare("DELETE FROM installation_updates WHERE installation_id IN (SELECT id FROM installations WHERE id = 'job-1001' AND job_code = 'JOB-1001' AND customer_name = 'Demo Customer')").run();
    db.prepare("DELETE FROM installations WHERE id = 'job-1001' AND job_code = 'JOB-1001' AND customer_name = 'Demo Customer'").run();
    db.prepare("DELETE FROM payments WHERE id = 'pay-1001' AND payment_code = 'PAY-1001'").run();
    db.prepare("DELETE FROM invoices WHERE id = 'inv-1001' AND invoice_code = 'INV-1001'").run();
    db.prepare("DELETE FROM quotations WHERE (id = 'quo-1001' AND quote_code = 'QUO-1001') OR (id = 'quo-1002' AND quote_code = 'QUO-1002')").run();
    db.prepare("DELETE FROM store_orders WHERE id = 'ord-1001' AND order_code = 'ORD-1001'").run();
    db.prepare("DELETE FROM catalog_items WHERE (id = 'cat-pv550' AND sku = 'PV-550M' AND name = '550W Monocrystalline Tier-1 Solar Panel' AND price_ngn = 155000) OR (id = 'cat-pv500' AND sku = 'PV-500M' AND name = '500W Mono PERC Solar Panel' AND price_ngn = 138000) OR (id = 'cat-inv5' AND sku = 'INV-5K-HYB' AND name = '5kW Hybrid MPPT Solar Inverter (48V)' AND price_ngn = 980000) OR (id = 'cat-inv10' AND sku = 'INV-10K-HYB' AND name = '10kW Dual-MPPT Parallel Hybrid Inverter' AND price_ngn = 1850000) OR (id = 'cat-inv15' AND sku = 'INV-15K-3P' AND name = '15kW Three-Phase Commercial Hybrid Inverter' AND price_ngn = 3100000) OR (id = 'cat-bat5' AND sku = 'BAT-512L' AND name = '5.12kWh 51.2V LiFePO4 Lithium Battery Module' AND price_ngn = 1420000) OR (id = 'cat-bos' AND sku = 'BOS-PRO' AND name = 'DC/AC Combiner, SPD Protection & Copper Cabling Kit' AND price_ngn = 285000) OR (id = 'cat-rack' AND sku = 'RACK-AL' AND name = 'Anodized Aluminum Roof Mounting Rails & Clamps' AND price_ngn = 195000) OR (id = 'cat-lab' AND sku = 'LAB-INST' AND name = 'Engineering Survey, Installation & Commissioning' AND price_ngn = 320000) OR (id = 'cat-maint' AND sku = 'SRV-MAINT' AND name = 'Preventive Maintenance & Battery Health Audit' AND price_ngn = 85000) OR (id = 'cat-app-ac' AND sku = 'APP-AC15' AND name = '1.5HP Low-Inrush Inverter Split AC' AND price_ngn = 540000) OR (id = 'cat-app-fridge' AND sku = 'APP-FRIDGE' AND name = 'Inverter Refrigerator / Deep Freezer (A++)' AND price_ngn = 485000) OR (id = 'cat-app-pump' AND sku = 'APP-PUMP' AND name = '1HP Solar-Compatible Submersible Borehole Pump' AND price_ngn = 310000)").run();
    db.prepare("DELETE FROM service_tickets WHERE id = 'tkt-1001' AND ticket_code = 'TKT-1001'").run();
    db.prepare("DELETE FROM customer_equipment WHERE (id = 'ceq-1' AND serial_number = 'DEMO-INVERTER-001') OR (id = 'ceq-2' AND serial_number = 'DEMO-BATTERY-001')").run();
    db.prepare("DELETE FROM customer_login_tokens WHERE customer_id IN (SELECT id FROM customer_profiles WHERE id = 'cust-amina' AND email = 'customer@example.invalid')").run();
    db.prepare("DELETE FROM customer_profiles WHERE id = 'cust-amina' AND email = 'customer@example.invalid'").run();
    db.prepare("DELETE FROM enquiries WHERE (id = 'enq-1001' AND ref_code = 'HISO-1001' AND email = 'customer@example.invalid') OR (id = 'enq-1002' AND ref_code = 'HISO-1002' AND email = 'clinic@example.invalid') OR (id = 'enq-1003' AND ref_code = 'HISO-1003' AND email = 'prospect@example.invalid') OR (id = 'enq-1004' AND ref_code = 'HISO-1004' AND email = 'retail@example.invalid')").run();
    db.prepare("DELETE FROM notifications WHERE id IN ('notif-1', 'notif-2', 'notif-tkt-1')").run();
    db.prepare("DELETE FROM audit_logs WHERE id = 'aud-1' AND entity_id = 'JOB-1001'").run();
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  db.exec('COMMIT');
}

function seedIfEmpty(): void {
  removeKnownDemoRecords();
  seedRolesAndMigrateUsers();
}

seedIfEmpty();

const communicationPermissionMigration = 'communications-default-role-permissions-v1';
if (!db.prepare('SELECT id FROM app_migrations WHERE id = ?').get(communicationPermissionMigration)) {
  for (const roleId of ['director', 'admin']) {
    const role = db.prepare('SELECT permissions_json, is_system FROM roles WHERE id = ?')
      .get(roleId) as { permissions_json: string; is_system: number } | undefined;
    if (!role?.is_system) continue;
    const permissions = JSON.parse(role.permissions_json || '[]') as PermissionKey[];
    if (!permissions.includes('manage_communications')) {
      permissions.push('manage_communications');
      db.prepare('UPDATE roles SET permissions_json = ? WHERE id = ?').run(JSON.stringify(permissions), roleId);
    }
  }
  db.prepare('INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)').run(
    communicationPermissionMigration,
    new Date().toISOString()
  );
}

function hydrateStaffRow(row: Record<string, unknown>, rolesMap: Map<string, RoleDefinition>): StaffMember {
  const roleId = String(row.role);
  const roleDef = rolesMap.get(roleId);
  return {
    id: String(row.id),
    name: String(row.name),
    username: row.username ? String(row.username) : undefined,
    email: String(row.email),
    phone: String(row.phone),
    profilePhotoUrl: row.profile_photo_filename
      ? `/api/staff/profile/photo/${encodeURIComponent(String(row.id))}?v=${encodeURIComponent(String(row.profile_photo_filename))}`
      : undefined,
    role: roleId as UserRole,
    roleName: roleDef?.name ?? roleId,
    permissions: roleId === 'superadmin'
      ? ALL_PERMISSIONS.map((p) => p.key)
      : roleDef?.permissions ?? ROLE_DEFAULT_PERMISSIONS[roleId] ?? [],
    title: String(row.title),
    skills: String(row.skills),
    status: row.status as StaffStatus,
    createdAt: String(row.created_at),
    mustSetPassword: Number(row.must_set_password) === 1,
  };
}

export function getAllRoles(): RoleDefinition[] {
  const rows = db.prepare('SELECT * FROM roles ORDER BY is_system DESC, created_at ASC').all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    description: String(r.description || ''),
    permissions: JSON.parse(String(r.permissions_json || '[]')) as PermissionKey[],
    isSystem: Boolean(r.is_system),
    createdAt: String(r.created_at),
  }));
}

export function createNotification(userId: string, title: string, body: string, targetModule: string, targetRef: string): void {
  db.prepare('INSERT INTO notifications (id, user_id, title, body, target_module, target_ref, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)').run(
    crypto.randomUUID(), userId, title, body, targetModule, targetRef, new Date().toISOString()
  );
}

export function notifyRoleMembers(roleIds: string[], title: string, body: string, targetModule: string, targetRef: string): void {
  const placeholders = roleIds.map(() => '?').join(',');
  const users = db.prepare(`SELECT id FROM users WHERE status = 'Active' AND role IN (${placeholders})`).all(...roleIds) as { id: string }[];
  for (const u of users) {
    createNotification(u.id, title, body, targetModule, targetRef);
  }
}

export function writeAudit(actor: { name: string; role: string }, actionType: string, entityType: string, entityId: string, summary: string): void {
  db.prepare('INSERT INTO audit_logs (id, actor_name, actor_role, action_type, entity_type, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), actor.name, actor.role, actionType, entityType, entityId, summary, new Date().toISOString()
  );
}

export function getPublicCatalog(): CatalogItem[] {
  const rows = db.prepare('SELECT * FROM catalog_items ORDER BY item_type, category, price_ngn').all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    sku: String(r.sku),
    name: String(r.name),
    itemType: (String(r.item_type || 'equipment') as CatalogItemType),
    category: String(r.category),
    grade: String(r.grade || 'Standard'),
    unit: String(r.unit),
    priceNgn: Number(r.price_ngn),
    stockQty: Number(r.stock_qty),
    capacityKw: r.capacity_kw !== null ? Number(r.capacity_kw) : null,
    watts: r.watts !== null ? Number(r.watts) : null,
    description: String(r.description || ''),
    imagePath: String(r.image_path),
  }));
}

export function canManagePlatformSettings(user: StaffMember | null): boolean {
  return Boolean(user && (
    user.role === 'superadmin'
    || user.role === 'admin'
    || (hasPermission(user, 'manage_storefront') && hasPermission(user, 'manage_invoices'))
  ));
}

export function getPlatformSettings(): PlatformSettings {
  const catalog = getPublicCatalog();
  const row = db.prepare("SELECT settings_json FROM platform_settings WHERE id = 'global'").get() as
    | { settings_json: string }
    | undefined;
  if (!row) {
    return {
      bankDetails: { bankName: '', accountName: '', accountNumber: '' },
      estimator: defaultEstimatorSettings(catalog),
    };
  }
  const stored = JSON.parse(row.settings_json) as Record<string, unknown>;
  const bank = stored.bankDetails && typeof stored.bankDetails === 'object'
    ? stored.bankDetails as Record<string, unknown>
    : {};
  const bankDetails: BankDetails = {
    bankName: typeof bank.bankName === 'string' ? bank.bankName : '',
    accountName: typeof bank.accountName === 'string' ? bank.accountName : '',
    accountNumber: typeof bank.accountNumber === 'string' ? bank.accountNumber : '',
  };
  return {
    bankDetails,
    estimator: normalizeEstimatorSettings(stored.estimator, catalog),
  };
}

export function getPublicEstimatorSettings(): EstimatorSettings {
  return getPlatformSettings().estimator;
}

export function savePlatformSettings(actor: StaffMember, value: unknown): PlatformSettings {
  if (!value || typeof value !== 'object') throw new Error('Settings data is invalid.');
  const source = value as Record<string, unknown>;
  const bank = source.bankDetails && typeof source.bankDetails === 'object'
    ? source.bankDetails as Record<string, unknown>
    : null;
  if (!bank || typeof bank.bankName !== 'string' || typeof bank.accountName !== 'string'
      || typeof bank.accountNumber !== 'string') {
    throw new Error('Bank details are invalid.');
  }
  const bankDetails: BankDetails = {
    bankName: bank.bankName.trim(),
    accountName: bank.accountName.trim(),
    accountNumber: bank.accountNumber.trim(),
  };
  if (bankDetails.bankName.length > 120 || bankDetails.accountName.length > 120
      || bankDetails.accountNumber.length > 50
      || /[\u0000-\u001f\u007f]/.test(`${bankDetails.bankName}${bankDetails.accountName}${bankDetails.accountNumber}`)) {
    throw new Error('Bank details exceed the allowed length or contain invalid characters.');
  }
  const bankFields = [bankDetails.bankName, bankDetails.accountName, bankDetails.accountNumber];
  if (bankFields.some(Boolean) && bankFields.some((field) => !field)) {
    throw new Error('Provide all bank details, or leave all three fields blank.');
  }

  const catalog = getPublicCatalog();
  const estimatorSource = source.estimator && typeof source.estimator === 'object'
    ? source.estimator as Record<string, unknown>
    : null;
  if (!estimatorSource) throw new Error('Estimator settings are invalid.');
  const categoryKeys = ['inverterCategory', 'batteryCategory', 'panelCategory'] as const;
  for (const key of categoryKeys) {
    if (typeof estimatorSource[key] !== 'string') throw new Error('Select valid Store categories for estimator equipment.');
    const category = estimatorSource[key] as string;
    if (catalog.length > 0 && !catalog.some((item) => item.itemType === 'equipment' && item.category === category)) {
      throw new Error('An estimator equipment category is not present in the Store.');
    }
  }
  const selections: [keyof Pick<EstimatorSettings, 'accessorySkus' | 'installationSkus' | 'logisticsSkus'>, 'equipment' | 'service'][] = [
    ['accessorySkus', 'equipment'],
    ['installationSkus', 'service'],
    ['logisticsSkus', 'service'],
  ];
  for (const [key, itemType] of selections) {
    const selected = estimatorSource[key];
    if (!Array.isArray(selected) || selected.length > 100
        || selected.some((sku) => typeof sku !== 'string'
          || !catalog.some((item) => item.itemType === itemType && item.sku === sku))) {
      throw new Error('Estimator Store item selections are invalid. Refresh the Store and try again.');
    }
  }
  const parallelInverterSkus = estimatorSource.parallelInverterSkus ?? [];
  if (!Array.isArray(parallelInverterSkus) || parallelInverterSkus.length > 100
      || parallelInverterSkus.some((sku) => typeof sku !== 'string'
        || !catalog.some((item) => item.itemType === 'equipment'
          && item.category === estimatorSource.inverterCategory
          && item.sku === sku
          && (item.capacityKw ?? 0) > 0))) {
    throw new Error('Parallel inverter selections must reference capacity-rated items in the selected inverter category.');
  }
  const settings: PlatformSettings = {
    bankDetails,
    estimator: normalizeEstimatorSettings(estimatorSource, catalog),
  };
  db.prepare(
    "INSERT INTO platform_settings (id, settings_json, updated_by, updated_at) VALUES ('global', ?, ?, ?) " +
    'ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at'
  ).run(JSON.stringify(settings), actor.id, new Date().toISOString());
  writeAudit(actor, 'UPDATE_PLATFORM_SETTINGS', 'PlatformSettings', 'global', 'Updated invoice bank details and solar estimator rules.');
  return settings;
}

export function authenticateUser(identifier: string, password: string): { token: string; user: StaffMember } | null {
  const row = db
    .prepare("SELECT * FROM users WHERE (LOWER(email) = ? OR LOWER(username) = ?) AND status = 'Active' LIMIT 1")
    .get(identifier.trim().toLowerCase(), identifier.trim().toLowerCase()) as Record<string, unknown> | undefined;
  if (!row) return null;
  if (Number(row.must_set_password) === 1) return null;
  const storedHash = String(row.password_hash);
  if (!verifyPassword(password, storedHash)) return null;
  if (!storedHash.startsWith('scrypt$')) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), String(row.id));
  }
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, String(row.id), new Date().toISOString());
  const rolesMap = new Map(getAllRoles().map((r) => [r.id, r]));
  return {
    token,
    user: hydrateStaffRow(row, rolesMap),
  };
}

export function getUserBySessionToken(token: string | undefined): StaffMember | null {
  if (!token) return null;
  const row = db
    .prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND u.status = 'Active' LIMIT 1")
    .get(token) as Record<string, unknown> | undefined;
  if (!row) return null;
  const rolesMap = new Map(getAllRoles().map((r) => [r.id, r]));
  return hydrateStaffRow(row, rolesMap);
}

export function saveStaffProfile(staffId: string, payload: {
  name: string;
  phone: string;
  photoDataUrl?: string;
  removePhoto?: boolean;
}): StaffMember {
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const phone = typeof payload.phone === 'string' ? payload.phone.trim() : '';
  if (name.length < 2 || name.length > 120 || /[\r\n]/.test(name)) {
    throw new Error('Enter a name between 2 and 120 characters.');
  }
  if (phone.length > 40 || /[\r\n]/.test(phone)) {
    throw new Error('Enter a valid phone number of at most 40 characters.');
  }
  if (payload.removePhoto && payload.photoDataUrl) {
    throw new Error('Choose a photo or remove the current photo, not both.');
  }

  let newFilename: string | null = null;
  if (payload.photoDataUrl !== undefined) {
    const match = payload.photoDataUrl.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match || payload.photoDataUrl.length > 1_400_000) {
      throw new Error('Choose a compressed JPEG profile photo no larger than 1MB.');
    }
    const binary = Buffer.from(match[1], 'base64');
    const dimensions = getJpegDimensions(binary);
    if (binary.length < 100 || binary.length > 1024 * 1024
        || binary.toString('base64') !== match[1]
        || !dimensions || dimensions.width > 1440 || dimensions.height > 1440
        || dimensions.width * dimensions.height > 2_073_600) {
      throw new Error('The profile photo is invalid, exceeds 1MB, or is larger than 1440px.');
    }
    newFilename = `${crypto.randomUUID()}.jpg`;
    fs.writeFileSync(path.join(STAFF_PROFILE_DIR, newFilename), binary, { flag: 'wx' });
  }

  const existing = db.prepare("SELECT phone, profile_photo_filename FROM users WHERE id = ? AND status = 'Active' LIMIT 1")
    .get(staffId) as { phone: string; profile_photo_filename: string | null } | undefined;
  if (!existing) {
    if (newFilename) fs.unlinkSync(path.join(STAFF_PROFILE_DIR, newFilename));
    throw new Error('Active staff account not found.');
  }

  const nextFilename = newFilename ?? (payload.removePhoto ? null : existing.profile_photo_filename);
  try {
    withTransaction(() => {
      db.prepare("UPDATE users SET name = ?, phone = ?, profile_photo_filename = ? WHERE id = ? AND status = 'Active'")
        .run(name, phone, nextFilename, staffId);
      if (existing.phone.trim() !== phone) {
        db.prepare("UPDATE whatsapp_recipient_consents SET revoked_at = ? WHERE recipient_type = 'staff' AND recipient_id = ? AND revoked_at IS NULL")
          .run(new Date().toISOString(), staffId);
      }
    });
  } catch (error) {
    if (newFilename && fs.existsSync(path.join(STAFF_PROFILE_DIR, newFilename))) {
      fs.unlinkSync(path.join(STAFF_PROFILE_DIR, newFilename));
    }
    throw error;
  }

  if ((newFilename || payload.removePhoto) && existing.profile_photo_filename) {
    const oldFilename = path.basename(existing.profile_photo_filename);
    const oldPath = path.join(STAFF_PROFILE_DIR, oldFilename);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  const row = db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(staffId) as Record<string, unknown>;
  return hydrateStaffRow(row, new Map(getAllRoles().map((role) => [role.id, role])));
}

export function getStaffProfilePhotoFile(staffId: string): { filePath: string; mimeType: string } | null {
  if (!/^[a-f0-9-]{36}$/i.test(staffId)) return null;
  const row = db.prepare("SELECT profile_photo_filename FROM users WHERE id = ? AND status = 'Active' LIMIT 1")
    .get(staffId) as { profile_photo_filename: string | null } | undefined;
  if (!row?.profile_photo_filename || !/^[a-f0-9-]{36}\.jpg$/i.test(row.profile_photo_filename)) return null;
  const filePath = path.join(STAFF_PROFILE_DIR, row.profile_photo_filename);
  return fs.existsSync(filePath) ? { filePath, mimeType: 'image/jpeg' } : null;
}

export function destroySession(token: string | undefined): void {
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
}

export function createPublicEnquiry(payload: {
  customerName: string;
  email: string;
  phone: string;
  location: string;
  channel?: string;
  needSummary: string;
  source?: 'homepage' | 'estimator';
  appliances?: ApplianceItem[];
  estimate?: SolarEstimateResult;
  whatsappUpdatesConsent?: boolean;
  whatsappMarketingConsent?: boolean;
}): { id: string; refCode: string; quoteId?: string; quoteCode?: string } {
  const requestedSource = payload.source
    ?? (payload.estimate && payload.estimate.connectedLoadWatts > 0 ? 'estimator' : 'homepage');
  if (!['homepage', 'estimator'].includes(requestedSource)) {
    throw new Error('Enquiry source is invalid.');
  }
  let appliances: ApplianceItem[] = [];
  let estimate: SolarEstimateResult | null = null;
  if (requestedSource === 'estimator') {
    if (!Array.isArray(payload.appliances) || payload.appliances.length === 0 || payload.appliances.length > 100) {
      throw new Error('An estimator enquiry must include between 1 and 100 appliance items.');
    }
    if (!payload.estimate || typeof payload.estimate !== 'object') {
      throw new Error('An estimator enquiry must include a valid load estimate.');
    }
    appliances = payload.appliances.map((item) => {
      if (!item || typeof item.name !== 'string' || item.name.trim().length === 0
          || item.name.length > 120 || !Number.isFinite(item.qty) || item.qty < 0 || item.qty > 1000
          || !Number.isFinite(item.watts) || item.watts < 0 || item.watts > 100000
          || !Number.isFinite(item.hours) || item.hours < 0 || item.hours > 24) {
        throw new Error('Estimator appliance details are invalid.');
      }
      return {
        id: typeof item.id === 'string' ? item.id.slice(0, 80) : crypto.randomUUID(),
        name: item.name.trim(),
        qty: item.qty,
        watts: item.watts,
        hours: item.hours,
        catalogSku: typeof item.catalogSku === 'string' ? item.catalogSku.slice(0, 80) : undefined,
      };
    });
    if (!appliances.some((item) => item.qty > 0 && item.watts > 0 && item.hours > 0)) {
      throw new Error('Add at least one appliance with a positive quantity, wattage, and usage time.');
    }
    estimate = calculateSolarEstimate(appliances, {
      peakSunHours: payload.estimate.peakSunHours,
      backupShare: payload.estimate.powerMode === 'Off-grid' ? 1 : 0.65,
      powerMode: payload.estimate.powerMode,
      equipmentGrade: payload.estimate.equipmentGrade,
      autonomyHours: payload.estimate.autonomyHours,
      usableDepthPercent: payload.estimate.usableDepthPercent,
    });
    if (estimate.connectedLoadWatts <= 0) throw new Error('The estimator could not calculate a positive connected load.');
  }
  if ((payload.whatsappUpdatesConsent || payload.whatsappMarketingConsent)
      && !/^\+[1-9]\d{7,14}$/.test(payload.phone.trim())) {
    throw new Error('Please use the required country code for the WhatsApp number (for example, +234…).');
  }
  const id = crypto.randomUUID();
  const refCode = nextCode('enquiries', 'ref_code', 'HISO');
  const now = new Date().toISOString();
  let quoteId: string | undefined;
  let quoteCode: string | undefined;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      "INSERT INTO enquiries (id, ref_code, customer_name, email, phone, location, channel, need_summary, appliances_json, estimate_json, status, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin-idee', ?)"
    ).run(
      id,
      refCode,
      payload.customerName.trim(),
      (payload.email || '').trim(),
      payload.phone.trim(),
      payload.location.trim(),
      requestedSource === 'estimator' ? 'Website · Load Estimator' : 'Website · Home Enquiry',
      payload.needSummary.trim(),
      JSON.stringify(appliances),
      estimate ? JSON.stringify(estimate) : null,
      'New',
      now
    );
    if (estimate) {
      const catalog = getPublicCatalog();
      const settings = getPlatformSettings().estimator;
      const cost = computeEstimateCostFromCatalog(estimate, catalog, 7.5, settings);
      estimate.estimatedTotalNgn = cost.total;
      db.prepare('UPDATE enquiries SET estimate_json = ? WHERE id = ?').run(JSON.stringify(estimate), id);
      const lines = buildQuoteLinesFromEstimate(estimate, catalog, settings);
      quoteId = crypto.randomUUID();
      quoteCode = nextCode('quotations', 'quote_code', 'QUO');
      const validUntil = isoDateOffset(7);
      const scope = `Turnkey solar system design and supply for ${payload.location.trim()}.`;
      const note = 'Core equipment estimate only. Accessories, installation, and logistics require director pricing before approval.';
      const revisions = [{
        revisionNo: 1,
        changedBy: 'Estimator',
        note: 'Draft quotation generated from the submitted load estimate.',
        createdAt: now,
        totalNgn: calculateDocumentTotals(lines, 0, 7.5).total,
      }];
      db.prepare(
        'INSERT INTO quotations (id, quote_code, enquiry_id, customer_name, status, revision_no, scope, terms, note, discount_ngn, tax_percent, issued_date, valid_until, approved_by, approved_at, items_json, revisions_json, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 0, 7.5, ?, ?, NULL, NULL, ?, ?, ?)'
      ).run(
        quoteId,
        quoteCode,
        id,
        payload.customerName.trim(),
        'Draft',
        scope,
        '50% deposit on acceptance, 50% prior to commissioning.',
        note,
        isoDateOffset(0),
        validUntil,
        JSON.stringify(lines),
        JSON.stringify(revisions),
        now
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  if (payload.whatsappUpdatesConsent || payload.whatsappMarketingConsent) {
    if (payload.whatsappUpdatesConsent) {
      recordWhatsAppRecipientConsent('enquiry', id, 'operational', payload.phone.trim(), true, 'public_enquiry_form');
    }
    if (payload.whatsappMarketingConsent) {
      recordWhatsAppRecipientConsent('enquiry', id, 'marketing', payload.phone.trim(), true, 'public_enquiry_form');
    }
  }
  notifyRoleMembers(['superadmin', 'director', 'admin'], `New solar enquiry ${refCode}`, `${payload.customerName} (${payload.location}) submitted an enquiry.`, 'enquiries', id);
  writeAudit({ name: payload.customerName, role: 'customer' }, 'CREATE_ENQUIRY', 'Enquiry', refCode, 'Submitted enquiry via website / estimator.');
  return { id, refCode, quoteId, quoteCode };
}

function hydrateStoreOrderRow(r: Record<string, unknown>): StoreOrderRecord {
  return {
    id: String(r.id),
    orderCode: String(r.order_code),
    enquiryId: String(r.enquiry_id),
    refCode: String(r.ref_code),
    customerName: String(r.customer_name),
    email: String(r.email || ''),
    phone: String(r.phone),
    location: String(r.location),
    deliveryAddress: String(r.delivery_address),
    deliveryMethod: String(r.delivery_method) as OrderDeliveryMethod,
    paymentMethod: String(r.payment_method) as OrderPaymentMethod,
    notes: String(r.notes || ''),
    items: JSON.parse(String(r.items_json || '[]')),
    subtotalNgn: Number(r.subtotal_ngn),
    deliveryFeeNgn: Number(r.delivery_fee_ngn),
    taxNgn: Number(r.tax_ngn),
    totalNgn: Number(r.total_ngn),
    status: String(r.status) as StoreOrderStatus,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function createStoreOrder(payload: {
  customerName: string;
  email: string;
  phone: string;
  location: string;
  deliveryAddress: string;
  deliveryMethod: OrderDeliveryMethod;
  paymentMethod: OrderPaymentMethod;
  notes: string;
  items: { sku: string; qty: number }[];
}): { id: string; orderCode: string; refCode: string; totalNgn: number; order: StoreOrderRecord } {
  const catalog = getPublicCatalog();
  const calc = calculateStoreOrderTotals(payload.items ?? [], payload.deliveryMethod, catalog, 7.5);
  if (calc.resolvedItems.length === 0) {
    throw new Error('Your cart is empty. Add at least one Store product or service before checking out.');
  }

  const orderId = crypto.randomUUID();
  const orderCode = nextCode('store_orders', 'order_code', 'ORD');
  const enqId = crypto.randomUUID();
  const refCode = nextCode('enquiries', 'ref_code', 'HISO');
  const now = new Date().toISOString();

  const itemSummary = calc.resolvedItems.map((it) => `${it.qty}× ${it.name}`).join(', ');
  const needSummary = `Store Order ${orderCode} (${payload.deliveryMethod}, ${payload.paymentMethod}): ${itemSummary}`;

  db.prepare(
    "INSERT INTO enquiries (id, ref_code, customer_name, email, phone, location, channel, need_summary, appliances_json, estimate_json, status, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 'Website · Store Order', ?, '[]', NULL, 'New', 'admin-idee', ?)"
  ).run(
    enqId,
    refCode,
    payload.customerName.trim(),
    (payload.email || '').trim(),
    payload.phone.trim(),
    payload.location.trim(),
    needSummary,
    now
  );

  db.prepare(
    'INSERT INTO store_orders (id, order_code, enquiry_id, ref_code, customer_name, email, phone, location, delivery_address, delivery_method, payment_method, notes, items_json, subtotal_ngn, delivery_fee_ngn, tax_ngn, total_ngn, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    orderId,
    orderCode,
    enqId,
    refCode,
    payload.customerName.trim(),
    (payload.email || '').trim(),
    payload.phone.trim(),
    payload.location.trim(),
    payload.deliveryAddress.trim(),
    payload.deliveryMethod,
    payload.paymentMethod,
    (payload.notes || '').trim(),
    JSON.stringify(calc.resolvedItems),
    calc.subtotalNgn,
    calc.deliveryFeeNgn,
    calc.taxNgn,
    calc.totalNgn,
    'Pending',
    now,
    now
  );

  notifyRoleMembers(
    ['superadmin', 'director', 'admin'],
    `New Store Order ${orderCode}`,
    `${payload.customerName.trim()} (${payload.location.trim()}) placed an order totaling ₦${calc.totalNgn.toLocaleString()}.`,
    'orders',
    orderCode
  );
  writeAudit(
    { name: payload.customerName.trim(), role: 'customer' },
    'CREATE_ORDER',
    'StoreOrder',
    orderCode,
    `Placed Store order ${orderCode} (${refCode}) for ₦${calc.totalNgn.toLocaleString()}.`
  );

  const row = db.prepare('SELECT * FROM store_orders WHERE id = ?').get(orderId) as Record<string, unknown>;
  return {
    id: orderId,
    orderCode,
    refCode,
    totalNgn: calc.totalNgn,
    order: hydrateStoreOrderRow(row),
  };
}

export function updateStoreOrderStatus(
  actor: StaffMember,
  body: { orderId: string; status: StoreOrderStatus; notes?: string }
): void {
  if (!['Pending', 'Confirmed', 'Dispatched', 'Delivered', 'Cancelled'].includes(body.status)) {
    throw new Error('Store order status is invalid.');
  }
  const existing = db.prepare('SELECT * FROM store_orders WHERE id = ? LIMIT 1').get(body.orderId) as Record<string, unknown> | undefined;
  if (!existing) throw new Error('Store order not found.');
  const now = new Date().toISOString();
  const nextNotes = body.notes !== undefined ? body.notes.trim() : String(existing.notes || '');
  const invoicePaid = db.prepare(
    "SELECT EXISTS(SELECT 1 FROM invoices i WHERE i.enquiry_id=? AND i.status='Completed') AS paid"
  ).get(String(existing.enquiry_id)) as { paid: number };
  const savedStatus: StoreOrderStatus = body.status === 'Delivered' && invoicePaid.paid ? 'Completed' : body.status;
  db.prepare('UPDATE store_orders SET status = ?, notes = ?, updated_at = ? WHERE id = ?').run(
    savedStatus,
    nextNotes,
    now,
    body.orderId
  );
  writeAudit(actor, 'UPDATE_ORDER', 'StoreOrder', String(existing.order_code), `Marked Store order ${existing.order_code} as ${body.status}.`);
}

export function getPublicTracking(refCode: string, customerEmail?: string) {
  const cleanRef = refCode.trim().toUpperCase();
  let orderRow = db.prepare('SELECT * FROM store_orders WHERE UPPER(order_code) = ? LIMIT 1').get(cleanRef) as Record<string, unknown> | undefined;
  let enq = orderRow
    ? (db.prepare('SELECT * FROM enquiries WHERE id = ? LIMIT 1').get(String(orderRow.enquiry_id)) as Record<string, unknown> | undefined)
    : (db.prepare('SELECT * FROM enquiries WHERE UPPER(ref_code) = ? LIMIT 1').get(cleanRef) as Record<string, unknown> | undefined);

  if (!enq) return null;
  if (!orderRow) {
    orderRow = db.prepare('SELECT * FROM store_orders WHERE enquiry_id = ? ORDER BY created_at DESC LIMIT 1').get(String(enq.id)) as Record<string, unknown> | undefined;
  }
  if (customerEmail !== undefined) {
    if (!customerEmailMatches(customerEmail, String(enq.email || ''))) return null;
    if (orderRow?.email && !customerEmailMatches(customerEmail, String(orderRow.email))) return null;
  }

  const quote = db
    .prepare("SELECT id, quote_code, status, revision_no, valid_until FROM quotations WHERE enquiry_id = ? AND status IN ('Approved','Invoiced') ORDER BY created_at DESC LIMIT 1")
    .get(String(enq.id)) as Record<string, unknown> | undefined;

  const inv = db
    .prepare('SELECT id, invoice_code, total_ngn, customer_accepted, due_date FROM invoices WHERE enquiry_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(String(enq.id)) as Record<string, unknown> | undefined;

  let confirmedPaid = 0;
  if (inv) {
    const p = db
      .prepare("SELECT COALESCE(SUM(amount_ngn),0) AS paid FROM payments WHERE invoice_id = ? AND status = 'Confirmed'")
      .get(String(inv.id)) as { paid: number };
    confirmedPaid = Number(p.paid);
  }

  const job = db.prepare('SELECT * FROM installations WHERE enquiry_id = ? LIMIT 1').get(String(enq.id)) as Record<string, unknown> | undefined;
  let installation = null;
  if (job) {
    const updRows = db
      .prepare('SELECT * FROM installation_updates WHERE installation_id = ? AND is_customer_visible = 1 ORDER BY created_at DESC')
      .all(String(job.id)) as Record<string, unknown>[];
    const updates = updRows.map((u) => {
      const photos = (db.prepare('SELECT id, original_name, created_at FROM installation_photos WHERE update_id = ?').all(String(u.id)) as Record<string, unknown>[]).map((ph) => ({
        id: String(ph.id),
        fileUrl: `/api/files/${ph.id}`,
        originalName: String(ph.original_name),
        createdAt: String(ph.created_at),
      }));
      return {
        id: String(u.id),
        stageNumber: Number(u.stage_number),
        activityTitle: String(u.activity_title),
        reportText: String(u.report_text),
        createdAt: String(u.created_at),
        photos,
      };
    });
    installation = {
      jobCode: String(job.job_code),
      systemSummary: String(job.system_summary),
      currentStage: Number(job.current_stage),
      targetDate: String(job.target_date),
      updates,
    };
  }

  return {
    enquiry: {
      refCode: String(enq.ref_code),
      customerName: String(enq.customer_name),
      location: String(enq.location),
      status: String(enq.status),
      createdAt: String(enq.created_at),
      estimate: enq.estimate_json ? JSON.parse(String(enq.estimate_json)) : null,
    },
    quotation: quote
      ? {
          id: String(quote.id),
          quoteCode: String(quote.quote_code),
          status: String(quote.status),
          revisionNo: Number(quote.revision_no),
          validUntil: String(quote.valid_until),
        }
      : null,
    invoice: inv
      ? {
          id: String(inv.id),
          invoiceCode: String(inv.invoice_code),
          totalNgn: Number(inv.total_ngn),
          status: String(inv.status || 'Pending'),
          confirmedPaidNgn: confirmedPaid,
          balanceNgn: Math.max(0, Number(inv.total_ngn) - confirmedPaid),
          customerAccepted: Boolean(inv.customer_accepted),
          dueDate: String(inv.due_date),
        }
      : null,
    installation,
    order: orderRow ? hydrateStoreOrderRow(orderRow) : null,
  };
}

export function getPublicDocument(type: 'quote' | 'invoice', idOrCode: string, customerEmail?: string) {
  if (type === 'invoice') {
    const row = customerEmail === undefined
      ? db.prepare('SELECT i.*, e.location, e.phone, e.email, e.ref_code FROM invoices i JOIN enquiries e ON e.id = i.enquiry_id WHERE i.id = ? OR i.invoice_code = ? LIMIT 1')
        .get(idOrCode, idOrCode) as Record<string, unknown> | undefined
      : db.prepare('SELECT i.*, e.location, e.phone, e.email, e.ref_code FROM invoices i JOIN enquiries e ON e.id = i.enquiry_id WHERE (i.id = ? OR i.invoice_code = ?) AND LOWER(e.email) = LOWER(?) LIMIT 1')
        .get(idOrCode, idOrCode, customerEmail) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      type: 'invoice' as const,
      documentCode: String(row.invoice_code),
      customerName: String(row.customer_name),
      location: String(row.location),
      phone: String(row.phone),
      email: String(row.email),
      refCode: String(row.ref_code),
      issuedDate: String(row.issued_date),
      dueDate: String(row.due_date),
      discountNgn: Number(row.discount_ngn),
      taxPercent: Number(row.tax_percent),
      totalNgn: Number(row.total_ngn),
      bankDetails: JSON.parse(String(row.bank_details_json)),
      customerAccepted: Boolean(row.customer_accepted),
      items: JSON.parse(String(row.items_json)),
    };
  }
  const row = customerEmail === undefined
    ? db.prepare('SELECT q.*, e.location, e.phone, e.email, e.ref_code FROM quotations q JOIN enquiries e ON e.id = q.enquiry_id WHERE q.id = ? OR q.quote_code = ? LIMIT 1')
      .get(idOrCode, idOrCode) as Record<string, unknown> | undefined
    : db.prepare("SELECT q.*, e.location, e.phone, e.email, e.ref_code FROM quotations q JOIN enquiries e ON e.id = q.enquiry_id WHERE (q.id = ? OR q.quote_code = ?) AND LOWER(e.email) = LOWER(?) AND q.status IN ('Approved', 'Invoiced') LIMIT 1")
      .get(idOrCode, idOrCode, customerEmail) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    type: 'quote' as const,
    documentCode: String(row.quote_code),
    revisionNo: Number(row.revision_no),
    status: String(row.status),
    customerName: String(row.customer_name),
    location: String(row.location),
    phone: String(row.phone),
    email: String(row.email),
    refCode: String(row.ref_code),
    scope: String(row.scope),
    terms: String(row.terms),
    note: String(row.note),
    issuedDate: String(row.issued_date),
    validUntil: String(row.valid_until),
    discountNgn: Number(row.discount_ngn),
    taxPercent: Number(row.tax_percent),
    approvedBy: row.approved_by ? String(row.approved_by) : null,
    items: JSON.parse(String(row.items_json)),
  };
}

export function acceptInvoiceByCustomer(invoiceId: string, customerEmail: string): boolean {
  const result = db.prepare(
    'UPDATE invoices SET customer_accepted = 1, accepted_at = ? WHERE (id = ? OR invoice_code = ?) AND EXISTS (SELECT 1 FROM enquiries e WHERE e.id = invoices.enquiry_id AND LOWER(e.email) = LOWER(?))'
  ).run(new Date().toISOString(), invoiceId, invoiceId, customerEmail);
  return result.changes === 1;
}

// --- Customer Portal Operations ---
function getCustomerEquipmentList(customerId: string): CustomerEquipment[] {
  return (db.prepare('SELECT * FROM customer_equipment WHERE customer_id = ? ORDER BY created_at DESC').all(customerId) as Record<string, unknown>[]).map((r) => {
    const equipmentId = String(r.id);
    const photos = (db.prepare('SELECT * FROM customer_equipment_photos WHERE equipment_id = ? AND customer_id = ? ORDER BY created_at DESC').all(equipmentId, customerId) as Record<string, unknown>[]).map((photo) => ({
      id: String(photo.id),
      fileUrl: `/api/customer-equipment-photo/${encodeURIComponent(String(photo.id))}`,
      originalName: String(photo.original_name),
      createdAt: String(photo.created_at),
    }));
    return {
      id: equipmentId,
      customerId: String(r.customer_id),
      equipmentType: String(r.equipment_type),
      brandModel: String(r.brand_model),
      serialNumber: String(r.serial_number),
      capacityKw: String(r.capacity_kw),
      installDate: String(r.install_date),
      notes: String(r.notes),
      createdAt: String(r.created_at),
      photos,
    };
  });
}

function hydrateTicketRow(r: Record<string, unknown>): ServiceTicket {
  return {
    id: String(r.id),
    ticketCode: String(r.ticket_code),
    customerId: String(r.customer_id),
    customerName: String(r.customer_name),
    customerPhone: String(r.customer_phone),
    location: String(r.location),
    equipmentId: r.equipment_id ? String(r.equipment_id) : null,
    equipmentSummary: String(r.equipment_summary || ''),
    category: r.category as TicketCategory,
    priority: (String(r.priority || 'Normal') as 'Normal' | 'Urgent'),
    subject: String(r.subject),
    description: String(r.description),
    status: r.status as TicketStatus,
    assignedTechId: r.assigned_tech_id ? String(r.assigned_tech_id) : null,
    assignedTechName: r.assigned_tech_name ? String(r.assigned_tech_name) : null,
    resolutionNote: String(r.resolution_note || ''),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function customerPortalData(customerId: string): {
  profile: CustomerProfile;
  equipment: CustomerEquipment[];
  tickets: ServiceTicket[];
} {
  const row = db
    .prepare('SELECT * FROM customer_profiles WHERE id = ? AND email_verified_at IS NOT NULL AND must_set_password = 0 LIMIT 1')
    .get(customerId) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Verified customer profile not found.');
  const profile: CustomerProfile = {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    phone: String(row.phone),
    location: String(row.location),
    company: String(row.company),
    refCode: String(row.ref_code),
    createdAt: String(row.created_at),
    emailMarketingConsent: hasCustomerConsent(customerId, 'email'),
    whatsappMarketingConsent: hasCustomerConsent(customerId, 'whatsapp'),
    whatsappUpdatesConsent: hasWhatsAppRecipientConsent('customer', customerId, 'operational'),
  };
  const equipment = getCustomerEquipmentList(customerId);
  const tickets = (
    db.prepare('SELECT * FROM service_tickets WHERE customer_id = ? ORDER BY created_at DESC').all(customerId) as Record<string, unknown>[]
  ).map(hydrateTicketRow);
  return { profile, equipment, tickets };
}

function hasCustomerConsent(customerId: string, channel: 'email' | 'whatsapp'): boolean {
  const consent = db.prepare(
    'SELECT consented_at, revoked_at FROM communications_consents WHERE customer_id = ? AND channel = ? LIMIT 1'
  ).get(customerId, channel) as { consented_at: string | null; revoked_at: string | null } | undefined;
  return Boolean(consent?.consented_at && !consent.revoked_at);
}

function hasWhatsAppRecipientConsent(
  recipientType: 'customer' | 'staff' | 'enquiry',
  recipientId: string,
  purpose: 'operational' | 'marketing',
): boolean {
  const consent = db.prepare(
    'SELECT consented_at, revoked_at, phone_at_consent FROM whatsapp_recipient_consents WHERE recipient_type = ? AND recipient_id = ? AND purpose = ?'
  ).get(recipientType, recipientId, purpose) as { consented_at: string; revoked_at: string | null; phone_at_consent: string } | undefined;
  const table = recipientType === 'customer' ? 'customer_profiles' : recipientType === 'staff' ? 'users' : 'enquiries';
  const phoneRow = db.prepare(`SELECT phone FROM ${table} WHERE id = ? LIMIT 1`).get(recipientId) as { phone: string } | undefined;
  return Boolean(consent?.consented_at && !consent.revoked_at && phoneRow?.phone === consent.phone_at_consent);
}

function recordWhatsAppRecipientConsent(
  recipientType: 'customer' | 'staff' | 'enquiry',
  recipientId: string,
  purpose: 'operational' | 'marketing',
  phone: string,
  enabled: boolean,
  source: string,
): void {
  const now = new Date().toISOString();
  const existing = db.prepare(
    'SELECT phone_at_consent, consented_at, revoked_at FROM whatsapp_recipient_consents WHERE recipient_type = ? AND recipient_id = ? AND purpose = ?'
  ).get(recipientType, recipientId, purpose) as { phone_at_consent: string; consented_at: string; revoked_at: string | null } | undefined;

  if (!enabled) {
    if (existing && !existing.revoked_at) {
      db.prepare(
        'UPDATE whatsapp_recipient_consents SET revoked_at = ? WHERE recipient_type = ? AND recipient_id = ? AND purpose = ?'
      ).run(now, recipientType, recipientId, purpose);
    }
    return;
  }

  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Please use the required country code for the WhatsApp number (for example, +234…).');
  db.prepare(
    'INSERT INTO whatsapp_recipient_consents (recipient_type, recipient_id, purpose, phone_at_consent, consented_at, revoked_at, consent_source) VALUES (?, ?, ?, ?, ?, NULL, ?) ' +
    'ON CONFLICT(recipient_type, recipient_id, purpose) DO UPDATE SET phone_at_consent = excluded.phone_at_consent, consented_at = CASE WHEN whatsapp_recipient_consents.revoked_at IS NOT NULL OR whatsapp_recipient_consents.phone_at_consent <> excluded.phone_at_consent THEN excluded.consented_at ELSE whatsapp_recipient_consents.consented_at END, revoked_at = NULL, consent_source = excluded.consent_source'
  ).run(recipientType, recipientId, purpose, phone, now, source);
}

export function updateCustomerWhatsAppUpdates(customerId: string, enabled: boolean): void {
  const customer = db.prepare('SELECT phone FROM customer_profiles WHERE id = ? AND email_verified_at IS NOT NULL LIMIT 1')
    .get(customerId) as { phone: string } | undefined;
  if (!customer) throw new Error('Verified customer profile not found.');
  recordWhatsAppRecipientConsent('customer', customerId, 'operational', customer.phone.trim(), enabled, 'customer_portal');
}

export function updateStaffWhatsAppConsents(
  staffId: string,
  consent: { operational: boolean; marketing: boolean },
): { operational: boolean; marketing: boolean } {
  const staff = db.prepare("SELECT phone FROM users WHERE id = ? AND status = 'Active' LIMIT 1").get(staffId) as { phone: string } | undefined;
  if (!staff) throw new Error('Active staff account not found.');
  if ((consent.operational || consent.marketing) && !/^\+[1-9]\d{7,14}$/.test(staff.phone.trim())) {
    throw new Error('Please use the required country code in your staff phone number before opting in to WhatsApp.');
  }
  recordWhatsAppRecipientConsent('staff', staffId, 'operational', staff.phone.trim(), consent.operational, 'staff_self_service');
  recordWhatsAppRecipientConsent('staff', staffId, 'marketing', staff.phone.trim(), consent.marketing, 'staff_self_service');
  return consent;
}

export function getStaffWhatsAppConsents(staffId: string): { operational: boolean; marketing: boolean; phone: string } {
  const staff = db.prepare("SELECT phone FROM users WHERE id = ? AND status = 'Active' LIMIT 1").get(staffId) as { phone: string } | undefined;
  if (!staff) return { operational: false, marketing: false, phone: '' };
  const active = (purpose: 'operational' | 'marketing') => {
    const row = db.prepare(
      'SELECT consented_at, revoked_at, phone_at_consent FROM whatsapp_recipient_consents WHERE recipient_type = ? AND recipient_id = ? AND purpose = ?'
    ).get('staff', staffId, purpose) as { consented_at: string; revoked_at: string | null; phone_at_consent: string } | undefined;
    return Boolean(row?.consented_at && !row.revoked_at && row.phone_at_consent === staff.phone && /^\+[1-9]\d{7,14}$/.test(staff.phone));
  };
  return { operational: active('operational'), marketing: active('marketing'), phone: staff.phone };
}

export function listWhatsAppConsentContacts(purpose: 'operational' | 'marketing') {
  const rows = purpose === 'marketing'
    ? db.prepare(
      `SELECT c.id, c.name, c.email, c.phone, 'customer' AS recipient_type FROM customer_profiles c ` +
      'JOIN communications_consents x ON x.customer_id = c.id ' +
      `WHERE x.channel = 'whatsapp' AND x.consented_at IS NOT NULL AND x.revoked_at IS NULL ` +
      `AND c.email_verified_at IS NOT NULL AND c.phone <> '' ` +
      `UNION ALL SELECT u.id, u.name, u.email, u.phone, 'staff' AS recipient_type FROM users u ` +
      `JOIN whatsapp_recipient_consents x ON x.recipient_type = 'staff' AND x.recipient_id = u.id ` +
      `AND x.purpose = 'marketing' AND x.revoked_at IS NULL AND x.phone_at_consent = u.phone ` +
      `WHERE u.status = 'Active' AND u.phone <> '' ` +
      `UNION ALL SELECT e.id, e.customer_name AS name, e.email, e.phone, 'enquiry' AS recipient_type FROM enquiries e ` +
      `JOIN whatsapp_recipient_consents x ON x.recipient_type = 'enquiry' AND x.recipient_id = e.id ` +
      `AND x.purpose = 'marketing' AND x.revoked_at IS NULL AND x.phone_at_consent = e.phone WHERE e.phone <> '' ORDER BY name`
    ).all()
    : db.prepare(
      'SELECT x.recipient_id AS id, u.name, u.email, u.phone, x.recipient_type FROM whatsapp_recipient_consents x ' +
      `JOIN users u ON x.recipient_type = 'staff' AND x.recipient_id = u.id ` +
      `WHERE x.purpose = 'operational' AND x.revoked_at IS NULL AND x.phone_at_consent = u.phone AND u.status = 'Active' ` +
      'UNION ALL SELECT x.recipient_id AS id, e.customer_name AS name, e.email, e.phone, x.recipient_type FROM whatsapp_recipient_consents x ' +
      `JOIN enquiries e ON x.recipient_type = 'enquiry' AND x.recipient_id = e.id ` +
      `WHERE x.purpose = 'operational' AND x.revoked_at IS NULL AND x.phone_at_consent = e.phone ` +
      'UNION ALL SELECT x.recipient_id AS id, c.name, c.email, c.phone, x.recipient_type FROM whatsapp_recipient_consents x ' +
      `JOIN customer_profiles c ON x.recipient_type = 'customer' AND x.recipient_id = c.id ` +
      `WHERE x.purpose = 'operational' AND x.revoked_at IS NULL AND x.phone_at_consent = c.phone AND c.email_verified_at IS NOT NULL ORDER BY name`
    ).all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    email: String(row.email || ''),
    phone: String(row.phone || ''),
    recipientType: String(row.recipient_type) as 'customer' | 'staff' | 'enquiry',
  })).filter((row) => /^\+[1-9]\d{7,14}$/.test(row.phone));
}

export function getWhatsAppConsentContact(
  recipientType: 'customer' | 'staff' | 'enquiry',
  recipientId: string,
  purpose: 'operational' | 'marketing',
  includeInvalidPhone = false,
) {
  const row = purpose === 'marketing' && recipientType === 'customer'
    ? db.prepare(
      `SELECT c.id, c.name, c.email, c.phone, 'customer' AS recipient_type FROM customer_profiles c ` +
      `JOIN communications_consents x ON x.customer_id = c.id AND x.channel = 'whatsapp' ` +
      `WHERE c.id = ? AND c.email_verified_at IS NOT NULL AND c.phone <> '' ` +
      'AND x.consented_at IS NOT NULL AND x.revoked_at IS NULL LIMIT 1'
    ).get(recipientId)
    : purpose === 'marketing' && recipientType === 'staff'
      ? db.prepare(
        `SELECT u.id, u.name, u.email, u.phone, 'staff' AS recipient_type FROM users u ` +
        `JOIN whatsapp_recipient_consents x ON x.recipient_type = 'staff' AND x.recipient_id = u.id ` +
        `WHERE u.id = ? AND u.status = 'Active' AND u.phone <> '' AND x.purpose = 'marketing' ` +
        'AND x.revoked_at IS NULL AND x.phone_at_consent = u.phone LIMIT 1'
      ).get(recipientId)
      : purpose === 'marketing'
        ? db.prepare(
          `SELECT e.id, e.customer_name AS name, e.email, e.phone, 'enquiry' AS recipient_type FROM enquiries e ` +
          `JOIN whatsapp_recipient_consents x ON x.recipient_type = 'enquiry' AND x.recipient_id = e.id ` +
          `WHERE e.id = ? AND e.phone <> '' AND x.purpose = 'marketing' ` +
          'AND x.revoked_at IS NULL AND x.phone_at_consent = e.phone LIMIT 1'
        ).get(recipientId)
        : recipientType === 'customer'
          ? db.prepare(
            `SELECT c.id, c.name, c.email, c.phone, 'customer' AS recipient_type FROM customer_profiles c ` +
            `JOIN whatsapp_recipient_consents x ON x.recipient_type = 'customer' AND x.recipient_id = c.id ` +
            `WHERE c.id = ? AND c.email_verified_at IS NOT NULL AND c.phone <> '' AND x.purpose = 'operational' ` +
            'AND x.revoked_at IS NULL AND x.phone_at_consent = c.phone LIMIT 1'
          ).get(recipientId)
          : recipientType === 'staff'
            ? db.prepare(
              `SELECT u.id, u.name, u.email, u.phone, 'staff' AS recipient_type FROM users u ` +
              `JOIN whatsapp_recipient_consents x ON x.recipient_type = 'staff' AND x.recipient_id = u.id ` +
              `WHERE u.id = ? AND u.status = 'Active' AND u.phone <> '' AND x.purpose = 'operational' ` +
              'AND x.revoked_at IS NULL AND x.phone_at_consent = u.phone LIMIT 1'
            ).get(recipientId)
            : db.prepare(
              `SELECT e.id, e.customer_name AS name, e.email, e.phone, 'enquiry' AS recipient_type FROM enquiries e ` +
              `JOIN whatsapp_recipient_consents x ON x.recipient_type = 'enquiry' AND x.recipient_id = e.id ` +
              `WHERE e.id = ? AND e.phone <> '' AND x.purpose = 'operational' ` +
              'AND x.revoked_at IS NULL AND x.phone_at_consent = e.phone LIMIT 1'
            ).get(recipientId);
  if (!row) return null;
  const contact = row as { id: string; name: string; email: string; phone: string; recipient_type: string };
  if (!includeInvalidPhone && !/^\+[1-9]\d{7,14}$/.test(contact.phone)) return null;
  return {
    id: String(contact.id),
    name: String(contact.name),
    email: String(contact.email || ''),
    phone: String(contact.phone),
    recipientType: contact.recipient_type as 'customer' | 'staff' | 'enquiry',
  };
}

export function getLifecycleWhatsAppRecipients(
  entity: 'enquiry' | 'quote' | 'invoice' | 'ticket' | 'installation',
  entityId: string,
): ReturnType<typeof listWhatsAppConsentContacts> {
  let enquiryId: string | null = null;
  let customerId: string | null = null;
  if (entity === 'enquiry') {
    enquiryId = entityId;
  } else if (entity === 'quote') {
    const row = db.prepare('SELECT enquiry_id FROM quotations WHERE id = ? OR quote_code = ? LIMIT 1').get(entityId, entityId) as { enquiry_id: string } | undefined;
    enquiryId = row?.enquiry_id ?? null;
  } else if (entity === 'invoice') {
    const row = db.prepare('SELECT enquiry_id FROM invoices WHERE id = ? OR invoice_code = ? LIMIT 1').get(entityId, entityId) as { enquiry_id: string } | undefined;
    enquiryId = row?.enquiry_id ?? null;
  } else if (entity === 'ticket') {
    const row = db.prepare('SELECT customer_id FROM service_tickets WHERE id = ? OR ticket_code = ? LIMIT 1').get(entityId, entityId) as { customer_id: string } | undefined;
    customerId = row?.customer_id ?? null;
  } else {
    const row = db.prepare('SELECT enquiry_id FROM installations WHERE id = ? OR job_code = ? LIMIT 1').get(entityId, entityId) as { enquiry_id: string } | undefined;
    enquiryId = row?.enquiry_id ?? null;
  }

  const recipients = listWhatsAppConsentContacts('operational');
  if (entity === 'enquiry') {
    return [
      ...recipients.filter((contact) => contact.recipientType === 'staff'),
      ...recipients.filter((contact) => contact.recipientType === 'enquiry' && contact.id === entityId),
    ];
  }
  if (enquiryId) {
    const enquiryRecipient = recipients.find((contact) => contact.recipientType === 'enquiry' && contact.id === enquiryId);
    if (enquiryRecipient) return [enquiryRecipient];
    const enquiry = db.prepare('SELECT email FROM enquiries WHERE id = ?').get(enquiryId) as { email: string } | undefined;
    const customer = enquiry?.email
      ? db.prepare('SELECT id FROM customer_profiles WHERE LOWER(email) = LOWER(?) AND email_verified_at IS NOT NULL LIMIT 1').get(enquiry.email) as { id: string } | undefined
      : undefined;
    const customerRecipient = customer
      ? recipients.find((contact) => contact.recipientType === 'customer' && contact.id === customer.id)
      : undefined;
    return customerRecipient ? [customerRecipient] : [];
  }
  if (customerId) {
    const customerRecipient = recipients.find((contact) => contact.recipientType === 'customer' && contact.id === customerId);
    return customerRecipient ? [customerRecipient] : [];
  }
  return [];
}

export function getLifecycleNotificationTargets(
  entity: 'enquiry' | 'quote' | 'invoice' | 'ticket' | 'installation',
  entityId: string,
): {
  recipientType: 'customer' | 'staff' | 'enquiry';
  recipientId: string;
  name: string;
  email: string;
  phone: string;
  whatsappOperational: boolean;
  pushOwnerType: 'customer' | 'staff' | null;
  pushOwnerId: string | null;
}[] {
  const targets: {
    recipientType: 'customer' | 'staff' | 'enquiry';
    recipientId: string;
    name: string;
    email: string;
    phone: string;
    whatsappOperational: boolean;
    pushOwnerType: 'customer' | 'staff' | null;
    pushOwnerId: string | null;
  }[] = [];

  const addTarget = (
    recipientType: 'customer' | 'staff' | 'enquiry',
    row: { id: string; name: string; email: string; phone: string },
    pushOwnerType: 'customer' | 'staff' | null = recipientType === 'enquiry' ? null : recipientType,
    pushOwnerId: string | null = recipientType === 'enquiry' ? null : row.id,
  ) => {
    targets.push({
      recipientType,
      recipientId: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      whatsappOperational: hasWhatsAppRecipientConsent(recipientType, row.id, 'operational'),
      pushOwnerType,
      pushOwnerId,
    });
  };

  if (entity === 'enquiry') {
    const enquiry = db.prepare('SELECT id, customer_name AS name, email, phone FROM enquiries WHERE id = ? LIMIT 1')
      .get(entityId) as { id: string; name: string; email: string; phone: string } | undefined;
    if (enquiry) addTarget('enquiry', enquiry);
    const staff = db.prepare("SELECT id, name, email, phone FROM users WHERE status = 'Active' AND role IN ('admin','director','superadmin')")
      .all() as { id: string; name: string; email: string; phone: string }[];
    for (const person of staff) addTarget('staff', person);
  } else if (entity === 'ticket') {
    const row = db.prepare(
      'SELECT c.id, c.name, c.email, c.phone, t.assigned_tech_id FROM service_tickets t JOIN customer_profiles c ON c.id = t.customer_id ' +
      'WHERE t.id = ? OR t.ticket_code = ? LIMIT 1'
    ).get(entityId, entityId) as { id: string; name: string; email: string; phone: string; assigned_tech_id: string | null } | undefined;
    if (row) {
      addTarget('customer', row);
      if (row.assigned_tech_id) {
        const technician = db.prepare("SELECT id, name, email, phone FROM users WHERE id=? AND status='Active' LIMIT 1")
          .get(row.assigned_tech_id) as { id: string; name: string; email: string; phone: string } | undefined;
        if (technician) addTarget('staff', technician);
      }
    }
  } else {
    let enquiryId: string | undefined;
    let assignedEngineerId: string | null = null;
    if (entity === 'quote') {
      enquiryId = (db.prepare('SELECT enquiry_id FROM quotations WHERE id = ? OR quote_code = ? LIMIT 1')
        .get(entityId, entityId) as { enquiry_id: string } | undefined)?.enquiry_id;
    } else if (entity === 'invoice') {
      enquiryId = (db.prepare('SELECT enquiry_id FROM invoices WHERE id = ? OR invoice_code = ? LIMIT 1')
        .get(entityId, entityId) as { enquiry_id: string } | undefined)?.enquiry_id;
    } else {
      const installation = db.prepare('SELECT enquiry_id, assigned_engineer_id FROM installations WHERE id = ? OR job_code = ? LIMIT 1')
        .get(entityId, entityId) as { enquiry_id: string; assigned_engineer_id: string | null } | undefined;
      enquiryId = installation?.enquiry_id;
      assignedEngineerId = installation?.assigned_engineer_id ?? null;
    }
    if (enquiryId) {
      const enquiry = db.prepare('SELECT id, customer_name AS name, email, phone FROM enquiries WHERE id = ? LIMIT 1')
        .get(enquiryId) as { id: string; name: string; email: string; phone: string } | undefined;
      if (enquiry) {
        const customer = enquiry.email
          ? db.prepare('SELECT id, name, email, phone FROM customer_profiles WHERE LOWER(email) = LOWER(?) AND email_verified_at IS NOT NULL LIMIT 1')
            .get(enquiry.email) as { id: string; name: string; email: string; phone: string } | undefined
          : undefined;
        if (customer) addTarget('customer', customer);
        else addTarget('enquiry', enquiry);
      }
    }
    if (entity === 'invoice') {
      const staff = db.prepare("SELECT id, name, email, phone FROM users WHERE status='Active' AND role IN ('admin','director','superadmin')")
        .all() as { id: string; name: string; email: string; phone: string }[];
      for (const person of staff) addTarget('staff', person);
    }
    if (assignedEngineerId) {
      const engineer = db.prepare("SELECT id, name, email, phone FROM users WHERE id=? AND status='Active' LIMIT 1")
        .get(assignedEngineerId) as { id: string; name: string; email: string; phone: string } | undefined;
      if (engineer) addTarget('staff', engineer);
    }
  }
  return targets;
}

export function logCommunicationDelivery(event: {
  eventKey: string;
  recipientType: 'customer' | 'staff' | 'enquiry';
  recipientId: string;
  channel: 'email' | 'push' | 'whatsapp';
  status: 'sent' | 'not_configured' | 'failed' | 'skipped';
  errorCode?: string;
}): void {
  db.prepare(
    'INSERT INTO communications_delivery_events (id, event_key, recipient_type, recipient_id, channel, status, error_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), event.eventKey, event.recipientType, event.recipientId, event.channel, event.status, event.errorCode ?? null, new Date().toISOString());
}

export function updateCustomerConsents(customerId: string, consent: { email: boolean; whatsapp: boolean }): void {
  const now = new Date().toISOString();
  const statement = db.prepare(
    'INSERT INTO communications_consents (customer_id, channel, consented_at, revoked_at, updated_at) VALUES ($customerId, $channel, $consentedAt, $revokedAt, $updatedAt) ' +
    'ON CONFLICT(customer_id, channel) DO UPDATE SET consented_at = excluded.consented_at, revoked_at = excluded.revoked_at, updated_at = excluded.updated_at'
  );
  for (const [channel, enabled] of [['email', consent.email], ['whatsapp', consent.whatsapp]] as const) {
    const existing = db.prepare('SELECT consented_at, revoked_at FROM communications_consents WHERE customer_id = ? AND channel = ?')
      .get(customerId, channel) as { consented_at: string | null; revoked_at: string | null } | undefined;
    const alreadyActive = Boolean(existing?.consented_at && !existing.revoked_at);
    statement.run({
      $customerId: customerId,
      $channel: channel,
      $consentedAt: enabled ? (alreadyActive ? existing?.consented_at || now : now) : existing?.consented_at || null,
      $revokedAt: enabled ? null : now,
      $updatedAt: now,
    });
  }
}

export function listMarketingContacts(channel: 'email' | 'whatsapp') {
  const rows = db.prepare(
    'SELECT c.id, c.name, c.email, c.phone FROM customer_profiles c ' +
    'JOIN communications_consents x ON x.customer_id = c.id ' +
    'WHERE x.channel = ? AND x.consented_at IS NOT NULL AND x.revoked_at IS NULL AND c.email_verified_at IS NOT NULL ORDER BY c.name'
  ).all(channel) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    phone: String(row.phone),
  })).filter((row) => channel === 'email'
    ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)
    : /^\+[1-9]\d{7,14}$/.test(row.phone));
}

export function getMarketingContact(customerId: string, channel: 'email' | 'whatsapp') {
  return listMarketingContacts(channel).find((contact) => contact.id === customerId) ?? null;
}

export function listCustomerContactDirectory() {
  return (db.prepare(
    'SELECT id, name, email, phone FROM customer_profiles WHERE email_verified_at IS NOT NULL ORDER BY name LIMIT 2000'
  ).all() as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    email: String(row.email || ''),
    phone: String(row.phone || ''),
  }));
}

export function listCustomerContactGroups() {
  const groups = db.prepare('SELECT id, name FROM customer_contact_groups ORDER BY name').all() as { id: string; name: string }[];
  const members = db.prepare('SELECT group_id, customer_id FROM customer_contact_group_members ORDER BY customer_id')
    .all() as { group_id: string; customer_id: string }[];
  const idsByGroup = new Map<string, string[]>();
  for (const member of members) {
    const ids = idsByGroup.get(member.group_id) ?? [];
    ids.push(member.customer_id);
    idsByGroup.set(member.group_id, ids);
  }
  return groups.map((group) => ({
    id: String(group.id),
    name: String(group.name),
    customerIds: idsByGroup.get(group.id) ?? [],
  }));
}

export function saveCustomerContactGroup(payload: {
  id?: string;
  name: string;
  customerIds: string[];
}, actorId: string): { id: string } {
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!name || name.length > 80 || /[\r\n]/.test(name)) {
    throw new Error('Enter a group name between 1 and 80 characters.');
  }
  if (!Array.isArray(payload.customerIds) || payload.customerIds.length > 1000
      || payload.customerIds.some((id) => typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id))) {
    throw new Error('Select up to 1,000 verified customers for this group.');
  }
  const customerIds = [...new Set(payload.customerIds)];
  if (customerIds.length) {
    const placeholders = customerIds.map(() => '?').join(',');
    const count = (db.prepare(
      `SELECT COUNT(*) AS count FROM customer_profiles WHERE email_verified_at IS NOT NULL AND id IN (${placeholders})`
    ).get(...customerIds) as { count: number }).count;
    if (count !== customerIds.length) {
      throw new Error('Groups can include only existing, verified customer accounts.');
    }
  }
  const id = payload.id || crypto.randomUUID();
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Contact group ID is invalid.');
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM customer_contact_groups WHERE id = ? LIMIT 1').get(id);
  if (payload.id && !existing) throw new Error('Contact group not found.');
  try {
    withTransaction(() => {
      if (existing) {
        db.prepare('UPDATE customer_contact_groups SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id);
      } else {
        db.prepare('INSERT INTO customer_contact_groups (id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(id, name, actorId, now, now);
      }
      db.prepare('DELETE FROM customer_contact_group_members WHERE group_id = ?').run(id);
      const addMember = db.prepare(
        'INSERT INTO customer_contact_group_members (group_id, customer_id, created_at) VALUES (?, ?, ?)'
      );
      for (const customerId of customerIds) addMember.run(id, customerId, now);
    });
  } catch (error) {
    if (String((error as Error).message).includes('UNIQUE constraint failed')) {
      throw new Error('A contact group with that name already exists.');
    }
    throw error;
  }
  return { id };
}

export function deleteCustomerContactGroup(groupId: string): void {
  if (!/^[a-f0-9-]{36}$/i.test(groupId)) throw new Error('Contact group ID is invalid.');
  const exists = db.prepare('SELECT id FROM customer_contact_groups WHERE id = ? LIMIT 1').get(groupId);
  if (!exists) throw new Error('Contact group not found.');
  withTransaction(() => {
    db.prepare('DELETE FROM customer_contact_group_members WHERE group_id = ?').run(groupId);
    db.prepare('DELETE FROM customer_contact_groups WHERE id = ?').run(groupId);
  });
}

export function getCustomerContactGroupRecipients(groupId: string, channel: 'email' | 'whatsapp') {
  if (!/^[a-f0-9-]{36}$/i.test(groupId)) throw new Error('Contact group ID is invalid.');
  const group = db.prepare('SELECT id FROM customer_contact_groups WHERE id = ? LIMIT 1').get(groupId);
  if (!group) throw new Error('Contact group not found.');
  const total = (db.prepare('SELECT COUNT(*) AS count FROM customer_contact_group_members WHERE group_id = ?')
    .get(groupId) as { count: number }).count;
  const rows = channel === 'email'
    ? db.prepare(
      'SELECT c.id, c.name, c.email, c.phone FROM customer_contact_group_members m ' +
      'JOIN customer_profiles c ON c.id = m.customer_id ' +
      `JOIN communications_consents x ON x.customer_id = c.id AND x.channel = 'email' ` +
      'WHERE m.group_id = ? AND c.email_verified_at IS NOT NULL AND x.consented_at IS NOT NULL AND x.revoked_at IS NULL ORDER BY c.name'
    ).all(groupId) as Record<string, unknown>[]
    : db.prepare(
      'SELECT c.id, c.name, c.email, c.phone FROM customer_contact_group_members m ' +
      'JOIN customer_profiles c ON c.id = m.customer_id ' +
      `JOIN communications_consents x ON x.customer_id = c.id AND x.channel = 'whatsapp' ` +
      'WHERE m.group_id = ? AND c.email_verified_at IS NOT NULL AND x.consented_at IS NOT NULL AND x.revoked_at IS NULL ORDER BY c.name'
    ).all(groupId) as Record<string, unknown>[];
  const contacts = rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    email: String(row.email || ''),
    phone: String(row.phone || ''),
  })).filter((contact) => channel === 'email'
    ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)
    : /^\+[1-9]\d{7,14}$/.test(contact.phone));
  return { contacts, skipped: Math.max(0, total - contacts.length) };
}

export function upsertPushSubscription(ownerType: 'staff' | 'customer', ownerId: string, subscription: {
  endpoint: string;
  p256dh: string;
  auth: string;
}): void {
  const now = new Date().toISOString();
  const endpointHash = crypto.createHash('sha256').update(subscription.endpoint).digest('hex');
  db.prepare(
    'INSERT INTO push_subscriptions (id, owner_type, owner_id, endpoint_hash, endpoint, p256dh, auth_key, created_at, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint_hash) DO UPDATE SET owner_type = excluded.owner_type, owner_id = excluded.owner_id, endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth_key = excluded.auth_key, updated_at = excluded.updated_at'
  ).run(crypto.randomUUID(), ownerType, ownerId, endpointHash, subscription.endpoint, subscription.p256dh, subscription.auth, now, now);
}

export function deletePushSubscription(endpoint: string, owner?: { type: 'staff' | 'customer'; id: string }): void {
  const endpointHash = crypto.createHash('sha256').update(endpoint).digest('hex');
  if (owner) {
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND owner_type = ? AND owner_id = ?')
      .run(endpointHash, owner.type, owner.id);
  } else {
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint_hash = ?').run(endpointHash);
  }
}

export function getPushSubscriptions(userIds: string[], customerIds: string[] = []) {
  const clauses: string[] = [];
  const values: string[] = [];
  if (userIds.length) {
    clauses.push(`(p.owner_type = 'staff' AND u.status = 'Active' AND p.owner_id IN (${userIds.map(() => '?').join(',')}))`);
    values.push(...userIds);
  }
  if (customerIds.length) {
    clauses.push(`(p.owner_type = 'customer' AND c.email_verified_at IS NOT NULL AND p.owner_id IN (${customerIds.map(() => '?').join(',')}))`);
    values.push(...customerIds);
  }
  if (!clauses.length) return [];
  return db.prepare(
    `SELECT p.owner_type, p.owner_id, p.endpoint, p.p256dh, p.auth_key FROM push_subscriptions p ` +
    `LEFT JOIN users u ON p.owner_type = 'staff' AND u.id = p.owner_id ` +
    `LEFT JOIN customer_profiles c ON p.owner_type = 'customer' AND c.id = p.owner_id ` +
    `WHERE ${clauses.join(' OR ')}`
  ).all(...values) as { owner_type: 'staff' | 'customer'; owner_id: string; endpoint: string; p256dh: string; auth_key: string }[];
}

export function getActiveStaffIds(userIds: string[]): string[] {
  if (!userIds.length) return [];
  const placeholders = userIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id FROM users WHERE status = 'Active' AND id IN (${placeholders})`)
    .all(...userIds) as { id: string }[];
  return rows.map((row) => row.id);
}

export function getActiveStaffEmailRecipients(roles: string[]): {
  id: string; name: string; email: string; role: string;
}[] {
  if (!roles.length) return [];
  const placeholders = roles.map(() => '?').join(',');
  return db.prepare(
    `SELECT id, name, email, role FROM users WHERE status='Active' AND role IN (${placeholders}) ORDER BY name`
  ).all(...roles) as { id: string; name: string; email: string; role: string }[];
}

export function getVerifiedCustomerIds(customerIds: string[]): string[] {
  if (!customerIds.length) return [];
  const placeholders = customerIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id FROM customer_profiles WHERE email_verified_at IS NOT NULL AND id IN (${placeholders})`)
    .all(...customerIds) as { id: string }[];
  return rows.map((row) => row.id);
}

export function getPushSubscribedCustomers() {
  const rows = db.prepare(
    "SELECT DISTINCT c.id, c.name FROM customer_profiles c JOIN push_subscriptions p ON p.owner_id = c.id " +
    "WHERE p.owner_type = 'customer' AND c.email_verified_at IS NOT NULL ORDER BY c.name LIMIT 2000"
  ).all() as { id: string; name: string }[];
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

export function getCustomerContactGroupPushRecipients(groupId: string): { customerIds: string[]; skipped: number } {
  if (!/^[a-f0-9-]{36}$/i.test(groupId)) throw new Error('Contact group ID is invalid.');
  const group = db.prepare('SELECT id FROM customer_contact_groups WHERE id = ? LIMIT 1').get(groupId);
  if (!group) throw new Error('Contact group not found.');
  const total = (db.prepare('SELECT COUNT(*) AS count FROM customer_contact_group_members WHERE group_id = ?')
    .get(groupId) as { count: number }).count;
  const rows = db.prepare(
    "SELECT DISTINCT c.id FROM customer_contact_group_members m " +
    "JOIN customer_profiles c ON c.id = m.customer_id " +
    "JOIN push_subscriptions p ON p.owner_type = 'customer' AND p.owner_id = c.id " +
    "WHERE m.group_id = ? AND c.email_verified_at IS NOT NULL"
  ).all(groupId) as { id: string }[];
  return {
    customerIds: rows.map((row) => String(row.id)),
    skipped: Math.max(0, total - rows.length),
  };
}

export function createCustomerLoginLink(payload: {
  name?: string;
  email: string;
  phone?: string;
  location?: string;
  company?: string;
  refCode?: string;
}, requesterAddress: string): { token: string | null; email: string | null } {
  const email = payload.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) {
    throw new Error('Enter a valid email address.');
  }
  const name = (payload.name || '').trim();
  const phone = (payload.phone || '').trim();
  const location = (payload.location || '').trim();
  const company = (payload.company || '').trim();
  const refCode = (payload.refCode || '').trim();
  if (name.length > 120 || phone.length > 40 || location.length > 190 || company.length > 150 || refCode.length > 32) {
    throw new Error('Some customer details exceed the allowed length.');
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const emailKey = crypto.createHash('sha256').update(`email:${email}`).digest('hex');
  const addressKey = crypto.createHash('sha256').update(`address:${requesterAddress}`).digest('hex');
  db.prepare('DELETE FROM customer_auth_rate_limits WHERE created_at < ?')
    .run(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
  const checkLimit = (keyHash: string, limit: number, minutes: number) => {
    const since = new Date(now.getTime() - minutes * 60 * 1000).toISOString();
    const count = (db.prepare('SELECT COUNT(*) AS count FROM customer_auth_rate_limits WHERE key_hash = ? AND created_at >= ?')
      .get(keyHash, since) as { count: number }).count;
    if (count >= limit) throw new Error('Too many sign-in requests. Please try again later.');
  };
  checkLimit(emailKey, 5, 15);
  checkLimit(addressKey, 20, 60);
  const recordRequest = db.prepare('INSERT INTO customer_auth_rate_limits (id, key_hash, created_at) VALUES (?, ?, ?)');
  recordRequest.run(crypto.randomUUID(), emailKey, nowIso);
  recordRequest.run(crypto.randomUUID(), addressKey, nowIso);

  const row = db.prepare(
    'SELECT * FROM customer_profiles WHERE LOWER(email) = ? AND email_verified_at IS NOT NULL AND must_set_password = 0 LIMIT 1'
  ).get(email) as Record<string, unknown> | undefined;
  if (!row) return { token: null, email: null };
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('DELETE FROM customer_login_tokens WHERE customer_id = ?').run(String(row.id));
  db.prepare('INSERT INTO customer_login_tokens (token_hash, customer_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash, String(row.id), new Date(Date.now() + 15 * 60 * 1000).toISOString());
  return { token, email };
}

export function createCustomerAccountForApprovedQuote(
  actor: StaffMember,
  quoteId: string,
): { id: string; enquiryId: string; name: string; email: string; phone: string; pin: string } {
  if (!['admin', 'superadmin'].includes(actor.role)) {
    throw new Error('Only Admin can approve a customer profile and create its account.');
  }
  const enquiry = db.prepare(
    "SELECT e.id, e.customer_name, e.email, e.phone, e.location, e.ref_code FROM quotations q " +
    "JOIN enquiries e ON e.id = q.enquiry_id WHERE q.id = ? AND q.status = 'Approved' " +
    "AND e.estimate_json IS NOT NULL LIMIT 1"
  ).get(quoteId) as {
    id: string; customer_name: string; email: string; phone: string; location: string; ref_code: string;
  } | undefined;
  if (!enquiry) throw new Error('Only Director-approved estimator quotations can be used to create customer accounts.');
  const email = enquiry.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) {
    throw new Error('A valid customer email address is required before account creation.');
  }

  const pin = makeInitialPin();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const existing = db.prepare('SELECT id, password_hash, email_verified_at FROM customer_profiles WHERE LOWER(email) = ? LIMIT 1')
    .get(email) as { id: string; password_hash: string | null; email_verified_at: string | null } | undefined;
  let id: string;
  if (existing && (existing.password_hash || existing.email_verified_at)) {
    throw new Error('A customer account already exists for this email address.');
  }
  if (existing) {
    id = existing.id;
    db.prepare(
      'UPDATE customer_profiles SET name=?, phone=?, location=?, ref_code=?, initial_pin_hash=?, pin_expires_at=?, must_set_password=1 WHERE id=?'
    ).run(enquiry.customer_name, enquiry.phone, enquiry.location, enquiry.ref_code, hashPassword(pin), expiresAt, id);
  } else {
    id = crypto.randomUUID();
    db.prepare(
      "INSERT INTO customer_profiles (id, name, email, phone, location, company, ref_code, email_verified_at, password_hash, initial_pin_hash, pin_expires_at, must_set_password, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 1, ?)"
    ).run(id, enquiry.customer_name, email, enquiry.phone, enquiry.location, '', enquiry.ref_code, hashPassword(pin), expiresAt, new Date().toISOString());
  }
  writeAudit(actor, 'CREATE_CUSTOMER_ACCOUNT', 'Customer', id, `Approved customer profile and created portal account from quotation ${quoteId}.`);
  return { id, enquiryId: enquiry.id, name: enquiry.customer_name, email, phone: enquiry.phone, pin };
}

export function clearCustomerInitialPin(customerId: string): void {
  db.prepare('UPDATE customer_profiles SET initial_pin_hash = NULL, pin_expires_at = NULL WHERE id = ? AND must_set_password = 1')
    .run(customerId);
}

export function issueCustomerPasswordResetPin(actor: StaffMember, quoteId: string): {
  id: string; enquiryId: string; name: string; email: string; phone: string; pin: string;
} {
  if (!['admin', 'superadmin'].includes(actor.role)) {
    throw new Error('Only Admin can issue customer password reset instructions.');
  }
  const enquiry = db.prepare(
    "SELECT e.id, e.customer_name, e.email, e.phone FROM quotations q " +
    "JOIN enquiries e ON e.id=q.enquiry_id WHERE q.id=? AND q.status='Approved' AND e.estimate_json IS NOT NULL LIMIT 1"
  ).get(quoteId) as { id: string; customer_name: string; email: string; phone: string } | undefined;
  if (!enquiry) throw new Error('Only an approved estimator customer can receive a password reset.');
  const account = db.prepare(
    'SELECT id, password_hash, email_verified_at FROM customer_profiles WHERE LOWER(email)=LOWER(?) LIMIT 1'
  ).get(enquiry.email.trim()) as { id: string; password_hash: string | null; email_verified_at: string | null } | undefined;
  if (!account?.password_hash || !account.email_verified_at) {
    throw new Error('An active verified customer account was not found for this enquiry.');
  }
  const pin = makeInitialPin();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      'UPDATE customer_profiles SET initial_pin_hash=?, pin_expires_at=?, must_set_password=1 WHERE id=?'
    ).run(hashPassword(pin), expiresAt, account.id);
    db.prepare('DELETE FROM customer_sessions WHERE customer_id=?').run(account.id);
    db.prepare('DELETE FROM customer_login_tokens WHERE customer_id=?').run(account.id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  writeAudit(actor, 'RESET_CUSTOMER_PASSWORD', 'Customer', account.id, 'Issued one-time customer password reset instructions.');
  return {
    id: account.id,
    enquiryId: enquiry.id,
    name: enquiry.customer_name,
    email: enquiry.email.trim().toLowerCase(),
    phone: enquiry.phone,
    pin,
  };
}

export function authenticateCustomer(emailValue: string, password: string): {
  sessionToken: string;
  profile: CustomerProfile;
  equipment: CustomerEquipment[];
  tickets: ServiceTicket[];
} | null {
  const email = emailValue.trim().toLowerCase();
  const row = db.prepare(
    'SELECT id, password_hash FROM customer_profiles WHERE LOWER(email) = ? AND email_verified_at IS NOT NULL AND must_set_password = 0 LIMIT 1'
  ).get(email) as { id: string; password_hash: string | null } | undefined;
  if (!row?.password_hash || !verifyPassword(password, row.password_hash)) return null;
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const sessionHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
  db.prepare('INSERT INTO customer_sessions (token_hash, customer_id, expires_at) VALUES (?, ?, ?)')
    .run(sessionHash, row.id, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());
  return { sessionToken, ...customerPortalData(row.id) };
}

export function setupCustomerPassword(emailValue: string, pin: string, password: string): void {
  if (!/^\d{4}$/.test(pin) || password.length < 12 || password.length > 128) {
    throw new Error('Enter the four-digit PIN and a password between 12 and 128 characters.');
  }
  const email = emailValue.trim().toLowerCase();
  const row = db.prepare(
    'SELECT id, initial_pin_hash, pin_expires_at FROM customer_profiles WHERE LOWER(email) = ? AND must_set_password = 1 LIMIT 1'
  ).get(email) as { id: string; initial_pin_hash: string | null; pin_expires_at: string | null } | undefined;
  if (!row?.initial_pin_hash || !row.pin_expires_at || row.pin_expires_at <= new Date().toISOString()
      || !verifyPassword(pin, row.initial_pin_hash)) {
    throw new Error('The PIN is invalid or has expired. Ask the Admin to resend your setup email.');
  }
  const now = new Date().toISOString();
  const result = db.prepare(
    'UPDATE customer_profiles SET password_hash=?, initial_pin_hash=NULL, pin_expires_at=NULL, must_set_password=0, email_verified_at=? ' +
    'WHERE id=? AND initial_pin_hash=? AND must_set_password=1 AND pin_expires_at > ?'
  ).run(hashPassword(password), now, row.id, row.initial_pin_hash, now);
  if (result.changes !== 1) throw new Error('The PIN is invalid or has expired. Ask the Admin to resend your setup email.');
}

export function setupStaffPassword(identifierValue: string, pin: string, password: string): void {
  if (!/^\d{4}$/.test(pin) || password.length < 12 || password.length > 128) {
    throw new Error('Enter the four-digit PIN and a password between 12 and 128 characters.');
  }
  const identifier = identifierValue.trim().toLowerCase();
  const row = db.prepare(
    "SELECT id, initial_pin_hash, pin_expires_at FROM users WHERE (LOWER(email)=? OR LOWER(username)=?) " +
    "AND status='Active' AND must_set_password=1 LIMIT 1"
  ).get(identifier, identifier) as { id: string; initial_pin_hash: string | null; pin_expires_at: string | null } | undefined;
  if (!row?.initial_pin_hash || !row.pin_expires_at || row.pin_expires_at <= new Date().toISOString()
      || !verifyPassword(pin, row.initial_pin_hash)) {
    throw new Error('The PIN is invalid or has expired. Ask your Super Admin to resend your setup email.');
  }
  const now = new Date().toISOString();
  const result = db.prepare(
    'UPDATE users SET password_hash=?, initial_pin_hash=NULL, pin_expires_at=NULL, must_set_password=0 ' +
    'WHERE id=? AND initial_pin_hash=? AND must_set_password=1 AND pin_expires_at > ?'
  ).run(hashPassword(password), row.id, row.initial_pin_hash, now);
  if (result.changes !== 1) throw new Error('The PIN is invalid or has expired. Ask your Super Admin to resend your setup email.');
}

export function reissueStaffSetupPin(actor: StaffMember, staffId: string): {
  id: string; name: string; email: string; phone: string; username: string; pin: string;
} {
  if (!['admin', 'superadmin'].includes(actor.role)) throw new Error('Only Admin can reset staff passwords.');
  const staff = db.prepare(
    'SELECT id, name, email, phone, username FROM users WHERE id=? AND status="Active" LIMIT 1'
  ).get(staffId) as { id: string; name: string; email: string; phone: string; username: string } | undefined;
  if (!staff) throw new Error('An active staff account was not found.');
  const pin = makeInitialPin();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE users SET initial_pin_hash=?, pin_expires_at=?, must_set_password=1 WHERE id=?')
    .run(hashPassword(pin), expiresAt, staff.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(staff.id);
  writeAudit(actor, 'RESET_STAFF_PASSWORD', 'Staff', staff.id, 'Issued one-time staff password reset instructions.');
  return { ...staff, pin };
}

export function checkAuthRateLimit(scope: string, limit: number, windowSeconds: number): boolean {
  const now = new Date();
  const nowIso = now.toISOString();
  const keyHash = crypto.createHash('sha256').update(scope).digest('hex');
  db.prepare('DELETE FROM customer_auth_rate_limits WHERE created_at < ?')
    .run(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
  const since = new Date(now.getTime() - windowSeconds * 1000).toISOString();
  const count = (db.prepare('SELECT COUNT(*) AS count FROM customer_auth_rate_limits WHERE key_hash = ? AND created_at >= ?')
    .get(keyHash, since) as { count: number }).count;
  if (count >= limit) return false;
  db.prepare('INSERT INTO customer_auth_rate_limits (id, key_hash, created_at) VALUES (?, ?, ?)')
    .run(crypto.randomUUID(), keyHash, nowIso);
  return true;
}

export function revokeCustomerLoginLink(token: string): void {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('DELETE FROM customer_login_tokens WHERE token_hash = ?').run(tokenHash);
}

export function verifyCustomerLoginLink(token: string): {
  sessionToken: string;
  profile: CustomerProfile;
  equipment: CustomerEquipment[];
  tickets: ServiceTicket[];
} {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('This sign-in link is invalid or has expired.');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const now = new Date().toISOString();
  const link = db.prepare(
    'SELECT t.customer_id FROM customer_login_tokens t JOIN customer_profiles c ON c.id = t.customer_id ' +
    'WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > ? AND c.must_set_password = 0 LIMIT 1'
  ).get(tokenHash, now) as { customer_id: string } | undefined;
  if (!link) throw new Error('This sign-in link is invalid or has expired.');
  const consumed = db.prepare('UPDATE customer_login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
    .run(now, tokenHash, now);
  if (consumed.changes !== 1) throw new Error('This sign-in link is invalid or has expired.');

  db.prepare('UPDATE customer_profiles SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?')
    .run(now, link.customer_id);
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const sessionHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
  db.prepare('INSERT INTO customer_sessions (token_hash, customer_id, expires_at) VALUES (?, ?, ?)')
    .run(sessionHash, link.customer_id, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());
  return { sessionToken, ...customerPortalData(link.customer_id) };
}

export function getCustomerBySessionToken(token: string | undefined) {
  if (!token) return null;
  const sessionHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = db.prepare(
    'SELECT s.customer_id FROM customer_sessions s JOIN customer_profiles c ON c.id = s.customer_id ' +
    'WHERE s.token_hash = ? AND s.expires_at > ? AND c.email_verified_at IS NOT NULL AND c.must_set_password = 0 LIMIT 1'
  ).get(sessionHash, new Date().toISOString()) as { customer_id: string } | undefined;
  if (!session) return null;
  return customerPortalData(session.customer_id);
}

export function destroyCustomerSession(token: string | undefined): void {
  if (!token) return;
  const sessionHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('DELETE FROM customer_sessions WHERE token_hash = ?').run(sessionHash);
}

export function getCustomerEquipmentPhoto(photoId: string, customerId: string): { filePath: string; mimeType: string } | null {
  if (!/^[a-f0-9-]{36}$/i.test(photoId)) return null;
  const row = db.prepare(
    'SELECT filename, mime_type FROM customer_equipment_photos WHERE id = ? AND customer_id = ? LIMIT 1'
  ).get(photoId, customerId) as { filename: string; mime_type: string } | undefined;
  if (!row) return null;
  const filePath = path.join(UPLOAD_DIR, row.filename);
  if (!fs.existsSync(filePath)) return null;
  return { filePath, mimeType: row.mime_type };
}

export function saveCustomerProfile(payload: {
  customerId: string;
  name: string;
  phone: string;
  location: string;
  company: string;
  refCode: string;
}): CustomerProfile {
  const previous = db.prepare(
    'SELECT phone FROM customer_profiles WHERE id = ? AND email_verified_at IS NOT NULL'
  ).get(payload.customerId) as { phone: string } | undefined;
  db.prepare(
    'UPDATE customer_profiles SET name = ?, phone = ?, location = ?, company = ?, ref_code = ? WHERE id = ? AND email_verified_at IS NOT NULL'
  ).run(payload.name.trim(), payload.phone.trim(), payload.location.trim(), payload.company.trim(), payload.refCode.trim(), payload.customerId);
  if (previous && previous.phone.trim() !== payload.phone.trim()) {
    db.prepare(
      "UPDATE communications_consents SET revoked_at = ?, updated_at = ? WHERE customer_id = ? AND channel = 'whatsapp' AND revoked_at IS NULL"
    ).run(new Date().toISOString(), new Date().toISOString(), payload.customerId);
    db.prepare(
      "UPDATE whatsapp_recipient_consents SET revoked_at = ? WHERE recipient_type = 'customer' AND recipient_id = ? AND revoked_at IS NULL"
    ).run(new Date().toISOString(), payload.customerId);
  }
  const row = db.prepare('SELECT * FROM customer_profiles WHERE id = ? AND email_verified_at IS NOT NULL').get(payload.customerId) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Verified customer profile not found.');
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    phone: String(row.phone),
    location: String(row.location),
    company: String(row.company),
    refCode: String(row.ref_code),
    createdAt: String(row.created_at),
    emailMarketingConsent: hasCustomerConsent(payload.customerId, 'email'),
    whatsappMarketingConsent: hasCustomerConsent(payload.customerId, 'whatsapp'),
    whatsappUpdatesConsent: hasWhatsAppRecipientConsent('customer', payload.customerId, 'operational'),
  };
}

export function saveCustomerEquipment(customerId: string, payload: {
  id?: string;
  equipmentType: string;
  brandModel: string;
  serialNumber: string;
  capacityKw: string;
  installDate: string;
  notes: string;
  photos?: { name: string; dataUrl: string }[];
}): CustomerEquipment[] {
  const customer = db.prepare('SELECT id FROM customer_profiles WHERE id = ? AND email_verified_at IS NOT NULL').get(customerId);
  if (!customer) throw new Error('Verified customer profile not found.');
  const now = new Date().toISOString();
  if (payload.id) {
    db.prepare(
      'UPDATE customer_equipment SET equipment_type=?, brand_model=?, serial_number=?, capacity_kw=?, install_date=?, notes=? WHERE id=? AND customer_id=?'
    ).run(payload.equipmentType, payload.brandModel, payload.serialNumber, payload.capacityKw, payload.installDate, payload.notes, payload.id, customerId);
  } else {
    const equipmentId = crypto.randomUUID();
    db.prepare(
      'INSERT INTO customer_equipment (id, customer_id, equipment_type, brand_model, serial_number, capacity_kw, install_date, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(equipmentId, customerId, payload.equipmentType, payload.brandModel, payload.serialNumber, payload.capacityKw, payload.installDate, payload.notes, now);
    if (Array.isArray(payload.photos)) {
      if (payload.photos.length > 4) throw new Error('At most 4 equipment photos may be added at once.');
      for (const photo of payload.photos) {
        if (!photo || typeof photo.name !== 'string' || typeof photo.dataUrl !== 'string'
            || !/^data:image\/(jpeg|png|webp);base64,/i.test(photo.dataUrl)
            || photo.dataUrl.length > 6 * 1024 * 1024) {
          throw new Error('Equipment photo data is invalid.');
        }
        const base64 = photo.dataUrl.split(',', 2)[1];
        const binary = Buffer.from(base64, 'base64');
        if (binary.length < 100 || binary.length > 4 * 1024 * 1024) {
          throw new Error('Each equipment photo must be between 100 bytes and 4MB.');
        }
        const id = crypto.randomUUID();
        const filename = `${id}.jpg`;
        fs.writeFileSync(path.join(UPLOAD_DIR, filename), binary);
        db.prepare(
          'INSERT INTO customer_equipment_photos (id, equipment_id, customer_id, filename, original_name, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(id, equipmentId, customerId, filename, photo.name.slice(0, 140).replace(/[\/\\\r\n]/g, '_'), 'image/jpeg', now);
      }
    }
  }
  return getCustomerEquipmentList(customerId);
}

export function submitCustomerTicket(customerId: string, payload: {
  equipmentId?: string | null;
  category: TicketCategory;
  priority: 'Normal' | 'Urgent';
  subject: string;
  description: string;
}): { ticketCode: string; tickets: ServiceTicket[] } {
  const cust = db.prepare('SELECT * FROM customer_profiles WHERE id = ? AND email_verified_at IS NOT NULL LIMIT 1').get(customerId) as Record<string, unknown> | undefined;
  if (!cust) throw new Error('Customer profile not found.');

  let eqSummary = 'General System / Site';
  if (payload.equipmentId) {
    const eq = db.prepare('SELECT * FROM customer_equipment WHERE id = ? AND customer_id = ?').get(payload.equipmentId, customerId) as Record<string, unknown> | undefined;
    if (eq) eqSummary = `${eq.equipment_type} — ${eq.brand_model}${eq.serial_number ? ` (S/N: ${eq.serial_number})` : ''}`;
  }

  const id = crypto.randomUUID();
  const ticketCode = nextCode('service_tickets', 'ticket_code', 'TKT');
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO service_tickets (id, ticket_code, customer_id, customer_name, customer_phone, location, equipment_id, equipment_summary, category, priority, subject, description, status, assigned_tech_id, assigned_tech_name, resolution_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)'
  ).run(
    id,
    ticketCode,
    customerId,
    String(cust.name),
    String(cust.phone || 'Not provided'),
    String(cust.location || 'Nigeria'),
    payload.equipmentId || null,
    eqSummary,
    payload.category,
    payload.priority,
    payload.subject.trim(),
    payload.description.trim(),
    'Open',
    'Logged to Help Desk queue.',
    now,
    now
  );

  // Route complaint/service request directly to Admin / Help Desk & Super Admin
  notifyRoleMembers(
    ['admin', 'superadmin', 'director'],
    `New ${payload.category}: ${ticketCode}`,
    `${cust.name} (${cust.location}) — ${payload.subject}`,
    'tickets',
    ticketCode
  );
  writeAudit({ name: String(cust.name), role: 'customer' }, 'CREATE_TICKET', 'ServiceTicket', ticketCode, `Customer filed ${payload.category}: ${payload.subject}`);

  const tickets = (
    db.prepare('SELECT * FROM service_tickets WHERE customer_id = ? ORDER BY created_at DESC').all(customerId) as Record<string, unknown>[]
  ).map(hydrateTicketRow);
  return { ticketCode, tickets };
}

export function hydrateWorkspace(user: StaffMember): WorkspaceBootstrap {
  const roles = getAllRoles();
  const rolesMap = new Map(roles.map((r) => [r.id, r]));
  const staff = (db.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as Record<string, unknown>[]).map((u) =>
    hydrateStaffRow(u, rolesMap)
  );

  const catalog = getPublicCatalog();
  const canCommercial =
    hasPermission(user, 'manage_enquiries') ||
    hasPermission(user, 'draft_quotes') ||
    hasPermission(user, 'approve_quotes') ||
    hasPermission(user, 'manage_invoices') ||
    hasPermission(user, 'verify_payments') ||
    hasPermission(user, 'release_installations');

  const enquiries: EnquiryRecord[] = !canCommercial
    ? []
    : (db.prepare('SELECT * FROM enquiries WHERE archived_at IS NULL ORDER BY created_at DESC').all() as Record<string, unknown>[]).map((e) => ({
        id: String(e.id),
        refCode: String(e.ref_code),
        customerName: String(e.customer_name),
        email: String(e.email),
        phone: String(e.phone),
        location: String(e.location),
        channel: String(e.channel),
        needSummary: String(e.need_summary),
        appliances: JSON.parse(String(e.appliances_json || '[]')),
        estimate: e.estimate_json ? JSON.parse(String(e.estimate_json)) : null,
        status: e.status as EnquiryRecord['status'],
        ownerUserId: String(e.owner_user_id),
        createdAt: String(e.created_at),
      }));

  const quotes: QuotationRecord[] = !canCommercial
    ? []
    : (db.prepare('SELECT * FROM quotations ORDER BY created_at DESC').all() as Record<string, unknown>[]).map((q) => ({
        id: String(q.id),
        quoteCode: String(q.quote_code),
        enquiryId: String(q.enquiry_id),
        customerName: String(q.customer_name),
        status: q.status as QuotationRecord['status'],
        revisionNo: Number(q.revision_no),
        scope: String(q.scope),
        terms: String(q.terms),
        note: String(q.note),
        discountNgn: Number(q.discount_ngn),
        taxPercent: Number(q.tax_percent),
        issuedDate: String(q.issued_date),
        validUntil: String(q.valid_until),
        approvedBy: q.approved_by ? String(q.approved_by) : null,
        approvedAt: q.approved_at ? String(q.approved_at) : null,
        items: JSON.parse(String(q.items_json || '[]')),
        revisions: JSON.parse(String(q.revisions_json || '[]')),
      }));

  const invoices: InvoiceRecord[] = !canCommercial
    ? []
    : (db.prepare('SELECT * FROM invoices ORDER BY created_at DESC').all() as Record<string, unknown>[]).map((i) => ({
        id: String(i.id),
        invoiceCode: String(i.invoice_code),
        quotationId: String(i.quotation_id),
        enquiryId: String(i.enquiry_id),
        customerName: String(i.customer_name),
        discountNgn: Number(i.discount_ngn),
        taxPercent: Number(i.tax_percent),
        totalNgn: Number(i.total_ngn),
        status: String(i.status || 'Pending') as InvoiceRecord['status'],
        bankDetails: JSON.parse(String(i.bank_details_json)),
        customerAccepted: Boolean(i.customer_accepted),
        acceptedAt: i.accepted_at ? String(i.accepted_at) : null,
        issuedDate: String(i.issued_date),
        dueDate: String(i.due_date),
        items: JSON.parse(String(i.items_json || '[]')),
      }));

  const payments: PaymentRecord[] = !canCommercial
    ? []
    : (db.prepare('SELECT * FROM payments ORDER BY created_at DESC').all() as Record<string, unknown>[]).map((p) => ({
        id: String(p.id),
        paymentCode: String(p.payment_code),
        invoiceId: String(p.invoice_id),
        amountNgn: Number(p.amount_ngn),
        paymentDate: String(p.payment_date),
        method: String(p.method),
        reference: String(p.reference),
        evidenceNote: String(p.evidence_note),
        status: p.status as PaymentRecord['status'],
        recordedBy: String(p.recorded_by),
        verifiedBy: p.verified_by ? String(p.verified_by) : null,
        verifiedAt: p.verified_at ? String(p.verified_at) : null,
        rejectionReason: p.rejection_reason ? String(p.rejection_reason) : null,
        createdAt: String(p.created_at),
      }));

  const isTechOnly = user.role === 'technician' || (!hasPermission(user, 'release_installations') && !hasPermission(user, 'manage_enquiries') && hasPermission(user, 'update_installations'));
  const jobRows = (
    isTechOnly
      ? db.prepare('SELECT * FROM installations WHERE assigned_engineer_id = ? ORDER BY released_at DESC').all(user.id)
      : db.prepare('SELECT * FROM installations ORDER BY released_at DESC').all()
  ) as Record<string, unknown>[];

  const installations: InstallationRecord[] = jobRows.map((j) => {
    const updRows = db
      .prepare('SELECT * FROM installation_updates WHERE installation_id = ? ORDER BY created_at DESC')
      .all(String(j.id)) as Record<string, unknown>[];
    const updates = updRows.map((u) => {
      const photos = (db.prepare('SELECT * FROM installation_photos WHERE update_id = ? ORDER BY created_at ASC').all(String(u.id)) as Record<string, unknown>[]).map((ph) => ({
        id: String(ph.id),
        fileUrl: `/api/files/${ph.id}`,
        originalName: String(ph.original_name),
        uploadedBy: String(ph.uploaded_by),
        createdAt: String(ph.created_at),
      }));
      return {
        id: String(u.id),
        stageNumber: Number(u.stage_number),
        activityTitle: String(u.activity_title),
        reportText: String(u.report_text),
        isCustomerVisible: Boolean(u.is_customer_visible),
        createdBy: String(u.created_by),
        createdAt: String(u.created_at),
        photos,
      };
    });
    return {
      id: String(j.id),
      jobCode: String(j.job_code),
      invoiceId: String(j.invoice_id),
      enquiryId: String(j.enquiry_id),
      customerName: String(j.customer_name),
      location: String(j.location),
      systemSummary: String(j.system_summary),
      assignedEngineerId: j.assigned_engineer_id ? String(j.assigned_engineer_id) : null,
      engineerAcknowledged: Boolean(j.engineer_acknowledged),
      currentStage: Number(j.current_stage) as InstallationRecord['currentStage'],
      targetDate: String(j.target_date),
      releaseType: j.release_type as InstallationRecord['releaseType'],
      releaseNote: String(j.release_note),
      releasedBy: String(j.released_by),
      releasedAt: String(j.released_at),
      updates,
    };
  });

  const tickets: ServiceTicket[] = !hasPermission(user, 'manage_tickets')
    ? []
    : (
        user.role === 'technician'
          ? db.prepare('SELECT * FROM service_tickets WHERE assigned_tech_id = ? ORDER BY created_at DESC').all(user.id)
          : db.prepare('SELECT * FROM service_tickets ORDER BY created_at DESC').all()
      ).map((r) => hydrateTicketRow(r as Record<string, unknown>));

  const notifications: NotificationRecord[] = (
    db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40').all(user.id) as Record<string, unknown>[]
  ).map((n) => ({
    id: String(n.id),
    userId: String(n.user_id),
    title: String(n.title),
    body: String(n.body),
    targetModule: String(n.target_module),
    targetRef: String(n.target_ref),
    isRead: Boolean(n.is_read),
    createdAt: String(n.created_at),
  }));

  const auditLogs: AuditLogRecord[] = !hasPermission(user, 'view_audit')
    ? []
    : (db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 60').all() as Record<string, unknown>[]).map((a) => ({
        id: String(a.id),
        actorName: String(a.actor_name),
        actorRole: String(a.actor_role),
        actionType: String(a.action_type),
        entityType: String(a.entity_type),
        entityId: String(a.entity_id),
        summary: String(a.summary),
        createdAt: String(a.created_at),
      }));

  const orders: StoreOrderRecord[] =
    !canCommercial && !hasPermission(user, 'manage_storefront')
      ? []
      : (db.prepare('SELECT * FROM store_orders ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(
          hydrateStoreOrderRow
        );
  const platformSettings = getPlatformSettings();

  return {
    user,
    settings: canManagePlatformSettings(user)
      ? platformSettings
      : { ...platformSettings, bankDetails: { bankName: '', accountName: '', accountNumber: '' } },
    roles,
    staff,
    catalog,
    orders,
    enquiries,
    quotes,
    invoices,
    payments,
    installations,
    tickets,
    notifications,
    auditLogs,
  };
}

export function getEnquiryForFollowUp(enquiryId: string): {
  id: string;
  refCode: string;
  customerName: string;
  email: string;
  phone: string;
  location: string;
  channel: string;
  needSummary: string;
} | null {
  const row = db.prepare(
    'SELECT id, ref_code, customer_name, email, phone, location, channel, need_summary FROM enquiries WHERE id=? AND archived_at IS NULL LIMIT 1'
  ).get(enquiryId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    refCode: String(row.ref_code),
    customerName: String(row.customer_name),
    email: String(row.email),
    phone: String(row.phone),
    location: String(row.location),
    channel: String(row.channel),
    needSummary: String(row.need_summary),
  };
}

export function forwardEnquiryToDirector(actor: StaffMember, enquiryId: string): ReturnType<typeof getEnquiryForFollowUp> {
  const enquiry = getEnquiryForFollowUp(enquiryId);
  if (!enquiry) return null;
  notifyRoleMembers(
    ['director', 'superadmin'],
    `Enquiry forwarded: ${enquiry.refCode}`,
    `${enquiry.customerName} — ${enquiry.location}.`,
    'enquiries',
    enquiry.id,
  );
  writeAudit(actor, 'FORWARD_ENQUIRY', 'Enquiry', enquiry.refCode, 'Forwarded enquiry to Director for follow-up.');
  return enquiry;
}

export function archiveEnquiry(actor: StaffMember, enquiryId: string): void {
  const activeOrder = db.prepare(
    "SELECT 1 FROM store_orders WHERE enquiry_id=? AND status NOT IN ('Completed','Cancelled') LIMIT 1"
  ).get(enquiryId);
  if (activeOrder) throw new Error('This enquiry is linked to an active Store order and cannot be archived yet.');
  const result = db.prepare('UPDATE enquiries SET archived_at=? WHERE id=? AND archived_at IS NULL')
    .run(new Date().toISOString(), enquiryId);
  if (result.changes !== 1) throw new Error('Enquiry not found or already archived.');
  const row = db.prepare('SELECT ref_code FROM enquiries WHERE id=? LIMIT 1').get(enquiryId) as { ref_code: string };
  writeAudit(actor, 'ARCHIVE_ENQUIRY', 'Enquiry', row.ref_code, 'Archived enquiry from the active desk.');
}

export function createStaffEnquiry(actor: StaffMember, body: { customerName: string; email: string; phone: string; location: string; channel: string; needSummary: string }) {
  const id = crypto.randomUUID();
  const refCode = nextCode('enquiries', 'ref_code', 'HISO');
  db.prepare(
    "INSERT INTO enquiries (id, ref_code, customer_name, email, phone, location, channel, need_summary, appliances_json, estimate_json, status, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', NULL, 'Technical review', ?, ?)"
  ).run(id, refCode, body.customerName.trim(), body.email.trim(), body.phone.trim(), body.location.trim(), body.channel.trim(), body.needSummary.trim(), actor.id, new Date().toISOString());
  writeAudit(actor, 'CREATE_ENQUIRY', 'Enquiry', refCode, `Logged ${body.channel} enquiry for ${body.customerName}.`);
  return { id, refCode };
}

export function upsertCatalogItem(
  actor: StaffMember,
  body: {
    sku: string;
    name: string;
    itemType?: CatalogItemType;
    category: string;
    grade?: string;
    unit: string;
    priceNgn: number;
    stockQty: number;
    capacityKw?: number | null;
    watts?: number | null;
    description?: string;
    imagePath?: string;
    imageDataUrl?: string;
  }
) {
  const sku = body.sku.trim();
  const name = body.name.trim();
  const category = body.category.trim();
  const grade = (body.grade || 'Standard').trim();
  const unit = body.unit.trim();
  const itemType = body.itemType || 'equipment';
  const priceNgn = Number(body.priceNgn);
  const stockQty = Number(body.stockQty);
  const capacityKw = body.capacityKw ?? null;
  const watts = body.watts ?? null;
  if (
    !sku || sku.length > 60 || !name || name.length > 180 || !category || category.length > 80 ||
    !grade || grade.length > 60 || !unit || unit.length > 40 ||
    !['equipment', 'service', 'appliance'].includes(itemType) ||
    !Number.isFinite(priceNgn) || priceNgn < 0 ||
    !Number.isInteger(stockQty) || stockQty < 0 ||
    (capacityKw !== null && (!Number.isFinite(Number(capacityKw)) || Number(capacityKw) <= 0)) ||
    (watts !== null && (!Number.isInteger(Number(watts)) || Number(watts) <= 0))
  ) {
    throw new Error('Enter valid SKU, item details, grade, price, stock, and equipment capacity.');
  }
  const existing = db.prepare('SELECT id, image_path FROM catalog_items WHERE sku = ?').get(sku) as { id: string; image_path: string } | undefined;
  let img = body.imagePath || existing?.image_path || '/src/assets/images/catalog_hybrid_inverter_1794819207311.jpg';
  if (body.imageDataUrl) {
    const saved = saveBase64Upload(body.imageDataUrl, 'cat');
    if (!saved) throw new Error('Choose a JPEG, PNG, or WebP product photo.');
    img = `/api/catalog-image/${saved.filename}`;
  }
  const desc = (body.description || '').trim();
  if (existing) {
    db.prepare(
      'UPDATE catalog_items SET name=?, item_type=?, category=?, grade=?, unit=?, price_ngn=?, stock_qty=?, capacity_kw=?, watts=?, description=?, image_path=? WHERE sku=?'
    ).run(
      name,
      itemType,
      category,
      grade,
      unit,
      priceNgn,
      stockQty,
      capacityKw,
      watts,
      desc,
      img,
      sku
    );
  } else {
    db.prepare(
      'INSERT INTO catalog_items (id, sku, name, item_type, category, grade, unit, price_ngn, stock_qty, capacity_kw, watts, description, image_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      crypto.randomUUID(),
      sku,
      name,
      itemType,
      category,
      grade,
      unit,
      priceNgn,
      stockQty,
      capacityKw,
      watts,
      desc,
      img
    );
  }
  writeAudit(actor, 'UPSERT_CATALOG', 'Catalog', sku, `Saved Store SKU ${sku} at ₦${Number(body.priceNgn).toLocaleString()}`);
  return { imagePath: img };
}

export function deleteCatalogItem(actor: StaffMember, sku: string) {
  db.prepare('DELETE FROM catalog_items WHERE sku = ?').run(sku.trim());
  writeAudit(actor, 'DELETE_CATALOG', 'Catalog', sku, `Removed SKU ${sku} from Store`);
}

export function saveQuotation(
  actor: StaffMember,
  body: {
    quoteId?: string;
    enquiryId: string;
    customerName: string;
    scope: string;
    terms: string;
    note: string;
    discountNgn: number;
    taxPercent: number;
    validUntil: string;
    items: LineItem[];
    submitForApproval?: boolean;
  }
) {
  const totals = calculateDocumentTotals(body.items, body.discountNgn, body.taxPercent);
  const status = body.submitForApproval ? 'Pending MD' : 'Draft';
  const now = new Date().toISOString();

  let code: string;
  let savedId: string;
  if (body.quoteId) {
    savedId = body.quoteId;
    const existing = db.prepare('SELECT * FROM quotations WHERE id = ?').get(body.quoteId) as Record<string, unknown> | undefined;
    if (!existing) throw new Error('Quotation not found.');
    const revNo = Number(existing.revision_no) + 1;
    const revs = JSON.parse(String(existing.revisions_json || '[]'));
    revs.push({ revisionNo: revNo, changedBy: actor.name, note: body.note || 'Revision', createdAt: now, totalNgn: totals.total });
    db.prepare('UPDATE quotations SET status=?, revision_no=?, scope=?, terms=?, note=?, discount_ngn=?, tax_percent=?, valid_until=?, items_json=?, revisions_json=? WHERE id=?').run(
      status, revNo, body.scope, body.terms, body.note, body.discountNgn, body.taxPercent, body.validUntil, JSON.stringify(body.items), JSON.stringify(revs), body.quoteId
    );
    code = String(existing.quote_code);
  } else {
    const enquiry = db.prepare(
      'SELECT estimate_json FROM enquiries WHERE id=? AND archived_at IS NULL LIMIT 1'
    ).get(body.enquiryId) as { estimate_json: string | null } | undefined;
    if (!enquiry) throw new Error('Enquiry not found or already archived.');
    const existingQuote = db.prepare('SELECT id FROM quotations WHERE enquiry_id=? LIMIT 1').get(body.enquiryId);
    const linkedOrder = db.prepare('SELECT id FROM store_orders WHERE enquiry_id=? LIMIT 1').get(body.enquiryId);
    if (existingQuote && linkedOrder) {
      throw new Error('A quotation already exists for this Store order. Revise the existing quotation instead.');
    }
    if (!linkedOrder && !enquiry.estimate_json) {
      throw new Error('Only load-estimator enquiries and Store orders can have quotations.');
    }
    const id = crypto.randomUUID();
    savedId = id;
    code = nextCode('quotations', 'quote_code', 'QUO');
    const revs = [{ revisionNo: 1, changedBy: actor.name, note: 'Initial quotation', createdAt: now, totalNgn: totals.total }];
    db.prepare(
      'INSERT INTO quotations (id, quote_code, enquiry_id, customer_name, status, revision_no, scope, terms, note, discount_ngn, tax_percent, issued_date, valid_until, approved_by, approved_at, items_json, revisions_json, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)'
    ).run(id, code, body.enquiryId, body.customerName, status, body.scope, body.terms, body.note, body.discountNgn, body.taxPercent, isoDateOffset(0), body.validUntil || isoDateOffset(7), JSON.stringify(body.items), JSON.stringify(revs), now);
  }
  if (status === 'Pending MD') {
    notifyRoleMembers(['director', 'superadmin'], `Quotation awaiting approval: ${code}`, `${body.customerName} submitted for Director review.`, 'quotes', code);
  }
  writeAudit(actor, 'SAVE_QUOTE', 'Quotation', code, `Saved quotation (${status}).`);
  return { id: savedId, quoteCode: code };
}

export function decideQuotation(actor: StaffMember, quoteId: string, decision: 'Approved' | 'Rejected') {
  const quote = db.prepare('SELECT * FROM quotations WHERE id = ?').get(quoteId) as Record<string, unknown> | undefined;
  if (!quote) throw new Error('Quotation not found.');
  if (!['Approved', 'Rejected'].includes(decision)) throw new Error('Quotation decision is invalid.');
  if (decision === 'Approved') {
    const items = JSON.parse(String(quote.items_json || '[]')) as LineItem[];
    if (items.some((item) => item.isTbd)) {
      throw new Error('Price all To Be Determined quotation lines before approving.');
    }
  }
  db.prepare('UPDATE quotations SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?').run(decision, actor.name, new Date().toISOString(), quoteId);
  if (decision === 'Approved') {
    db.prepare('UPDATE store_orders SET status = "Confirmed", updated_at = ? WHERE enquiry_id = ?')
      .run(new Date().toISOString(), String(quote.enquiry_id));
  }
  notifyRoleMembers(['admin'], `Quotation ${decision}: ${quote.quote_code}`, `${actor.name} marked ${quote.quote_code} as ${decision}.`, 'quotes', String(quote.quote_code));
  writeAudit(actor, 'DECIDE_QUOTE', 'Quotation', String(quote.quote_code), `Marked quotation ${decision}.`);
  return { status: decision };
}

export function issueInvoice(actor: StaffMember, quotationId: string) {
  const quote = db.prepare('SELECT * FROM quotations WHERE id = ?').get(quotationId) as Record<string, unknown> | undefined;
  if (!quote || quote.status !== 'Approved') {
    throw new Error('Only Approved quotations can be converted to an invoice.');
  }
  const items = JSON.parse(String(quote.items_json)) as LineItem[];
  const totals = calculateDocumentTotals(items, Number(quote.discount_ngn), Number(quote.tax_percent));
  const enquiry = db.prepare('SELECT email, phone FROM enquiries WHERE id=? LIMIT 1')
    .get(String(quote.enquiry_id)) as { email: string; phone: string } | undefined;
  const id = crypto.randomUUID();
  const invoiceCode = nextCode('invoices', 'invoice_code', 'INV');
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO invoices (id, invoice_code, quotation_id, enquiry_id, customer_name, discount_ngn, tax_percent, total_ngn, bank_details_json, customer_accepted, accepted_at, issued_date, due_date, items_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)'
  ).run(
    id, invoiceCode, String(quote.id), String(quote.enquiry_id), String(quote.customer_name),
    Number(quote.discount_ngn), Number(quote.tax_percent), totals.total,
    JSON.stringify(getPlatformSettings().bankDetails),
    isoDateOffset(0), isoDateOffset(14), String(quote.items_json), now
  );
  db.prepare("UPDATE quotations SET status = 'Invoiced' WHERE id = ?").run(String(quote.id));
  writeAudit(actor, 'ISSUE_INVOICE', 'Invoice', invoiceCode, `Issued invoice from ${quote.quote_code}`);
  return {
    id,
    invoiceCode,
    enquiryId: String(quote.enquiry_id),
    customerName: String(quote.customer_name),
    email: String(enquiry?.email || ''),
    phone: String(enquiry?.phone || ''),
    totalNgn: totals.total,
    items,
  };
}

export function recordPayment(actor: StaffMember, body: { invoiceId: string; amountNgn: number; paymentDate: string; method: string; reference: string; evidenceNote: string }) {
  const id = crypto.randomUUID();
  const paymentCode = nextCode('payments', 'payment_code', 'PAY');
  db.prepare(
    "INSERT INTO payments (id, payment_code, invoice_id, amount_ngn, payment_date, method, reference, evidence_note, status, recorded_by, verified_by, verified_at, rejection_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, NULL, NULL, NULL, ?)"
  ).run(id, paymentCode, body.invoiceId, Number(body.amountNgn), body.paymentDate || isoDateOffset(0), body.method, body.reference, body.evidenceNote, actor.name, new Date().toISOString());
  notifyRoleMembers(['director', 'superadmin'], `Receipt pending verification: ${paymentCode}`, `₦${Number(body.amountNgn).toLocaleString()} logged by ${actor.name}.`, 'finance', paymentCode);
  writeAudit(actor, 'LOG_PAYMENT', 'Payment', paymentCode, `Logged payment receipt (${body.method}) pending verification.`);
  return { id, paymentCode };
}

export function verifyPayment(actor: StaffMember, paymentId: string, decision: 'Confirmed' | 'Rejected', reason?: string) {
  const pay = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as Record<string, unknown> | undefined;
  if (!pay) throw new Error('Payment receipt not found.');
  if (!['Confirmed', 'Rejected'].includes(decision)) throw new Error('Payment decision is invalid.');
  db.prepare('UPDATE payments SET status = ?, verified_by = ?, verified_at = ?, rejection_reason = ? WHERE id = ?').run(
    decision, actor.name, new Date().toISOString(), reason ?? null, paymentId
  );
  const invoice = db.prepare('SELECT id, total_ngn, enquiry_id FROM invoices WHERE id=? LIMIT 1')
    .get(String(pay.invoice_id)) as { id: string; total_ngn: number; enquiry_id: string } | undefined;
  let invoiceStatus: 'Pending' | 'Confirmed' | 'Completed' | null = null;
  if (invoice) {
    const confirmed = db.prepare("SELECT COALESCE(SUM(amount_ngn),0) AS paid FROM payments WHERE invoice_id=? AND status='Confirmed'")
      .get(invoice.id) as { paid: number };
    invoiceStatus = Number(confirmed.paid) >= Number(invoice.total_ngn) ? 'Completed' : Number(confirmed.paid) > 0 ? 'Confirmed' : 'Pending';
    db.prepare('UPDATE invoices SET status=? WHERE id=?').run(invoiceStatus, invoice.id);
    if (invoiceStatus === 'Completed') {
      db.prepare("UPDATE store_orders SET status='Completed', updated_at=? WHERE enquiry_id=? AND status='Delivered'")
        .run(new Date().toISOString(), invoice.enquiry_id);
    }
  }
  writeAudit(actor, 'VERIFY_PAYMENT', 'Payment', String(pay.payment_code), `${actor.name} ${decision} receipt.`);
  return { status: decision, invoiceStatus };
}

export function getPaymentInvoiceId(paymentId: string): { invoiceId: string } | null {
  const row = db.prepare('SELECT invoice_id FROM payments WHERE id = ? LIMIT 1').get(paymentId) as { invoice_id: string } | undefined;
  return row ? { invoiceId: row.invoice_id } : null;
}

export function releaseInstallation(
  actor: StaffMember,
  body: { invoiceId: string; releaseType: 'Full Payment' | 'MD Exception'; releaseNote: string; assignedEngineerId: string | null; targetDate: string; systemSummary: string }
) {
  const inv = db
    .prepare('SELECT i.*, e.location FROM invoices i JOIN enquiries e ON e.id = i.enquiry_id WHERE i.id = ? LIMIT 1')
    .get(body.invoiceId) as Record<string, unknown> | undefined;
  if (!inv) throw new Error('Invoice not found.');

  const payRows = db.prepare('SELECT amount_ngn, status FROM payments WHERE invoice_id = ?').all(String(inv.id)) as { amount_ngn: number; status: string }[];
  const bal = calculateInvoiceBalance(
    Number(inv.total_ngn),
    payRows.map((p) => ({ amountNgn: p.amount_ngn, status: p.status as PaymentRecord['status'] }))
  );

  const check = validateInstallationRelease(bal.balance, body.releaseType, body.releaseNote);
  if (!check.allowed) throw new Error(check.reason);

  const id = crypto.randomUUID();
  const jobCode = nextCode('installations', 'job_code', 'JOB');
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO installations (id, job_code, invoice_id, enquiry_id, customer_name, location, system_summary, assigned_engineer_id, engineer_acknowledged, current_stage, target_date, release_type, release_note, released_by, released_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?)'
  ).run(
    id, jobCode, String(inv.id), String(inv.enquiry_id), String(inv.customer_name), String(inv.location),
    body.systemSummary || 'Solar Hybrid Installation', body.assignedEngineerId || null,
    body.targetDate || isoDateOffset(10), body.releaseType, body.releaseNote || 'Full verified payment', actor.name, now
  );
  if (body.assignedEngineerId) {
    createNotification(body.assignedEngineerId, `New installation assigned: ${jobCode}`, `${inv.customer_name} (${inv.location}) released for delivery.`, 'jobs', jobCode);
  }
  writeAudit(actor, 'RELEASE_INSTALLATION', 'Installation', jobCode, `Released installation (${body.releaseType}).`);
  return { id, jobCode };
}

export function assignInstallation(actor: StaffMember, installationId: string, engineerId: string) {
  db.prepare('UPDATE installations SET assigned_engineer_id = ?, engineer_acknowledged = 0 WHERE id = ?').run(engineerId, installationId);
  createNotification(engineerId, 'Installation assigned', 'Review job details and acknowledge assignment.', 'jobs', installationId);
  writeAudit(actor, 'ASSIGN_TECHNICIAN', 'Installation', installationId, 'Assigned field technician.');
}

export function acknowledgeInstallation(actor: StaffMember, installationId: string) {
  const installation = db.prepare(
    'SELECT assigned_engineer_id, engineer_acknowledged FROM installations WHERE id = ? LIMIT 1'
  ).get(installationId) as { assigned_engineer_id: string | null; engineer_acknowledged: number } | undefined;
  if (!installation) throw new Error('Installation not found.');

  const canSupervise = hasPermission(actor, 'manage_enquiries') || hasPermission(actor, 'release_installations');
  if (!canAcknowledgeInstallation(actor.id, installation.assigned_engineer_id, canSupervise)) {
    throw new Error('Only the assigned engineer or an authorized supervisor can acknowledge this installation.');
  }
  if (installation.engineer_acknowledged) return;

  const updated = db.prepare(
    'UPDATE installations SET engineer_acknowledged = 1 WHERE id = ? AND (assigned_engineer_id = ? OR ? = 1)'
  ).run(installationId, actor.id, canSupervise ? 1 : 0);
  if (updated.changes !== 1) throw new Error('Installation assignment changed before it could be acknowledged.');
  writeAudit(actor, 'ACK_INSTALLATION', 'Installation', installationId, `${actor.name} acknowledged job assignment.`);
}

export function submitInstallationReport(
  actor: StaffMember,
  body: {
    installationId: string;
    stageNumber: number;
    activityTitle: string;
    reportText: string;
    isCustomerVisible: boolean;
    advanceStage: boolean;
  },
  photos: { path: string; originalName: string; mimeType: string }[]
) {
  const installation = db.prepare('SELECT assigned_engineer_id FROM installations WHERE id = ? LIMIT 1')
    .get(body.installationId) as { assigned_engineer_id: string | null } | undefined;
  if (!installation) throw new Error('Installation not found.');
  if (actor.role === 'technician' && installation.assigned_engineer_id !== actor.id) {
    throw new Error('You can only report on installations assigned to you.');
  }
  if (!body.activityTitle?.trim() || body.activityTitle.length > 160 ||
      typeof body.reportText !== 'string' || body.reportText.length > 3000) {
    throw new Error('Field report details are invalid or too long.');
  }
  if (photos.length > 8) throw new Error('A field report can include at most 8 photos.');

  const preparedPhotos = photos.map((photo) => {
    const stat = fs.statSync(photo.path);
    if (photo.mimeType !== 'image/jpeg' || stat.size <= 0 || stat.size > 4 * 1024 * 1024) {
      throw new Error('A site photo is invalid or exceeds the 4MB limit.');
    }
    const header = Buffer.alloc(3);
    const file = fs.openSync(photo.path, 'r');
    try {
      fs.readSync(file, header, 0, header.length, 0);
    } finally {
      fs.closeSync(file);
    }
    if (header[0] !== 0xff || header[1] !== 0xd8 || header[2] !== 0xff) {
      throw new Error('A site photo is not a valid JPEG image.');
    }
    return {
      ...photo,
      filename: `site-${crypto.randomUUID()}.jpg`,
      originalName: path.basename(photo.originalName).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120),
    };
  });

  const updId = crypto.randomUUID();
  const stage = Math.max(1, Math.min(5, Number(body.stageNumber) || 1));
  const now = new Date().toISOString();

  const movedFiles: string[] = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      'INSERT INTO installation_updates (id, installation_id, stage_number, activity_title, report_text, is_customer_visible, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(updId, body.installationId, stage, body.activityTitle.trim(), body.reportText.trim(), body.isCustomerVisible ? 1 : 0, actor.name, now);

    for (const photo of preparedPhotos) {
      const destination = path.join(UPLOAD_DIR, photo.filename);
      fs.renameSync(photo.path, destination);
      movedFiles.push(destination);
      db.prepare('INSERT INTO installation_photos (id, update_id, filename, original_name, mime_type, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        crypto.randomUUID(), updId, photo.filename, photo.originalName, 'image/jpeg', actor.name, now
      );
    }

    if (body.advanceStage) {
      db.prepare('UPDATE installations SET current_stage = MAX(current_stage, ?) WHERE id = ?').run(stage, body.installationId);
    }
    writeAudit(actor, 'FIELD_REPORT', 'Installation', body.installationId, `Stage ${stage}: ${body.activityTitle}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    for (const file of movedFiles) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    throw error;
  }
  return { updateId: updId };
}

export function updateServiceTicket(
  actor: StaffMember,
  body: { ticketId: string; status: TicketStatus; assignedTechId?: string | null; resolutionNote?: string }
) {
  const existing = db.prepare('SELECT * FROM service_tickets WHERE id = ? LIMIT 1').get(body.ticketId) as Record<string, unknown> | undefined;
  if (!existing) throw new Error('Service ticket not found.');

  let techName: string | null = existing.assigned_tech_name ? String(existing.assigned_tech_name) : null;
  let techId: string | null = existing.assigned_tech_id ? String(existing.assigned_tech_id) : null;

  if (body.assignedTechId !== undefined) {
    techId = body.assignedTechId || null;
    if (techId) {
      const u = db.prepare('SELECT name FROM users WHERE id = ? LIMIT 1').get(techId) as { name: string } | undefined;
      techName = u?.name ?? null;
      createNotification(techId, `Service ticket assigned: ${existing.ticket_code}`, `${existing.customer_name} (${existing.location}) — ${existing.subject}`, 'tickets', String(existing.ticket_code));
    } else {
      techName = null;
    }
  }

  db.prepare(
    'UPDATE service_tickets SET status=?, assigned_tech_id=?, assigned_tech_name=?, resolution_note=?, updated_at=? WHERE id=?'
  ).run(
    body.status,
    techId,
    techName,
    (body.resolutionNote ?? String(existing.resolution_note || '')).trim(),
    new Date().toISOString(),
    body.ticketId
  );

  writeAudit(actor, 'UPDATE_TICKET', 'ServiceTicket', String(existing.ticket_code), `Ticket ${existing.ticket_code} marked ${body.status}${techName ? ` (${techName})` : ''}.`);
}

export function saveRoleDefinition(
  actor: StaffMember,
  body: { id?: string; name: string; description: string; permissions: PermissionKey[] }
): { id: string } {
  const cleanName = body.name.trim();
  if (!cleanName) throw new Error('Role name is required.');
  const slug =
    body.id?.trim() ||
    cleanName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  if (!slug) throw new Error('Invalid role identifier.');
  if (slug === 'superadmin') throw new Error('Built-in Super Admin role permissions are locked.');

  const existing = db.prepare('SELECT id, is_system FROM roles WHERE id = ?').get(slug) as { id: string; is_system: number } | undefined;
  const now = new Date().toISOString();
  if (existing) {
    db.prepare('UPDATE roles SET name = ?, description = ?, permissions_json = ? WHERE id = ?').run(
      cleanName,
      body.description.trim(),
      JSON.stringify(body.permissions),
      slug
    );
  } else {
    db.prepare('INSERT INTO roles (id, name, description, permissions_json, is_system, created_at) VALUES (?, ?, ?, ?, 0, ?)').run(
      slug,
      cleanName,
      body.description.trim(),
      JSON.stringify(body.permissions),
      now
    );
  }
  writeAudit(actor, 'SAVE_ROLE', 'Role', slug, `Configured role "${cleanName}" (${body.permissions.length} permissions).`);
  return { id: slug };
}

export function saveStaffMember(
  actor: StaffMember,
  body: { id?: string; name: string; username: string; email: string; phone: string; role: UserRole; title: string; skills: string; status: StaffStatus; password?: string }
): { id: string } | { id: string; name: string; username: string; email: string; phone: string; pin: string } {
  const username = body.username.trim().toLowerCase();
  if ((!body.id && !username) || (username && !/^[a-z0-9._-]{3,50}$/.test(username))) {
    throw new Error('Username must be 3–50 characters using letters, numbers, dots, underscores, or hyphens.');
  }
  const email = body.email.trim().toLowerCase();
  if (!body.name.trim() || body.name.trim().length > 120
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190
      || body.phone.trim().length > 40 || body.title.trim().length > 120
      || body.skills.trim().length > 4000) {
    throw new Error('Valid staff name, email, phone, title, and skills are required.');
  }
  const usernameOwner = username
    ? db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username) as { id: string } | undefined
    : undefined;
  if (usernameOwner && usernameOwner.id !== body.id) {
    throw new Error('That username is already in use.');
  }
  if (!body.id && actor.role !== 'superadmin') {
    throw new Error('Only Super Admin can create staff accounts.');
  }
  if (body.password !== undefined && body.password.trim().length > 0 && body.password.trim().length < 12) {
    throw new Error('Staff passwords must be at least 12 characters.');
  }
  if (body.role === 'superadmin' && actor.role !== 'superadmin') {
    throw new Error('Only Super Admin can assign or modify Super Admin accounts.');
  }

  const jobs = (db.prepare('SELECT assigned_engineer_id, current_stage FROM installations').all() as { assigned_engineer_id: string | null; current_stage: number }[]).map((j) => ({
    assignedEngineerId: j.assigned_engineer_id,
    currentStage: j.current_stage as InstallationRecord['currentStage'],
  }));

  if (body.id) {
    const existing = db.prepare('SELECT role, username, phone FROM users WHERE id = ?').get(body.id) as { role: string; username: string | null; phone: string } | undefined;
    if (!existing) throw new Error('Staff account not found.');
    const nextUsername = username || existing.username;
    if (actor.role !== 'superadmin' && (existing.role !== body.role || existing.username !== nextUsername)) {
      throw new Error('Only Super Admin can change usernames or assign roles.');
    }
    const check = canUpdateStaffStatusOrRole(body.id, body.role, body.status, jobs);
    if (!check.allowed) throw new Error(check.reason);
    db.prepare('UPDATE users SET name=?, username=?, phone=?, role=?, title=?, skills=?, status=? WHERE id=?').run(
      body.name.trim(), nextUsername ?? null, body.phone.trim(), body.role, body.title.trim(), body.skills.trim(), body.status, body.id
    );
    if (existing.phone.trim() !== body.phone.trim()) {
      db.prepare("UPDATE whatsapp_recipient_consents SET revoked_at = ? WHERE recipient_type = 'staff' AND recipient_id = ? AND revoked_at IS NULL")
        .run(new Date().toISOString(), body.id);
    }
    if (body.password && body.password.trim().length >= 12) {
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(body.password.trim()), body.id);
    }
    writeAudit(actor, 'UPDATE_STAFF', 'Staff', body.id, `Updated staff record for ${body.name}`);
    return { id: body.id };
  }

  const id = crypto.randomUUID();
  const pin = makeInitialPin();
  db.prepare(
    "INSERT INTO users (id, name, username, email, phone, password_hash, initial_pin_hash, pin_expires_at, must_set_password, role, title, skills, status, created_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'Active', ?)"
  ).run(
    id,
    body.name.trim(),
    username,
    email,
    body.phone.trim(),
    hashPassword(crypto.randomBytes(32).toString('hex')),
    hashPassword(pin),
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    body.role,
    body.title.trim(),
    body.skills.trim(),
    new Date().toISOString(),
  );
  writeAudit(actor, 'CREATE_STAFF', 'Staff', id, `Created staff account for ${body.name} (${body.role})`);
  return { id, name: body.name.trim(), email, phone: body.phone.trim(), username, pin };
}

export function markNotificationsRead(userId: string): void {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(userId);
}

export function getHomepageSections(): Partial<Record<string, { heading: string; body: string; enabled: boolean }>> {
  const rows = db.prepare('SELECT section_id, heading, body, enabled FROM homepage_sections')
    .all() as { section_id: string; heading: string; body: string; enabled: number }[];
  const content: Partial<Record<string, { heading: string; body: string; enabled: boolean }>> = {};
  for (const row of rows) {
    content[row.section_id] = {
      heading: row.heading,
      body: row.body,
      enabled: row.enabled === 1,
    };
  }
  return content;
}

export function saveHomepageSections(
  content: Record<string, { heading: string; body: string; enabled: boolean }>,
  userId: string,
): void {
  const sectionIds = ['hero', 'workflow', 'about', 'services', 'projects', 'pricing'];
  const saveSection = db.prepare(`INSERT INTO homepage_sections
    (section_id, heading, body, enabled, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(section_id) DO UPDATE SET
      heading = excluded.heading,
      body = excluded.body,
      enabled = excluded.enabled,
      updated_by = excluded.updated_by,
      updated_at = CURRENT_TIMESTAMP`);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sectionId of sectionIds) {
      const section = content[sectionId];
      saveSection.run(sectionId, section.heading, section.body, section.enabled ? 1 : 0, userId);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getPhotoFile(photoId: string, isAuthedStaff: boolean): { filePath: string; mimeType: string } | null {
  const row = db
    .prepare('SELECT p.filename, p.mime_type, u.is_customer_visible FROM installation_photos p JOIN installation_updates u ON u.id = p.update_id WHERE p.id = ? LIMIT 1')
    .get(photoId) as { filename: string; mime_type: string; is_customer_visible: number } | undefined;
  if (!row) return null;
  if (!isAuthedStaff && !row.is_customer_visible) return null;
  const full = path.join(UPLOAD_DIR, path.basename(row.filename));
  if (!fs.existsSync(full)) return null;
  return { filePath: full, mimeType: row.mime_type };
}

export function getUploadedCatalogImage(filename: string): { filePath: string; mimeType: string } | null {
  const safe = path.basename(filename);
  const full = path.join(UPLOAD_DIR, safe);
  if (!fs.existsSync(full)) return null;
  const mimeType = safe.endsWith('.png') ? 'image/png' : safe.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  return { filePath: full, mimeType };
}
