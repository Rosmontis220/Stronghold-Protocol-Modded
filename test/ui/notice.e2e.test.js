// Browser regression of server-wide announcements (`app.notice`): the real client page against a real local
// server (server/notice.js), headless Chrome. Opt-in: SP_E2E=1 (CHROME_PATH for a non-macOS Chrome).
//
//   SP_E2E=1 CHROME_PATH=<chrome or msedge> node --test test/ui/notice.e2e.test.js
//
// It covers what the unit test cannot: the frame really reaches the running client, appears *while* it is open
// (no reload), updates when the text changes, is dismissed by the close button, comes back for a different notice,
// clears on --clear, is delivered with `welcome` to a player who connects later, and expires by itself.
// Screenshots: test/e2e/out/notice-*.png.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('server announcements (app.notice)', { skip: !ENABLED && 'set SP_E2E=1 (and CHROME_PATH) to run' }, () => {
  let srv;
  let browser;
  let base;
  let dir;
  let file;

  /** Publish a notice exactly the way an operator does (the file the running server polls). */
  const publish = (obj) => writeFileSync(file, typeof obj === 'string' ? obj : JSON.stringify(obj));
  const banner = (page) => page.evaluate(() => {
    const el = document.querySelector('.notice-banner');
    if (!el) return null;
    return { tag: el.querySelector('.notice-banner__tag')?.textContent || '', text: el.querySelector('.notice-banner__text')?.textContent || '', cls: el.className };
  });
  /** Open the real client page and wait until it is on screen with a live socket. */
  async function open() {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!document.querySelector('.screen') || !!document.querySelector('.app-root'), { timeout: 60000 });
    await page.waitForFunction(() => document.title.includes('卫戍协议') || !!document.querySelector('.app-root'), { timeout: 30000 });
    await sleep(2500); // let the socket finish hello
    return { page, problems };
  }

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    dir = mkdtempSync(path.join(os.tmpdir(), 'sp-notice-e2e-'));
    file = path.join(dir, 'notice.json');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, noticeFile: file, noticePollMs: 150 });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
    mkdirSync(OUT, { recursive: true });
  });

  after(async () => {
    await browser?.close();
    await srv?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('announcement lifecycle in a live client', { timeout: 180_000 }, async () => {
    const { page, problems } = await open();
    assert.equal((await banner(page)) ?? null, null, 'no notice at first');

    // 1. published while the page is open → appears without a reload
    publish({ text: '服务器将于 23:30 维护重启，预计 5 分钟', kind: 'maintenance' });
    await page.waitForSelector('.notice-banner', { timeout: 20_000 });
    let b = await banner(page);
    assert.match(b.text, /23:30/);
    assert.equal(b.tag, '维护');
    assert.match(b.cls, /notice-banner--maintenance/);
    await page.screenshot({ path: path.join(OUT, 'notice-banner.png') });

    // 2. the player can dismiss it, and it stays dismissed across a reload of that notice
    await page.click('.notice-banner__close');
    await page.waitForFunction(() => !document.querySelector('.notice-banner'), { timeout: 5000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(3000);
    assert.equal(await banner(page), null, 'a dismissed notice does not come back');

    // 3. an edited notice shows again (different text = a new announcement)
    publish({ text: '紧急：服务器异常，正在抢修', kind: 'emergency' });
    await page.waitForFunction(() => document.querySelector('.notice-banner__text')?.textContent?.includes('抢修'), { timeout: 20_000 });
    b = await banner(page);
    assert.equal(b.tag, '紧急');
    assert.match(b.cls, /notice-banner--emergency/);

    // 4. clearing the file withdraws it for everyone
    rmSync(file, { force: true });
    await page.waitForFunction(() => !document.querySelector('.notice-banner'), { timeout: 20_000 });

    // 5. a notice that is already live reaches a player as they connect (sent right after `welcome`)
    publish({ text: '登录时就该看到这条', kind: 'update' });
    await sleep(800);
    const late = await open();
    // the client boots for a while (data + art) before its socket says hello, so wait for the frame it gets on welcome
    await late.page.waitForSelector('.notice-banner', { timeout: 60_000 });
    const bl = await banner(late.page);
    assert.ok(bl, 'a player connecting later sees the live notice');
    assert.match(bl.text, /登录时就该看到这条/);
    assert.equal(bl.tag, '更新');
    await late.page.screenshot({ path: path.join(OUT, 'notice-welcome.png') });

    // 6. `until` expires by itself, without the file changing
    //    NB: polling is explicit — a background tab (tab B was opened above) throttles rAF, which is what
    //    waitForFunction polls with by default, and the notice lives for only a few seconds.
    await page.bringToFront();
    publish({ text: '这条 5 秒后自己消失', kind: 'info', until: Date.now() + 5000 });
    await page.waitForFunction(() => document.querySelector('.notice-banner__text')?.textContent?.includes('5 秒后'), { timeout: 20_000, polling: 100 });
    await page.waitForFunction(() => !document.querySelector('.notice-banner'), { timeout: 20_000, polling: 100 });

    assert.deepEqual([...problems, ...late.problems], []);
    await page.close();
    await late.page.close();
  });
});
