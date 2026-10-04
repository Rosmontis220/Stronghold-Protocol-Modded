// Which resources may be skipped: only the audio set and the 玩法说明 tutorial pages; everything else is required.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyResourceFiles, optionalGroupOf, selectResourceFiles, OPTIONAL_RESOURCE_GROUPS } from '../shared/resource-plan.js';

const files = [
  { url: '/data/chess.json', bytes: 100 },
  { url: '/data/assets.json', bytes: 100 },
  { url: '/fonts/bender-regular.woff2', bytes: 22 },
  { url: '/assets/spine/op/char_1/front/char_1.skel', bytes: 5000 },
  { url: '/assets/spine/enemy/enemy_1/enemy_1.atlas', bytes: 900 },
  { url: '/assets/char/portrait/char_1_1.png', bytes: 300 },
  { url: '/assets/char/avatar/char_1.png', bytes: 40 },
  { url: '/assets/ui/settle/btn.png', bytes: 30 },
  { url: '/assets/ui/guide/autochess_home_1.png', bytes: 1000 },
  { url: '/assets/ui/guide/autochess_shop_1.png', bytes: 1000 },
  { url: '/assets/audio/bgm/m_sys_act1autochess_loop.mp3', bytes: 2000 },
  { url: '/assets/audio/sfx/player/p_atk_x.mp3', bytes: 200 },
];

test('only audio and the tutorial pages are optional', () => {
  assert.deepEqual(OPTIONAL_RESOURCE_GROUPS.map((g) => g.id), ['audio', 'guide']);
  assert.equal(optionalGroupOf('/assets/audio/bgm/a.mp3'), 'audio');
  assert.equal(optionalGroupOf('/assets/audio/sfx/a/b.mp3'), 'audio');
  assert.equal(optionalGroupOf('/assets/ui/guide/a.png'), 'guide');
  for (const url of ['/data/chess.json', '/fonts/x.woff2', '/assets/spine/op/a.skel', '/assets/spine/enemy/a.atlas',
    '/assets/char/portrait/a.png', '/assets/char/avatar/a.png', '/assets/ui/settle/a.png', '/assets/skill/a.png',
    '/assets/item/a.png', '/assets/band/a.png', '/assets/bond/a.png', '/assets/enemy/a.png', '/assets/ui/emoticon/a.png']) {
    assert.equal(optionalGroupOf(url), null, `${url} is required`);
  }
});

test('classification counts the two optional groups and everything else as required', () => {
  const c = classifyResourceFiles(files);
  assert.equal(c.required, 8);
  assert.equal(c.requiredBytes, 100 + 100 + 22 + 5000 + 900 + 300 + 40 + 30);
  const byId = Object.fromEntries(c.groups.map((g) => [g.id, g]));
  assert.deepEqual([byId.audio.files, byId.audio.bytes], [2, 2200]);
  assert.deepEqual([byId.guide.files, byId.guide.bytes], [2, 2000]);
  assert.equal(c.required + byId.audio.files + byId.guide.files, files.length);
  assert.equal(classifyResourceFiles(null).required, 0, 'tolerates junk');
});

test('a selection only drops the switched-off optional groups', () => {
  assert.equal(selectResourceFiles(files, null).length, files.length, 'no selection: everything');
  assert.equal(selectResourceFiles(files, { audio: true, guide: true }).length, files.length);
  const noAudio = selectResourceFiles(files, { audio: false, guide: true }).map((f) => f.url);
  assert.ok(!noAudio.some((u) => u.startsWith('/assets/audio/')));
  assert.ok(noAudio.includes('/assets/ui/guide/autochess_home_1.png'), 'the tutorial pages stay unless switched off');
  const lean = selectResourceFiles(files, { audio: false, guide: false }).map((f) => f.url);
  assert.equal(lean.length, 8);
  assert.ok(lean.includes('/assets/spine/op/char_1/front/char_1.skel'), 'operator models are required');
  assert.ok(lean.includes('/assets/char/portrait/char_1_1.png'), 'portraits are required');
  assert.ok(lean.includes('/data/chess.json') && lean.includes('/fonts/bender-regular.woff2'));
  assert.deepEqual(selectResourceFiles(null, { audio: false }), []);
});
