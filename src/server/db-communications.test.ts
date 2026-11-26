import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
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
  database?.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;');
  database?.close();
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('WhatsApp group delivery includes saved numbers without consent while email remains consent-gated', () => {
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
  assert.deepEqual(whatsappResult.contacts.map((contact) => contact.id), [activeId, noConsentId]);
  assert.equal(emailResult.skipped, 1);
  assert.equal(whatsappResult.skipped, 0);
  assert.equal(db!.getWhatsAppContact('customer', noConsentId)?.phone, '+2348012345679');
  assert.ok(db!.listWhatsAppContacts().some((contact) => contact.id === noConsentId && contact.recipientType === 'customer'));

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

test('service WhatsApp replies resolve only active customer requests and do not widen marketing consent', () => {
  const now = new Date().toISOString();
  const enquiryId = 'c1111111-1111-4111-8111-111111111111';
  const archivedEnquiryId = 'c2222222-2222-4222-8222-222222222222';
  const ticketId = 'c3333333-3333-4333-8333-333333333333';
  const resolvedTicketId = 'c4444444-4444-4444-8444-444444444444';
  const addEnquiry = (id: string, refCode: string, archivedAt: string | null) => database!.prepare(
    'INSERT INTO enquiries (id, ref_code, customer_name, email, phone, location, channel, need_summary, status, archived_at, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, refCode, 'Service customer', 'service@example.com', '+2348012345678', 'Lagos', 'Website', 'Solar consultation', 'New', archivedAt, 'service-test-staff', now);
  addEnquiry(enquiryId, 'HISO-SERVICE-1', null);
  addEnquiry(archivedEnquiryId, 'HISO-SERVICE-2', now);
  const addTicket = (id: string, code: string, status: string) => database!.prepare(
    'INSERT INTO service_tickets (id, ticket_code, customer_id, customer_name, customer_phone, location, category, subject, description, status, resolution_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, code, `customer-${id}`, 'Ticket customer', '+2348098765432', 'Abuja', 'Service Request', 'Inverter check', 'Please check the inverter.', status, '', now, now);
  addTicket(ticketId, 'HISO-TICKET-1', 'Open');
  addTicket(resolvedTicketId, 'HISO-TICKET-2', 'Resolved');

  const requests = db!.listWhatsAppServiceRequests();
  assert.deepEqual(
    requests.filter((request) => [enquiryId, archivedEnquiryId, ticketId, resolvedTicketId].includes(request.id))
      .map((request) => `${request.requestType}:${request.id}`).sort(),
    [`enquiry:${enquiryId}`, `ticket:${ticketId}`].sort(),
  );
  assert.equal(db!.getWhatsAppServiceRequestContact('enquiry', enquiryId)?.phone, '+2348012345678');
  assert.equal(db!.getWhatsAppServiceRequestContact('enquiry', archivedEnquiryId), null);
  assert.equal(db!.getWhatsAppServiceRequestContact('ticket', resolvedTicketId), null);
  assert.equal(db!.getWhatsAppConsentContact('enquiry', enquiryId, 'marketing'), null);
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

test('staff onboarding PIN, authentication type changes, and reset links are single-use', () => {
  const now = new Date().toISOString();
  const staffId = '99999999-9999-4999-8999-999999999999';
  const legacyHash = (value: string) => createHash('sha256').update(`hiso_salt:${value}`).digest('hex');
  database!.prepare(
    'INSERT INTO users (id, name, username, email, email_verified_at, phone, password_hash, initial_pin_hash, pin_expires_at, must_set_password, role, title, skills, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(staffId, 'Auth User', 'auth-user', 'auth-user@example.com', now, '', legacyHash('unusable'), legacyHash('1234'),
    new Date(Date.now() + 60_000).toISOString(), 1, 'admin', 'Admin', '', 'Active', now);

  assert.deepEqual(db!.authenticateUser('auth-user', '1234'), { setupRequired: true });
  db!.setupStaffPassword('auth-user@example.com', '1234', 'initial password 123');
  assert.ok(db!.authenticateUser('auth-user@example.com', 'initial password 123'));

  const pinUser = db!.saveStaffAuthentication(staffId, 'initial password 123', 'pin', '123456');
  assert.equal(pinUser.authType, 'pin');
  assert.ok(db!.authenticateUser('auth-user', '123456'));
  assert.equal(db!.authenticateUser('auth-user', 'initial password 123'), null);

  const reset = db!.createStaffPasswordResetToken('auth-user@example.com');
  assert.ok(reset);
  db!.resetStaffPassword(reset!.token, 'reset password 123');
  assert.throws(() => db!.resetStaffPassword(reset!.token, 'another password 123'), /invalid or has expired/);
  const passwordUser = db!.authenticateUser('auth-user', 'reset password 123');
  assert.ok(passwordUser && 'token' in passwordUser);
  assert.equal(passwordUser.user.authType, 'password');
});

test('staff and customer setup PINs lock after ten total wrong attempts', () => {
  const now = new Date().toISOString();
  const staffId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const customerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const legacyHash = (value: string) => createHash('sha256').update(`hiso_salt:${value}`).digest('hex');
  database!.prepare(
    'INSERT INTO users (id, name, username, email, email_verified_at, phone, password_hash, initial_pin_hash, pin_expires_at, must_set_password, role, title, skills, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(staffId, 'Locked Staff', 'locked-staff', 'locked-staff@example.com', now, '', legacyHash('unused'),
    legacyHash('5678'), new Date(Date.now() + 60_000).toISOString(), 1, 'admin', 'Admin', '', 'Active', now);
  database!.prepare(
    'INSERT INTO customer_profiles (id, name, email, phone, location, company, ref_code, initial_pin_hash, pin_expires_at, must_set_password, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(customerId, 'Locked Customer', 'locked-customer@example.com', '', '', '', 'HISO-LOCKED',
    legacyHash('9876'), new Date(Date.now() + 60_000).toISOString(), 1, now);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (attempt % 2 === 0) {
      assert.equal(db!.authenticateUser('locked-staff', '0000'), null);
    } else {
      assert.throws(() => db!.setupStaffPassword('locked-staff', '0000', 'staff password 123'));
    }
    assert.throws(() => db!.setupCustomerPassword('locked-customer@example.com', '0000', 'customer password 123'));
  }
  assert.equal(db!.authenticateUser('locked-staff', '5678'), null);
  assert.throws(() => db!.setupStaffPassword('locked-staff', '5678', 'staff password 123'));
  assert.throws(() => db!.setupCustomerPassword('locked-customer@example.com', '9876', 'customer password 123'));

  const staff = database!.prepare('SELECT pin_attempts, initial_pin_hash, must_set_password FROM users WHERE id=?')
    .get(staffId) as { pin_attempts: number; initial_pin_hash: string | null; must_set_password: number };
  const customer = database!.prepare('SELECT pin_attempts, initial_pin_hash, must_set_password FROM customer_profiles WHERE id=?')
    .get(customerId) as { pin_attempts: number; initial_pin_hash: string | null; must_set_password: number };
  assert.equal(staff.pin_attempts, 10);
  assert.equal(staff.initial_pin_hash, null);
  assert.equal(staff.must_set_password, 1);
  assert.equal(customer.pin_attempts, 10);
  assert.equal(customer.initial_pin_hash, null);
  assert.equal(customer.must_set_password, 1);
});

test('notification archive and clear actions are restricted to the signed-in staff owner', () => {
  const staffId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const otherStaffId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const firstId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const secondId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const otherId = 'abababab-abab-4bab-8bab-abababababab';
  const now = new Date().toISOString();
  const addNotification = (id: string, userId: string) => database!.prepare(
    'INSERT INTO notifications (id, user_id, title, body, target_module, target_ref, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
  ).run(id, userId, 'Test notification', 'Notification body', 'notifications', id, now);
  addNotification(firstId, staffId);
  addNotification(secondId, staffId);
  addNotification(otherId, otherStaffId);

  assert.equal(db!.listNotifications(staffId, false).length, 2);
  assert.equal(db!.manageNotifications(staffId, 'archive', [firstId]), 1);
  assert.deepEqual(db!.listNotifications(staffId, false).map((notification) => notification.id), [secondId]);
  assert.deepEqual(db!.listNotifications(staffId, true).map((notification) => notification.id), [firstId]);
  assert.equal(db!.manageNotifications(staffId, 'restore', [firstId]), 1);
  assert.equal(db!.manageNotifications(staffId, 'clear', [secondId, otherId]), 1);
  assert.deepEqual(db!.listNotifications(staffId, false).map((notification) => notification.id), [firstId]);
  assert.deepEqual(db!.listNotifications(otherStaffId, false).map((notification) => notification.id), [otherId]);
});
