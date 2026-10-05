import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { createResourceIndex, EMPTY_LOCAL_MANIFEST } from '../server/resource-index.js';
import { createStaticHandler } from '../server/index.js';
import { DATA_URLS } from '../shared/resource-plan.js';

const sha = (text) => createHash('sha256').update(text).digest('hex');
async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-index-'));
  t.after(async () => { assert.match(root, /sp-index-/); await fsp.rm(root, { recursive: true, force: true }); });
  const publicDir = path.join(root, 'public');
  const dataDir = path.join(root, 'data');
  await fsp.mkdir(path.join(publicDir, 'assets', 'audio', 'bgm'), { recursive: true });
  await fsp.mkdir(dataDir);
  for (const url of DATA_URLS) await fsp.writeFile(path.join(dataDir, path.basename(url)), '{}');
  await fsp.writeFile(path.join(publicDir, 'assets', 'a.png'), 'alpha');
  await fsp.writeFile(path.join(publicDir, 'assets', 'audio', 'bgm', 'a.mp3'), 'audio');
  await fsp.writeFile(path.join(dataDir, 'assets.json'), JSON.stringify({ hash: 'unchanged-manifest',
    ui: { a: '/assets/a.png' }, audio: { bgm: { lobby: { loop: '/assets/audio/bgm/a.mp3' } } } }));
  return { publicDir, dataDir, sharedDir: path.join(root, 'shared') };
}

test('content index includes raw-byte SHA-256, stable empty local manifest, and audio alias', async (t) => {
  const dirs = await fixture(t);
  const build = createResourceIndex(dirs);
  const index = await build();
  const audio = index.files.find((file) => file.url.endsWith('a.mp3'));
  assert.equal(audio.runtime, '/media/bgm/a');
  assert.equal(audio.sha256, sha('audio'));
  assert.deepEqual(index.startup.bgm, { loop: audio.url });
  assert.deepEqual(index.files.slice(0, 2).map((file) => file.url), ['/data/assets.json', audio.url]);
  const local = index.files.find((file) => file.url === '/data/local-assets.json');
  assert.equal(local.sha256, sha(EMPTY_LOCAL_MANIFEST));
  assert.equal(index.bytes, index.files.reduce((sum, file) => sum + file.bytes, 0));
  assert.equal(index.required.length, index.files.length);
  assert.equal(index.optional.length, 0);
  await fsp.unlink(path.join(dirs.publicDir, 'assets', 'audio', 'bgm', 'a.mp3'));
  await assert.rejects(build(), /Resource unavailable/);
  // Image rebuilds touch mtimes even when the file content stays identical.
  await fsp.utimes(path.join(dirs.publicDir, 'assets/a.png'), new Date(), new Date(1000000000000));
  await fsp.writeFile(path.join(dirs.publicDir, 'assets', 'audio', 'bgm', 'a.mp3'), 'audio');
  const restored = await build();
  assert.equal(restored.hash, index.hash);
  // Same URL, same byte length, same structure hash, different bytes must produce a different version.
  await fsp.writeFile(path.join(dirs.publicDir, 'assets/a.png'), 'bravo');
  const changed = await build();
  assert.notEqual(changed.hash, restored.hash);
  assert.equal(changed.files.find((file) => file.url === '/assets/a.png').sha256, sha('bravo'));
});

test('missing enemy E2 icon falls back by omitting the stale manifest leaf', async (t) => {
  const dirs = await fixture(t);
  const iconDir = path.join(dirs.publicDir, 'assets', 'enemy', 'icon');
  await fsp.mkdir(iconDir, { recursive: true });
  await fsp.writeFile(path.join(iconDir, 'enemy_2085_skzjxd.png'), 'base');
  await fsp.writeFile(path.join(dirs.dataDir, 'assets.json'), JSON.stringify({
    chars: {}, enemies: { duck: { icon: '/assets/enemy/icon/enemy_2085_skzjxd_2.png' } },
  }));
  const index = await createResourceIndex(dirs)();
  assert.equal(index.files.some((file) => file.url.endsWith('enemy_2085_skzjxd_2.png')), false);
});

test('index serves fresh no-store JSON and blocks incomplete resources', async (t) => {
  const dirs = await fixture(t);
  const handler = createStaticHandler(dirs);
  const server = http.createServer((req, res) => handler(req, res, req.url.split('?')[0], ''));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/resource-manifest.json`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).version, 2);
  const target = path.resolve(dirs.publicDir, 'assets', 'a.png');
  assert.ok(target.startsWith(path.resolve(dirs.publicDir) + path.sep));
  await fsp.unlink(target);
  const unavailable = await fetch(url);
  assert.equal(unavailable.status, 503);
});
