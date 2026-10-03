// PRELOAD_E2E=1 CHROME_PATH=... node --test test/preload.browser.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from '../server/index.js';
import { DATA_URLS } from '../shared/resource-plan.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BROWSER = process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

test('browser predownload verifies local bytes, reuses files, updates atomically and supports retry',
  { skip: process.env.PRELOAD_E2E !== '1', timeout: 180000 }, async (t) => {
    const { default: puppeteer } = await import('puppeteer-core');
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-preload-browser-'));
    const publicDir = path.join(root, 'public');
    const dataDir = path.join(root, 'data');
    await fsp.mkdir(path.join(publicDir, 'assets/audio/bgm'), { recursive: true });
    await fsp.mkdir(path.join(publicDir, 'fonts'));
    await fsp.mkdir(dataDir);
    for (const url of DATA_URLS) await fsp.writeFile(path.join(dataDir, path.basename(url)), '{}');
    await fsp.writeFile(path.join(publicDir, 'assets/a.png'), 'alpha');
    await fsp.writeFile(path.join(publicDir, 'assets/b.png'), 'second');
    await fsp.writeFile(path.join(publicDir, 'assets/model.atlas'), 'page.png\nsize: 512,512\n'.repeat(100));
    await fsp.writeFile(path.join(publicDir, 'assets/audio/bgm/a.mp3'), 'sound');
    await fsp.writeFile(path.join(publicDir, 'fonts/fonts.css'), '/* fonts */');
    const manifest = { hash: 'same-structure', ui: { a: '/assets/a.png', b: '/assets/b.png', atlas: '/assets/model.atlas' },
      audio: { bgm: '/assets/audio/bgm/a.mp3' }, fonts: { css: '/fonts/fonts.css' } };
    await fsp.writeFile(path.join(dataDir, 'assets.json'), JSON.stringify(manifest));
    const fixtureHandler = createStaticHandler({ publicDir, dataDir, sharedDir: path.join(ROOT, 'shared') });
    const codeHandler = createStaticHandler({ publicDir: path.join(ROOT, 'public'), dataDir, sharedDir: path.join(ROOT, 'shared') });
    const downloads = [];
    let blocked = '';
    let corrupt = '';
    let workerSuffix = '';
    const server = http.createServer(async (req, res) => {
      const url = req.url.split('?')[0];
      if (url === '/js/main.js') {
        res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
        res.end("window.__gameStarted=true;document.getElementById('boot').classList.add('is-done');");
        return;
      }
      if (url === '/sw.js') {
        res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
        res.end((await fsp.readFile(path.join(ROOT, 'public/sw.js'), 'utf8')) + workerSuffix);
        return;
      }
      if (/^\/(?:data|assets|media|fonts)\//.test(url)) downloads.push(url);
      if (url === blocked) { res.writeHead(503); res.end('temporary failure'); return; }
      if (url === corrupt) { res.writeHead(200); res.end('WRONG'); return; }
      if (url === '/resource-manifest.json' || /^\/(?:data|assets|media|fonts)\//.test(url)) {
        await fixtureHandler(req, res, url, '');
      } else { await codeHandler(req, res, url, ''); }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let browser;
    t.after(async () => {
      if (browser) await browser.close();
      await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
      assert.match(root, /sp-preload-browser-/);
      await fsp.rm(root, { recursive: true, force: true });
    });
    browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, pipe: true,
      args: ['--no-first-run', '--disable-background-networking'] });
    const page = await browser.newPage();
    page.on('pageerror', (err) => t.diagnostic(`page error: ${err.message}`));
    page.on('console', (message) => { if (message.type() === 'error') t.diagnostic(`console: ${message.text()}`); });
    browser.on('targetcreated', async (target) => {
      if (target.type() === 'service_worker') {
        const session = await target.createCDPSession();
        await session.send('Runtime.enable');
        session.on('Runtime.exceptionThrown', (event) => t.diagnostic(`worker error: ${JSON.stringify(event.exceptionDetails)}`));
      }
    });
    await page.setViewport({ width: 1280, height: 720 });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const boot = async () => {
      await page.bringToFront();
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      try {
        await page.waitForFunction(() => window.__gameStarted || !document.getElementById('boot-retry').hidden, { timeout: 50000 });
      } catch (err) {
        t.diagnostic(JSON.stringify(await page.evaluate(() => ({ status: document.getElementById('boot-status').textContent,
          error: document.getElementById('boot-err').textContent, result: window.__spPreloadResult,
          controlled: !!navigator.serviceWorker.controller }))));
        throw err;
      }
      return page.evaluate(() => ({ result: window.__spPreloadResult, started: !!window.__gameStarted,
        error: document.getElementById('boot-err').textContent, controlled: !!navigator.serviceWorker.controller }));
    };
    const first = await boot();
    assert.equal(first.started, true, first.error);
    assert.equal(first.controlled, true);
    assert.equal(first.result.downloaded, first.result.total);
    assert.equal(first.result.cached, 0);
    assert.equal(await page.evaluate(async () => (await fetch('/assets/model.atlas')).text()), 'page.png\nsize: 512,512\n'.repeat(100));
    const meta = () => page.evaluate(async () => (await (await caches.open('sp-resource-meta-v2')).match('/__sp_active__')).json());
    const firstIndex = await meta();
    assert.equal(firstIndex.files.length, first.result.total);

    downloads.length = 0;
    const second = await boot();
    assert.equal(second.started, true, second.error);
    assert.equal(second.result.downloaded, 0);
    assert.equal(second.result.cached, second.result.total);
    assert.ok(!downloads.some((url) => /^\/(?:assets|media)\//.test(url)), downloads.join(','));

    // Direct and extensionless audio requests use the same local bytes, including when offline.
    await page.setOfflineMode(true);
    const offline = await page.evaluate(async () => Promise.all(['/assets/a.png', '/data/config.json',
      '/assets/audio/bgm/a.mp3', '/media/bgm/a'].map(async (url) => (await fetch(url)).text())));
    assert.deepEqual(offline, ['alpha', '{}', 'sound', 'sound']);
    await page.setOfflineMode(false);

    // Repair a same-size corrupted local entry; all the other cached entries remain usable.
    await page.evaluate(async (index) => {
      const file = index.files.find((item) => item.url === '/assets/a.png');
      const key = `${location.origin}/__sp_object__/${file.sha256}${encodeURI(file.url)}`;
      await (await caches.open('sp-resource-objects-v2')).put(key, new Response('WRONG'));
    }, firstIndex);
    const repaired = await boot();
    assert.equal(repaired.result.downloaded, 1);
    assert.equal(await page.evaluate(async () => (await fetch('/assets/a.png')).text()), 'alpha');

    // Another live tab keeps its own snapshot while a new page updates to changed cloud bytes.
    const olderPage = await browser.newPage();
    await olderPage.goto(origin);
    await olderPage.waitForFunction(() => window.__gameStarted);
    await fsp.writeFile(path.join(publicDir, 'assets/a.png'), 'bravo');
    downloads.length = 0;
    const changed = await boot();
    assert.equal(changed.started, true, changed.error);
    assert.equal(changed.result.downloaded, 1);
    assert.notEqual(changed.result.version, first.result.version);
    assert.equal(await page.evaluate(async () => (await fetch('/assets/a.png')).text()), 'bravo');
    assert.equal(await olderPage.evaluate(async () => (await fetch('/assets/a.png')).text()), 'alpha');
    await olderPage.close();
    const goodVersion = changed.result.version;

    // No half-complete snapshot can become active after a failed or corrupt network response.
    await fsp.writeFile(path.join(publicDir, 'assets/a.png'), 'third');
    blocked = '/assets/a.png';
    const failed = await boot();
    assert.equal(failed.started, false);
    assert.match(failed.error, /校对失败/);
    assert.equal((await meta()).hash, goodVersion);
    blocked = '';
    corrupt = '/assets/a.png';
    const badBytes = await boot();
    assert.equal(badBytes.started, false);
    assert.match(badBytes.error, /SHA-256/);
    assert.equal((await meta()).hash, goodVersion);
    corrupt = '';
    await page.click('#boot-retry');
    await page.waitForFunction(() => window.__gameStarted, { timeout: 30000 });
    const retry = await page.evaluate(() => window.__spPreloadResult);
    assert.equal(retry.downloaded, 1);
    assert.equal(await page.evaluate(async () => (await fetch('/assets/a.png')).text()), 'third');

    // A newly published worker controls this document before the preloader starts the game.
    workerSuffix = '\n// updated-worker';
    const updated = await boot();
    assert.equal(updated.started, true, updated.error);
    assert.equal(updated.result.downloaded, 0);
    // Bytes already downloaded by the first release can be migrated without another network transfer.
    await page.evaluate(async () => {
      const meta = await (await (await caches.open('sp-resource-meta-v2')).match('/__sp_active__')).json();
      const file = meta.files.find((item) => item.url === '/assets/a.png');
      const key = `${location.origin}/__sp_object__/${file.sha256}${encodeURI(file.url)}`;
      const objects = await caches.open('sp-resource-objects-v2');
      const hit = await objects.match(key);
      await (await caches.open('sp-preload-legacy')).put(file.url, hit);
      await objects.delete(key);
    });
    const migrated = await boot();
    assert.equal(migrated.result.downloaded, 0);
    assert.ok(!(await page.evaluate(() => caches.keys())).includes('sp-preload-legacy'));
    t.diagnostic(JSON.stringify({ first: { downloaded: first.result.downloaded, total: first.result.total },
      second: { downloaded: second.result.downloaded, cached: second.result.cached }, changed: changed.result.downloaded,
      repaired: repaired.result.downloaded, retry: retry.downloaded, migrated: migrated.result.downloaded,
      workerUpdate: updated.controlled }));
  });
