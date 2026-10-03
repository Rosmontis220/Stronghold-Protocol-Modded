// A content-derived resource index: stable across image rebuilds, changes when file bytes change.
import path from 'node:path';
import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildPreloadPlan, LOCAL_MANIFEST_URL, runtimeResourceUrl } from '../shared/resource-plan.js';

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
    urls.sort();
    const files = new Array(urls.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(8, urls.length) }, async () => {
      while (cursor < urls.length) { const i = cursor++; files[i] = await fileRecord(urls[i]); }
    }));
    return { version: 2, hash: hash(JSON.stringify(files)), bytes: files.reduce((sum, item) => sum + item.bytes, 0), files };
  }

  // Share concurrent requests, but stat again on the next request so in-place edits are detected.
  return () => {
    if (!pending) pending = build().finally(() => { pending = null; });
    return pending;
  };
}
