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
    // Actual PCM wave: the browser must decode and start a real source, not just update a label.
    const sampleRate = 8000;
    const wave = Buffer.alloc(44 + sampleRate * 2);
    wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
    wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
    wave.writeUInt32LE(sampleRate, 24); wave.writeUInt32LE(sampleRate * 2, 28);
    wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(sampleRate * 2, 40);
    for (let i = 0; i < sampleRate; i++) wave.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / sampleRate) * 1500), 44 + i * 2);
    await fsp.writeFile(path.join(publicDir, 'assets/audio/bgm/a.wav'), wave);
    await fsp.copyFile(process.env.TEST_FONT || 'C:\\Windows\\Fonts\\segoeui.ttf', path.join(publicDir, 'fonts/fixture.ttf'));
    await fsp.writeFile(path.join(publicDir, 'fonts/fonts.css'), '/* fonts */');
    const extraArt = {};
    for (let i = 0; i < 110; i++) {
      const url = `/assets/fixture-${String(i).padStart(3, '0')}.png`;
      await fsp.writeFile(path.join(publicDir, url.slice(1)), `fixture-${i}`);
      extraArt[`fixture${i}`] = url;
    }
    const manifest = { hash: 'same-structure', ui: { a: '/assets/a.png', b: '/assets/b.png', atlas: '/assets/model.atlas', ...extraArt },
      audio: { bgm: { lobby: { loop: '/assets/audio/bgm/a.wav' } } },
      fonts: { css: '/fonts/fonts.css', faces: { fixture: { family: 'Fixture Font', weight: 400, original: '/fonts/fixture.ttf' } } } };
    await fsp.writeFile(path.join(dataDir, 'assets.json'), JSON.stringify(manifest));
    const fixtureHandler = createStaticHandler({ publicDir, dataDir, sharedDir: path.join(ROOT, 'shared') });
    const codeHandler = createStaticHandler({ publicDir: path.join(ROOT, 'public'), dataDir, sharedDir: path.join(ROOT, 'shared') });
    const downloads = [];
    let blocked = '';
    let corrupt = '';
    let workerSuffix = '';
    let transientFailures = 0;
    let releaseArt;
    const artGate = new Promise((resolve) => { releaseArt = resolve; });
    let holdArt = true;
    let artWaiting = false;
    const server = http.createServer(async (req, res) => {
      const url = req.url.split('?')[0];
      if (url === '/probe.html') {
        res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>batch probe</title>'); return;
      }
      if (url === '/js/main.js') {
        res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
        res.end(`import { audio, installAudio } from '/js/audio.js';
          window.__bgmBeforeGame = audio.bgm;
          installAudio({ getManifest: () => null, getState: () => ({}), subscribe: () => () => {}, selectRoute: () => 'title' });
          window.__bgmContinued = audio.bgm === window.__bgmBeforeGame;
          window.__gameStarted=true;document.getElementById('boot').classList.add('is-done');`);
        return;
      }
      if (url === '/sw.js') {
        res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
        res.end((await fsp.readFile(path.join(ROOT, 'public/sw.js'), 'utf8')) + workerSuffix);
        return;
      }
      if (/^\/(?:data|assets|media|fonts)\//.test(url)) downloads.push(url);
      if (url === '/assets/a.png' && holdArt) { artWaiting = true; await artGate; }
      if (url === '/assets/a.png' && transientFailures > 0) {
        transientFailures--;
        res.writeHead(503); res.end('transient failure'); return;
      }
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
      args: ['--no-first-run', '--disable-background-networking',
        `--autoplay-policy=${process.env.PRELOAD_AUTOPLAY === '1' ? 'no-user-gesture-required' : 'document-user-activation-required'}`] });
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
    const progress = [];
    await page.exposeFunction('recordProgress', (value) => progress.push(value));
    await page.evaluateOnNewDocument(() => {
      document.addEventListener('DOMContentLoaded', () => {
        new MutationObserver(() => window.recordProgress(document.getElementById('boot-detail').textContent))
          .observe(document.getElementById('boot-detail'), { childList: true });
      });
    });
    const firstBoot = boot();
    await page.waitForFunction(() => document.getElementById('boot-music')?.dataset.state === 'ready');
    assert.equal(artWaiting, true);
    assert.equal(await page.evaluate(() => !!window.__gameStarted), false);
    assert.equal(await page.$('#boot-dl-lean'), null);
    holdArt = false; releaseArt();
    const first = await firstBoot;
    assert.equal(first.started, true, first.error);
    assert.equal(first.controlled, true);
    assert.equal(first.result.downloaded, first.result.total);
    assert.equal(first.result.cached, 0);
    assert.ok(first.result.total > 96, 'fixture must span multiple worker events');
    const counts = progress.map((value) => +(value.match(/^(\d+)\//)?.[1] || 0));
    assert.ok(counts.every((value, i) => i === 0 || value >= counts[i - 1]), 'file progress must not reset between batches');
    assert.equal(await page.evaluate(async () => (await fetch('/assets/model.atlas')).text()), 'page.png\nsize: 512,512\n'.repeat(100));
    const meta = () => page.evaluate(async () => (await (await caches.open('sp-resource-meta-v2')).match('/__sp_active__')).json());
    const firstIndex = await meta();
    assert.equal(firstIndex.files.length, first.result.total);

    downloads.length = 0;
    progress.length = 0;
    await page.evaluate(() => localStorage.setItem('sp.pref.settings', JSON.stringify({ muted: true, bgm: 0.25, sfx: 0.4 })));
    const second = await boot();
    assert.equal(second.started, true, second.error);
    assert.equal(second.result.downloaded, 0);
    const savedAudio = await page.evaluate(async () => (await import('/js/audio.js')).audio.volumes);
    assert.deepEqual(savedAudio, { muted: true, bgm: 0.25, sfx: 0.4 });
    assert.equal(second.result.cached, second.result.total);
    const reuseCounts = progress.map((value) => +(value.match(/本地复用 (\d+)/)?.[1] || 0));
    assert.ok(reuseCounts.every((value, i) => i === 0 || value >= reuseCounts[i - 1]), 'cache reuse count must not reset between batches');
    assert.equal(Math.max(...reuseCounts), second.result.total);
    assert.ok(!downloads.some((url) => /^\/(?:assets|media)\//.test(url)), downloads.join(','));

    // Direct and extensionless audio requests use the same local bytes, including when offline.
    await page.setOfflineMode(true);
    const offline = await page.evaluate(async () => Promise.all(['/assets/a.png', '/data/config.json',
      '/assets/audio/bgm/a.wav', '/media/bgm/a'].map(async (url) => {
        const response = await fetch(url);
        return url.includes('bgm/') ? (await response.arrayBuffer()).byteLength : response.text();
      })));
    assert.deepEqual(offline, ['alpha', '{}', wave.length, wave.length]);
    await page.setOfflineMode(false);

    // Repair a same-size corrupted local entry; all the other cached entries remain usable.
    await page.evaluate(async (index) => {
      const file = index.files.find((item) => item.url === '/assets/a.png');
      const key = `${location.origin}/__sp_object__/${file.sha256}${encodeURI(file.url)}`;
      await (await caches.open('sp-resource-objects-v2')).put(key, new Response('WRONG'));
    }, firstIndex);
    transientFailures = 2;
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
    // Persist a partial snapshot, terminate the worker, and ensure another tab's cleanup preserves it.
    const partialPage = await browser.newPage();
    await partialPage.goto(`${origin}/probe.html`);
    await partialPage.evaluate(async () => {
      window.probeIndex = await (await fetch('/resource-manifest.json', { cache: 'no-store' })).json();
      window.probeBatch = (index, offset) => new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = ({ data }) => {
          if (data.type === 'BATCH_DONE' || data.type === 'ERROR') { channel.port1.close(); resolve(data); }
        };
        navigator.serviceWorker.controller.postMessage({ type: 'PRELOAD_BATCH', index, offset }, [channel.port2]);
      });
    });
    await fsp.writeFile(path.join(publicDir, 'assets/a.png'), 'final');
    const activeBeforePartial = await meta();
    const partial = await partialPage.evaluate(async () => {
      window.probeIndex = await (await fetch('/resource-manifest.json', { cache: 'no-store' })).json();
      return probeBatch(probeIndex, 0);
    });
    assert.equal(partial.type, 'BATCH_DONE');
    assert.equal(partial.final, false);
    assert.equal((await meta()).hash, activeBeforePartial.hash);
    const stoppedWorker = await partialPage.createCDPSession();
    await stoppedWorker.send('ServiceWorker.enable');
    await stoppedWorker.send('ServiceWorker.stopAllWorkers');
    await stoppedWorker.detach();
    // Another page finishes a different version while the first page is between batches.
    await fsp.writeFile(path.join(publicDir, 'assets/a.png'), 'later');
    assert.equal((await boot()).started, true);
    const retainedPartial = await partialPage.evaluate(async () => {
      const file = probeIndex.files.find((item) => item.url === '/assets/a.png');
      return (await (await caches.open('sp-resource-objects-v2')).match(
        `${location.origin}/__sp_object__/${file.sha256}${encodeURI(file.url)}`))?.text();
    });
    assert.equal(retainedPartial, 'final');
    const outOfOrder = await partialPage.evaluate(() => probeBatch(probeIndex, probeIndex.files.length - 1));
    assert.equal(outOfOrder.type, 'ERROR');
    const completedPartial = await partialPage.evaluate(async (offset) => {
      let next = offset;
      let downloaded = 0;
      while (next < probeIndex.files.length) {
        const result = await probeBatch(probeIndex, next);
        if (result.type === 'ERROR') return result;
        downloaded += result.downloaded;
        next = result.done;
      }
      return { next, downloaded, text: await (await fetch('/assets/a.png')).text() };
    }, partial.done);
    assert.equal(completedPartial.next, first.result.total);
    assert.equal(completedPartial.downloaded, 0);
    assert.equal(completedPartial.text, 'final');
    await partialPage.close();
    // --- a narrowed download: the switched-off optional groups are never requested --------------------------
    const leanStart = downloads.length;
    const leanPage = await browser.newPage();
    await leanPage.evaluateOnNewDocument(() => localStorage.setItem('sp.pref.download', JSON.stringify({ audio: false, guide: false })));
    await leanPage.goto(`${origin}/`);
    await leanPage.waitForFunction(() => window.__spPreloadResult, { timeout: 90000 });
    const lean = await leanPage.evaluate(() => window.__spPreloadResult);
    assert.equal(lean.total, first.result.total, 'legacy lean preferences must still verify every resource');
    assert.ok(!downloads.slice(leanStart).some((url) => url.includes('/assets/audio/')), 'no audio was requested');
    await leanPage.close();
    // A fresh browser profile downloads the complete payload without exposing any choice controls.
    const context = await browser.createBrowserContext();
    const fresh = await context.newPage();
    await fresh.evaluateOnNewDocument(() => localStorage.setItem('sp.pref.download', JSON.stringify({ audio: false, guide: false })));
    await fresh.goto(origin);
    await fresh.waitForFunction(() => window.__spPreloadResult, { timeout: 120000 });
    const freshResult = await fresh.evaluate(() => window.__spPreloadResult);
    assert.equal(freshResult.total, first.result.total);
    assert.equal(freshResult.downloaded, freshResult.total);
    assert.equal(await fresh.$('#boot-dl-lean'), null);
    assert.equal(await fresh.$('#boot-import-input'), null);
    await context.close();
    t.diagnostic(JSON.stringify({ first: { downloaded: first.result.downloaded, total: first.result.total },
      second: { downloaded: second.result.downloaded, cached: second.result.cached }, changed: changed.result.downloaded,
      repaired: repaired.result.downloaded, retry: retry.downloaded, migrated: migrated.result.downloaded,
      workerUpdate: updated.controlled }));
  });
