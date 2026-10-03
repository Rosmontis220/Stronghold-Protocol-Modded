import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreloadPlan, collectAssetUrls, collectLocalUrls, validateResourceIndex } from '../public/js/preload.js';
import { runtimeResourceUrl } from '../shared/resource-plan.js';

const digest = 'a'.repeat(64);

test('collectAssetUrls finds art, fonts, and audio without external URLs', () => {
  const urls = [...collectAssetUrls({ avatar: '/assets/char/a.png', font: '/fonts/fonts.css',
    audio: '/assets/audio/bgm/act1.mp3', ignored: 'https://example.com/external.png' })].sort();
  assert.deepEqual(urls, ['/fonts/fonts.css', '/assets/audio/bgm/act1.mp3', '/assets/char/a.png'].sort());
});

test('collectLocalUrls includes optional map data and same-origin art', () => {
  const urls = [...collectLocalUrls({ groups: { ui: { one: { path: '/assets/local/ui/one.png' } },
    map: { materials: { path: '/assets/local/map/materials.json' } }, bad: 'https://example.com/x' } })];
  assert.deepEqual(urls, ['/assets/local/ui/one.png', '/assets/local/map/materials.json']);
});

test('buildPreloadPlan covers game data and only installed fonts/local resources', () => {
  const urls = buildPreloadPlan({ hash: 'abc', ui: { x: '/assets/ui/x.png' } }, {
    groups: { ui: { y: { path: '/assets/local/ui/y.png' } } },
  });
  for (const url of ['/data/assets.json', '/data/config.json', '/data/emotes.json', '/data/tuning.json',
    '/data/local-assets.json', '/assets/ui/x.png', '/assets/local/ui/y.png']) assert.ok(urls.includes(url));
  assert.ok(!urls.includes('/fonts/fonts.css'), 'fonts are optional when absent from the asset manifest');
  assert.ok(buildPreloadPlan({ fonts: { css: '/fonts/fonts.css' } }).includes('/fonts/fonts.css'));
  assert.deepEqual(urls, [...urls].sort());
});

test('audio has one extensionless runtime path, other asset URLs stay intact', () => {
  assert.equal(runtimeResourceUrl('/assets/audio/bgm/act1.mp3'), '/media/bgm/act1');
  assert.equal(runtimeResourceUrl('/assets/ui/image.png'), '/assets/ui/image.png');
});

test('cloud index validates sizes, paths, hashes and duplicate entries', () => {
  const index = { version: 2, hash: digest, bytes: 3, files: [{ url: '/assets/a.png', sha256: digest, bytes: 3 }] };
  assert.equal(validateResourceIndex(index), index);
  for (const patch of [{ url: '/assets/../secret' }, { url: '//example.com/a' }, { url: '/assets/a?x' },
    { sha256: 'abc' }, { bytes: -1 }, { runtime: 'https://example.com/a' }]) {
    assert.throws(() => validateResourceIndex({ ...index, files: [{ ...index.files[0], ...patch }] }));
  }
  assert.throws(() => validateResourceIndex({ ...index, bytes: 99 }));
  assert.throws(() => validateResourceIndex({ ...index, bytes: 6, files: [...index.files, ...index.files] }));
});
