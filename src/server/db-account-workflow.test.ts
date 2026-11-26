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

function dateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

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
      'Solar enquiry', '[]', estimator ? '{}' : null, 'New', 'admin-user', new Date().toISOString(),
    );
  };
  const addQuote = (id: string, enquiryId: string, status: string, itemsJson = '[]') => {
    database!.prepare(
      'INSERT INTO quotations (id, quote_code, enquiry_id, customer_name, status, revision_no, scope, terms, note, discount_ngn, tax_percent, issued_date, valid_until, approved_by, approved_at, items_json, revisions_json, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 0, 0, ?, ?, NULL, NULL, ?, ?, ?)'
    ).run(
      id, `QUO-${id}`, enquiryId, 'Test Customer', status, 'Solar system', 'Terms', '',
      dateOffset(0), dateOffset(7), itemsJson, '[]', new Date().toISOString(),
    );
  };

  addEnquiry('enq-homepage', 'homepage@example.com', false);
  assert.throws(
    () => workflow!.saveQuotation(actor, {
      enquiryId: 'enq-homepage', customerName: 'Test Customer', scope: 'Solar', terms: 'Terms',
      note: '', discountNgn: 0, taxPercent: 0, validUntil: '2026-01-08', items: [],
    }),
    /Only load-estimator enquiries and Store orders can have quotations/,
  );
  addQuote('quote-homepage', 'enq-homepage', 'Approved');
  assert.throws(
    () => workflow!.createCustomerAccountForApprovedQuote(actor, 'quote-homepage'),
    /Director-approved estimator quotations/,
  );
  addEnquiry('enq-estimator-new', 'estimate@example.com', true);
  workflow!.saveQuotation(actor, {
    enquiryId: 'enq-estimator-new', customerName: 'Test Customer', scope: 'Solar', terms: 'Terms',
    note: '', discountNgn: 0, taxPercent: 0, validUntil: '2026-01-08', items: [],
  });
  assert.equal(
    (database!.prepare('SELECT status FROM enquiries WHERE id=?').get('enq-estimator-new') as { status: string }).status,
    'New',
  );
  workflow!.archiveEnquiry(actor, 'enq-estimator-new');
  assert.equal(workflow!.getEnquiryForFollowUp('enq-estimator-new'), null);

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

  addEnquiry('enq-payment', 'payment@example.com', true);
  addQuote('quote-payment', 'enq-payment', 'Approved', JSON.stringify([{
    sku: 'INV-1', description: 'Solar inverter', unit: 'unit', qty: 1, unitPriceNgn: 1000,
  }]));
  database!.prepare(
    'INSERT INTO store_orders (id, order_code, enquiry_id, ref_code, customer_name, email, phone, location, delivery_address, delivery_method, payment_method, notes, items_json, subtotal_ngn, delivery_fee_ngn, tax_ngn, total_ngn, status, created_at, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    'order-payment', 'ORD-payment', 'enq-payment', 'REF-enq-payment', 'Test Customer', 'payment@example.com',
    '+2348012345678', 'Abuja', 'Abuja', 'Abuja Warehouse Pickup', 'Bank Transfer on Invoice', '',
    '[]', 1000, 0, 0, 1000, 'Pending', new Date().toISOString(), new Date().toISOString(),
  );
  assert.throws(
    () => workflow!.archiveEnquiry(actor, 'enq-payment'),
    /linked to an active Store order/,
  );
  assert.throws(
    () => workflow!.saveQuotation(actor, {
      enquiryId: 'enq-payment', customerName: 'Test Customer', scope: 'Solar', terms: 'Terms',
      note: '', discountNgn: 0, taxPercent: 0, validUntil: '2026-01-08', items: [],
    }),
    /quotation already exists for this Store order/,
  );
  workflow!.updateStoreOrderStatus(actor, { orderId: 'order-payment', status: 'Delivered' });
  const invoice = workflow!.issueInvoice(actor, 'quote-payment');
  const firstPayment = workflow!.recordPayment(actor, {
    invoiceId: invoice.id, amountNgn: 500, paymentDate: '2026-01-01', method: 'Transfer', reference: 'first', evidenceNote: '',
  });
  assert.equal(workflow!.verifyPayment(actor, firstPayment.id, 'Confirmed').invoiceStatus, 'Confirmed');
  const secondPayment = workflow!.recordPayment(actor, {
    invoiceId: invoice.id, amountNgn: 500, paymentDate: '2026-01-02', method: 'Transfer', reference: 'second', evidenceNote: '',
  });
  assert.equal(workflow!.verifyPayment(actor, secondPayment.id, 'Confirmed').invoiceStatus, 'Completed');
  assert.equal((database!.prepare('SELECT status FROM store_orders WHERE id=?').get('order-payment') as { status: string }).status, 'Completed');
  workflow!.archiveEnquiry(actor, 'enq-payment');
  assert.ok((database!.prepare('SELECT archived_at FROM enquiries WHERE id=?').get('enq-payment') as { archived_at: string }).archived_at);

  const standaloneQuote = workflow!.saveQuotation(actor, {
    enquiryId: null,
    standalone: true,
    customerName: '',
    scope: 'Standalone solar supply',
    terms: 'Payment due on invoice.',
    note: 'Custom quotation note',
    discountNgn: 0,
    taxPercent: 0,
    items: [{ sku: 'INV-2', description: 'Solar inverter', unit: 'unit', qty: 1, unitPriceNgn: 2500 }],
    submitForApproval: true,
  });
  const standaloneRecord = database!.prepare(
    'SELECT enquiry_id, customer_name, customer_email, customer_phone, customer_address, valid_until FROM quotations WHERE id=?'
  ).get(standaloneQuote.id) as {
    enquiry_id: string | null;
    customer_name: string;
    customer_email: string | null;
    customer_phone: string | null;
    customer_address: string | null;
    valid_until: string;
  };
  assert.equal(standaloneRecord.enquiry_id, null);
  assert.equal(standaloneRecord.customer_name, '');
  assert.equal(standaloneRecord.customer_email, null);
  assert.equal(standaloneRecord.customer_phone, null);
  assert.equal(standaloneRecord.customer_address, null);
  assert.equal(standaloneRecord.valid_until, dateOffset(7));

  const technician = { ...actor, id: 'tech-user', role: 'technician' as const };
  assert.throws(() => workflow!.saveQuotation(technician, {
    enquiryId: null,
    standalone: true,
    customerName: 'Unauthorized',
    scope: 'Standalone',
    terms: '',
    note: '',
    discountNgn: 0,
    taxPercent: 0,
    items: [{ sku: 'INV-2', description: 'Solar inverter', unit: 'unit', qty: 1, unitPriceNgn: 2500 }],
  }), /Only Admin\/front desk or Super Admin/);

  workflow!.saveDocumentDetails(actor, {
    type: 'quote',
    id: standaloneQuote.id,
    customerName: 'Standalone Customer Updated',
    customerEmail: 'standalone@example.com',
    customerPhone: '+2348012345678',
    customerAddress: 'Abuja',
    note: 'Updated quotation note',
  });
  workflow!.decideQuotation(actor, standaloneQuote.id, 'Approved');
  const standaloneInvoice = workflow!.issueInvoice(actor, standaloneQuote.id);
  assert.equal(standaloneInvoice.enquiryId, null);
  assert.equal(standaloneInvoice.email, 'standalone@example.com');
  assert.equal(standaloneInvoice.note, 'Updated quotation note');
  assert.throws(
    () => database!.prepare(
      'INSERT INTO invoices (id, invoice_code, quotation_id, customer_name, note, discount_ngn, tax_percent, total_ngn, bank_details_json, issued_date, due_date, items_json, created_at) ' +
      'SELECT ?, ?, quotation_id, customer_name, note, discount_ngn, tax_percent, total_ngn, bank_details_json, issued_date, due_date, items_json, created_at FROM invoices WHERE id = ?'
    ).run('duplicate-invoice-id', 'INV-DUPLICATE', standaloneInvoice.id),
    /UNIQUE constraint failed: invoices\.quotation_id/,
  );
  assert.equal(
    (database!.prepare('SELECT COUNT(*) AS count FROM invoices WHERE quotation_id=?').get(standaloneQuote.id) as { count: number }).count,
    1,
  );
  const invoiceDocument = workflow!.getPublicDocument('invoice', standaloneInvoice.id, 'standalone@example.com') as { note: string; email: string };
  assert.equal(invoiceDocument.note, 'Updated quotation note');
  workflow!.saveDocumentDetails(actor, {
    type: 'invoice',
    id: standaloneInvoice.id,
    customerName: 'Standalone Customer Updated',
    customerEmail: 'standalone@example.com',
    customerPhone: '+2348012345678',
    customerAddress: 'Abuja',
    note: 'Invoice-specific note',
  });
  assert.equal(
    (workflow!.getPublicDocument('invoice', standaloneInvoice.id, 'standalone@example.com') as { note: string }).note,
    'Invoice-specific note',
  );

  addEnquiry('enq-expiry', 'expiry@example.com', true);
  const expiringQuote = workflow!.saveQuotation(actor, {
    enquiryId: 'enq-expiry',
    customerName: 'Expiry Customer',
    scope: 'Solar system',
    terms: '',
    note: '',
    discountNgn: 0,
    taxPercent: 0,
    items: [{ sku: 'INV-3', description: 'Solar inverter', unit: 'unit', qty: 1, unitPriceNgn: 1000 }],
    submitForApproval: true,
  });
  database!.prepare('UPDATE quotations SET valid_until=? WHERE id=?').run(dateOffset(-1), expiringQuote.id);
  assert.throws(() => workflow!.decideQuotation(actor, expiringQuote.id, 'Approved'), /quotation has expired/i);
  const renewed = workflow!.renewQuotation(actor, expiringQuote.id);
  assert.equal(renewed.validUntil, dateOffset(7));
  assert.equal(workflow!.decideQuotation(actor, expiringQuote.id, 'Approved').status, 'Approved');
});
