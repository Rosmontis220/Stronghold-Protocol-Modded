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

// ---- what you may skip ---------------------------------------------------------------------------------
//
// Two groups are optional: the audio set (music + effects — the game runs silent) and the 玩法说明 tutorial
// pages (the viewer falls back to the official text tips). Everything else — the game data, the fonts, the enemy
// and operator models, the art, the icons — is required: skipping it breaks the match or the readable board, so the
// download picker only offers these two.

/** Optional groups the preload picker offers, heaviest first, with the reason shown to the player. */
export const OPTIONAL_RESOURCE_GROUPS = Object.freeze([
  Object.freeze({ id: 'audio', label: '音频（背景音乐与音效）', note: '关闭后游戏静音，启动页也不再播放音乐', bytes: 27.1 * 1048576 }),
  Object.freeze({ id: 'guide', label: '玩法说明教程页', note: '关闭后「玩法说明」只显示文字要点', bytes: 20.6 * 1048576 }),
]);

/**
 * The optional group a URL belongs to, or null when the file is required.
 * @param {string} url @returns {'audio'|'guide'|null}
 */
export function optionalGroupOf(url) {
  if (typeof url !== 'string') return null;
  if (url.startsWith('/assets/audio/')) return 'audio';
  if (url.startsWith('/assets/ui/guide/')) return 'guide';
  return null;
}

/**
 * Split an index's files into what is always downloaded and what the picker may skip.
 * @param {Array<{ url: string, bytes?: number }>} files
 * @returns {{ required: number, requiredBytes: number, groups: Array<{ id: string, label: string, note: string, files: number, bytes: number }> }}
 */
export function classifyResourceFiles(files) {
  const list = Array.isArray(files) ? files : [];
  const groups = OPTIONAL_RESOURCE_GROUPS.map((g) => ({ ...g, files: 0, bytes: 0 }));
  const byId = new Map(groups.map((g) => [g.id, g]));
  let required = 0;
  let requiredBytes = 0;
  for (const f of list) {
    const id = optionalGroupOf(f && f.url);
    if (!id) { required++; requiredBytes += Number(f && f.bytes) || 0; continue; }
    const g = byId.get(id);
    g.files++;
    g.bytes += Number(f && f.bytes) || 0;
  }
  return { required, requiredBytes, groups };
}

/**
 * The files to download for a selection: everything except the switched-off optional groups.
 * @param {Array<{ url: string }>} files
 * @param {{ audio?: boolean, guide?: boolean }|null} selection omitted groups are skipped (null/undefined ⇒ all)
 * @returns {Array<any>}
 */
export function selectResourceFiles(files, selection) {
  const list = Array.isArray(files) ? files : [];
  if (!selection) return list.slice();
  return list.filter((f) => {
    const id = optionalGroupOf(f && f.url);
    return !id || selection[id] !== false;
  });
}

