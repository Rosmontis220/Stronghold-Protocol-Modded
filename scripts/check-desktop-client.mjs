import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
const exe = path.resolve('dist/win-unpacked/Stronghold Protocol Alliance.exe');
const proc = spawn(exe, ['--remote-debugging-port=9338'], { stdio: 'inherit', env: { ...process.env, STRONGHOLD_SERVER: 'https://unreachable.invalid' } });
let browser;
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9338' }); break; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  if (!browser) throw new Error('Desktop debug endpoint did not start');
  let page;
  for (let n = 0; n < 60; n++) {
    page = (await browser.pages()).find(p => p.url().includes('packaged=1'));
    if (page) break;
    await new Promise(r => setTimeout(r, 500));
  }
  if (!page) throw new Error('Packaged desktop window did not start');
  await page.waitForFunction(() => globalThis.__SP__?.net.local, { timeout: 60000 });
  console.log(await page.evaluate(async () => {
    const { net } = __SP__;
    net.setName('桌面离线博士');
    await new Promise(r => setTimeout(r, 100));
    await net.request('room.create', { mode: 'coop', difficulty: 'FUNNY' });
    await net.request('room.addBot', {});
    await net.request('room.start', {});
    return { local: net.local, phase: __SP__.store.get().match.public?.phase, seats: __SP__.store.get().room.seats.filter(Boolean).length };
  }));
} finally { browser?.disconnect(); proc.kill(); }
