// Announcements from the shell: write (or clear) the notice file the running server polls (server/notice.js).
//
//   node scripts/notice.mjs "服务器将于 23:30 维护重启，预计 5 分钟"            # info (default)
//   node scripts/notice.mjs --kind maintenance "23:30 维护重启，约 5 分钟"      # 维护（琥珀色 + ⏳）
//   node scripts/notice.mjs --kind emergency "服务器异常，正在抢修"             # 紧急（红色）
//   node scripts/notice.mjs --for 30m "30 分钟后维护重启"                       # 30 分钟后自动撤回
//   node scripts/notice.mjs --show                                            # 现在服务器正在播的公告
//   node scripts/notice.mjs --clear                                           # 撤回
//
// The server picks the change up within SP_NOTICE_POLL_SEC (default 10 s) — no restart, no reconnect: every player
// sees it appear/disappear live. `--file` / SP_NOTICE_FILE point somewhere else (a test server).
//
// Maintainers' restart scripts write the same file, so an automated release and a hand-typed notice are one
// mechanism (the file format is documented in docs/DEPLOY.md §6).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTICE_FILE, NOTICE_KINDS, NOTICE_MAX_LEN, cleanNoticeText, readNotice } from '../server/notice.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = `usage: node scripts/notice.mjs [--kind info|maintenance|update|emergency] [--for <30s|5m|2h>] [--file <path>] [--clear | --show | <text>]`;

/** `30s` / `5m` / `2h` / `1d` → ms (bare numbers are seconds). */
export function parseDuration(v) {
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/i.exec(String(v ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || 's').toLowerCase();
  return Math.round(n * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]);
}

function parseArgs(argv) {
  const o = { kind: 'info', forMs: null, file: process.env.SP_NOTICE_FILE || path.join(ROOT, NOTICE_FILE), text: null, clear: false, show: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const key = eq === -1 ? a : a.slice(0, eq);
    const val = () => (eq === -1 ? argv[++i] : a.slice(eq + 1));
    if (key === '--kind') o.kind = val();
    else if (key === '--for') o.forMs = parseDuration(val());
    else if (key === '--file') o.file = val();
    else if (key === '--clear') o.clear = true;
    else if (key === '--show') o.show = true;
    else if (key === '-h' || key === '--help') o.help = true;
    else if (key.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o.text = o.text ? `${o.text} ${a}` : a;
  }
  return o;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || (!o.text && !o.clear && !o.show)) {
    console.log(USAGE);
    console.log(`\nfile: ${o.file}   kinds: ${NOTICE_KINDS.join(', ')}   (text 会被压成一行并截到 ${NOTICE_MAX_LEN} 字)`);
    return;
  }
  if (o.show) {
    const n = readNotice(o.file);
    console.log(n ? `${n.kind}${n.until ? ` · 到 ${new Date(n.until).toISOString()}` : ''}: ${n.text}` : `（没有公告）${fs.existsSync(o.file) ? ` 文件存在但无有效内容: ${o.file}` : ` 文件不存在: ${o.file}`}`);
    return;
  }
  if (o.clear) {
    try {
      fs.rmSync(o.file, { force: true });
      console.log(`已撤回（删除 ${o.file}）—— 服务器 ${Number(process.env.SP_NOTICE_POLL_SEC || 10)} 秒内广播清空`);
    } catch (e) {
      console.error(`撤回失败: ${e?.message || e}`);
      process.exitCode = 1;
    }
    return;
  }
  if (!NOTICE_KINDS.includes(o.kind)) {
    console.error(`--kind 只能是 ${NOTICE_KINDS.join(' / ')}`);
    process.exitCode = 1;
    return;
  }
  const text = cleanNoticeText(o.text);
  if (!text) {
    console.error('公告内容为空');
    process.exitCode = 1;
    return;
  }
  const notice = { text, kind: o.kind, until: o.forMs && o.forMs > 0 ? Date.now() + o.forMs : null };
  // --for writes a *relative* duration, so the server's clock decides when it ends: keep `until` absolute but also
  // record the duration, so a reader can tell how long it was meant to last.
  if (o.forMs) notice.forMs = o.forMs;
  fs.mkdirSync(path.dirname(o.file), { recursive: true });
  fs.writeFileSync(o.file, `${JSON.stringify(notice, null, 2)}\n`);
  console.log(`已发布到 ${o.file}`);
  console.log(`  ${notice.kind}: ${notice.text}${notice.until ? `（到 ${new Date(notice.until).toLocaleString('zh-CN')}）` : '（直到手动撤回）'}`);
  console.log(`服务器 ${Number(process.env.SP_NOTICE_POLL_SEC || 10)} 秒内广播给所有在线玩家（无需重启）`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`notice: ${e?.message || e}`);
    console.error(USAGE);
    process.exitCode = 1;
  }
}
