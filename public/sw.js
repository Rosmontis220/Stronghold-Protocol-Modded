/* Verified resource objects shared across snapshots. HTML/code and /ws stay network-backed. */
const META_CACHE = 'sp-resource-meta-v2';
const OBJECT_CACHE = 'sp-resource-objects-v2';
const ACTIVE_KEY = '/__sp_active__';
const CLIENT_PREFIX = '/__sp_client__/';
const PENDING_PREFIX = '/__sp_pending__/';
const BATCH_FILES = 96;
const BATCH_BYTES = 8 * 1024 * 1024;
const ORIGIN = self.location.origin;
const LOCAL_BUNDLE = self.location.hostname === 'localhost';
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

async function downloadOnce(file, base) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 30000);
  try {
    // The optional CDN origin (the manifest's base, SP_ASSET_BASE server-side): every body is SHA-256 verified
    // below, so a stale or lying origin fails verification and download() falls back to this server.
    const path = file.runtime || file.url;
    const response = await fetch(base ? `${base}${path}` : path, { cache: 'no-store', signal: abort.signal });
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

async function download(file, base) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    // The CDN origin on the first attempts; the last one always goes to this server (the CDN may be offline,
    // blocked or stale — the digest check above rejects anything that does not match the manifest).
    try { return await downloadOnce(file, attempt < 2 ? base : undefined); }
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
    const prefix = [CLIENT_PREFIX, PENDING_PREFIX].find((value) => pathname.startsWith(value));
    if (!prefix) continue;
    const id = decodeURIComponent(pathname.slice(prefix.length));
    if (!live.has(id)) { await meta.delete(request); metadata.delete(request.url); continue; }
    const record = await readMeta(request.url);
    const snapshot = prefix === PENDING_PREFIX ? record?.index : record;
    for (const file of snapshot?.files || []) keep.add(objectKey(file));
  }
  const objects = await caches.open(OBJECT_CACHE);
  for (const request of await objects.keys()) if (!keep.has(request.url)) await objects.delete(request);
  // v1 caches are migrated by a fresh verified download; never delete current metadata.
  for (const name of await caches.keys()) if (name.startsWith('sp-preload-')) await caches.delete(name);
}

async function preloadBatch(index, offset, port, clientId, wanted = null) {
  if (index?.version !== 2 || !Array.isArray(index.files) || !index.files.length || !clientId) throw new Error('资源清单无效');
  // `wanted`: the URLs the player chose to download (the page leaves out the optional groups it switched off). The
  // full index still comes along — the version hash, the object keys and the batch sequence all stay the same; only
  // the list walked here is shorter.
  const list = Array.isArray(wanted) && wanted.length
    ? (() => { const keep = new Set(wanted); return index.files.filter((f) => keep.has(f.url)); })()
    : index.files;
  if (!list.length) throw new Error('没有可下载的资源');
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= list.length) throw new Error('资源批次无效');
  const pendingKey = `${PENDING_PREFIX}${encodeURIComponent(clientId)}`;
  let session = await readMeta(pendingKey);
  if (offset === 0) {
    session = { index: { ...index, files: list, bytes: list.reduce((n, f) => n + f.bytes, 0) }, next: 0 };
    await writeMeta(pendingKey, session);
  } else if (session?.index.hash !== index.hash || session.next !== offset) {
    throw new Error('资源批次顺序失效，请刷新重试');
  }
  // Bound both file count and bytes; stop starting new files after 15 seconds.
  const files = [];
  let plannedBytes = 0;
  for (let i = offset; i < list.length && files.length < BATCH_FILES; i++) {
    const file = list[i];
    if (files.length && plannedBytes + file.bytes > BATCH_BYTES) break;
    files.push(file);
    plannedBytes += file.bytes;
  }
  const wantedBytes = list.reduce((n, f) => n + f.bytes, 0);
  const started = Date.now();
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
  const report = (file) => post({ type: 'PROGRESS', done: offset + done, total: list.length, cached, downloaded,
    downloadedBytes, checkedBytes, totalBytes: wantedBytes, failed: failed.length, url: file.url });

  await Promise.all(Array.from({ length: Math.min(6, files.length) }, async () => {
    while (cursor < files.length && Date.now() - started < 15000) {
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
            const response = await download(file, index.base);
            await objects.put(key, response);
            downloaded++;
            downloadedBytes += file.bytes;
          }
        }
        checkedBytes += file.bytes;
        post({ type: 'RESOURCE_READY', url: file.url });
      } catch (err) {
        const message = err?.name === 'QuotaExceededError' ? '本地存储空间不足，请释放空间后重试' : String(err?.message || err);
        failed.push(`${file.url}: ${message}`);
      } finally { done++; report(file); }
    }
  }));
  if (failed.length) throw new Error(`资源校对失败 ${failed.length} 项：${failed.slice(0, 2).join('；')}`);

  const next = offset + cursor;
  const final = next === list.length;
  session.next = next;
  await writeMeta(pendingKey, session);
  // Only sequentially verified, complete snapshots become active. The active record keeps the *full* index (the
  // version the server published); the files this player skipped simply have no object in the cache.
  if (final) {
    await writeMeta(clientKey(clientId), index);
    await writeMeta(ACTIVE_KEY, index);
    const meta = await caches.open(META_CACHE);
    await meta.delete(pendingKey);
    metadata.delete(new URL(pendingKey, ORIGIN).href);
    await prune(index).catch((err) => console.warn('[resources] cleanup failed', err));
  }
  post({ type: 'BATCH_DONE', version: index.hash, done: next, total: list.length,
    cached, downloaded, downloadedBytes, checkedBytes, final });
}

async function inspectSnapshot(index, wanted, port) {
  const list = Array.isArray(wanted) && wanted.length
    ? index.files.filter((file) => wanted.includes(file.url)) : index.files;
  const objects = await caches.open(OBJECT_CACHE);
  let cached = 0;
  let missing = 0;
  for (const file of list) {
    const hit = await objects.match(objectKey(file));
    if (await verifiedBody(hit, file)) { cached++; continue; }
    if (LOCAL_BUNDLE) {
      const response = await fetch(file.url, { cache: 'no-store' });
      const bytes = await verifiedBody(response, file);
      if (bytes) {
        const headers = new Headers(response.headers);
        headers.delete('content-encoding'); headers.delete('content-length'); headers.delete('content-range');
        await objects.put(objectKey(file), new Response(bytes, { status: 200, headers }));
        cached++;
        continue;
      }
    }
    missing++;
  }
  port.postMessage({ type: 'LOCAL_SNAPSHOT', cached, missing, complete: missing === 0, hash: index.hash });
}

async function activateIndex(index, port, clientId) {
  if (index?.version !== 2 || !Array.isArray(index.files) || !index.files.length
    || !/^[a-f0-9]{64}$/.test(index.hash || '')) throw new Error('资源清单无效');
  // The streamed mode (the player chose 边玩边下载) registers the same records WITHOUT downloading: the fetch
  // handler below resolves every requested file and downloads + verifies it on demand into the object cache.
  await writeMeta(ACTIVE_KEY, index);
  if (clientId) await writeMeta(clientKey(clientId), index);
  // The streamed downloads land in the same object cache (all of them are index files), so the prune here only
  // removes objects of older snapshots.
  await prune(index).catch((err) => console.warn('[resources] cleanup failed', err));
  port.postMessage({ type: 'INDEX_ACTIVE', hash: index.hash, files: index.files.length });
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') { event.waitUntil(self.skipWaiting()); return; }
  const port = event.ports?.[0];
  if (!port) return;
  if (data.type === 'INSPECT_SNAPSHOT') {
    event.waitUntil(inspectSnapshot(data.index, data.wanted, port).catch((err) => {
      try { port.postMessage({ type: 'ERROR', message: String(err?.message || err) }); } catch {}
    }));
    return;
  }
  if (data.type === 'ACTIVATE_INDEX') {
    event.waitUntil(activateIndex(data.index, port, event.source?.id).catch((err) => {
      try { port.postMessage({ type: 'ERROR', message: String(err?.message || err) }); } catch {}
    }));
    return;
  }
  if (data.type !== 'PRELOAD_BATCH') return;
  const task = preloadQueue.then(() => preloadBatch(data.index, data.offset, port, event.source?.id, data.wanted));
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
      const response = await download(file, index?.base);
      await cache.put(objectKey(file), response.clone());
      return response;
    }
    return fetch(request);
  })());
});
