// Local resource import (public/js/local-import.js): path resolution, picked-file mapping and the verified import
// into the object cache — the same keys and the same size + SHA-256 checks the Service Worker downloader uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { candidatePaths, findInMap, mapPickedFiles, mimeOf, digestOf, objectKey, importResources, OBJECT_CACHE } from '../public/js/local-import.js';

const enc = (text) => new TextEncoder().encode(text);

/** A File stand-in with the bytes and size the import checks. */
const fakeFile = (text) => { const bytes = enc(text); return { size: bytes.length, arrayBuffer: async () => bytes.slice().buffer }; };

async function entryFor(url, text, extra = {}) {
  return { url, bytes: enc(text).length, sha256: await digestOf(enc(text)), ...extra };
}

test('the object key matches the Service Worker (sha256 + encoded url)', () => {
  assert.equal(objectKey({ sha256: 'ab12', url: '/assets/a b.png' }, 'https://x'), 'https://x/__sp_object__/ab12/assets/a%20b.png');
  assert.equal(OBJECT_CACHE, 'sp-resource-objects-v2');
});

test('content types match what the downloader would have stored', () => {
  assert.equal(mimeOf('/assets/char/avatar/char_1.png'), 'image/png');
  assert.equal(mimeOf('/assets/audio/bgm/a.mp3'), 'audio/mpeg');
  assert.equal(mimeOf('/data/chess.json'), 'application/json');
  assert.equal(mimeOf('/fonts/bender.woff2'), 'font/woff2');
  assert.equal(mimeOf('/assets/spine/op/a.atlas'), 'text/plain');
  assert.equal(mimeOf('/assets/spine/op/a.skel'), 'application/octet-stream');
  assert.equal(mimeOf('/x/y.unknown'), 'application/octet-stream');
});

test('a picked folder may be the public root, a mirror of it, or the assets tree itself', () => {
  assert.deepEqual(candidatePaths('/assets/spine/op/a.skel'), [
    'assets/spine/op/a.skel', 'public/assets/spine/op/a.skel', 'spine/op/a.skel',
  ]);
  assert.deepEqual(candidatePaths('/data/chess.json'), ['data/chess.json', 'public/data/chess.json']);
  assert.deepEqual(candidatePaths('/fonts/x.woff2'), ['fonts/x.woff2', 'public/fonts/x.woff2']);
  // the first exact candidate wins, then any path ending with the URL, so odd nesting still resolves
  assert.equal(findInMap(new Map([['public/assets/a.png', 'A'], ['assets/a.png', 'B']]), '/assets/a.png'), 'B');
  assert.equal(findInMap(new Map([['deep/nest/assets/a.png', 'A']]), '/assets/a.png'), 'A');
  assert.equal(findInMap(new Map([['other/b.png', 'B']]), '/assets/a.png'), null);
});

test('webkitdirectory picks are mapped without the chosen folder name', () => {
  const map = mapPickedFiles([
    { name: 'a.png', webkitRelativePath: 'public/assets/a.png' },
    { name: 'chess.json', webkitRelativePath: 'public/data/chess.json' },
    { name: 'loose.png', webkitRelativePath: '' },
  ]);
  assert.deepEqual([...map.keys()], ['assets/a.png', 'data/chess.json', 'loose.png']);
});

test('import verifies size and SHA-256 before anything enters the cache', async () => {
  const good = await entryFor('/assets/ok.png', 'good');
  const wrong = await entryFor('/assets/wrong.png', 'expected-bytes');
  const gone = await entryFor('/assets/gone.png', 'never-there');
  const audio = await entryFor('/assets/audio/bgm/a.mp3', 'noise');
  const index = { files: [good, wrong, gone, audio] };
  const puts = [];
  const cache = { put: async (key, response) => { puts.push([key, new TextDecoder().decode(await response.arrayBuffer())]); } };
  const map = new Map([
    ['assets/ok.png', fakeFile('good')],
    ['assets/wrong.png', fakeFile('something-else')],
    ['assets/audio/bgm/a.mp3', fakeFile('noise')],
  ]);
  const seen = [];
  const stats = await importResources(map, index, { cache, onProgress: (s) => seen.push(s.done) });
  assert.deepEqual([stats.total, stats.imported, stats.missing, stats.rejected], [4, 2, 1, 1]);
  assert.equal(stats.importedBytes, good.bytes + audio.bytes);
  assert.deepEqual(puts.map(([key]) => key).sort(), [objectKey(good), objectKey(audio)].sort());
  assert.deepEqual(puts.map(([, body]) => body).sort(), ['good', 'noise']);
  assert.equal(seen.length, 4, 'progress fires for every entry');
  assert.equal(seen.at(-1), 4);

  // a selection only walks the chosen files: the audio file is never looked for
  const lean = await importResources(map, index, { cache: { put: async () => {} }, wanted: [good.url, wrong.url, gone.url] });
  assert.deepEqual([lean.total, lean.imported, lean.missing, lean.rejected], [3, 1, 1, 1]);
  assert.equal(lean.importedBytes, good.bytes);
});

test('import tolerates an empty folder and an empty index', async () => {
  const entry = await entryFor('/data/chess.json', '{}');
  const empty = await importResources(new Map(), { files: [entry] }, { cache: { put: async () => {} } });
  assert.deepEqual([empty.total, empty.imported, empty.missing], [1, 0, 1]);
  const none = await importResources(new Map(), { files: [] }, { cache: { put: async () => {} } });
  assert.deepEqual([none.total, none.done], [0, 0]);
});
