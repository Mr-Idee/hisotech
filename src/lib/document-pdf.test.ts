import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createDocumentPdf } from './document-pdf';

test('document PDF includes the supplied equipment totals and warranty terms', async () => {
  const logoDataUrl = `data:image/png;base64,${readFileSync(
    new URL('../../public/assets/hisotech-logo-mark.png', import.meta.url)
  ).toString('base64')}`;
  const blob = await createDocumentPdf({
    type: 'quote',
    documentCode: 'SAMPLE-QUO-001',
    customerName: 'Sample Customer',
    location: 'Abuja',
    phone: '',
    email: '',
    refCode: 'SAMPLE-REF-001',
    issuedDate: '2026-01-01',
    dueDate: '',
    validUntil: '2026-01-08',
    status: 'Approved',
    scope: '3kVA-5kWh hybrid system',
    terms: 'Valid for 7 days.',
    note: 'Custom quotation message.',
    discountNgn: 0,
    taxPercent: 0,
    logoDataUrl,
    items: [
      { sku: 'INV', description: '3KVA 24V Hybrid Inverter', unit: 'unit', qty: 1, unitPriceNgn: 400_000 },
      { sku: 'BAT', description: '5KWH 24V Lithium Ion Battery Bank', unit: 'unit', qty: 1, unitPriceNgn: 1_230_000 },
      { sku: 'PV', description: '2.5KW Monocrystalline Solar Array', unit: 'panel', qty: 6, unitPriceNgn: 120_000 },
      { sku: 'ACC', description: 'Installation Accessories', unit: 'lot', qty: 1, unitPriceNgn: 430_000 },
      { sku: 'INSTALL', description: 'Logistics and Installation', unit: 'lot', qty: 1, unitPriceNgn: 350_000 },
    ],
  });
  const content = Buffer.from(await blob.arrayBuffer()).toString('latin1');

  assert.ok(content.startsWith('%PDF-'));
  assert.match(content, /NGN 3,130,000/);
  assert.match(content, /Three Million One Hundred and Thirty Thousand Naira Only/);
  assert.match(content, /2 years on installation work only/);
  assert.match(content, /Custom quotation message\./);
  assert.match(content, /\/Subtype \/Image/);
  assert.ok(content.indexOf('WARRANTY & EXPECTED EQUIPMENT LIFE') > content.indexOf('3KVA 24V Hybrid Inverter'));
  assert.ok(blob.size < 2 * 1024 * 1024);
});

test('invoice PDF places warranty after the listed items and receiving account', async () => {
  const logoDataUrl = `data:image/png;base64,${readFileSync(
    new URL('../../public/assets/hisotech-logo-mark.png', import.meta.url)
  ).toString('base64')}`;
  const blob = await createDocumentPdf({
    type: 'invoice',
    documentCode: 'INV-001',
    customerName: 'Sample Customer',
    location: 'Abuja',
    phone: '',
    email: '',
    refCode: 'REF-001',
    issuedDate: '2026-01-01',
    dueDate: '2026-01-15',
    validUntil: '',
    status: 'Issued',
    scope: 'Supply and installation',
    terms: '',
    note: '',
    discountNgn: 0,
    taxPercent: 0,
    items: [{ sku: 'INV-3', description: '3kVA inverter', unit: 'unit', qty: 1, unitPriceNgn: 100_000 }],
    bankDetails: { bankName: 'Sample Bank', accountName: 'HI-SOTECH', accountNumber: '1234567890' },
    logoDataUrl,
  });
  const content = Buffer.from(await blob.arrayBuffer()).toString('latin1');

  assert.match(content, /\/Subtype \/Image/);
  assert.ok(content.indexOf('3kVA inverter') < content.indexOf('Account number: 1234567890'));
  assert.ok(content.indexOf('Account number: 1234567890') < content.indexOf('Installation warranty'));
});
