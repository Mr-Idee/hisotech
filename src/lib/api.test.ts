import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from './api';

test('public bootstrap rejects HTML fatal-error responses with HTTP 200', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>PHP fatal error</html>', { status: 200 });
  try {
    await assert.rejects(api.getPublicBootstrap(), /invalid response/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('public bootstrap rejects JSON responses without a catalog array', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: 'Runtime unavailable.' });
  try {
    await assert.rejects(api.getPublicBootstrap(), /invalid public catalog/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
