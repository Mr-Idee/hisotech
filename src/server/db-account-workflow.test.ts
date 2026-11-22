import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StaffMember } from '../lib/types';

let tempDir = '';
let originalCwd = '';
let database: DatabaseSync | undefined;
let workflow: typeof import('./db') | undefined;

before(async () => {
  originalCwd = process.cwd();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hiso-account-workflow-'));
  process.chdir(tempDir);
  workflow = await import('./db');
  database = new DatabaseSync(path.join(tempDir, '.hiso_preview.sqlite'));
});

after(() => {
  workflow?.closeDatabase();
  database?.close();
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('only approved estimator quotations can provision a customer account and the PIN is one-time', () => {
  const actor: StaffMember = {
    id: 'admin-user',
    name: 'Admin User',
    username: 'admin-user',
    email: 'admin@example.com',
    phone: '',
    role: 'admin',
    title: 'Administrator',
    skills: '',
    status: 'Active',
    createdAt: new Date().toISOString(),
  };
  const addEnquiry = (id: string, email: string, estimator: boolean) => {
    database!.prepare(
      'INSERT INTO enquiries (id, ref_code, customer_name, email, phone, location, channel, need_summary, appliances_json, estimate_json, status, owner_user_id, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id, `REF-${id}`, 'Test Customer', email, '+2348012345678', 'Abuja',
      estimator ? 'Website · Load Estimator' : 'Website · Home Enquiry',
      'Solar enquiry', '[]', estimator ? '{}' : null, 'Quoted', 'admin-user', new Date().toISOString(),
    );
  };
  const addQuote = (id: string, enquiryId: string, status: string) => {
    database!.prepare(
      'INSERT INTO quotations (id, quote_code, enquiry_id, customer_name, status, revision_no, scope, terms, note, discount_ngn, tax_percent, issued_date, valid_until, approved_by, approved_at, items_json, revisions_json, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 0, 0, ?, ?, NULL, NULL, ?, ?, ?)'
    ).run(
      id, `QUO-${id}`, enquiryId, 'Test Customer', status, 'Solar system', 'Terms', '',
      '2026-01-01', '2026-01-08', '[]', '[]', new Date().toISOString(),
    );
  };

  addEnquiry('enq-homepage', 'homepage@example.com', false);
  addQuote('quote-homepage', 'enq-homepage', 'Approved');
  assert.throws(
    () => workflow!.createCustomerAccountForApprovedQuote(actor, 'quote-homepage'),
    /Director-approved estimator quotations/,
  );

  addEnquiry('enq-pending', 'pending@example.com', true);
  addQuote('quote-pending', 'enq-pending', 'Pending MD');
  assert.throws(
    () => workflow!.createCustomerAccountForApprovedQuote(actor, 'quote-pending'),
    /Director-approved estimator quotations/,
  );

  addEnquiry('enq-approved', 'approved@example.com', true);
  addQuote('quote-approved', 'enq-approved', 'Approved');
  const account = workflow!.createCustomerAccountForApprovedQuote(actor, 'quote-approved');
  const stored = database!.prepare(
    'SELECT password_hash, initial_pin_hash, must_set_password, email_verified_at FROM customer_profiles WHERE id=?'
  ).get(account.id) as {
    password_hash: string | null;
    initial_pin_hash: string;
    must_set_password: number;
    email_verified_at: string | null;
  };
  assert.equal(stored.password_hash, null);
  assert.notEqual(stored.initial_pin_hash, account.pin);
  assert.equal(stored.must_set_password, 1);
  assert.equal(stored.email_verified_at, null);
  assert.equal(workflow!.authenticateCustomer(account.email, 'A long password!'), null);
  assert.throws(
    () => workflow!.setupCustomerPassword(account.email, '0000', 'A long password!'),
    /invalid or has expired/,
  );

  workflow!.setupCustomerPassword(account.email, account.pin, 'A long password!');
  assert.ok(workflow!.authenticateCustomer(account.email, 'A long password!'));
  assert.throws(
    () => workflow!.setupCustomerPassword(account.email, account.pin, 'Another long password!'),
    /invalid or has expired/,
  );
});
