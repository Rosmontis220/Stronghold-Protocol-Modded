import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreloadPlan, cacheVersion, collectAssetUrls, collectLocalUrls } from '../public/js/preload.js';

test('collectAssetUrls finds art, fonts, and audio asset URLs', () => {
  const urls = [...collectAssetUrls({
    avatar: '/assets/char/a.png',
    font: '/fonts/fonts.css',
    audio: '/assets/audio/bgm/act1.mp3',
    ignored: 'https://example.com/external.png',
  })].sort();
  assert.deepEqual(urls, ['/fonts/fonts.css', '/assets/audio/bgm/act1.mp3', '/assets/char/a.png'].sort());
});

test('collectLocalUrls only keeps same-origin local art paths', () => {
  const urls = [...collectLocalUrls({ groups: { ui: { one: { path: '/assets/local/ui/one.png' } }, bad: 'https://example.com/x' } })];
  assert.deepEqual(urls, ['/assets/local/ui/one.png']);
});

test('buildPreloadPlan includes data, manifest, and optional local manifest', () => {
  const urls = buildPreloadPlan({ hash: 'abc', ui: { x: '/assets/ui/x.png' } }, {
    groups: { ui: { y: { path: '/assets/local/ui/y.png' } } },
  });
  assert.ok(urls.includes('/data/assets.json'));
  assert.ok(urls.includes('/data/config.json'));
  assert.ok(urls.includes('/data/emotes.json'));
  assert.ok(urls.includes('/data/local-assets.json'));
  assert.ok(urls.includes('/assets/ui/x.png'));
  assert.ok(urls.includes('/assets/local/ui/y.png'));
  assert.deepEqual(urls, [...urls].sort());
});

test('cacheVersion changes when the cloud manifest or local manifest changes', () => {
  const a = cacheVersion({ hash: 'abc' }, { groups: { ui: { a: { path: '/assets/a.png' } } } });
  const b = cacheVersion({ hash: 'def' }, { groups: { ui: { a: { path: '/assets/a.png' } } } });
  const c = cacheVersion({ hash: 'abc' }, { groups: { ui: { b: { path: '/assets/b.png' } } } });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});
