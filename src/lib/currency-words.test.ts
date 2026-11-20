import assert from 'node:assert/strict';
import test from 'node:test';
import { amountInNairaWords } from './currency-words';

test('converts whole naira amounts across groups without dropping conjunctions', () => {
  assert.equal(amountInNairaWords(0), 'Zero Naira Only');
  assert.equal(amountInNairaWords(21), 'Twenty-One Naira Only');
  assert.equal(amountInNairaWords(101), 'One Hundred and One Naira Only');
  assert.equal(amountInNairaWords(1_001), 'One Thousand and One Naira Only');
  assert.equal(amountInNairaWords(1_001_000), 'One Million One Thousand Naira Only');
  assert.equal(amountInNairaWords(1_000_001), 'One Million and One Naira Only');
  assert.equal(amountInNairaWords(3_130_000), 'Three Million One Hundred and Thirty Thousand Naira Only');
});

test('includes kobo and preserves negative amounts', () => {
  assert.equal(amountInNairaWords(1_234.56), 'One Thousand Two Hundred and Thirty-Four Naira and Fifty-Six Kobo Only');
  assert.equal(amountInNairaWords(-10), 'Minus Ten Naira Only');
});

test('rejects non-finite and unsafe currency amounts', () => {
  assert.throws(() => amountInNairaWords(Number.NaN), RangeError);
  assert.throws(() => amountInNairaWords(Number.MAX_SAFE_INTEGER), RangeError);
});
