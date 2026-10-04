// Do not execute the game shell until its local resource snapshot is complete and verified.
import { prepareAssets, validateResourceIndex } from './preload.js';
import { createPreloadEffects } from './preload-effects.js';
import { RESOURCE_INDEX_URL, OPTIONAL_RESOURCE_GROUPS, classifyResourceFiles } from '../../shared/resource-plan.js';

const PREF_DOWNLOAD = 'sp.pref.download';
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
const dl = document.getElementById('boot-download');
const dlToggle = document.getElementById('boot-dl-toggle');
const dlTotal = document.getElementById('boot-dl-total');
const dlNote = document.getElementById('boot-dl-note');
const dlBoxes = { audio: document.getElementById('boot-dl-audio'), guide: document.getElementById('boot-dl-guide') };

/** Which optional groups to download (shared/resource-plan.js); audio and the tutorial pages are the only ones. */
let selection = { audio: true, guide: true };
let preloadStarted = false;
let indexPromise = null;

function loadSelection() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_DOWNLOAD) || 'null');
    if (raw && typeof raw === 'object') return { audio: raw.audio !== false, guide: raw.guide !== false };
  } catch { /* defaults */ }
  return null;
}
function saveSelection(value) {
  try { localStorage.setItem(PREF_DOWNLOAD, JSON.stringify(value)); } catch { /* private browsing */ }
}

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

/** Render the choice panel from the index: each optional group with its file count and size, and the running total. */
function renderChoices(index) {
  const info = classifyResourceFiles(index.files);
  const byId = new Map(info.groups.map((g) => [g.id, g]));
  if (dlTotal) dlTotal.textContent = `共 ${index.files.length} 项 · ${mb(index.bytes)}`;
  for (const group of OPTIONAL_RESOURCE_GROUPS) {
    const g = byId.get(group.id);
    const label = document.getElementById(`boot-dl-${group.id}-label`);
    if (label && g) label.textContent = `${group.label}（${g.files} 项 · ${mb(g.bytes)}）`;
    if (dlBoxes[group.id]) dlBoxes[group.id].checked = selection[group.id] !== false;
  }
  if (dlNote) {
    const off = OPTIONAL_RESOURCE_GROUPS.filter((group) => selection[group.id] === false);
    const files = info.required + info.groups.reduce((n, g) => n + (selection[g.id] === false ? 0 : g.files), 0);
    const bytes = info.requiredBytes + info.groups.reduce((n, g) => n + (selection[g.id] === false ? 0 : g.bytes), 0);
    dlNote.textContent = off.length
      ? `将下载 ${files} 项 · ${mb(bytes)}；跳过：${off.map((g) => g.label).join('、')}。其余素材为必需项。`
      : `将下载全部 ${index.files.length} 项 · ${mb(index.bytes)}。音频与教程页可跳过，其余为必需项。`;
  }
}
const readChoice = () => ({ audio: dlBoxes.audio ? dlBoxes.audio.checked : true, guide: dlBoxes.guide ? dlBoxes.guide.checked : true });

function begin() {
  if (preloadStarted) return;
  preloadStarted = true;
  if (dl) dl.hidden = true;
  if (dlToggle) dlToggle.hidden = false;
  start();
}

function wireChoices() {
  if (!dl) return;
  const repaint = () => { fetchIndex().then(renderChoices).catch(() => {}); };
  const setBoth = (value) => { selection = { audio: value, guide: value }; repaint(); };
  document.getElementById('boot-dl-all')?.addEventListener('click', () => setBoth(true));
  document.getElementById('boot-dl-lean')?.addEventListener('click', () => setBoth(false));
  for (const box of Object.values(dlBoxes)) box?.addEventListener('change', () => { selection = readChoice(); repaint(); });
  document.getElementById('boot-dl-go')?.addEventListener('click', () => {
    selection = readChoice();
    saveSelection(selection);
    if (preloadStarted) location.reload();
    else begin();
  });
  if (dlToggle) dlToggle.addEventListener('click', () => { if (dl) dl.hidden = !dl.hidden; });
}

const effects = createPreloadEffects({ audioSelected: selection.audio, onState(state) {
  const labels = { loading: '音乐优先下载中', ready: '音乐已就绪，点击开启', playing: '正在播放本地音乐',
    muted: '音乐已静音', unavailable: '音乐不可用，继续下载素材', skipped: '音乐未选择下载' };
  if (ready) ready.textContent = `${labels[state.music]}${state.fonts ? ` · ${state.fonts} 款字体已应用` : ''}`;
  if (music) {
    music.dataset.state = state.music;
    music.disabled = state.music === 'unavailable' || state.music === 'skipped';
    music.textContent = state.music === 'playing' ? '音乐已开启' : state.music === 'loading' ? '开启下载期间音乐' : '开启音乐';
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
      error.textContent = `资源下载或校对失败：${String(err?.message || err).slice(0, 220)}。请检查网络或本地存储空间后重试。`;
      error.setAttribute('data-final', '1');
    }
    if (retry) { retry.hidden = false; retry.onclick = () => location.reload(); }
    if (status) status.textContent = '资源校对未完成';
    if (progress) progress.setAttribute('aria-hidden', 'true');
  }
}

wireChoices();
const saved = loadSelection();
if (saved) {
  // A remembered choice starts right away; 「下载内容」 reopens the panel.
  selection = saved;
  begin();
  fetchIndex().then(renderChoices).catch(() => {});
} else {
  // First visit: show the picker, but do not block the boot — the default (everything) starts on its own.
  fetchIndex().then(renderChoices).catch(() => {});
  let left = 8;
  const tick = setInterval(() => {
    if (preloadStarted) { clearInterval(tick); return; }
    left -= 1;
    if (status) status.textContent = left > 0 ? `可先选择下载内容，${left} 秒后自动开始…` : '正在开始下载…';
    if (left <= 0) { clearInterval(tick); begin(); }
  }, 1000);
}
