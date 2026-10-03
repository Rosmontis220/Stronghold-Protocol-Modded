// Boot orchestration: verify/download the current cloud asset snapshot before importing the game shell.
import { prepareAssets } from './preload.js';

const boot = document.getElementById('boot');
const status = document.getElementById('boot-status');
const progress = document.getElementById('boot-progress');
const bar = progress?.querySelector('span');
const error = document.getElementById('boot-err');
const retry = document.getElementById('boot-retry');

function setStatus(text) {
  if (status) status.textContent = text;
}

function setProgress(p) {
  if (!progress || !bar || !Number.isFinite(p?.total) || p.total <= 0) return;
  progress.setAttribute('aria-hidden', 'false');
  const ratio = Math.max(0, Math.min(1, (p.done || 0) / p.total));
  bar.style.transform = `scaleX(${ratio})`;
  const percent = Math.round(ratio * 100);
  setStatus(p.failed ? `资源校对失败 ${p.failed} 项…` : `正在校对本地资源… ${percent}%`);
}

function fail(message) {
  if (error) {
    error.textContent = message;
    error.setAttribute('data-final', '1');
  }
  if (retry) {
    retry.hidden = false;
    retry.onclick = () => location.reload();
  }
  setStatus('资源校对未完成');
  if (progress) progress.setAttribute('aria-hidden', 'true');
}

async function start() {
  try {
    const result = await prepareAssets({ onProgress: setProgress });
    setStatus(result.cached ? `本地资源已就绪 · ${result.cached}/${result.total} 项已缓存` : '本地资源已就绪');
    if (bar) bar.style.transform = 'scaleX(1)';
    // A newly installed worker can populate Cache Storage immediately, but it cannot control this
    // already-open document until the next navigation. Reload once so all runtime requests use the
    // verified snapshot; the second boot sees navigator.serviceWorker.controller and continues.
    if (result.needsReload) {
      location.reload();
      return;
    }
    // The game shell starts only after the active service-worker snapshot is complete.
    await import('./main.js');
  } catch (err) {
    console.error('[boot] asset predownload failed', err);
    fail(`资源下载或校对失败：${String(err?.message || err).slice(0, 180)}。请检查网络后重试。`);
  }
}

start();
