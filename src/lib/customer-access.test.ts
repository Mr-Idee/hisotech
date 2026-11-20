import assert from 'node:assert/strict';
import test from 'node:test';
import { customerEmailMatches } from './customer-access';

test('matches verified customer email without case sensitivity', () => {
  assert.equal(customerEmailMatches(' Customer@Example.com ', 'customer@example.com'), true);
});

test('rejects missing or unrelated customer email addresses', () => {
  assert.equal(customerEmailMatches(undefined, 'customer@example.com'), false);
  assert.equal(customerEmailMatches('customer@example.com', ''), false);
  assert.equal(customerEmailMatches('other@example.com', 'customer@example.com'), false);
});
