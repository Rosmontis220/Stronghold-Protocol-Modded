// Do not execute the game shell until its local resource snapshot is complete and verified — unless the player chose
// 边玩边下载 (the start page's picker, saved in sp.pref.download): then the cache service is registered without
// downloading and every asset verifies + caches on demand while the game plays.
import { prepareAssets, inspectCachedSnapshot, fetchResourceIndex, activateStreamIndex, readDownloadPref, saveDownloadPref } from './preload.js';
import { createPreloadEffects } from './preload-effects.js';

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
const dlTotal = document.getElementById('boot-dl-total');
const dlNote = document.getElementById('boot-dl-note');
const choice = document.getElementById('boot-choice');
const choiceTotal = document.getElementById('boot-choice-total');
const choicePredl = document.getElementById('boot-choice-predl');
const choiceStream = document.getElementById('boot-choice-stream');

let preloadStarted = false;
let indexPromise = null;

/** Fetch + validate the cloud index once: use one authoritative list for verification and download. */
function fetchIndex() {
  if (!indexPromise) indexPromise = fetchResourceIndex().catch((err) => { indexPromise = null; throw err; });
  return indexPromise;
}

/** Render the complete download summary after a valid manifest confirms required resources are missing. */
function renderDownloadSummary(index) {
  if (dlTotal) dlTotal.textContent = `共 ${index.files.length} 项 · ${mb(index.bytes)}`;
  if (dlNote) dlNote.textContent = '缺少必需资源，将自动完整下载并校验。';
}

function begin() {
  if (preloadStarted) return;
  preloadStarted = true;
  if (dl) dl.hidden = true;
  audioPanel?.setAttribute('hidden', '');
  start();
}

async function detectRequiredLocalSnapshot(index) {
  try {
    const result = await inspectCachedSnapshot(index);
    return result.complete;
  } catch (err) {
    console.warn('[boot] local snapshot inspection failed', err);
    return false;
  }
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
    const result = await prepareAssets({ index, onProgress: setProgress,
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

if (dl) dl.hidden = true;

/** The start page's picker (the player chooses once; the choice is remembered): the two tiles of #boot-choice. */
function showChoice(index) {
  if (!choice) { saveDownloadPref('predownload'); begin(); return; }
  if (choiceTotal) choiceTotal.textContent = `${index.files.length} 项 · ${mb(index.bytes)}`;
  choice.hidden = false;
  if (status) status.textContent = '选择资源获取方式';
  if (progress) progress.setAttribute('aria-hidden', 'true');
  if (choicePredl) choicePredl.onclick = () => choose('predownload');
  if (choiceStream) choiceStream.onclick = () => choose('stream');
}

function choose(mode) {
  saveDownloadPref(mode);
  if (choice) choice.hidden = true;
  if (mode === 'stream') {
    if (status) status.textContent = '正在启动（边玩边下载）…';
    if (detail) detail.textContent = '进入游戏后资源在用到时下载并校验；建议 Wi-Fi 下游玩。';
    audioPanel?.setAttribute('hidden', '');
    beginStream();
    return;
  }
  if (status) status.textContent = '正在准备完整下载…';
  if (detail) detail.textContent = '下载期间可以开启音乐。';
  begin();
}

/** Streamed mode: register the verified index with the cache service (no downloads), then run the game shell. */
async function beginStream() {
  if (preloadStarted) return;
  preloadStarted = true;
  if (dl) dl.hidden = true;
  try {
    const index = await fetchIndex();
    await activateStreamIndex(index);
    window.__spPreloadResult = { type: 'STREAMED', version: index.hash, total: index.files.length };
    if (status) status.textContent = '正在进入游戏…';
    await import('./main.js');
    effects.finish();
  } catch (err) {
    console.error('[boot] streamed start failed', err);
    saveDownloadPref(null); // the mode failed — ask again next time
    if (error) {
      error.textContent = `边玩边下载启动失败：${String(err?.message || err).slice(0, 220)}。可稍后刷新重试，或重新选择完整下载。`;
      error.setAttribute('data-final', '1');
    }
    if (retry) { retry.hidden = false; retry.onclick = () => { saveDownloadPref(null); location.reload(); }; }
    if (status) status.textContent = '启动未完成';
  }
}

async function bootFromLocalOrDownload() {
  // Packaged assets are validated at build time and served directly from the installation.
  if (globalThis.__SP_PACKAGED || new URLSearchParams(location.search).get('packaged') === '1') {
    await import('./main.js');
    return;
  }
  try {
    const index = await fetchIndex();
    const local = await detectRequiredLocalSnapshot(index);
    if (local) {
      if (status) status.textContent = '本地资源已校对，正在进入游戏…';
      begin();
      return;
    }
    // The player already chose: 预下载 runs the verified full download as before; 边玩边下载 starts right away.
    const pref = readDownloadPref();
    if (pref === 'predownload' || pref === 'stream') {
      if (pref === 'stream') {
        if (status) status.textContent = '正在启动（边玩边下载）…';
        beginStream();
      } else {
        if (dl) dl.hidden = false;
        if (status) status.textContent = '本地资源不完整，正在准备完整下载…';
        renderDownloadSummary(index);
        begin();
      }
      return;
    }
    // First visit (or a previous mode failed): let the player pick once. The download panel stays hidden meanwhile.
    showChoice(index);
  } catch (err) {
    // A manifest failure is a verification error, not proof that the player should see the download picker.
    // Keep every download control hidden until required-resource absence has been confirmed by a valid index.
    if (dl) dl.hidden = true;
    choice && (choice.hidden = true);
    audioPanel?.setAttribute('hidden', '');
    if (error) error.textContent = '资源校验服务暂时不可用，请稍后刷新重试。';
  }
}

bootFromLocalOrDownload();
