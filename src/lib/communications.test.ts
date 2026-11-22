import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectNewsletterMime,
  createWhatsAppLink,
  isValidE164,
  validateMessage,
  validateNewsletterAttachment,
  validateWhatsAppAttachment,
} from './communications';

test('E.164 validation rejects local and overlong numbers', () => {
  assert.equal(isValidE164('+2348012345678'), true);
  assert.equal(isValidE164('08012345678'), false);
  assert.equal(isValidE164('+012345678'), false);
  assert.equal(isValidE164('+1234567890123456'), false);
});

test('message validation enforces non-empty content and the provider length limit', () => {
  assert.match(validateMessage('  ') || '', /required/);
  assert.match(validateMessage('x'.repeat(4097)) || '', /4096/);
  assert.equal(validateMessage('Hello'), null);
});

test('WhatsApp click-to-chat links normalize Nigerian numbers and encode the draft', () => {
  const local = createWhatsAppLink('0801 234 5678', 'Hello & welcome');
  assert.ok(local);
  assert.equal(new URL(local).pathname, '/2348012345678');
  assert.equal(new URL(local).searchParams.get('text'), 'Hello & welcome');
  assert.equal(new URL(createWhatsAppLink('+44 20 1234 5678', 'Hello') || '').pathname, '/442012345678');
  assert.equal(createWhatsAppLink('not a number', 'Hello'), null);
});

test('newsletter attachments validate file signatures instead of trusting the claimed MIME', () => {
  const pdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(detectNewsletterMime(pdf), 'application/pdf');
  assert.equal(detectNewsletterMime(png), 'image/png');
  assert.equal(detectNewsletterMime(Uint8Array.from([1, 2, 3])), null);
  assert.equal(validateNewsletterAttachment({
    name: 'document.pdf',
    mimeType: 'application/pdf',
    size: pdf.length,
    data: Buffer.from(pdf).toString('base64'),
  }), null);
  assert.match(validateNewsletterAttachment({
    name: 'document.pdf',
    mimeType: 'image/png',
    size: pdf.length,
    data: Buffer.from(pdf).toString('base64'),
  }) || '', /does not match/);
  assert.equal(validateNewsletterAttachment({
    name: 'image.png',
    mimeType: 'image/png',
    size: png.length,
    data: Buffer.from(png).toString('base64'),
  }), null);
  assert.match(validateNewsletterAttachment({
    name: 'large.pdf',
    mimeType: 'application/pdf',
    size: 2 * 1024 * 1024 + 1,
    data: '',
  }) || '', /2MB/);
  assert.match(validateWhatsAppAttachment({
    name: 'image.webp',
    mimeType: 'image/webp',
    size: png.length,
    data: Buffer.from(png).toString('base64'),
  }) || '', /WhatsApp supports/);
});
