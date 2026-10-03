// Compare cloud file digests with local Cache Storage before importing the game shell.
import { RESOURCE_INDEX_URL } from '../../shared/resource-plan.js';
export { ASSET_MANIFEST_URL, LOCAL_MANIFEST_URL, DATA_URLS, buildPreloadPlan, collectAssetUrls, collectLocalUrls } from '../../shared/resource-plan.js';

export function validateResourceIndex(index) {
  if (index?.version !== 2 || !/^[a-f0-9]{64}$/.test(index.hash) || !Array.isArray(index.files) || !index.files.length) {
    throw new Error('云端资源清单无效');
  }
  const paths = new Set();
  let bytes = 0;
  for (const file of index.files) {
    if (!file || typeof file.url !== 'string' || !/^\/(?:data|assets|fonts)\//.test(file.url)
      || /[\\\0?#]/.test(file.url) || file.url.split('/').slice(1).some((part) => !part || part.startsWith('.'))
      || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0
      || paths.has(file.url) || (file.runtime && !/^\/media\/[^?#\\]+$/.test(file.runtime))) {
      throw new Error('云端资源清单包含无效文件');
    }
    paths.add(file.url);
    bytes += file.bytes;
  }
  if (index.bytes !== bytes) throw new Error('云端资源清单大小不一致');
  return index;
}

function progressText(progress, onProgress) {
  try { onProgress?.(progress); } catch { /* UI progress is best effort */ }
}

function waitForActivation(worker) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('本地缓存服务启动超时，请刷新重试')), 30000);
    function finish(error) {
      clearTimeout(timer);
      worker.removeEventListener('statechange', check);
      if (error) reject(error); else resolve(worker);
    }
    function check() {
      if (worker.state === 'activated') finish();
      else if (worker.state === 'redundant') finish(new Error('本地缓存服务更新失败，请刷新重试'));
      else if (worker.state === 'installed') worker.postMessage({ type: 'SKIP_WAITING' });
    }
    worker.addEventListener('statechange', check);
    check();
  });
}

async function activeWorker() {
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  await registration.update();
  const worker = registration.installing || registration.waiting || registration.active;
  if (!worker) throw new Error('本地缓存服务未就绪');
  await waitForActivation(worker);
  // clients.claim() controls the current document without a mandatory reload.
  if (navigator.serviceWorker.controller !== worker) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('本地缓存服务尚未接管页面，请刷新重试')), 15000);
      function finish(error) {
        clearTimeout(timer);
        navigator.serviceWorker.removeEventListener('controllerchange', check);
        if (error) reject(error); else resolve();
      }
      function check() { if (navigator.serviceWorker.controller === worker) finish(); }
      navigator.serviceWorker.addEventListener('controllerchange', check);
      check();
    });
  }
  return worker;
}

function sendBatch(worker, index, offset, onProgress) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    let settled = false;
    const timer = setTimeout(() => finish(reject, new Error('资源批次校对超时，请刷新重试')), 120000);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.port1.close();
      fn(value);
    };
    channel.port1.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === 'PROGRESS') progressText(data, onProgress);
      else if (data.type === 'BATCH_DONE') finish(resolve, data);
      else if (data.type === 'ERROR') finish(reject, new Error(data.message || '资源预下载失败'));
    };
    try { worker.postMessage({ type: 'PRELOAD_BATCH', index, offset }, [channel.port2]); }
    catch (err) { finish(reject, err); }
  });
}

async function sendBatches(worker, index, onProgress) {
  const totals = { cached: 0, downloaded: 0, downloadedBytes: 0, checkedBytes: 0 };
  let offset = 0;
  while (offset < index.files.length) {
    const result = await sendBatch(worker, index, offset, (progress) => progressText({ ...progress,
      cached: totals.cached + (progress.cached || 0), downloaded: totals.downloaded + (progress.downloaded || 0),
      downloadedBytes: totals.downloadedBytes + (progress.downloadedBytes || 0),
      checkedBytes: totals.checkedBytes + (progress.checkedBytes || 0) }, onProgress));
    if (!Number.isSafeInteger(result.done) || result.done <= offset || result.done > index.files.length
      || result.version !== index.hash || result.final !== (result.done === index.files.length)) {
      throw new Error('资源批次结果无效，请刷新重试');
    }
    for (const key of Object.keys(totals)) totals[key] += result[key] || 0;
    offset = result.done;
  }
  return { type: 'DONE', version: index.hash, total: index.files.length, ...totals };
}

export async function prepareAssets({ onProgress } = {}) {
  if (!('serviceWorker' in navigator) || !('MessageChannel' in window) || !('caches' in window) || !window.crypto?.subtle) {
    throw new Error('当前浏览器无法保存本地资源，请通过 HTTPS 或 localhost 使用最新版浏览器');
  }
  progressText({ phase: 'manifest' }, onProgress);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 120000);
  let index;
  try {
    const response = await fetch(RESOURCE_INDEX_URL, { cache: 'no-store', signal: abort.signal });
    if (!response.ok) throw new Error(`云端资源清单 HTTP ${response.status}`);
    index = validateResourceIndex(await response.json());
  } finally { clearTimeout(timer); }
  progressText({ phase: 'verify', done: 0, total: index.files.length, totalBytes: index.bytes }, onProgress);
  const worker = await activeWorker();
  const result = await sendBatches(worker, index, onProgress);
  return { ...result, mode: 'verified-cache', urls: index.files.map((file) => file.url) };
}
