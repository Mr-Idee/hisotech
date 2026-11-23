import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tempDir = '';
let originalCwd = '';
let database: DatabaseSync | undefined;
let db: typeof import('./db') | undefined;

before(async () => {
  originalCwd = process.cwd();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hiso-communications-'));
  process.chdir(tempDir);
  db = await import('./db');
  database = new DatabaseSync(path.join(tempDir, '.hiso_preview.sqlite'));
});

after(() => {
  db?.closeDatabase();
  database?.close();
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('group delivery includes only currently consented customers and reports skipped members', () => {
  const now = new Date().toISOString();
  const activeId = '11111111-1111-4111-8111-111111111111';
  const noConsentId = '22222222-2222-4222-8222-222222222222';
  const addCustomer = (id: string, phone: string) => database!.prepare(
    'INSERT INTO customer_profiles (id, name, email, phone, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, `Customer ${id[0]}`, `${id[0]}@example.com`, phone, now, now);
  addCustomer(activeId, '+2348012345678');
  addCustomer(noConsentId, '+2348012345679');
  database!.prepare(
    'INSERT INTO communications_consents (customer_id, channel, consented_at, revoked_at, updated_at) VALUES (?, ?, ?, NULL, ?)'
  ).run(activeId, 'email', now, now);
  database!.prepare(
    'INSERT INTO communications_consents (customer_id, channel, consented_at, revoked_at, updated_at) VALUES (?, ?, ?, NULL, ?)'
  ).run(activeId, 'whatsapp', now, now);

  const group = db!.saveCustomerContactGroup({
    name: 'Regional customers',
    customerIds: [activeId, noConsentId],
  }, 'staff-id');
  const emailResult = db!.getCustomerContactGroupRecipients(group.id, 'email');
  const whatsappResult = db!.getCustomerContactGroupRecipients(group.id, 'whatsapp');
  assert.deepEqual(emailResult.contacts.map((contact) => contact.id), [activeId]);
  assert.deepEqual(whatsappResult.contacts.map((contact) => contact.id), [activeId]);
  assert.equal(emailResult.skipped, 1);
  assert.equal(whatsappResult.skipped, 1);

  const secondGroup = db!.saveCustomerContactGroup({
    name: 'Newsletter customers',
    customerIds: [activeId],
  }, 'staff-id');
  assert.deepEqual(
    db!.listCustomerContactGroups().find((item) => item.id === secondGroup.id)?.customerIds,
    [activeId],
  );
  assert.throws(
    () => db!.saveCustomerContactGroup({ name: 'Invalid group', customerIds: ['33333333-3333-4333-8333-333333333333'] }, 'staff-id'),
    /existing, verified customer accounts/,
  );
});

test('push group resolution includes subscribed verified members and counts skipped members', () => {
  const now = new Date().toISOString();
  const subscribedId = '77777777-7777-4777-8777-777777777777';
  const unsubscribedId = '88888888-8888-4888-8888-888888888888';
  for (const [id, name] of [[subscribedId, 'Subscribed'], [unsubscribedId, 'Unsubscribed']]) {
    database!.prepare(
      'INSERT INTO customer_profiles (id, name, email, phone, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, name, `${name.toLowerCase()}@example.com`, '+2348012345678', now, now);
  }
  const group = db!.saveCustomerContactGroup({
    name: 'Push subscribers',
    customerIds: [subscribedId, unsubscribedId],
  }, 'staff-id');
  database!.prepare(
    'INSERT INTO push_subscriptions (id, owner_type, owner_id, endpoint_hash, endpoint, p256dh, auth_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('sub-id', 'customer', subscribedId, 'endpoint-hash', 'https://push.example/sub', 'key', 'auth', now, now);

  assert.deepEqual(db!.getCustomerContactGroupPushRecipients(group.id), {
    customerIds: [subscribedId],
    skipped: 1,
  });
  assert.throws(() => db!.getCustomerContactGroupPushRecipients('invalid'), /Contact group ID is invalid/);
});

test('WhatsApp send resolution distinguishes invalid phone format from missing marketing consent', () => {
  const now = new Date().toISOString();
  const customerId = '44444444-4444-4444-8444-444444444444';
  database!.prepare(
    'INSERT INTO customer_profiles (id, name, email, phone, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(customerId, 'Invalid phone', 'invalid-phone@example.com', '08012345678', now, now);
  database!.prepare(
    'INSERT INTO communications_consents (customer_id, channel, consented_at, revoked_at, updated_at) VALUES (?, ?, ?, NULL, ?)'
  ).run(customerId, 'whatsapp', now, now);
  assert.equal(db!.getWhatsAppConsentContact('customer', customerId, 'marketing'), null);
  assert.equal(
    db!.getWhatsAppConsentContact('customer', customerId, 'marketing', true)?.phone,
    '08012345678',
  );
});

test('staff profile editing preserves email and withdraws consent bound to the old phone', () => {
  const now = new Date().toISOString();
  const staffId = '55555555-5555-4555-8555-555555555555';
  database!.prepare(
    'INSERT INTO users (id, name, email, phone, password_hash, role, title, skills, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(staffId, 'Before Name', 'staff@example.com', '+2348012345678', 'hash', 'admin', 'Admin', '', 'Active', now);
  database!.prepare(
    'INSERT INTO whatsapp_recipient_consents (recipient_type, recipient_id, purpose, phone_at_consent, consented_at, consent_source) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('staff', staffId, 'marketing', '+2348012345678', now, 'test');

  const updated = db!.saveStaffProfile(staffId, { name: 'Updated Name', phone: '+2348098765432' });
  assert.equal(updated.name, 'Updated Name');
  assert.equal(updated.phone, '+2348098765432');
  assert.equal(updated.email, 'staff@example.com');
  assert.equal(
    (database!.prepare('SELECT revoked_at FROM whatsapp_recipient_consents WHERE recipient_type=? AND recipient_id=? AND purpose=?')
      .get('staff', staffId, 'marketing') as { revoked_at: string }).revoked_at !== null,
    true,
  );
});

test('staff profile photos reject dimensions beyond the compressed image limit', () => {
  const now = new Date().toISOString();
  const staffId = '66666666-6666-4666-8666-666666666666';
  database!.prepare(
    'INSERT INTO users (id, name, email, phone, password_hash, role, title, skills, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(staffId, 'Photo User', 'photo@example.com', '', 'hash', 'admin', 'Admin', '', 'Active', now);
  const oversizedJpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x82]),
    Buffer.alloc(128),
    Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, 0x05, 0xa1, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]),
  ]);
  assert.throws(() => db!.saveStaffProfile(staffId, {
    name: 'Photo User',
    phone: '',
    photoDataUrl: `data:image/jpeg;base64,${oversizedJpeg.toString('base64')}`,
  }), /larger than 1440px/);
});
