import puppeteer from 'puppeteer-core';
import { startServer } from '../server/index.js';
const server = await startServer({ port: 0, quiet: true, ...(process.env.PACKAGED_PUBLIC ? { publicDir: process.env.PACKAGED_PUBLIC } : {}) });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', r => new URL(r.url()).origin === new URL(server.url).origin ? r.continue() : r.abort());
  await page.goto(server.url + '/?packaged=1&server=https://unreachable.invalid');
  await page.waitForFunction(() => globalThis.__SP__?.net.local, { timeout: 60000 });
  await page.evaluate(async () => {
    const { net } = __SP__;
    net.setName('离线博士');
    await new Promise(r => setTimeout(r, 100));
    await net.request('room.create', { mode: 'coop', difficulty: 'FUNNY' });
    for (let n = 0; n < 7; n++) await net.request('room.addBot', {});
    await net.request('room.start', {});
    await net.request('g.autoplay', { on: true });
    await net.request('g.infoReady', {});
  });
  await page.waitForFunction(() => __SP__.store.get().match.public?.round >= 2, { timeout: 240000 });
  const result = await page.evaluate(() => ({ local: __SP__.net.local, phase: __SP__.store.get().match.public.phase, round: __SP__.store.get().match.public.round, seats: __SP__.store.get().room.seats.filter(Boolean).length }));
  console.log(result, { errors });
  if (errors.length || result.seats !== 8) throw new Error('Offline integration failed');
} finally { await browser.close(); await server.close(); }
