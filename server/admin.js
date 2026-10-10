// server/admin.js — operator console API (UI: public/admin.html + public/js/admin.js).
//
// First-use setup stores a salted scrypt verifier in the persistent auth file. Passwords travel over HTTPS,
// never enter logs or source code; a per-IP attempt limiter and constant-time comparison guard login. A successful login
// hands out a random bearer token kept in memory (a server restart logs everyone out).
//
// Endpoints (all JSON, all but /login need the token):
//   POST /api/admin/login    { hash }            → { token, expiresAt }
//   POST /api/admin/logout   {}                  → { ok }
//   GET  /api/admin/overview                     → rooms, matches, notice, server figures
//   GET  /api/admin/room?code=XXX                → one room: seats + the live match public view + per-player summary
//   POST /api/admin/notice   { text, kind, forMs, clear } → writes the notice file (picked up within the poll)
//   POST /api/admin/state    { code, playerId, action, value, bondId } → one live player's state
//
// The notice file format and the polling board live in server/notice.js (the panel only writes the same file the
// command line writes).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cleanNoticeText, NOTICE_KINDS, NOTICE_FILE } from './notice.js';

/** Credentials are created by the first visitor and kept outside the source tree. */
export const ADMIN_AUTH_FILE = process.env.SP_ADMIN_AUTH_FILE || path.resolve('.deploy/admin-auth.json');
/** Login attempts allowed per IP inside the window. */
const ATTEMPT_LIMIT = 8;
const ATTEMPT_WINDOW_MS = 10 * 60_000;
/** Session lifetime. */
const SESSION_MS = 12 * 60 * 60_000;
/** Largest request body the API accepts. */
export const ADMIN_BODY_MAX = 64 * 1024;

const FUNDS_MAX = 9999;
const LP_MAX = 999;
const LAYER_MAX = 200;
const SHOP_LEVEL_MAX = 6;
const SHOP_LEVEL_MIN = 1;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.trunc(n)));

/** Constant-time compare of two hex digests. */
export function sameDigest(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/** The digest the page must send for `password` (also what the tests use). */
export const passwordDigest = (password) => crypto.createHash('sha256').update(String(password), 'utf8').digest('hex');
const derivePassword = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');

/** Read a JSON body with a hard size cap. Resolves `null` for anything unusable. */
export function readJsonBody(req, max = ADMIN_BODY_MAX) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { resolve(null); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

/** Write (or clear) the notice file the running server polls. */
export function writeNoticeFile(file, { text, kind, forMs } = {}) {
  const clean = cleanNoticeText(text);
  if (!clean) {
    try { fs.rmSync(file, { force: true }); } catch { /* nothing to clear */ }
    return null;
  }
  const notice = { text: clean, kind: NOTICE_KINDS.includes(kind) ? kind : 'info', until: null };
  const ms = Number(forMs);
  if (Number.isFinite(ms) && ms > 0) { notice.until = new Date(Date.now() + ms).toISOString(); notice.forMs = ms; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(notice, null, 2)}\n`);
  return notice;
}

/**
 * The console API.
 * @param {{ lobby: any, noticeBoard?: any, noticeFile?: string, log?: any, now?: () => number }} deps
 */
export function createAdminApi({ lobby, noticeBoard = null, noticeFile = null, authFile = ADMIN_AUTH_FILE, log = {}, now = Date.now } = {}) {
  const file = noticeFile || NOTICE_FILE;
  const readAuth = () => {
    try {
      const auth = JSON.parse(fs.readFileSync(authFile, 'utf8'));
      if (auth.version !== 1 || !/^[a-f0-9]{64}$/.test(auth.salt) || !/^[a-f0-9]{128}$/.test(auth.verifier)) throw new Error('Invalid admin credentials');
      return auth;
    } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  };
  /** @type {Map<string, number>} token → expiry */
  const sessions = new Map();
  /** @type {Map<string, { count: number, first: number }>} ip → attempts */
  const attempts = new Map();

  const attemptsOf = (ip) => {
    const rec = attempts.get(ip);
    if (!rec || now() - rec.first > ATTEMPT_WINDOW_MS) return 0;
    return rec.count;
  };
  const noteAttempt = (ip) => {
    const rec = attempts.get(ip);
    if (!rec || now() - rec.first > ATTEMPT_WINDOW_MS) attempts.set(ip, { count: 1, first: now() });
    else rec.count++;
  };
  const authorized = (req) => {
    const token = String(req.headers['x-admin-token'] || '');
    const exp = sessions.get(token);
    if (!exp) return false;
    if (exp <= now()) { sessions.delete(token); return false; }
    return true;
  };

  /** One room as the panel shows it: seats plus the live match figures. */
  const roomView = (room) => {
    const state = typeof room.toState === 'function' ? room.toState() : {};
    const match = room.match || null;
    const players = match
      ? match.order.filter((ps) => ps && !ps.isBot).map((ps) => ({
        playerId: ps.playerId, name: ps.name, alive: !!ps.alive, left: !!ps.left, connected: !!ps.connected,
        lp: ps.lp, funds: ps.funds, bonds: Object.keys(ps.layers || {}).length,
      }))
      : [];
    return {
      code: state.code || room.code, mode: state.mode, difficulty: state.difficulty, inMatch: !!state.inMatch,
      phase: match ? match.phase : null, round: match ? match.round : null,
      players,
      seats: (state.seats || []).filter(Boolean).map((s) => ({ seat: s.seat, playerId: s.playerId, name: s.name, isBot: !!s.isBot, ready: !!s.ready, connected: !!s.connected, avatar: s.avatar ?? null })),
    };
  };

  const overview = () => {
    const rooms = [];
    for (const room of lobby.rooms.values()) rooms.push(roomView(room));
    rooms.sort((a, b) => String(a.code).localeCompare(String(b.code)));
    return {
      ok: true,
      matches: rooms.filter((r) => r.inMatch).length,
      rooms: rooms.length,
      humans: rooms.reduce((n, r) => n + r.players.length, 0),
      notice: noticeBoard?.current || null,
      list: rooms,
    };
  };

  const applyState = (msg) => {
    const room = lobby.rooms.get(String(msg.code || '').toUpperCase());
    if (!room) return { status: 404, body: { error: 'ROOM_NOT_FOUND' } };
    const match = room.match;
    if (!match) return { status: 409, body: { error: 'NO_MATCH' } };
    const ps = match.order.find((p) => p && p.playerId === msg.playerId);
    if (!ps) return { status: 404, body: { error: 'PLAYER_NOT_FOUND' } };
    const value = Number(msg.value);
    if (!Number.isFinite(value)) return { status: 400, body: { error: 'BAD_VALUE' } };
    switch (msg.action) {
      case 'funds': {
        // console money stays out of the settlement statistics (the owner's rule: otherwise too obvious): the granted
        // amount is parked on the player (ps.adminFunds) — addFunds's bookkeeping is bypassed (stats.fundsGained stays)
        // and what the player spends is paid from the parked amount first, so stats.gold grows by the earned money only
        ps.adminFunds = Math.max(0, (ps.adminFunds || 0) + clamp(value, -FUNDS_MAX, FUNDS_MAX));
        ps.funds = clamp(ps.funds + value, 0, FUNDS_MAX);
        break;
      }
      case 'lp': ps.lp = clamp(ps.lp + value, 0, LP_MAX); break;
      case 'shopLevel': ps.shop.level = clamp(ps.shop.level + value, SHOP_LEVEL_MIN, SHOP_LEVEL_MAX); break;
      case 'layers': {
        const id = String(msg.bondId || '');
        if (!id) return { status: 400, body: { error: 'BAD_BOND' } };
        ps.layers[id] = clamp((ps.layers[id] || 0) + value, 0, LAYER_MAX);
        break;
      }
      default: return { status: 400, body: { error: 'BAD_ACTION' } };
    }
    try {
      match.markPrivate(ps);
      match.markPublic();
      match.flush(true);
    } catch (e) { log.warn?.('[admin] flush failed', e); }
    return { status: 200, body: { ok: true, player: { playerId: ps.playerId, lp: ps.lp, funds: ps.funds, layers: ps.layers, shopLevel: ps.shop.level } } };
  };

  /**
   * Handle one admin request. Resolves `false` when the path is not ours (the caller falls through to static files).
   * @returns {Promise<false | { status: number, body: object }>}
   */
  async function handle(req, res, rawPath, query) {
    if (!rawPath.startsWith('/api/admin/')) return false;
    const route = rawPath.slice('/api/admin/'.length);
    let credentials;
    try { credentials = readAuth(); } catch { return { status: 503, body: { error: 'AUTH_CONFIG_ERROR' } }; }
    if (route === 'status' && req.method === 'GET') return { status: 200, body: { initialized: !!credentials } };
    if (req.method !== 'POST' && !(req.method === 'GET' && (route === 'overview' || route === 'room'))) {
      res.setHeader('Allow', req.method === 'GET' ? 'GET, POST' : 'POST');
      return { status: 405, body: { error: 'BAD_METHOD' } };
    }
    if (route === 'setup') {
      if (credentials) return { status: 409, body: { error: 'ALREADY_INITIALIZED' } };
      const body = await readJsonBody(req);
      if (typeof body?.password !== 'string' || body.password.length < 12 || body.password.length > 256) return { status: 400, body: { error: 'PASSWORD_LENGTH' } };
      const salt = crypto.randomBytes(32).toString('hex');
      const auth = { version: 1, salt, verifier: derivePassword(body.password, salt) };
      try {
        fs.mkdirSync(path.dirname(authFile), { recursive: true });
        fs.writeFileSync(authFile, JSON.stringify(auth) + '\n', { flag: 'wx', mode: 0o600 });
      } catch (err) {
        return { status: err.code === 'EEXIST' ? 409 : 503, body: { error: err.code === 'EEXIST' ? 'ALREADY_INITIALIZED' : 'AUTH_SAVE_FAILED' } };
      }
      return { status: 200, body: { ok: true } };
    }
    if (!credentials) return { status: 503, body: { error: 'SETUP_REQUIRED' } };
    if (route === 'login') {
      const ip = req.socket?.remoteAddress || '?';
      if (attemptsOf(ip) >= ATTEMPT_LIMIT) return { status: 429, body: { error: 'TOO_MANY_ATTEMPTS' } };
      const body = await readJsonBody(req);
      if (!body || typeof body.password !== 'string' || body.password.length > 256 || !sameDigest(derivePassword(body.password, credentials.salt), credentials.verifier)) {
        noteAttempt(ip);
        log.warn?.(`[admin] rejected login from ${ip}`);
        return { status: 401, body: { error: 'BAD_PASSWORD' } };
      }
      attempts.delete(ip);
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, now() + SESSION_MS);
      log.info?.(`[admin] console session opened from ${ip}`);
      return { status: 200, body: { ok: true, token, expiresAt: now() + SESSION_MS } };
    }
    if (!authorized(req)) return { status: 401, body: { error: 'UNAUTHORIZED' } };
    if (route === 'logout') {
      sessions.delete(String(req.headers['x-admin-token'] || ''));
      return { status: 200, body: { ok: true } };
    }
    if (route === 'overview') return { status: 200, body: overview() };
    if (route === 'room') {
      let code = '';
      try {
        if (query && typeof query.get === 'function') code = query.get('code') || '';
        else if (typeof query === 'string') code = new URLSearchParams(query).get('code') || '';
      } catch { code = ''; }
      return roomDetail(code);
    }
    if (route === 'notice') {
      const body = await readJsonBody(req);
      if (!body) return { status: 400, body: { error: 'BAD_JSON' } };
      if (body.clear) {
        writeNoticeFile(file, {});
        noticeBoard?.refresh?.(true);
        return { status: 200, body: { ok: true, notice: null } };
      }
      const notice = writeNoticeFile(file, body);
      if (!notice) return { status: 400, body: { error: 'EMPTY_TEXT' } };
      noticeBoard?.refresh?.(true);
      log.info?.(`[admin] notice ${notice.kind}: ${notice.text}`);
      return { status: 200, body: { ok: true, notice: noticeBoard?.current || notice } };
    }
    if (route === 'state') {
      const body = await readJsonBody(req);
      if (!body) return { status: 400, body: { error: 'BAD_JSON' } };
      return applyState(body);
    }
    return { status: 404, body: { error: 'NOT_FOUND' } };
  }

  /** Room detail including the live match view (the caller passes the query's `code`). */
  function roomDetail(code) {
    const room = lobby.rooms.get(String(code || '').toUpperCase());
    if (!room) return { status: 404, body: { error: 'ROOM_NOT_FOUND' } };
    const view = roomView(room);
    const match = room.match;
    let publicView = null;
    let players = [];
    if (match) {
      try { publicView = match.publicView(); } catch (e) { log.warn?.('[admin] publicView failed', e); }
      players = match.order.filter((ps) => ps && !ps.isBot).map((ps) => ({
        playerId: ps.playerId, name: ps.name, alive: !!ps.alive, left: !!ps.left, connected: !!ps.connected,
        lp: ps.lp, funds: ps.funds, shopLevel: ps.shop?.level ?? null, layers: ps.layers || {},
      }));
    }
    return { status: 200, body: { ok: true, room: view, publicView, players } };
  }

  return { handle, overview, roomDetail, applyState, sessions };
}
