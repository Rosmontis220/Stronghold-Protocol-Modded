// Browser-side resource preloader.
// The manifest is fetched from the server on every page load. The service worker keeps a
// versioned Cache Storage snapshot of every asset/font URL, so a new manifest hash downloads
// only the new snapshot before the game shell starts.

export const ASSET_MANIFEST_URL = '/data/assets.json';
export const LOCAL_MANIFEST_URL = '/data/local-assets.json';

// Static game data is small, but loading it here means the first match does not scatter requests
// across the room -> briefing -> battle transition. local-assets.json remains optional.
export const DATA_URLS = Object.freeze([
  '/data/config.json', '/data/chess.json', '/data/bonds.json', '/data/items.json',
  '/data/bands.json', '/data/enemies.json', '/data/bosses.json', '/data/stages.json',
  '/data/tokens.json', '/data/choices.json', '/data/effects.json', '/data/garrisons.json',
  '/data/factions.json', '/data/tuning.json', '/data/waves.json', '/data/emotes.json',
]);

const ASSET_PATH = /^(?:\/assets|\/fonts)\//;
const LOCAL_PATH = /^\/assets\//;

/** Collect unique same-origin asset paths from a manifest. */
export function collectAssetUrls(value, out = new Set()) {
  if (typeof value === 'string') {
    if (ASSET_PATH.test(value)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectAssetUrls(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectAssetUrls(item, out);
  }
  return out;
}

/** Collect optional local-client art paths from data/local-assets.json. */
export function collectLocalUrls(value, out = new Set()) {
  if (typeof value === 'string') {
    if (LOCAL_PATH.test(value)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectLocalUrls(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectLocalUrls(item, out);
  }
  return out;
}

/** Build the complete predownload list in stable order. */
export function buildPreloadPlan(assetManifest, localManifest = null) {
  const urls = new Set(DATA_URLS);
  urls.add(ASSET_MANIFEST_URL);
  urls.add('/fonts/fonts.css');
  for (const url of collectAssetUrls(assetManifest)) urls.add(url);
  if (localManifest && typeof localManifest === 'object') {
    urls.add(LOCAL_MANIFEST_URL);
    for (const url of collectLocalUrls(localManifest)) urls.add(url);
  }
  return [...urls].sort();
}

/** Cache names may contain only a short, safe manifest-derived token. */
function quickHash(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function cacheVersion(assetManifest, localManifest = null, dataSignature = 'none') {
  const base = String(assetManifest?.hash || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'unknown';
  const localSignature = localManifest ? quickHash(JSON.stringify(localManifest)) : 'none';
  return `${base}-${localSignature}-${dataSignature}`;
}

async function dataSignature(urls) {
  const validators = await Promise.all(urls.map(async (url) => {
    try {
      const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      return `${url}:${res.status}:${res.headers.get('etag') || res.headers.get('last-modified') || ''}`;
    } catch {
      return `${url}:network-error`;
    }
  }));
  return quickHash(validators.join('\n'));
}

async function readJson(url, optional = false) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (optional && res.status === 404) return null;
    if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
    const json = await res.json();
    if (!json || typeof json !== 'object') throw new Error(`${url} 返回的不是 JSON 对象`);
    return json;
  } catch (err) {
    if (optional) return null;
    throw err;
  }
}

function progressText(progress, onProgress) {
  try { onProgress?.(progress); } catch { /* UI progress is best effort */ }
}

async function directPreload(urls, onProgress) {
  let done = 0;
  const failed = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < urls.length) {
      const url = urls[cursor++];
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        failed.push({ url, error: String(err?.message || err) });
      } finally {
        done++;
        progressText({ done, total: urls.length, cached: 0, failed: failed.length, url }, onProgress);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, urls.length) }, worker));
  if (failed.length) throw new Error(`资源下载失败 ${failed.length} 个：${failed.slice(0, 3).map((x) => x.url).join('、')}`);
  return { mode: 'browser-cache', version: null, total: urls.length };
}

function sendToWorker(worker, message, onProgress) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; channel.port1.close(); fn(value); };
    channel.port1.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === 'PROGRESS') { progressText(data, onProgress); return; }
      if (data.type === 'DONE') { finish(resolve, data); return; }
      if (data.type === 'ERROR') { finish(reject, new Error(data.message || '资源预下载失败')); }
    };
    try { worker.postMessage(message, [channel.port2]); } catch (err) { finish(reject, err); }
  });
}

async function activateLatestWorker(registration) {
  const skip = (worker) => { try { worker?.postMessage({ type: 'SKIP_WAITING' }); } catch { /* page may be closing */ } };
  if (registration.waiting) skip(registration.waiting);
  const installing = registration.installing;
  if (installing) {
    await new Promise((resolve) => {
      if (['installed', 'activated', 'redundant'].includes(installing.state)) { resolve(); return; }
      const onState = () => {
        if (['installed', 'activated', 'redundant'].includes(installing.state)) {
          installing.removeEventListener('statechange', onState);
          skip(registration.waiting);
          resolve();
        }
      };
      installing.addEventListener('statechange', onState);
    });
  }
  await navigator.serviceWorker.ready;
}

async function serviceWorkerPreload(version, urls, onProgress) {
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  await registration.update().catch(() => {});
  await activateLatestWorker(registration);
  const worker = registration.active || navigator.serviceWorker.controller;
  if (!worker) throw new Error('Service Worker 尚未准备好');
  const result = await sendToWorker(worker, { type: 'PRELOAD', version, urls }, onProgress);
  return { ...result, needsReload: !navigator.serviceWorker.controller };
}

/**
 * Fetch the cloud manifest, compare its version with local Cache Storage, and make a complete
 * local snapshot before the application module is imported.
 */
export async function prepareAssets({ onProgress } = {}) {
  const manifest = await readJson(ASSET_MANIFEST_URL);
  const localManifest = await readJson(LOCAL_MANIFEST_URL, true);
  const urls = buildPreloadPlan(manifest, localManifest);
  const signatureUrls = urls.filter((url) => url.startsWith('/data/'));
  const version = cacheVersion(manifest, localManifest, await dataSignature(signatureUrls));
  const progress = { done: 0, total: urls.length, cached: 0, failed: 0, url: '' };
  progressText(progress, onProgress);

  if ('serviceWorker' in navigator && 'MessageChannel' in window && 'caches' in window) {
    try {
      const result = await serviceWorkerPreload(version, urls, onProgress);
      return { ...result, manifest, localManifest, urls };
    } catch (err) {
      // A storage quota error should be visible rather than silently becoming a partial cache.
      // Network fallback is useful for browsers where Service Worker is unavailable, but not for
      // a failed worker snapshot: retrying with direct fetch would defeat local verification.
      if (/quota|存储|storage|snapshot|预下载|资源校对/i.test(String(err?.message || err))) throw err;
      console.warn('[preload] Service Worker unavailable, using browser cache fallback', err);
    }
  }
  const result = await directPreload(urls, onProgress);
  return { ...result, manifest, localManifest, urls };
}
