/* Verified resource objects shared across snapshots. HTML/code and /ws stay network-backed. */
const META_CACHE = 'sp-resource-meta-v2';
const OBJECT_CACHE = 'sp-resource-objects-v2';
const ACTIVE_KEY = '/__sp_active__';
const CLIENT_PREFIX = '/__sp_client__/';
const ORIGIN = self.location.origin;
let preloadQueue = Promise.resolve();
const metadata = new Map();
const resourceMaps = new WeakMap();

const canonicalPath = (path) => path.replace(/^\/assets\/audio\/(.+)\.(?:mp3|m4a|aac|ogg|oga|opus|wav)$/i, '/media/$1');
const objectKey = (file) => `${ORIGIN}/__sp_object__/${file.sha256}${encodeURI(file.url)}`;
const clientKey = (id) => `${CLIENT_PREFIX}${encodeURIComponent(id)}`;
const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function readMeta(key) {
  const url = new URL(key, ORIGIN).href;
  if (!metadata.has(url)) {
    const pending = (async () => {
      const cache = await caches.open(META_CACHE);
      const response = await cache.match(url);
      return response ? response.json() : null;
    })();
    metadata.set(url, pending);
    pending.catch(() => metadata.delete(url));
  }
  return metadata.get(url);
}

function resourceFor(index, path) {
  if (!index) return null;
  if (!resourceMaps.has(index)) resourceMaps.set(index, new Map(index.files.map((file) => [canonicalPath(file.url), file])));
  return resourceMaps.get(index).get(path);
}

async function writeMeta(key, index) {
  const cache = await caches.open(META_CACHE);
  await cache.put(key, new Response(JSON.stringify(index), { headers: { 'content-type': 'application/json' } }));
  metadata.set(new URL(key, ORIGIN).href, Promise.resolve(index));
}

async function verifiedBody(response, file) {
  if (!response || response.status !== 200) return null;
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== file.bytes) return null;
  if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== file.sha256) return null;
  return bytes;
}

async function downloadOnce(file) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 30000);
  try {
    const response = await fetch(file.runtime || file.url, { cache: 'no-store', signal: abort.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = await verifiedBody(response, file);
    if (!bytes) throw new Error('文件大小或 SHA-256 校验不符，请重试');
    // Fetch returns decoded bytes. Remove wire-only gzip/length headers before storing them.
    const headers = new Headers(response.headers);
    headers.delete('content-encoding');
    headers.delete('content-length');
    headers.delete('content-range');
    return new Response(bytes, { status: 200, headers });
  } finally { clearTimeout(timer); }
}

async function download(file) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await downloadOnce(file); }
    catch (err) {
      last = err;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw last;
}

async function prune(index) {
  const meta = await caches.open(META_CACHE);
  const live = new Set((await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).map((client) => client.id));
  const keep = new Set(index.files.map(objectKey));
  for (const request of await meta.keys()) {
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith(CLIENT_PREFIX)) continue;
    const id = decodeURIComponent(pathname.slice(CLIENT_PREFIX.length));
    if (!live.has(id)) { await meta.delete(request); metadata.delete(request.url); continue; }
    const snapshot = await readMeta(request.url);
    for (const file of snapshot?.files || []) keep.add(objectKey(file));
  }
  const objects = await caches.open(OBJECT_CACHE);
  for (const request of await objects.keys()) if (!keep.has(request.url)) await objects.delete(request);
  // v1 caches are migrated by a fresh verified download; never delete current metadata.
  for (const name of await caches.keys()) if (name.startsWith('sp-preload-')) await caches.delete(name);
}

async function preloadBatch(index, files, offset, port, clientId, final) {
  if (index?.version !== 2 || !Array.isArray(index.files) || !index.files.length || !Array.isArray(files)) throw new Error('资源清单无效');
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + files.length > index.files.length) throw new Error('资源批次无效');
  const objects = await caches.open(OBJECT_CACHE);
  const legacy = await Promise.all((await caches.keys())
    .filter((name) => name.startsWith('sp-preload-') && name !== 'sp-preload-meta-v1')
    .map((name) => caches.open(name)));
  let cursor = 0;
  let done = 0;
  let cached = 0;
  let downloaded = 0;
  let downloadedBytes = 0;
  let checkedBytes = 0;
  const failed = [];
  const post = (message) => { try { port.postMessage(message); } catch { /* tab closed */ } };
  const report = (file) => post({ type: 'PROGRESS', done: offset + done, total: index.files.length, cached, downloaded,
    downloadedBytes, checkedBytes, totalBytes: index.bytes, failed: failed.length, url: file.url });

  await Promise.all(Array.from({ length: Math.min(6, files.length) }, async () => {
    while (cursor < files.length) {
      const file = files[cursor++];
      try {
        const key = objectKey(file);
        const hit = await objects.match(key);
        if (await verifiedBody(hit, file)) {
          cached++;
        } else {
          // Reuse v1 downloads after checking the actual bytes against the new content index.
          let migrated = false;
          for (const cache of legacy) {
            const old = await cache.match(file.runtime || file.url);
            if (old && await verifiedBody(old.clone(), file)) {
              await objects.put(key, old);
              cached++;
              migrated = true;
              break;
            }
          }
          if (!migrated) {
            const response = await download(file);
            await objects.put(key, response);
            downloaded++;
            downloadedBytes += file.bytes;
          }
        }
        checkedBytes += file.bytes;
      } catch (err) {
        const message = err?.name === 'QuotaExceededError' ? '本地存储空间不足，请释放空间后重试' : String(err?.message || err);
        failed.push(`${file.url}: ${message}`);
      } finally { done++; report(file); }
    }
  }));
  if (failed.length) throw new Error(`资源校对失败 ${failed.length} 项：${failed.slice(0, 2).join('；')}`);

  // Only the final batch commits the active manifest. Earlier batches are resumable objects.
  if (final) {
    if (clientId) await writeMeta(clientKey(clientId), index);
    await writeMeta(ACTIVE_KEY, index);
    await prune(index).catch((err) => console.warn('[resources] cleanup failed', err));
  }
  post({ type: 'BATCH_DONE', version: index.hash, done: offset + files.length, total: index.files.length,
    cached, downloaded, downloadedBytes, final: !!final });
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') { event.waitUntil(self.skipWaiting()); return; }
  const port = event.ports?.[0];
  if (!port || data.type !== 'PRELOAD_BATCH') return;
  const task = preloadQueue.then(() => preloadBatch(data.index, data.files, data.offset, port, event.source?.id, data.final));
  preloadQueue = task.catch(() => {});
  event.waitUntil(task.catch((err) => {
    try { port.postMessage({ type: 'ERROR', message: String(err?.message || err) }); } catch { /* tab closed */ }
  }));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== ORIGIN || !/^\/(?:data|assets|fonts|media)\//.test(url.pathname)) return;
  event.respondWith((async () => {
    // Explicit no-store requests (cloud checks) must never fall back to an old local manifest.
    if (request.cache === 'no-store' || request.headers.has('range')) return fetch(request);
    const index = (event.clientId && await readMeta(clientKey(event.clientId))) || await readMeta(ACTIVE_KEY);
    const path = canonicalPath(decodeURI(url.pathname));
    const file = resourceFor(index, path);
    if (file) {
      const cache = await caches.open(OBJECT_CACHE);
      const hit = await cache.match(objectKey(file));
      if (hit) return hit;
      // A browser can evict storage. Re-download the expected content rather than serving another version.
      const response = await download(file);
      await cache.put(objectKey(file), response.clone());
      return response;
    }
    return fetch(request);
  })());
});
