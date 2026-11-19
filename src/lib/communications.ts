export interface NewsletterAttachment {
  name: string;
  mimeType: string;
  data: string;
  size: number;
}

export function isValidE164(value: unknown): value is string {
  return typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value);
}

export function validateMessage(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return 'Message is required.';
  if ([...value].length > 4096 || new TextEncoder().encode(value).length > 16384) {
    return 'Message exceeds the 4096 character limit.';
  }
  return null;
}

export function detectNewsletterMime(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return 'application/pdf';
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export function validateNewsletterAttachment(file: NewsletterAttachment): string | null {
  if (!file || typeof file.name !== 'string' || file.name.length > 160 || /[\\/\r\n]/.test(file.name)) {
    return 'Attachment filename is invalid.';
  }
  if (!Number.isInteger(file.size) || file.size <= 0 || file.size > 2 * 1024 * 1024) {
    return 'Each attachment must be 2MB or smaller.';
  }
  if (typeof file.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)) {
    return 'Attachment data is invalid.';
  }
  const extension = file.name.toLowerCase().split('.').pop();
  const extensionsByMime: Record<string, string[]> = {
    'image/jpeg': ['jpg', 'jpeg'],
    'image/png': ['png'],
    'image/webp': ['webp'],
    'application/pdf': ['pdf'],
  };
  if (!extensionsByMime[file.mimeType]?.includes(extension || '')) {
    return 'Attachment filename extension does not match its allowed file type.';
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0));
  } catch {
    return 'Attachment data is invalid.';
  }
  if (bytes.length !== file.size || detectNewsletterMime(bytes) !== file.mimeType) {
    return 'Attachment content does not match an allowed image or PDF type.';
  }
  return null;
}

export function validateWhatsAppAttachment(file: NewsletterAttachment): string | null {
  if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file?.mimeType)) {
    return 'WhatsApp supports JPEG or PNG images and PDF files.';
  }
  return validateNewsletterAttachment(file);
}
