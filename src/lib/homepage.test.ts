import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_HOMEPAGE_CONTENT,
  normalizeHomepageContent,
} from './homepage';

test('homepage normalization keeps defaults for missing sections and accepts visibility edits', () => {
  const homepage = normalizeHomepageContent({
    hero: { heading: 'Updated heading', body: 'Updated copy', enabled: false },
  });

  assert.deepEqual(homepage.hero, {
    heading: 'Updated heading',
    body: 'Updated copy',
    enabled: false,
  });
  assert.deepEqual(homepage.about, DEFAULT_HOMEPAGE_CONTENT.about);
});

test('homepage normalization caps copy lengths and ignores malformed field types', () => {
  const homepage = normalizeHomepageContent({
    hero: { heading: 'x'.repeat(200), body: 'y'.repeat(1300), enabled: 'false' },
  });

  assert.equal(homepage.hero.heading.length, 180);
  assert.equal(homepage.hero.body.length, 1200);
  assert.equal(homepage.hero.enabled, true);
});
