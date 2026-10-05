// Do not execute the game shell until its local resource snapshot is complete and verified.
import { prepareAssets, validateResourceIndex, inspectCachedSnapshot } from './preload.js';
import { createPreloadEffects } from './preload-effects.js';
import { RESOURCE_INDEX_URL } from '../../shared/resource-plan.js';
import { pickResourceDirectory, recallDirectory, permissionOf, requestPermission, importDirectory,
  importFileList, cachedSample, supportsDirectoryPicker } from './local-import.js';

const status = document.getElementById('boot-status');
const detail = document.getElementById('boot-detail');
const progress = document.getElementById('boot-progress');
const bar = progress?.querySelector('span');
const error = document.getElementById('boot-err');
const retry = document.getElementById('boot-retry');
const mb = (bytes) => `${((bytes || 0) / (1024 * 1024)).toFixed(1)} MB`;
const ready = document.getElementById('boot-ready');
const music = document.getElementById('boot-music');
const mute = document.getElementById('boot-mute');
const audioPanel = document.getElementById('boot-audio');
const dl = document.getElementById('boot-download');
const dlToggle = document.getElementById('boot-dl-toggle');
const dlTotal = document.getElementById('boot-dl-total');
const dlNote = document.getElementById('boot-dl-note');
const importNote = document.getElementById('boot-import-note');
const importInput = document.getElementById('boot-import-input');
const importResume = document.getElementById('boot-import-resume');
/** The player is picking/importing a local folder: never let the auto-start race the import. */
let autoStartHeld = false;

/** The client always verifies and downloads the complete indexed resource set. */
const selection = null;
let preloadStarted = false;
let indexPromise = null;

/** Fetch + validate the cloud index once: the choice panel needs the real sizes before the download starts. */
function fetchIndex() {
  if (!indexPromise) {
    indexPromise = (async () => {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 120000);
      try {
        const response = await fetch(RESOURCE_INDEX_URL, { cache: 'no-store', signal: abort.signal });
        if (!response.ok) throw new Error(`云端资源清单 HTTP ${response.status}`);
        return validateResourceIndex(await response.json());
      } finally { clearTimeout(timer); }
    })();
  }
  return indexPromise;
}

/** Render the complete download summary after a valid manifest confirms required resources are missing. */
function renderChoices(index) {
  if (dlTotal) dlTotal.textContent = `共 ${index.files.length} 项 · ${mb(index.bytes)}`;
  if (dlNote) dlNote.textContent = '缺少必需资源，将自动完整下载并校验。';
}

const wantedFor = () => null;

/** Report one import pass into the boot status lines. */
function importProgress(index) {
  return (stats) => {
    const ratio = stats.total ? stats.done / stats.total : 1;
    if (status) status.textContent = `正在从本地文件夹校验素材… ${Math.round(ratio * 100)}%`;
    if (detail) detail.textContent = `${stats.done}/${stats.total} 项 · 已导入 ${stats.imported} 项 (${mb(stats.importedBytes)}) · 文件夹里没有 ${stats.missing} 项 · 校验不符 ${stats.rejected} 项`;
  };
}

/** After an import (or a cancel), continue with the normal verified download: imported files count as cache hits. */
function afterImport(index, stats) {
  const summary = stats
    ? `本地导入完成：${stats.imported} 项（${mb(stats.importedBytes)}）已进本地缓存；文件夹缺少 ${stats.missing} 项、校验不符 ${stats.rejected} 项将改为下载。`
    : '未从本地导入，改为全部下载。';
  if (importNote) importNote.textContent = summary;
  effects.stop?.();
  begin();
}

/**
 * The local-folder row: pick a folder (Chromium remembers it), import a `webkitdirectory` pick elsewhere, and offer
 * the remembered folder on the next visit. An empty cache with a remembered folder imports by itself.
 * Listeners attach immediately — the index may still be in flight, so every handler awaits it.
 * @param {Promise<any>} indexPromise
 */
async function wireImport(indexPromise) {
  return;
  const runDirectory = async (handle, index) => {
    autoStartHeld = true;
    try {
      const stats = await importDirectory(handle, index, { wanted: wantedFor(index), onProgress: importProgress(index) });
      afterImport(index, stats);
    } catch (err) {
      console.error('[boot] local resource import failed', err);
      if (importNote) importNote.textContent = `本地导入失败：${String(err?.message || err).slice(0, 160)}`;
      afterImport(index, null);
    }
  };
  document.getElementById('boot-import')?.addEventListener('click', async () => {
    autoStartHeld = true;
    if (importNote) importNote.textContent = '正在读取文件夹…';
    let index;
    try { index = await indexPromise; } catch { autoStartHeld = false; if (importNote) importNote.textContent = '云端资源清单不可用，无法导入。'; return; }
    if (supportsDirectoryPicker()) {
      const handle = await pickResourceDirectory();
      if (!handle) { autoStartHeld = false; if (importNote) importNote.textContent = '已取消选择文件夹。'; return; }
      await runDirectory(handle, index);
      return;
    }
    importInput?.click(); // Firefox/Safari: no handle, no memory
  });
  importInput?.addEventListener('change', async () => {
    autoStartHeld = true;
    const files = importInput.files;
    if (!files || !files.length) { autoStartHeld = false; return; }
    try {
      const index = await indexPromise;
      const stats = await importFileList(files, index, { wanted: wantedFor(index), onProgress: importProgress(index) });
      afterImport(index, stats);
    } catch (err) {
      console.error('[boot] local resource import failed', err);
      if (importNote) importNote.textContent = `本地导入失败：${String(err?.message || err).slice(0, 160)}`;
      try { afterImport(await indexPromise, null); } catch { /* no download possible either */ }
    }
  });
  let index;
  try { index = await indexPromise; } catch { return; }
  const remembered = await recallDirectory();
  if (!remembered?.handle) return;
  const state = await permissionOf(remembered.handle);
  const when = remembered.at ? new Date(remembered.at).toLocaleDateString() : '';
  if (state === 'granted' || state === 'prompt') {
    if (importResume) {
      importResume.hidden = false;
      importResume.textContent = `继续使用上次的文件夹（${remembered.name}${when ? ` · ${when}` : ''}）`;
      importResume.addEventListener('click', async () => {
        if (state === 'prompt' && !(await requestPermission(remembered.handle))) {
          if (importNote) importNote.textContent = '浏览器未授予读取权限，请重新选择文件夹。';
          return;
        }
        await runDirectory(remembered.handle);
      });
    }
    // Nothing in the verified cache yet and the folder is still readable: import it without asking.
    if (state === 'granted' && !(await cachedSample(index, ['/data/assets.json', '/data/chess.json']))) {
      if (status) status.textContent = `正在从上次的本地文件夹（${remembered.name}）导入素材…`;
      await runDirectory(remembered.handle);
    }
  } else if (importNote) {
    importNote.textContent = `上次的文件夹（${remembered.name}）需要重新授权，点击「选择本地素材文件夹」重新选择即可。`;
  }
}

function begin() {
  if (preloadStarted) return;
  preloadStarted = true;
  if (dl) dl.hidden = true;
  if (dlToggle) dlToggle.hidden = true;
  audioPanel?.setAttribute('hidden', '');
  start();
}

async function detectRequiredLocalSnapshot(index) {
  // Startup readiness only concerns mandatory game files. Audio and tutorial pages are optional downloads and must
  // never prevent an already playable local snapshot from entering the game.
  const required = { audio: false, guide: false };
  try {
    const result = await inspectCachedSnapshot(index, required);
    return result.complete ? required : null;
  } catch (err) {
    console.warn('[boot] required local snapshot inspection failed', err);
    return null;
  }
}

function wireChoices() {
  if (dlToggle) dlToggle.hidden = true;
}

const effects = createPreloadEffects({ audioSelected: true, onState(state) {
  const labels = { loading: '音乐准备中', ready: '音乐已就绪', playing: '正在播放本地音乐',
    muted: '音乐已静音', unavailable: '音乐不可用', skipped: '音乐未选择' };
  if (ready) ready.textContent = `${labels[state.music]}${state.fonts ? ` · ${state.fonts} 款字体已应用` : ''}`;
  if (music) {
    music.dataset.state = state.music;
    music.disabled = state.music === 'unavailable' || state.music === 'skipped';
    music.textContent = state.music === 'playing' ? '音乐已开启' : state.music === 'loading' ? '开启音乐' : '开启音乐';
    music.setAttribute('aria-pressed', String(state.music === 'playing'));
  }
  if (mute) {
    mute.disabled = state.music === 'unavailable' || state.music === 'skipped';
    mute.setAttribute('aria-pressed', String(state.music === 'muted'));
  }
} });
// Explicit actions stay correct even if focus/pointerdown unlocks autoplay before click.
if (music) music.onclick = () => effects.setMusicEnabled(true);
if (mute) mute.onclick = () => effects.setMusicEnabled(false);

function setProgress(p) {
  if (p.phase === 'manifest') {
    if (status) status.textContent = '正在获取云端资源清单…';
    return;
  }
  if (!progress || !bar || !Number.isFinite(p.total) || p.total <= 0) return;
  progress.setAttribute('aria-hidden', 'false');
  const ratio = Math.max(0, Math.min(1, (p.done || 0) / p.total));
  bar.style.transform = `scaleX(${ratio})`;
  if (status) status.textContent = `${p.downloaded ? '正在下载并校对资源' : '正在校对本地资源'}… ${Math.round(ratio * 100)}%`;
  if (detail) detail.textContent = `${p.done || 0}/${p.total} 项 · 本地复用 ${p.cached || 0} 项 · 已下载 ${mb(p.downloadedBytes)} · 本次素材 ${mb(p.totalBytes)}`;
}

async function start() {
  try {
    const index = await fetchIndex();
    const result = await prepareAssets({ index, selection, onProgress: setProgress,
      onIndex: (i, read) => effects.configure(i, read),
      onResourceReady: (file) => effects.resourceReady(file) });
    if (status) status.textContent = '本地资源已就绪，正在进入游戏…';
    if (bar) bar.style.transform = 'scaleX(1)';
    window.__spPreloadResult = result;
    await import('./main.js');
    effects.finish();
  } catch (err) {
    effects.finish({ failed: true });
    if (music) music.disabled = true;
    if (mute) mute.disabled = true;
    console.error('[boot] asset predownload failed', err);
    if (error) {
      error.textContent = `本地资源校对失败：${String(err?.message || err).slice(0, 220)}。请检查网络或本地存储空间后重试。`;
      error.setAttribute('data-final', '1');
    }
    if (retry) { retry.hidden = false; retry.onclick = () => location.reload(); }
    if (status) status.textContent = '资源校对未完成';
    if (progress) progress.setAttribute('aria-hidden', 'true');
  }
}

wireChoices();
wireImport(fetchIndex()).catch(() => {});
if (dl) dl.hidden = true;

async function bootFromLocalOrShowPicker() {
  try {
    const index = await fetchIndex();
    const local = await detectRequiredLocalSnapshot(index);
    if (local) {
      selection = local;
      if (status) status.textContent = '本地资源已校对，正在进入游戏…';
      begin();
      return;
    }
    if (dl) dl.hidden = false;
    if (status) status.textContent = '本地资源不完整，正在准备完整下载…';
    renderChoices(index);
    startDownloadCountdown();
  } catch (err) {
    // A manifest failure is a verification error, not proof that the player should see the download picker.
    // Keep every download control hidden until required-resource absence has been confirmed by a valid index.
    if (dl) dl.hidden = true;
    if (dlToggle) dlToggle.hidden = true;
    audioPanel?.setAttribute('hidden', '');
    if (importNote) importNote.textContent = `无法获取资源清单：${String(err?.message || err).slice(0, 120)}`;
    if (error) error.textContent = '资源校验服务暂时不可用，请稍后刷新重试。';
  }
}

let downloadCountdown = null;
function startDownloadCountdown() {
  if (downloadCountdown || preloadStarted) return;
  let left = 10;
  const tick = () => {
    if (preloadStarted || !dl || dl.hidden || autoStartHeld) return;
    if (status) status.textContent = left > 0
      ? `本地必需资源缺失，${left} 秒后开始下载…`
      : '正在开始下载…';
    if (left <= 0) {
      downloadCountdown = null;
      begin();
      return;
    }
    left -= 1;
    downloadCountdown = setTimeout(tick, 1000);
  };
  tick();
}

bootFromLocalOrShowPicker();
