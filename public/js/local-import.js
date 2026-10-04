// public/js/local-import.js — seed the verified object cache from a local resource folder.
//
// The Service Worker cannot read a directory handle, so the page walks the picked folder, verifies every file
// (size + SHA-256) and writes the bytes into the same `sp-resource-objects-v2` cache the downloader uses. The runtime
// path never changes, and the preload afterwards only fetches what the folder did not provide.
//
// Chromium (File System Access API) remembers the directory handle in IndexedDB: the next visit can re-use it after a
// one-click permission prompt. Other browsers fall back to `<input type="file" webkitdirectory>` — the same import,
// without the memory.

export const OBJECT_CACHE = 'sp-resource-objects-v2';
const DB_NAME = 'sp-resource-dir';
const STORE = 'handles';
const ROOT_KEY = 'root';

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  json: 'application/json', css: 'text/css', txt: 'text/plain', js: 'text/javascript',
  woff2: 'font/woff2', woff: 'font/woff', otf: 'font/otf', ttf: 'font/ttf',
  atlas: 'text/plain', skel: 'application/octet-stream',
};

/** Content type for a resource URL (what the downloader would have stored). */
export function mimeOf(url) {
  const ext = String(url).split('?')[0].split('.').pop()?.toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

/** The cache key the Service Worker uses for a file record (`sw.js objectKey`). */
export const objectKey = (file, origin = globalThis.location?.origin || '') =>
  `${origin}/__sp_object__/${file.sha256}${encodeURI(file.url)}`;

/**
 * Where a folder file for this URL may sit, most likely first: the picker may point at `public/`, at the project
 * root, at `public/assets` or straight at a mirror of the URL tree. The import tries each candidate.
 * @param {string} url resource URL from the index (`/assets/…`)
 * @returns {string[]} relative paths without a leading slash
 */
export function candidatePaths(url) {
  const path = String(url).replace(/^\/+/, '');
  const out = [path, `public/${path}`];
  if (path.startsWith('assets/')) out.push(path.slice('assets/'.length));
  if (path === 'data/local-assets.json') out.push('local-assets.json', 'data/local-assets.json');
  return [...new Set(out)];
}

/** Does this browser let the page pick (and remember) a folder? */
export const supportsDirectoryPicker = () => typeof globalThis.showDirectoryPicker === 'function';

/** SHA-256 hex of an ArrayBuffer (WebCrypto). */
export async function digestOf(bytes) {
  const view = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(view)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- remembered directory (IndexedDB) ---------------------------------------------------------------

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbPut(value) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, ROOT_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function idbGet() {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(ROOT_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

/** Ask for a folder, and remember it for the next visit. Resolves null when the player cancels. */
export async function pickResourceDirectory() {
  if (!supportsDirectoryPicker()) return null;
  try {
    const handle = await globalThis.showDirectoryPicker({ id: 'sp-resources', mode: 'read' });
    if (!handle) return null;
    try { await idbPut({ handle, name: handle.name, at: Date.now() }); } catch { /* remember best-effort */ }
    return handle;
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return null;
    throw err;
  }
}

/** The remembered folder (or null). */
export async function recallDirectory() {
  try { return await idbGet(); } catch { return null; }
}

/** 'granted' | 'prompt' | 'denied' | 'unsupported' for a remembered handle. */
export async function permissionOf(handle) {
  if (!handle || typeof handle.queryPermission !== 'function') return 'unsupported';
  try { return await handle.queryPermission({ mode: 'read' }); } catch { return 'denied'; }
}

/** Re-grant a remembered handle inside a click (browsers require a gesture). */
export async function requestPermission(handle) {
  if (!handle || typeof handle.requestPermission !== 'function') return false;
  try { return (await handle.requestPermission({ mode: 'read' })) === 'granted'; } catch { return false; }
}

// ---- walking a folder ------------------------------------------------------------------------------

/** Every file under `dir` as path → handle (dotfiles skipped). */
export async function walkDirectory(dir, prefix = '', out = new Map()) {
  for await (const [name, entry] of dir.entries()) {
    if (name.startsWith('.')) continue;
    const path = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === 'directory') await walkDirectory(entry, path, out);
    else out.set(path, entry);
  }
  return out;
}

/** Path → File map from a `webkitdirectory` pick (first path segment is the chosen folder's name). */
export function mapPickedFiles(fileList) {
  const out = new Map();
  for (const file of fileList || []) {
    const rel = String(file.webkitRelativePath || file.name).split('/').filter(Boolean);
    const path = rel.length > 1 ? rel.slice(1).join('/') : rel.join('/');
    out.set(path, file);
  }
  return out;
}

/**
 * The first candidate path that exists in the folder (exact candidates first, then any path ending with the URL).
 * @param {Map<string, any>} map @param {string} url
 */
export function findInMap(map, url) {
  for (const candidate of candidatePaths(url)) if (map.has(candidate)) return map.get(candidate);
  const tail = String(url).replace(/^\/+/, '');
  for (const [path, value] of map) if (path === tail || path.endsWith(`/${tail}`)) return value;
  return null;
}

// ---- the import ------------------------------------------------------------------------------------

/**
 * Verify a folder's bytes against the index and write the matches into the object cache.
 * @param {Map<string, any>} map path → handle or File
 * @param {any} index validated resource index
 * @param {{ wanted?: string[]|null, onProgress?: (stats: any, entry?: any) => void,
 *   open?: (value: any) => Promise<{ size: number, arrayBuffer: () => Promise<ArrayBuffer> }>, cache?: any }} [opts]
 * @returns {Promise<{ total: number, imported: number, importedBytes: number, missing: number, rejected: number }>}
 */
export async function importResources(map, index, { wanted = null, onProgress = null, open = null, cache = null } = {}) {
  const keep = wanted ? new Set(wanted) : null;
  const files = (index?.files || []).filter((f) => !keep || keep.has(f.url));
  const objects = cache || await caches.open(OBJECT_CACHE);
  const stats = { total: files.length, done: 0, imported: 0, importedBytes: 0, missing: 0, rejected: 0 };
  const toFile = open || (async (handleOrFile) => (typeof handleOrFile.getFile === 'function' ? handleOrFile.getFile() : handleOrFile));
  for (const entry of files) {
    const found = findInMap(map, entry.url);
    if (!found) stats.missing++;
    else {
      try {
        const file = await toFile(found);
        if (file.size !== entry.bytes) throw new Error('size');
        const bytes = await file.arrayBuffer();
        if (await digestOf(bytes) !== entry.sha256) throw new Error('sha');
        await objects.put(objectKey(entry), new Response(bytes, { status: 200, headers: { 'content-type': mimeOf(entry.url) } }));
        stats.imported++;
        stats.importedBytes += entry.bytes;
      } catch { stats.rejected++; }
    }
    stats.done++;
    if (onProgress) onProgress(stats, entry);
    if (stats.done % 40 === 0) await new Promise((resolve) => setTimeout(resolve, 0)); // keep the page responsive
  }
  return stats;
}

/** Import from a picked directory handle. */
export async function importDirectory(handle, index, opts = {}) {
  const map = await walkDirectory(handle);
  return importResources(map, index, opts);
}

/** Import from a `webkitdirectory` file list (no memory: the folder cannot be re-opened without the player). */
export async function importFileList(fileList, index, opts = {}) {
  return importResources(mapPickedFiles(fileList), index, opts);
}

/**
 * Is anything already in the verified cache for this index? Used to offer the folder import on an empty cache.
 * @param {any} index @param {string[]} [sentinels]
 */
export async function cachedSample(index, sentinels = ['/data/assets.json']) {
  try {
    const objects = await caches.open(OBJECT_CACHE);
    for (const url of sentinels) {
      const entry = (index?.files || []).find((f) => f.url === url);
      if (!entry) continue;
      if (await objects.match(objectKey(entry))) return true;
    }
    return false;
  } catch { return false; }
}
