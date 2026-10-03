// Do not execute the game shell until its local resource snapshot is complete and verified.
import { prepareAssets } from './preload.js';

const status = document.getElementById('boot-status');
const detail = document.getElementById('boot-detail');
const progress = document.getElementById('boot-progress');
const bar = progress?.querySelector('span');
const error = document.getElementById('boot-err');
const retry = document.getElementById('boot-retry');
const mb = (bytes) => `${((bytes || 0) / (1024 * 1024)).toFixed(1)} MB`;

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
  if (detail) detail.textContent = `${p.done || 0}/${p.total} 项 · 本地复用 ${p.cached || 0} 项 · 已下载 ${mb(p.downloadedBytes)} · 完整素材 ${mb(p.totalBytes)}`;
}

async function start() {
  try {
    const result = await prepareAssets({ onProgress: setProgress });
    if (status) status.textContent = '本地资源已就绪，正在进入游戏…';
    if (bar) bar.style.transform = 'scaleX(1)';
    window.__spPreloadResult = result;
    await import('./main.js');
  } catch (err) {
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

start();
