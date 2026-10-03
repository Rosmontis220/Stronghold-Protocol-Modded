// test/notice.test.js — server/notice.js (server-wide announcements) and scripts/notice.mjs (the operator command).
//
// The feature exists so a restart can be announced *without* restarting: a file the running server polls. What must
// hold: a bad/empty/missing file is simply "no notice", `until` expires by itself (even when the file never changes),
// the change callback fires once per real change, and the frame carries a single line (the client renders a capsule).

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { NoticeBoard, NOTICE_KINDS, NOTICE_MAX_LEN, cleanNoticeText, noticeFrame, parseNotice, readNotice } from '../server/notice.js';
import { parseDuration } from '../scripts/notice.mjs';

let dir;
let file;
const write = (body) => fs.writeFileSync(file, body);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-notice-'));
  file = path.join(dir, 'notice.json');
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('notice file → notice', () => {
  test('a missing, empty or junk file is "no notice" — never a crash', () => {
    assert.equal(readNotice(file), null);
    write('   \n');
    assert.equal(readNotice(file), null);
    assert.equal(readNotice(dir), null, 'a directory is not an error either');
    assert.equal(parseNotice(null), null);
    assert.equal(parseNotice('{}'), null, 'no text');
    assert.equal(parseNotice('{"text":"   "}'), null);
  });

  test('plain text works (the simplest way to post one)', () => {
    write('服务器 23:30 维护重启\n');
    assert.deepEqual(readNotice(file), { text: '服务器 23:30 维护重启', kind: 'info', until: null });
  });

  test('JSON carries kind and until', () => {
    const until = Date.now() + 60_000;
    write(JSON.stringify({ text: '维护重启', kind: 'maintenance', until }));
    assert.deepEqual(readNotice(file), { text: '维护重启', kind: 'maintenance', until });
    write(JSON.stringify({ message: '换个字段名', kind: 'nope' }));
    assert.deepEqual(readNotice(file), { text: '换个字段名', kind: 'info', until: null }, 'unknown kind degrades to info');
    write(JSON.stringify({ text: 'ISO 时间', until: '2030-01-02T03:04:05Z' }));
    assert.equal(readNotice(file).until, Date.parse('2030-01-02T03:04:05Z'));
  });

  test('an expired notice is no notice', () => {
    write(JSON.stringify({ text: '已经过期', until: Date.now() - 1000 }));
    assert.equal(readNotice(file), null);
  });

  test('broken JSON still shows the text instead of showing nothing', () => {
    write('{ "text": "忘了闭合"');
    assert.equal(readNotice(file).text, '{ "text": "忘了闭合"');
  });

  test('the text is one line, and long text is cut', () => {
    assert.equal(cleanNoticeText('a\nb\tc'), 'a b c');
    assert.equal(cleanNoticeText('  前后有空格  '), '前后有空格');
    assert.equal(cleanNoticeText(null), '');
    const long = cleanNoticeText('x'.repeat(NOTICE_MAX_LEN + 50));
    assert.equal(long.length, NOTICE_MAX_LEN);
    assert.ok(long.endsWith('…'));
  });

  test('the frame is what the client expects', () => {
    assert.deepEqual(noticeFrame({ text: 't', kind: 'update', until: 5 }), { t: 'app.notice', text: 't', kind: 'update', until: 5 });
    assert.deepEqual(noticeFrame(null), { t: 'app.notice', text: null, kind: 'info', until: null });
    assert.ok(NOTICE_KINDS.includes('maintenance') && NOTICE_KINDS.includes('emergency'));
  });
});

describe('the board the server runs', () => {
  test('reports a change once per real change, and clears when the file goes away', () => {
    const seen = [];
    const board = new NoticeBoard({ file, log: {}, onNotice: (frame) => seen.push(frame.text) });
    assert.equal(board.current, null);
    assert.equal(board.refresh(true), false, 'no file → no change');

    write('维护中');
    assert.equal(board.refresh(true), true);
    assert.equal(board.current.text, '维护中');
    assert.equal(board.refresh(true), false, 'same content → no second broadcast');
    write('维护中'); // same text, new mtime
    assert.equal(board.refresh(true), false);

    write(JSON.stringify({ text: '维护中', kind: 'maintenance' }));
    assert.equal(board.refresh(true), true, 'kind changed → new frame');

    fs.rmSync(file);
    assert.equal(board.refresh(true), true);
    assert.equal(board.current, null);
    assert.deepEqual(seen, ['维护中', '维护中', null]);
  });

  test('an `until` notice expires on its own, without touching the file', () => {
    let now = 1_000_000;
    const board = new NoticeBoard({ file, log: {}, now: () => now });
    write(JSON.stringify({ text: '30 分钟后维护', kind: 'maintenance', until: now + 30_000 }));
    assert.equal(board.refresh(true), true);
    assert.equal(board.current.text, '30 分钟后维护');
    now += 29_000;
    assert.equal(board.refresh(), false, 'still live');
    now += 2_000;
    assert.equal(board.refresh(), true, 'expired → cleared');
    assert.equal(board.current, null);
  });

  test('sendTo only sends when there is something to send', () => {
    const sent = [];
    const send = (_ws, msg) => { sent.push(msg); return true; };
    const board = new NoticeBoard({ file, log: {} });
    assert.equal(board.sendTo({ id: 1 }, send), false);
    write('公告');
    board.refresh(true);
    assert.equal(board.sendTo({ id: 1 }, send), true);
    assert.deepEqual(sent, [{ t: 'app.notice', text: '公告', kind: 'info', until: null }]);
  });

  test('`watch: false` (SP_NOTICE=off) reads nothing at all', () => {
    write('不该被读到');
    const board = new NoticeBoard({ file, log: {}, watch: false });
    assert.equal(board.refresh(true), false);
    assert.equal(board.current, null);
    assert.equal(board.start(), board, 'start() stays a no-op');
    assert.equal(board.timer, null);
  });

  test('start/stop polls, and stop is idempotent', () => {
    const board = new NoticeBoard({ file, log: {}, pollMs: 20 });
    board.start();
    assert.ok(board.timer);
    board.stop();
    board.stop();
    assert.equal(board.timer, null);
    board.start();
    board.stop();
  });
});

describe('scripts/notice.mjs', () => {
  test('--for accepts s / m / h / d (bare number = seconds)', () => {
    assert.equal(parseDuration('30'), 30_000);
    assert.equal(parseDuration('30s'), 30_000);
    assert.equal(parseDuration('5m'), 300_000);
    assert.equal(parseDuration('2h'), 7_200_000);
    assert.equal(parseDuration('1d'), 86_400_000);
    assert.equal(parseDuration('0.5m'), 30_000);
    assert.equal(parseDuration('nope'), null);
    assert.equal(parseDuration(''), null);
  });
});
