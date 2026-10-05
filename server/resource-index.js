// A content-derived resource index: stable across image rebuilds, changes when file bytes change.
import path from 'node:path';
import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildPreloadPlan, LOCAL_MANIFEST_URL, runtimeResourceUrl, optionalGroupOf } from '../shared/resource-plan.js';

export const EMPTY_LOCAL_MANIFEST = JSON.stringify({ version: 1, source: 'none', count: 0, groups: {} });
const hash = (body) => createHash('sha256').update(body).digest('hex');

export function createResourceIndex({ publicDir, dataDir }) {
  const digests = new Map();
  let pending = null;

  function filePath(url) {
    const root = path.resolve(url.startsWith('/data/') ? dataDir : publicDir);
    const rel = decodeURIComponent(url.startsWith('/data/') ? url.slice(6) : url.slice(1));
    if (/[\\\0?#]/.test(rel) || rel.split('/').some((part) => !part || part.startsWith('.') || part === '..')) {
      throw new Error(`Invalid resource path: ${url}`);
    }
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) throw new Error(`Invalid resource path: ${url}`);
    return file;
  }

  async function readManifest(name, fallback = null) {
    try { return JSON.parse(await fsp.readFile(path.join(dataDir, name), 'utf8')); }
    catch (err) { if (fallback && err.code === 'ENOENT') return fallback; throw err; }
  }

  async function fileRecord(url) {
    const file = filePath(url);
    let stat;
    try { stat = await fsp.stat(file); }
    catch (err) {
      if (url === LOCAL_MANIFEST_URL && err.code === 'ENOENT') {
        const bytes = Buffer.from(EMPTY_LOCAL_MANIFEST);
        return { url, sha256: hash(bytes), bytes: bytes.length };
      }
      // A missing enemy E2 icon can safely use its base icon. Asset downloads may fail transiently while the
      // generated data/assets.json keeps the previous URL; omit that stale leaf so the cloud manifest remains usable.
      if (err.code === 'ENOENT' && /^\/assets\/enemy\/icon\/enemy_\d+_[a-z0-9]+_2\.png$/i.test(url)) {
        const base = filePath(url.replace(/_2\.png$/i, '.png'));
        try { if ((await fsp.stat(base)).isFile()) return null; } catch { /* base is also unavailable */ }
      }
      throw new Error(`Resource unavailable: ${url} (${err.code || err.message})`);
    }
    if (!stat.isFile()) throw new Error(`Resource is not a file: ${url}`);
    const signature = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    let digest = digests.get(file);
    if (digest?.signature !== signature) {
      const bytes = await fsp.readFile(file);
      const after = await fsp.stat(file);
      if (`${after.size}:${after.mtimeMs}:${after.ctimeMs}` !== signature) throw new Error(`Resource changed while indexing: ${url}`);
      digest = { signature, sha256: hash(bytes) };
      digests.set(file, digest);
    }
    const runtime = runtimeResourceUrl(url);
    return { url, sha256: digest.sha256, bytes: stat.size, ...(runtime !== url ? { runtime } : {}) };
  }

  async function build() {
    const [manifest, local] = await Promise.all([
      readManifest('assets.json'), readManifest('local-assets.json', JSON.parse(EMPTY_LOCAL_MANIFEST)),
    ]);
    const urls = buildPreloadPlan(manifest, local);
    // The optional board UV table is discovered alongside the installed diffuse atlas.
    const board = local?.groups?.['map/autochess']?.TX_autochessi_D?.path;
    if (typeof board === 'string') {
      const tiles = board.replace(/\/[^/]+$/, '/tiles.json');
      try { await fsp.access(filePath(tiles)); if (!urls.includes(tiles)) urls.push(tiles); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    }
    const available = new Set(urls);
    const lobby = manifest?.audio?.bgm?.lobby;
    const bgm = typeof lobby?.loop === 'string' && available.has(lobby.loop)
      ? { loop: lobby.loop, ...(typeof lobby.intro === 'string' && available.has(lobby.intro) ? { intro: lobby.intro } : {}) } : null;
    const fonts = Object.values(manifest?.fonts?.faces || {}).flatMap((face) => {
      const url = [face?.woff2, face?.original].find((value) => available.has(value));
      return url && typeof face.family === 'string' && Number.isFinite(face.weight)
        ? [{ url, family: face.family, weight: face.weight }] : [];
    });
    // Make startup music and fonts usable while the remaining art is still downloading.
    const priority = new Map(['/data/assets.json', bgm?.intro, bgm?.loop, ...fonts.map((face) => face.url)]
      .filter(Boolean).map((url, i) => [url, i]));
    urls.sort((a, b) => (priority.get(a) ?? 999) - (priority.get(b) ?? 999) || (a < b ? -1 : a > b ? 1 : 0));
    const files = [];
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(8, urls.length) }, async () => {
      while (cursor < urls.length) {
        const i = cursor++;
        const url = urls[i];
        try {
          files[i] = await fileRecord(url);
        } catch (err) {
          if (optionalGroupOf(url)) continue;
          throw err;
        }
      }
    }));
    const compactFiles = files.filter(Boolean);
    const required = compactFiles.filter((file) => !optionalGroupOf(file.url));
    const optional = compactFiles.filter((file) => optionalGroupOf(file.url));
    return { version: 2, hash: hash(JSON.stringify(compactFiles)), bytes: compactFiles.reduce((sum, item) => sum + item.bytes, 0),
      files: compactFiles, required, optional, startup: { bgm, fonts } };
  }

  // Share concurrent requests, but stat again on the next request so in-place edits are detected.
  return () => {
    if (!pending) pending = build().finally(() => { pending = null; });
    return pending;
  };
}
