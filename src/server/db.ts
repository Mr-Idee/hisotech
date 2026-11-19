import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ALL_PERMISSIONS,
  calculateDocumentTotals,
  calculateInvoiceBalance,
  calculateStoreOrderTotals,
  canUpdateStaffStatusOrRole,
  hasPermission,
  ROLE_DEFAULT_PERMISSIONS,
  validateInstallationRelease,
} from '../lib/solar';
import type {
  AuditLogRecord,
  CatalogItem,
  CatalogItemType,
  CustomerEquipment,
  CustomerProfile,
  EnquiryRecord,
  InstallationRecord,
  InvoiceRecord,
  LineItem,
  NotificationRecord,
  OrderDeliveryMethod,
  OrderPaymentMethod,
  PaymentRecord,
  PermissionKey,
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
  WorkspaceBootstrap,
} from '../lib/types';

const DB_PATH = path.resolve(process.cwd(), '.hiso_preview.sqlite');
const UPLOAD_DIR = path.resolve(process.cwd(), '.hiso_uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

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
ensureColumn('customer_profiles', 'email_verified_at', 'email_verified_at TEXT');
ensureColumn('users', 'username', 'username TEXT');
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username ON users(username) WHERE username IS NOT NULL AND username <> ''");

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
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

function hydrateStaffRow(row: Record<string, unknown>, rolesMap: Map<string, RoleDefinition>): StaffMember {
  const roleId = String(row.role);
  const roleDef = rolesMap.get(roleId);
  return {
    id: String(row.id),
    name: String(row.name),
    username: row.username ? String(row.username) : undefined,
    email: String(row.email),
    phone: String(row.phone),
    role: roleId as UserRole,
    roleName: roleDef?.name ?? roleId,
    permissions: roleId === 'superadmin'
      ? ALL_PERMISSIONS.map((p) => p.key)
      : roleDef?.permissions ?? ROLE_DEFAULT_PERMISSIONS[roleId] ?? [],
    title: String(row.title),
    skills: String(row.skills),
    status: row.status as StaffStatus,
    createdAt: String(row.created_at),
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

export function authenticateUser(identifier: string, password: string): { token: string; user: StaffMember } | null {
  const row = db
    .prepare("SELECT * FROM users WHERE (LOWER(email) = ? OR LOWER(username) = ?) AND status = 'Active' LIMIT 1")
    .get(identifier.trim().toLowerCase(), identifier.trim().toLowerCase()) as Record<string, unknown> | undefined;
  if (!row) return null;
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
  appliances?: unknown[];
  estimate?: unknown;
}): { id: string; refCode: string } {
  const id = crypto.randomUUID();
  const refCode = nextCode('enquiries', 'ref_code', 'HISO');
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO enquiries (id, ref_code, customer_name, email, phone, location, channel, need_summary, appliances_json, estimate_json, status, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'New', 'admin-idee', ?)"
  ).run(
    id,
    refCode,
    payload.customerName.trim(),
    (payload.email || '').trim(),
    payload.phone.trim(),
    payload.location.trim(),
    (payload.channel || 'Website · Load Estimator').trim(),
    payload.needSummary.trim(),
    JSON.stringify(payload.appliances ?? []),
    payload.estimate ? JSON.stringify(payload.estimate) : null,
    now
  );
  notifyRoleMembers(['superadmin', 'director', 'admin'], `New solar enquiry ${refCode}`, `${payload.customerName} (${payload.location}) submitted an enquiry.`, 'enquiries', id);
  writeAudit({ name: payload.customerName, role: 'customer' }, 'CREATE_ENQUIRY', 'Enquiry', refCode, 'Submitted enquiry via website / estimator.');
  return { id, refCode };
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
  const existing = db.prepare('SELECT * FROM store_orders WHERE id = ? LIMIT 1').get(body.orderId) as Record<string, unknown> | undefined;
  if (!existing) throw new Error('Store order not found.');
  const now = new Date().toISOString();
  const nextNotes = body.notes !== undefined ? body.notes.trim() : String(existing.notes || '');
  db.prepare('UPDATE store_orders SET status = ?, notes = ?, updated_at = ? WHERE id = ?').run(
    body.status,
    nextNotes,
    now,
    body.orderId
  );
  if (body.status === 'Delivered') {
    db.prepare("UPDATE enquiries SET status = 'Completed' WHERE id = ?").run(String(existing.enquiry_id));
  }
  writeAudit(actor, 'UPDATE_ORDER', 'StoreOrder', String(existing.order_code), `Marked Store order ${existing.order_code} as ${body.status}.`);
}

export function getPublicTracking(refCode: string) {
  const cleanRef = refCode.trim().toUpperCase();
  let orderRow = db.prepare('SELECT * FROM store_orders WHERE UPPER(order_code) = ? LIMIT 1').get(cleanRef) as Record<string, unknown> | undefined;
  let enq = orderRow
    ? (db.prepare('SELECT * FROM enquiries WHERE id = ? LIMIT 1').get(String(orderRow.enquiry_id)) as Record<string, unknown> | undefined)
    : (db.prepare('SELECT * FROM enquiries WHERE UPPER(ref_code) = ? LIMIT 1').get(cleanRef) as Record<string, unknown> | undefined);

  if (!enq) return null;
  if (!orderRow) {
    orderRow = db.prepare('SELECT * FROM store_orders WHERE enquiry_id = ? ORDER BY created_at DESC LIMIT 1').get(String(enq.id)) as Record<string, unknown> | undefined;
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

export function getPublicDocument(type: 'quote' | 'invoice', idOrCode: string) {
  if (type === 'invoice') {
    const row = db
      .prepare('SELECT i.*, e.location, e.phone, e.email, e.ref_code FROM invoices i JOIN enquiries e ON e.id = i.enquiry_id WHERE i.id = ? OR i.invoice_code = ? LIMIT 1')
      .get(idOrCode, idOrCode) as Record<string, unknown> | undefined;
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
  const row = db
    .prepare('SELECT q.*, e.location, e.phone, e.email, e.ref_code FROM quotations q JOIN enquiries e ON e.id = q.enquiry_id WHERE q.id = ? OR q.quote_code = ? LIMIT 1')
    .get(idOrCode, idOrCode) as Record<string, unknown> | undefined;
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

export function acceptInvoiceByCustomer(invoiceId: string): void {
  db.prepare('UPDATE invoices SET customer_accepted = 1, accepted_at = ? WHERE id = ?').run(new Date().toISOString(), invoiceId);
}

// --- Customer Portal Operations ---
function getCustomerEquipmentList(customerId: string): CustomerEquipment[] {
  return (db.prepare('SELECT * FROM customer_equipment WHERE customer_id = ? ORDER BY created_at DESC').all(customerId) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    customerId: String(r.customer_id),
    equipmentType: String(r.equipment_type),
    brandModel: String(r.brand_model),
    serialNumber: String(r.serial_number),
    capacityKw: String(r.capacity_kw),
    installDate: String(r.install_date),
    notes: String(r.notes),
    createdAt: String(r.created_at),
  }));
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
    .prepare('SELECT * FROM customer_profiles WHERE id = ? AND email_verified_at IS NOT NULL LIMIT 1')
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
  };
  const equipment = getCustomerEquipmentList(customerId);
  const tickets = (
    db.prepare('SELECT * FROM service_tickets WHERE customer_id = ? ORDER BY created_at DESC').all(customerId) as Record<string, unknown>[]
  ).map(hydrateTicketRow);
  return { profile, equipment, tickets };
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

  let row = db.prepare('SELECT * FROM customer_profiles WHERE LOWER(email) = ? LIMIT 1').get(email) as Record<string, unknown> | undefined;
  const createdAt = nowIso;
  if (!row) {
    if (!name) return { token: null, email: null };
    const id = crypto.randomUUID();
    db.prepare(
      'INSERT INTO customer_profiles (id, name, email, phone, location, company, ref_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id,
      name,
      email,
      phone,
      location,
      company,
      refCode,
      createdAt
    );
    row = db.prepare('SELECT * FROM customer_profiles WHERE id = ?').get(id) as Record<string, unknown>;
  }
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('DELETE FROM customer_login_tokens WHERE customer_id = ?').run(String(row.id));
  db.prepare('INSERT INTO customer_login_tokens (token_hash, customer_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash, String(row.id), new Date(Date.now() + 15 * 60 * 1000).toISOString());
  return { token, email };
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
    'SELECT customer_id FROM customer_login_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? LIMIT 1'
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
    'SELECT customer_id FROM customer_sessions WHERE token_hash = ? AND expires_at > ? LIMIT 1'
  ).get(sessionHash, new Date().toISOString()) as { customer_id: string } | undefined;
  if (!session) return null;
  return customerPortalData(session.customer_id);
}

export function destroyCustomerSession(token: string | undefined): void {
  if (!token) return;
  const sessionHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('DELETE FROM customer_sessions WHERE token_hash = ?').run(sessionHash);
}

export function saveCustomerProfile(payload: {
  customerId: string;
  name: string;
  phone: string;
  location: string;
  company: string;
  refCode: string;
}): CustomerProfile {
  db.prepare(
    'UPDATE customer_profiles SET name = ?, phone = ?, location = ?, company = ?, ref_code = ? WHERE id = ? AND email_verified_at IS NOT NULL'
  ).run(payload.name.trim(), payload.phone.trim(), payload.location.trim(), payload.company.trim(), payload.refCode.trim(), payload.customerId);
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
}): CustomerEquipment[] {
  const customer = db.prepare('SELECT id FROM customer_profiles WHERE id = ? AND email_verified_at IS NOT NULL').get(customerId);
  if (!customer) throw new Error('Verified customer profile not found.');
  const now = new Date().toISOString();
  if (payload.id) {
    db.prepare(
      'UPDATE customer_equipment SET equipment_type=?, brand_model=?, serial_number=?, capacity_kw=?, install_date=?, notes=? WHERE id=? AND customer_id=?'
    ).run(payload.equipmentType, payload.brandModel, payload.serialNumber, payload.capacityKw, payload.installDate, payload.notes, payload.id, customerId);
  } else {
    db.prepare(
      'INSERT INTO customer_equipment (id, customer_id, equipment_type, brand_model, serial_number, capacity_kw, install_date, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(crypto.randomUUID(), customerId, payload.equipmentType, payload.brandModel, payload.serialNumber, payload.capacityKw, payload.installDate, payload.notes, now);
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
    : (db.prepare('SELECT * FROM enquiries ORDER BY created_at DESC').all() as Record<string, unknown>[]).map((e) => ({
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

  return {
    user,
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
  if (body.quoteId) {
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
    const id = crypto.randomUUID();
    code = nextCode('quotations', 'quote_code', 'QUO');
    const revs = [{ revisionNo: 1, changedBy: actor.name, note: 'Initial quotation', createdAt: now, totalNgn: totals.total }];
    db.prepare(
      'INSERT INTO quotations (id, quote_code, enquiry_id, customer_name, status, revision_no, scope, terms, note, discount_ngn, tax_percent, issued_date, valid_until, approved_by, approved_at, items_json, revisions_json, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)'
    ).run(id, code, body.enquiryId, body.customerName, status, body.scope, body.terms, body.note, body.discountNgn, body.taxPercent, isoDateOffset(0), body.validUntil || isoDateOffset(7), JSON.stringify(body.items), JSON.stringify(revs), now);
    db.prepare("UPDATE enquiries SET status = 'Quoted' WHERE id = ? AND status IN ('New','Technical review')").run(body.enquiryId);
  }
  if (status === 'Pending MD') {
    notifyRoleMembers(['director', 'superadmin'], `Quotation awaiting approval: ${code}`, `${body.customerName} submitted for Director review.`, 'quotes', code);
  }
  writeAudit(actor, 'SAVE_QUOTE', 'Quotation', code, `Saved quotation (${status}).`);
  return { quoteCode: code };
}

export function decideQuotation(actor: StaffMember, quoteId: string, decision: 'Approved' | 'Rejected') {
  const quote = db.prepare('SELECT * FROM quotations WHERE id = ?').get(quoteId) as Record<string, unknown> | undefined;
  if (!quote) throw new Error('Quotation not found.');
  db.prepare('UPDATE quotations SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?').run(decision, actor.name, new Date().toISOString(), quoteId);
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
  const id = crypto.randomUUID();
  const invoiceCode = nextCode('invoices', 'invoice_code', 'INV');
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO invoices (id, invoice_code, quotation_id, enquiry_id, customer_name, discount_ngn, tax_percent, total_ngn, bank_details_json, customer_accepted, accepted_at, issued_date, due_date, items_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)'
  ).run(
    id, invoiceCode, String(quote.id), String(quote.enquiry_id), String(quote.customer_name),
    Number(quote.discount_ngn), Number(quote.tax_percent), totals.total,
    JSON.stringify({ bankName: 'Example Bank', accountName: 'DEMO ONLY - DO NOT PAY', accountNumber: '0000000000' }),
    isoDateOffset(0), isoDateOffset(14), String(quote.items_json), now
  );
  db.prepare("UPDATE quotations SET status = 'Invoiced' WHERE id = ?").run(String(quote.id));
  db.prepare("UPDATE enquiries SET status = 'Invoiced' WHERE id = ?").run(String(quote.enquiry_id));
  writeAudit(actor, 'ISSUE_INVOICE', 'Invoice', invoiceCode, `Issued invoice from ${quote.quote_code}`);
  return { id, invoiceCode };
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
  db.prepare('UPDATE payments SET status = ?, verified_by = ?, verified_at = ?, rejection_reason = ? WHERE id = ?').run(
    decision, actor.name, new Date().toISOString(), reason ?? null, paymentId
  );
  writeAudit(actor, 'VERIFY_PAYMENT', 'Payment', String(pay.payment_code), `${actor.name} ${decision} receipt.`);
  return { status: decision };
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
  db.prepare("UPDATE enquiries SET status = 'In delivery' WHERE id = ?").run(String(inv.enquiry_id));
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
  db.prepare('UPDATE installations SET engineer_acknowledged = 1 WHERE id = ?').run(installationId);
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
      if (stage === 5) {
        const job = db.prepare('SELECT enquiry_id FROM installations WHERE id = ?').get(body.installationId) as { enquiry_id: string } | undefined;
        if (job) {
          db.prepare("UPDATE enquiries SET status = 'Completed' WHERE id = ?").run(job.enquiry_id);
        }
      }
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
) {
  const username = body.username.trim().toLowerCase();
  if ((!body.id && !username) || (username && !/^[a-z0-9._-]{3,50}$/.test(username))) {
    throw new Error('Username must be 3–50 characters using letters, numbers, dots, underscores, or hyphens.');
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
    const existing = db.prepare('SELECT role, username FROM users WHERE id = ?').get(body.id) as { role: string; username: string | null } | undefined;
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
    if (body.password && body.password.trim().length >= 12) {
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(body.password.trim()), body.id);
    }
    writeAudit(actor, 'UPDATE_STAFF', 'Staff', body.id, `Updated staff record for ${body.name}`);
    return { id: body.id };
  }

  const id = crypto.randomUUID();
  if (!body.password || body.password.trim().length < 12) {
    throw new Error('A staff password of at least 12 characters is required.');
  }
  db.prepare(
    "INSERT INTO users (id, name, username, email, phone, password_hash, role, title, skills, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?)"
  ).run(id, body.name.trim(), username, body.email.trim().toLowerCase(), body.phone.trim(), hashPassword(body.password.trim()), body.role, body.title.trim(), body.skills.trim(), new Date().toISOString());
  writeAudit(actor, 'CREATE_STAFF', 'Staff', id, `Created staff account for ${body.name} (${body.role})`);
  return { id };
}

export function markNotificationsRead(userId: string): void {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(userId);
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
