// Operator console (server/admin.js + public/admin.html): the password digest, the notice file it writes, the room
// figures it reports, and the guards around the API (attempt limiter, bearer token, unknown actions).
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAdminApi, passwordDigest, sameDigest, writeNoticeFile, PASSWORD_HASH } from '../server/admin.js';
import { parseNotice, readNotice } from '../server/notice.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal request stand-in: headers, method, body stream, remote address. */
function fakeReq({ method = 'GET', headers = {}, body = null, ip = '10.0.0.1' } = {}) {
  const req = new PassThrough();
  req.method = method;
  req.headers = headers;
  req.socket = { remoteAddress: ip };
  if (body !== null) req.end(JSON.stringify(body));
  else req.end();
  return req;
}

/** A room with one live match and one human. */
function fakeLobby() {
  const ps = { playerId: 'p_1', name: '甲', isBot: false, alive: true, left: false, connected: true, lp: 30, funds: 7, layers: { yanShip: 3 }, shop: { level: 2 } };
  const calls = { markPrivate: 0, markPublic: 0, flush: 0 };
  const match = {
    order: [ps], phase: 'PREP', round: 3,
    publicView: () => ({ t: 'm.public', phase: 'PREP', round: 3, serverNow: Date.now() }),
    markPrivate() { calls.markPrivate++; }, markPublic() { calls.markPublic++; }, flush() { calls.flush++; },
  };
  const room = { code: 'ABCD', match, toState: () => ({ t: 'room.state', code: 'ABCD', hostId: 'p_1', mode: 'coop', difficulty: 'NORMAL', inMatch: true, seats: [{ seat: 0, playerId: 'p_1', name: '甲', isBot: false, ready: true, connected: true, avatar: 'char_4040_rockr' }] }) };
  return { lobby: { rooms: new Map([['ABCD', room]]) }, ps, calls, match, room };
}

describe('operator console', () => {
  test('the password is only ever compared as a SHA-256 digest', () => {
    assert.equal(PASSWORD_HASH, passwordDigest('forgetmenot'));
    assert.equal(PASSWORD_HASH.length, 64);
    assert.ok(sameDigest(PASSWORD_HASH, passwordDigest('forgetmenot')));
    assert.ok(!sameDigest(PASSWORD_HASH, passwordDigest('forgetmenot ')));
    assert.ok(!sameDigest(PASSWORD_HASH, 'zz'));
    assert.ok(!sameDigest(null, PASSWORD_HASH));
    // the plaintext must not appear in the server sources
    for (const file of ['server/admin.js', 'public/admin.html', 'public/js/admin.js']) {
      assert.doesNotMatch(readFileSync(path.join(ROOT, file), 'utf8'), /forgetmenot/);
    }
  });

  test('the console page is standalone and asks search engines to stay away', () => {
    const html = readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
    assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive, nosnippet" \/>/);
    assert.match(html, /src="\/js\/admin\.js"/);
    assert.match(html, /href="\/css\/admin\.css"/);
    assert.doesNotMatch(html, /js\/main\.js|js\/boot\.js/, 'not part of the game shell');
  });

  test('the notice file the panel writes is what the running server polls', async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-admin-'));
    t.after(async () => { assert.match(dir, /sp-admin-/); await fs.rm(dir, { recursive: true, force: true }); });
    const file = path.join(dir, '.deploy', 'notice.json');
    const notice = writeNoticeFile(file, { text: '维护重启\n约 5 分钟', kind: 'maintenance', forMs: 60_000 });
    assert.equal(notice.kind, 'maintenance');
    assert.equal(notice.text, '维护重启 约 5 分钟', 'collapsed to one line');
    const parsed = readNotice(file);
    assert.equal(parsed.text, '维护重启 约 5 分钟');
    assert.equal(parsed.kind, 'maintenance');
    assert.ok(parsed.until > Date.now(), 'the duration became an expiry');
    // an unknown kind degrades to info; an empty text clears the file
    assert.equal(writeNoticeFile(file, { text: 'hi', kind: 'nope' }).kind, 'info');
    assert.equal(writeNoticeFile(file, { text: '   ' }), null);
    await assert.rejects(fs.access(file), 'cleared');
    // a malformed file still reads as plain text rather than nothing
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '服务器 23:30 维护');
    assert.equal(parseNotice(await fs.readFile(file, 'utf8')).kind, 'info');
  });

  test('login: digest only, attempt limiter, bearer token on everything else', async () => {
    const { lobby } = fakeLobby();
    const api = createAdminApi({ lobby, noticeFile: path.join(os.tmpdir(), 'sp-admin-none.json') });
    const send = (req, p, query = '') => api.handle(req, {}, p, query);

    assert.equal(await send(fakeReq({ method: 'GET', headers: {} }), '/api/nope'), false, 'other paths are not ours');
    assert.equal((await send(fakeReq({ method: 'GET' }), '/api/admin/overview')).status, 401, 'no token');
    assert.equal((await send(fakeReq({ method: 'POST', body: { hash: passwordDigest('nope') } }), '/api/admin/login')).status, 401);

    const ok = await send(fakeReq({ method: 'POST', body: { hash: PASSWORD_HASH } }), '/api/admin/login');
    assert.equal(ok.status, 200);
    assert.match(ok.body.token, /^[a-f0-9]{64}$/);
    const auth = { 'x-admin-token': ok.body.token };

    const overview = await send(fakeReq({ method: 'GET', headers: auth }), '/api/admin/overview');
    assert.equal(overview.status, 200);
    assert.equal(overview.body.matches, 1);
    assert.equal(overview.body.rooms, 1);
    assert.equal(overview.body.list[0].code, 'ABCD');
    assert.equal(overview.body.list[0].phase, 'PREP');
    assert.deepEqual(overview.body.list[0].players[0], { playerId: 'p_1', name: '甲', alive: true, left: false, connected: true, lp: 30, funds: 7, bonds: 1 });

    const room = await send(fakeReq({ method: 'GET', headers: auth }), '/api/admin/room', new URLSearchParams('code=abcd'));
    assert.equal(room.status, 200);
    assert.equal(room.body.room.inMatch, true);
    assert.equal(room.body.players[0].lp, 30);
    assert.equal((await send(fakeReq({ method: 'GET', headers: auth }), '/api/admin/room', new URLSearchParams('code=ZZZZ'))).status, 404);

    const out = await send(fakeReq({ method: 'POST', headers: auth, body: {} }), '/api/admin/logout');
    assert.equal(out.status, 200);
    assert.equal((await send(fakeReq({ method: 'GET', headers: auth }), '/api/admin/overview')).status, 401, 'the token is dead');

    // the limiter stops a burst of wrong passwords
    const api2 = createAdminApi({ lobby });
    let last = 0;
    for (let i = 0; i < 9; i++) last = (await api2.handle(fakeReq({ method: 'POST', body: { hash: passwordDigest('x') } }), {}, '/api/admin/login', '')).status;
    assert.equal(last, 429);
  });

  test('a live player state can be adjusted (clamped, flushed, private and public pushed)', async () => {
    const { lobby, ps, calls } = fakeLobby();
    const api = createAdminApi({ lobby });
    assert.equal(api.applyState({ code: 'ABCD', playerId: 'p_1', action: 'funds', value: 10 }).body.player.funds, 17);
    api.applyState({ code: 'ABCD', playerId: 'p_1', action: 'funds', value: -1000 });
    assert.equal(ps.funds, 0, 'never negative');
    api.applyState({ code: 'ABCD', playerId: 'p_1', action: 'lp', value: 5 });
    assert.equal(ps.lp, 35);
    api.applyState({ code: 'ABCD', playerId: 'p_1', action: 'layers', bondId: 'yanShip', value: 4 });
    assert.equal(ps.layers.yanShip, 7);
    api.applyState({ code: 'ABCD', playerId: 'p_1', action: 'shopLevel', value: 9 });
    assert.equal(ps.shop.level, 6, 'clamped to the shop maximum');
    assert.ok(calls.markPrivate >= 5 && calls.markPublic >= 5 && calls.flush >= 5, 'every change is published');
    assert.equal(api.applyState({ code: 'ABCD', playerId: 'p_1', action: 'nope', value: 1 }).status, 400);
    assert.equal(api.applyState({ code: 'ABCD', playerId: 'nobody', action: 'lp', value: 1 }).status, 404);
    assert.equal(api.applyState({ code: 'ABCD', playerId: 'p_1', action: 'layers', value: 1 }).status, 400, 'a bond id is required');
    assert.equal(api.applyState({ code: 'ZZZZ', playerId: 'p_1', action: 'lp', value: 1 }).status, 404);
  });
});
