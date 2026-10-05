// The complete client payload is required; no resource group may be skipped.
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

test('the complete client payload has no optional groups', () => {
  assert.deepEqual(OPTIONAL_RESOURCE_GROUPS.map((g) => g.id), []);
  assert.equal(optionalGroupOf('/assets/audio/bgm/a.mp3'), null);
  assert.equal(optionalGroupOf('/assets/audio/sfx/a/b.mp3'), null);
  assert.equal(optionalGroupOf('/assets/ui/guide/a.png'), null);
  for (const url of ['/data/chess.json', '/fonts/x.woff2', '/assets/spine/op/a.skel', '/assets/spine/enemy/a.atlas',
    '/assets/char/portrait/a.png', '/assets/char/avatar/a.png', '/assets/ui/settle/a.png', '/assets/skill/a.png',
    '/assets/item/a.png', '/assets/band/a.png', '/assets/bond/a.png', '/assets/enemy/a.png', '/assets/ui/emoticon/a.png']) {
    assert.equal(optionalGroupOf(url), null, `${url} is required`);
  }
});

test('classification marks every indexed file as required', () => {
  const c = classifyResourceFiles(files);
  assert.equal(c.required, files.length);
  assert.equal(c.requiredBytes, files.reduce((sum, file) => sum + file.bytes, 0));
  assert.deepEqual(c.groups, []);
  assert.equal(classifyResourceFiles(null).required, 0, 'tolerates junk');
});

test('resource selection always returns the complete list', () => {
  assert.equal(selectResourceFiles(files, null).length, files.length);
  assert.equal(selectResourceFiles(files, { audio: false, guide: false }).length, files.length);
  assert.ok(selectResourceFiles(files, { audio: false, guide: false }).some((f) => f.url.startsWith('/assets/audio/')));
  assert.deepEqual(selectResourceFiles(null, { audio: false }), []);
});
