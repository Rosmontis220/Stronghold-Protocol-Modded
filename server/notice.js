// Server-wide announcement board (`app.notice`, DESIGN §8).
//
// The server has no console and no admin channel, so the notice is a *file* on disk: an operator (or the deploy
// script) writes it and the running server picks it up within `pollMs` without a restart. That is the whole point —
// warning players about a restart must not itself require one.
//
//   <ROOT>/.deploy/notice.json      (or SP_NOTICE_FILE / opts.noticeFile)
//   { "text": "服务器将于 23:30 维护重启，预计 5 分钟", "kind": "maintenance", "until": "2026-10-03T15:40:00Z" }
//
//   kind:  info (default) | maintenance | update | emergency   — the client only picks an icon/colour
//   until: optional ISO 8601 (or epoch ms). After it the notice is inactive and the clients clear it.
//
// A file that is not JSON is taken as the plain text of an `info` notice, so
//   echo "服务器 23:30 维护" > .deploy/notice.json
// works too. Deleting / emptying the file clears the notice.
//
// The file lives outside the tracked tree on purpose: `git pull` must never conflict with it.

import fs from 'node:fs';

/** Kinds the client knows how to render; anything else degrades to `info`. */
export const NOTICE_KINDS = Object.freeze(['info', 'maintenance', 'update', 'emergency']);
/** Longest notice the server will send (CSS px, one line): the client layout is a capsule, not a paragraph. */
export const NOTICE_MAX_LEN = 200;
/** Default poll interval (ms). The mtime check is one stat() per interval — cheap enough for any interval. */
export const NOTICE_POLL_MS = 10_000;
/** Default location, relative to the repository root. */
export const NOTICE_FILE = '.deploy/notice.json';

/** Collapse to a single line and cut to `NOTICE_MAX_LEN` (control characters and newlines would break the capsule). */
export function cleanNoticeText(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > NOTICE_MAX_LEN ? `${s.slice(0, NOTICE_MAX_LEN - 1)}…` : s;
}

/**
 * Turn whatever was read from the file into a notice, or null when there is nothing to show.
 * @param {string} content raw file content
 * @param {number} [now] epoch ms (tests)
 * @returns {{ text: string, kind: string, until: number|null } | null}
 */
export function parseNotice(content, now = Date.now()) {
  if (typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!trimmed) return null;
  let text = trimmed;
  let kind = 'info';
  let until = null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let obj = null;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      obj = null; // malformed JSON: treat the raw text as the notice rather than showing nothing
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      text = typeof obj.text === 'string' ? obj.text : typeof obj.message === 'string' ? obj.message : '';
      if (typeof obj.kind === 'string' && NOTICE_KINDS.includes(obj.kind)) kind = obj.kind;
      if (obj.until != null) {
        const t = typeof obj.until === 'number' ? obj.until : Date.parse(String(obj.until));
        if (Number.isFinite(t)) until = t;
      }
    }
  }
  const clean = cleanNoticeText(text);
  if (!clean) return null;
  if (until != null && until <= now) return null; // expired: nothing to show (the file may stay for the record)
  return { text: clean, kind, until };
}

/** Read + parse the notice file. Any failure (missing, unreadable, a directory) is "no notice" — never throws. */
export function readNotice(file, now = Date.now()) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  return parseNotice(content, now);
}

/** Same notice? (the poller only broadcasts on a real change) */
function sameNotice(a, b) {
  if (!a || !b) return a === b;
  return a.text === b.text && a.kind === b.kind && a.until === b.until;
}

/** The `app.notice` frame. `text: null` is the "clear it" frame (no notice right now). */
export function noticeFrame(notice) {
  return notice
    ? { t: 'app.notice', text: notice.text, kind: notice.kind, until: notice.until }
    : { t: 'app.notice', text: null, kind: 'info', until: null };
}

/**
 * The live board: reloads the file every `pollMs`, keeps the current notice and reports changes.
 *
 * The change callback fires once per real change (including "cleared"), so the caller can broadcast to every
 * socket; `sendTo(session)` is for a player who just completed `hello`.
 */
export class NoticeBoard {
  /**
   * @param {{ file?: string, pollMs?: number, log?: { warn?: Function, info?: Function }, now?: () => number,
   *           onNotice?: (frame: object, notice: object|null) => void, watch?: boolean }} [opts]
   */
  constructor(opts = {}) {
    this.file = opts.file || NOTICE_FILE;
    this.pollMs = Number.isFinite(opts.pollMs) && opts.pollMs > 0 ? opts.pollMs : NOTICE_POLL_MS;
    this.log = opts.log || {};
    this.now = opts.now || Date.now;
    /** @type {((frame: object, notice: object|null) => void) | null} */
    this.onNotice = opts.onNotice || null;
    /** @type {{ text: string, kind: string, until: number|null } | null} */
    this.notice = null;
    this.mtimeMs = -1;
    this.timer = null;
    // `off` disables the whole feature (SP_NOTICE=off) — the file is then never even read.
    this.enabled = opts.watch !== false;
  }

  /** The current notice (null when there is none). */
  get current() {
    return this.notice;
  }

  /** Read the file if it changed since the last look; returns true when the notice changed. */
  refresh(force = false) {
    if (!this.enabled) return false;
    // Expiry first: a notice with `until` must clear itself even when the file never changes again.
    if (this.notice && this.notice.until != null && this.notice.until <= this.now()) {
      this.notice = null;
      this.log.info?.('[notice] expired');
      this.onNotice?.(noticeFrame(null), null);
      return true;
    }
    let mtimeMs = -1;
    try {
      mtimeMs = fs.statSync(this.file).mtimeMs;
    } catch {
      mtimeMs = -1; // missing file = no notice
    }
    if (!force && mtimeMs === this.mtimeMs) return false;
    this.mtimeMs = mtimeMs;
    const next = readNotice(this.file, this.now());
    if (sameNotice(this.notice, next)) return false;
    const before = this.notice;
    this.notice = next;
    this.log.info?.(`[notice] ${next ? `${next.kind}: ${next.text}` : 'cleared'}${before && next ? ' (updated)' : ''}`);
    this.onNotice?.(noticeFrame(next), next);
    return true;
  }

  /** Start polling (idempotent). The first read happens immediately. */
  start() {
    if (!this.enabled || this.timer) return this;
    this.refresh(true);
    this.timer = setInterval(() => {
      try {
        this.refresh();
      } catch (e) {
        this.log.warn?.('[notice] refresh failed', e);
      }
    }, this.pollMs);
    this.timer.unref?.();
    return this;
  }

  /** Stop polling. */
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Send the current notice to one socket (a player who just connected); without a notice nothing is sent — their
   * client starts with none anyway. `send` is server/net.js's send(ws, msg).
   * @param {any} ws
   * @param {(ws: any, msg: object) => boolean} send
   */
  sendTo(ws, send) {
    if (!this.notice) return false;
    try {
      return !!send(ws, noticeFrame(this.notice));
    } catch {
      return false;
    }
  }
}
