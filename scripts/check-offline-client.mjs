import puppeteer from 'puppeteer-core';
import { startServer } from '../server/index.js';
const server = await startServer({ port: 0, quiet: true, ...(process.env.PACKAGED_PUBLIC ? { publicDir: process.env.PACKAGED_PUBLIC } : {}) });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => {errors.push(e.message); console.error('PAGE ERROR',e.message);});
   page.on('console', msg => {if(msg.type()==='error') console.error('BROWSER',msg.text());});
  await page.setRequestInterception(true);
  page.on('request', r => new URL(r.url()).origin === new URL(server.url).origin ? r.continue() : r.abort());
  await page.goto(server.url + '/?packaged=1&server=https://unreachable.invalid');
  await page.waitForFunction(() => globalThis.__SP__?.net.local, { timeout: 60000 });
  await page.evaluate(async () => {
    const { net } = __SP__;
    const { enterSession } = await import('/js/screens/title.js');
    enterSession('离线博士');
    await new Promise(r => setTimeout(r, 100));
    // 头像跟随皮肤: pick 迷迭香 (char_391_rosmon) as the avatar and 轻盈一梦 as her skin BEFORE the seats are built —
    // a seat copies session.avatar / session.skins when it is created, so the match must start after the choice.
    const { data } = __SP__;
    const { setSkin } = await import('/js/ui/skins.js');
    const { identity } = await import('/js/net.js');
    const chess = data.list('chess').find((c) => !c.isGolden && (c.assets?.avatar || c.charId) === 'char_391_rosmon');
    if (!chess) throw new Error('迷迭香 is not in chess.json');
    identity.saveAvatar('char_391_rosmon');
    setSkin(chess.chessId, 'char_391_rosmon@sale#16');
    net.resendHello();
    await new Promise(r => setTimeout(r, 800)); // let the 500 ms skin sync reach the room
    await net.request('room.create', { mode: 'coop', difficulty: 'FUNNY', capacity: 20 });
    for (let n = 0; n < 19; n++) await net.request('room.addBot', {});
    await net.request('room.start', {});
    await net.request('g.autoplay', { on: true });
    await net.request('g.infoReady', {});
  });
  await page.waitForFunction(() => __SP__.store.get().match.public?.round >= 2, { timeout: 240000 });
  const result = await page.evaluate(() => ({ local: __SP__.net.local, phase: __SP__.store.get().match.public.phase, round: __SP__.store.get().match.public.round, seats: __SP__.store.get().room.seats.filter(Boolean).length }));
  await page.evaluate(() => __SP__.net.request('g.autoplay', {on:false}));
  // 头像跟随皮肤: the choice was made before the seats were built; now the resolver must return 轻盈一梦's own avatar
  // art, the server must carry the skins map into m.public, and the roster row must draw the skin file.
  const avatar = await page.evaluate(async () => {
    const { data } = __SP__;
    const { playerAvatarUrl } = await import('/js/ui/avatarSkin.js');
    const chess = data.list('chess').find((c) => !c.isGolden && (c.assets?.avatar || c.charId) === 'char_391_rosmon');
    if (!chess) return { error: '迷迭香 is not in chess.json' };
    const skinId = 'char_391_rosmon@sale#16';
    const ch = data.get('assets').chars.char_391_rosmon;
    const want = ch.skins[skinId].avatar;
    const mine = __SP__.store.get().room.seats.filter(Boolean).find((s) => s.seat === 0) || {};
    return { chessId: chess.chessId, skinId, want, base: ch.avatar, seatAvatar: mine.avatar ?? null, seatSkins: mine.skins ?? null,
      resolved: playerAvatarUrl(data.get('assets'), { avatar: 'char_391_rosmon', skins: { [chess.chessId]: skinId } }) };
  });
  if (avatar.error || avatar.resolved !== avatar.want) throw new Error(`avatar does not follow the skin: ${JSON.stringify(avatar)}`);
  if (avatar.seatAvatar !== 'char_391_rosmon') throw new Error(`the seat did not take the picked avatar: ${JSON.stringify(avatar)}`);
  const carried = await page.waitForFunction((skinId) => {
    const p = __SP__.store.get().match.public?.players?.find((x) => x.avatar === 'char_391_rosmon');
    return !!(p && p.skins && Object.values(p.skins).includes(skinId));
  }, { timeout: 30000 }, avatar.skinId).then(() => true).catch(() => false);
  if (!carried) throw new Error(`the server never carried the skins map into m.public: ${JSON.stringify(avatar.seatSkins)}`);
  const drawn = await page.waitForFunction((want) => [...document.querySelectorAll('.team__row.is-self img')]
    .some((img) => (img.getAttribute('src') || '').includes(want)), { timeout: 30000 }, avatar.want)
    .then(() => true).catch(() => false);
  if (!drawn) {
    const seen = await page.evaluate(() => [...document.querySelectorAll('.team__row.is-self img')].map((i) => i.getAttribute('src')));
    throw new Error(`the roster row does not draw the skin avatar: ${JSON.stringify(seen)}`);
  }
  // 战斗语音 (the packaged client had no voice): the manifest must list both dubs for this operator and the files the
  // client would play must actually be served — the same lookup audio.js `voice()` does, plus a real fetch per line.
  const voice = await page.evaluate(async () => {
    const { data } = __SP__;
    const root = data.get('assets')?.audio?.voice;
    const slots = ['start', 'faceEnemy', 'select', 'place', 'skill1', 'resultLose'];
    const out = { langs: Object.keys(root || {}), cn: {}, jp: {}, status: {} };
    for (const lang of ['cn', 'jp']) {
      for (const slot of slots) {
        const line = root?.[lang]?.['char_391_rosmon']?.[slot];
        const url = Array.isArray(line) ? line[0] : line;
        out[lang][slot] = url || null;
        if (url) out.status[`${lang}/${slot}`] = (await fetch(url)).status;
      }
    }
    return out;
  });
  const voiceBad = Object.entries(voice.status).filter(([, s]) => s !== 200);
  if (voiceBad.length) throw new Error(`voice files are not served: ${JSON.stringify(voiceBad)}`);
  if (!Object.keys(voice.cn).length || !Object.keys(voice.jp).length) throw new Error(`no voice slots: ${JSON.stringify(voice)}`);
  await page.waitForSelector('.team__list');
  // the nineteen AI teammates: a full 20-seat room must field 19 distinct operators, each wearing its own avatar
  const bots = await page.evaluate(() => __SP__.store.get().match.public.players.filter((p) => p.isBot)
    .map((p) => ({ name: p.name, avatar: p.avatar })));
  if (bots.length !== 19) throw new Error(`expected 19 AI teammates, got ${bots.length}`);
  if (new Set(bots.map((b) => b.name)).size !== 19) throw new Error(`duplicate AI names: ${JSON.stringify(bots.map((b) => b.name))}`);
  if (bots.some((b) => !/^char_/.test(String(b.avatar)))) throw new Error(`an AI has no avatar: ${JSON.stringify(bots)}`);
  if (new Set(bots.map((b) => b.avatar)).size !== 19) throw new Error('two AI share an operator avatar');
  const roster = await page.evaluate(() => {
    const list = document.querySelector('.team__list');
    list.scrollTop = list.scrollHeight;
    const rows = list.querySelectorAll('.team__row');
    const last = rows[rows.length-1].getBoundingClientRect();
    const box = list.getBoundingClientRect();
    return {rows:rows.length,scrollable:list.scrollHeight>list.clientHeight,scrolled:list.scrollTop>0,lastVisible:last.top>=box.top&&last.bottom<=box.bottom+2};
  });
  console.log(result, { errors, roster, avatar, carried, drawn, voice, bots: bots.length });
  if (roster.rows!==20||!roster.scrollable||!roster.scrolled||!roster.lastVisible) throw new Error('Roster scroll failed');
  await page.screenshot({path:'test/e2e/out/twenty-roster.png'});
  if (errors.length || result.seats !== 20) throw new Error('Offline integration failed');
} finally { await browser.close(); await server.close(); }
