/* Stronghold Protocol resource cache.
 * The page drives a versioned, all-or-nothing snapshot through PRELOAD messages.
 * Only /data/, /assets/ and /fonts/ are served from this cache; HTML, JS, CSS and the
 * WebSocket connection remain network-backed so deployments are picked up normally.
 */
const META_CACHE = 'sp-preload-meta-v1';
const ACTIVE_KEY = '/__stronghold_active__';
const CACHE_PREFIX = 'sp-preload-';
const STATIC_PREFIXES = ['/data/', '/assets/', '/fonts/', '/media/'];

const sameOrigin = (url) => url.origin === self.location.origin;
const AUDIO_PATH = /^\/assets\/audio\/(.+)\.(mp3|m4a|aac|ogg|oga|opus|wav)$/i;
const cacheable = (request) => request.method === 'GET' && sameOrigin(new URL(request.url))
  && STATIC_PREFIXES.some((prefix) => new URL(request.url).pathname.startsWith(prefix));
const cacheName = (version) => `${CACHE_PREFIX}${String(version).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100)}`;

// The game normally asks for audio through /media/... to avoid download-manager prompts, but
// audio.js falls back to /assets/audio/... on static hosts. Both URLs share one cache entry.
function canonicalRequest(request) {
  const url = new URL(request.url);
  const match = AUDIO_PATH.exec(url.pathname);
  if (match) {
    url.pathname = `/media/${match[1]}`;
    return new Request(url.href);
  }
  return request;
}

self.addEventListener('install', (event) => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
  })());
});

async function activeMeta() {
  const cache = await caches.open(META_CACHE);
  const hit = await cache.match(ACTIVE_KEY);
  if (!hit) return null;
  try { return await hit.json(); } catch { return null; }
}

async function setActive(version, urls) {
  const metaCache = await caches.open(META_CACHE);
  await metaCache.put(ACTIVE_KEY, new Response(JSON.stringify({ version, urls, at: Date.now() }), {
    headers: { 'content-type': 'application/json' },
  }));
}

async function pruneCaches(active) {
  const names = await caches.keys();
  await Promise.all(names
    .filter((name) => name.startsWith(CACHE_PREFIX) && name !== cacheName(active))
    .map((name) => caches.delete(name)));
}

async function preload({ version, urls }, port) {
  if (!version || !Array.isArray(urls) || !urls.length) throw new Error('预下载清单为空');
  const name = cacheName(version);
  const cache = await caches.open(name);
  const previous = await activeMeta();
  const previousCache = previous?.version && previous.version !== version
    ? await caches.open(cacheName(previous.version)) : null;
  const requests = urls.map((url) => new Request(new URL(url, self.location.origin).href, {
    credentials: 'same-origin',
    cache: 'no-store',
  }));
  let done = 0;
  let cached = 0;
  let cursor = 0;
  const failed = [];

  const report = (url) => {
    done++;
    port.postMessage({ type: 'PROGRESS', done, total: requests.length, cached, failed: failed.length, url });
  };

  const worker = async () => {
    while (cursor < requests.length) {
      const request = requests[cursor++];
      const canonical = canonicalRequest(request);
      const url = canonical.url;
      try {
        const pathname = new URL(url).pathname;
        const alwaysRefresh = pathname.startsWith('/data/') || pathname === '/sw.js';
        const existing = alwaysRefresh ? null : await cache.match(canonical);
        if (existing && existing.ok) {
          cached++;
          report(url);
          continue;
        }

        // On a manifest update, validate the previous cached copy with its ETag. A 304 copies
        // the old bytes into the new snapshot; a 200 replaces only the changed file. This keeps
        // updates incremental without trusting a stale URL forever.
        const old = !alwaysRefresh && previousCache ? await previousCache.match(canonical) : null;
        const headers = {};
        const etag = old?.headers?.get('etag');
        if (etag) headers['If-None-Match'] = etag;
        const response = await fetch(canonical, { cache: 'no-store', credentials: 'same-origin', headers });
        if (response.status === 304 && old?.ok) {
          await cache.put(canonical, old.clone());
          cached++;
        } else {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          await cache.put(canonical, response.clone());
        }
      } catch (err) {
        failed.push({ url, message: String(err?.message || err) });
      } finally {
        report(url);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(8, requests.length) }, worker));
  if (failed.length) {
    throw new Error(`资源校对失败 ${failed.length} 个：${failed.slice(0, 3).map((x) => `${x.url} (${x.message})`).join('；')}`);
  }

  // Switching the active snapshot is atomic from the page's point of view. If a download failed,
  // this point is never reached and the previous working snapshot remains active.
  await setActive(version, urls);
  await pruneCaches(version);
  port.postMessage({ type: 'DONE', version, total: requests.length, cached });
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
    return;
  }
  const port = event.ports?.[0];
  if (!port || data.type !== 'PRELOAD') return;
  preload(data, port).catch((err) => port.postMessage({ type: 'ERROR', message: String(err?.message || err) }));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!cacheable(request)) return;
  event.respondWith((async () => {
    const meta = await activeMeta();
    const active = meta?.version ? await caches.open(cacheName(meta.version)) : null;
    const canonical = canonicalRequest(request);
    const pathname = new URL(canonical.url).pathname;
    const networkFirst = pathname.startsWith('/data/') || pathname === '/assets.json' || pathname === '/sw.js';
    if (networkFirst) {
      try {
        const response = await fetch(request, { cache: 'no-store' });
        if (response.ok && active) await active.put(canonical, response.clone());
        return response;
      } catch (err) {
        const hit = active && await active.match(canonical);
        if (hit) return hit;
        throw err;
      }
    }
    if (active) {
      const hit = await active.match(canonical);
      if (hit) return hit;
    }
    const response = await fetch(request);
    if (response.ok && active) await active.put(canonical, response.clone());
    return response;
  })());
});
