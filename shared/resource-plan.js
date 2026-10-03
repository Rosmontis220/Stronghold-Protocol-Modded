// Resource URLs shared by the server's content index and the browser preloader.
export const ASSET_MANIFEST_URL = '/data/assets.json';
export const LOCAL_MANIFEST_URL = '/data/local-assets.json';
export const RESOURCE_INDEX_URL = '/resource-manifest.json';
export const DATA_URLS = Object.freeze([
  '/data/config.json', '/data/chess.json', '/data/bonds.json', '/data/items.json',
  '/data/bands.json', '/data/enemies.json', '/data/bosses.json', '/data/stages.json',
  '/data/tokens.json', '/data/choices.json', '/data/effects.json', '/data/garrisons.json',
  '/data/factions.json', '/data/tuning.json', '/data/waves.json', '/data/emotes.json',
]);

export function collectAssetUrls(value, out = new Set()) {
  if (typeof value === 'string') {
    if (/^\/(?:assets|fonts)\//.test(value)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectAssetUrls(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectAssetUrls(item, out);
  }
  return out;
}

export function collectLocalUrls(value, out = new Set()) {
  if (typeof value === 'string') {
    if (value.startsWith('/assets/')) out.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectLocalUrls(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectLocalUrls(item, out);
  }
  return out;
}

export function buildPreloadPlan(assetManifest, localManifest = null) {
  const urls = new Set([...DATA_URLS, ASSET_MANIFEST_URL]);
  for (const url of collectAssetUrls(assetManifest)) urls.add(url);
  if (localManifest) {
    urls.add(LOCAL_MANIFEST_URL);
    for (const url of collectLocalUrls(localManifest)) urls.add(url);
  }
  return [...urls].sort();
}

// Both the runtime audio URL and its original URL use the same local object.
export function runtimeResourceUrl(url) {
  return url.replace(/^\/assets\/audio\/(.+)\.(?:mp3|m4a|aac|ogg|oga|opus|wav)$/i, '/media/$1');
}
