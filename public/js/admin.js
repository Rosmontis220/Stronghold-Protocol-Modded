// public/js/admin.js — 操作台 (admin.html): login + overview + live room view + notice publishing.
// Plain ES module, no build step and no game shell: the API is /api/admin/* (server/admin.js) and the password is
// hashed with WebCrypto before it leaves the page.

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'sp.admin.token';
let token = sessionStorage.getItem(TOKEN_KEY) || '';
let pollTimer = null;
let openRoom = null;
let busy = false;

/** hex SHA-256 of a string (the only form of the password the server ever sees). */
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function api(path, { method = 'GET', body = null } = {}) {
  const res = await fetch(`/api/admin/${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { 'x-admin-token': token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data: data || {} };
}

const say = (el, text, tone = '') => { el.textContent = text; el.classList.toggle('is-ok', tone === 'ok'); el.classList.toggle('is-bad', tone === 'bad'); };

// ---- login -----------------------------------------------------------------------------------------

async function login(password) {
  const hash = await sha256(password);
  const { status, data } = await api('login', { method: 'POST', body: { hash } });
  if (status !== 200) {
    throw new Error(status === 429 ? '尝试次数过多，请稍后再试' : '口令错误');
  }
  token = data.token;
  sessionStorage.setItem(TOKEN_KEY, token);
}

async function signOut() {
  try { await api('logout', { method: 'POST', body: {} }); } catch { /* leaving anyway */ }
  token = '';
  sessionStorage.removeItem(TOKEN_KEY);
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  $('console').hidden = true;
  $('drawer').hidden = true;
  $('gate').hidden = false;
  $('gate-pass').value = '';
  $('gate-err').textContent = '';
}

// ---- overview --------------------------------------------------------------------------------------

function renderRooms(list) {
  const host = $('rooms');
  const stateRoom = $('state-room');
  const keepRoom = stateRoom.value;
  host.textContent = '';
  stateRoom.textContent = '';
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = '暂无房间';
    host.append(p);
  }
  for (const room of list) {
    const card = document.createElement('article');
    card.className = 'card';

    const top = document.createElement('div');
    top.className = 'card__top';
    const code = document.createElement('span');
    code.className = 'card__code';
    code.textContent = room.code;
    const live = document.createElement('span');
    live.className = `tag ${room.inMatch ? 'tag--live' : 'tag--idle'}`;
    live.textContent = room.inMatch ? `进行中 · ${room.phase || ''} R${room.round ?? '-'}` : '等待中';
    const mode = document.createElement('span');
    mode.className = 'tag';
    mode.textContent = `${room.mode || '-'} / ${room.difficulty || '-'}`;
    top.append(code, live, mode);

    const players = document.createElement('div');
    players.className = 'card__players';
    for (const p of room.players.length ? room.players : room.seats) {
      const who = document.createElement('span');
      who.className = `who${p.alive === false ? ' is-dead' : ''}`;
      if (p.avatar) {
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.src = `/assets/char/avatar/${p.avatar}.png`;
        img.addEventListener('error', () => img.remove());
        who.append(img);
      }
      const name = document.createElement('span');
      name.textContent = p.name || '—';
      who.append(name);
      if (p.isBot) { const b = document.createElement('small'); b.textContent = 'AI'; who.append(b); }
      else { const b = document.createElement('b'); b.textContent = `LP ${p.lp ?? '-'}`; who.append(b); }
      players.append(who);
    }
    if (!players.childElementCount) { const s = document.createElement('span'); s.className = 'tag'; s.textContent = '空'; players.append(s); }

    const acts = document.createElement('div');
    acts.className = 'card__acts';
    const watch = document.createElement('button');
    watch.className = 'btn';
    watch.type = 'button';
    watch.textContent = '旁观';
    watch.addEventListener('click', () => openLive(room.code));
    acts.append(watch);

    card.append(top, players, acts);
    host.append(card);

    const opt = document.createElement('option');
    opt.value = room.code;
    opt.textContent = room.inMatch ? `${room.code}（进行中）` : room.code;
    stateRoom.append(opt);
  }
  if (keepRoom && [...stateRoom.options].some((o) => o.value === keepRoom)) stateRoom.value = keepRoom;
  renderStatePlayers(list.find((r) => r.code === stateRoom.value) || list[0] || null);
}

function renderStatePlayers(room) {
  const sel = $('state-player');
  const keep = sel.value;
  sel.textContent = '';
  for (const p of room?.players || []) {
    const opt = document.createElement('option');
    opt.value = p.playerId;
    opt.textContent = `${p.name}（LP ${p.lp}）`;
    sel.append(opt);
  }
  if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
}

async function refreshOverview() {
  if (busy) return;
  const { status, data } = await api('overview');
  if (status === 401) { signOut(); return; }
  if (status !== 200) return;
  $('stat-matches').textContent = data.matches ?? 0;
  $('stat-rooms').textContent = data.rooms ?? 0;
  $('stat-humans').textContent = data.humans ?? 0;
  $('chip-matches').classList.toggle('chip--alert', (data.matches ?? 0) > 0);
  renderRooms(data.list || []);
  const notice = data.notice;
  say($('notice-now'), notice ? `${notice.kind} · ${notice.text}${notice.until ? `（到 ${new Date(notice.until).toLocaleString('zh-CN')}）` : ''}` : '当前没有公告', notice ? 'ok' : '');
}

// ---- live view (spectate) ---------------------------------------------------------------------------

async function refreshLive() {
  if (!openRoom) return;
  const { status, data } = await api(`room?code=${encodeURIComponent(openRoom)}`);
  const body = $('drawer-body');
  if (status !== 200 || !data.room) { body.textContent = '房间已关闭'; return; }
  const room = data.room;
  body.textContent = '';

  const kv = document.createElement('div');
  kv.className = 'kv';
  const cells = [
    ['阶段 PHASE', room.phase || '—'], ['回合 ROUND', room.round ?? '—'],
    ['编号 CODE', room.code], ['模式 MODE', `${room.mode || '-'} / ${room.difficulty || '-'}`],
  ];
  for (const [k, v] of cells) {
    const d = document.createElement('div');
    const s = document.createElement('span'); s.textContent = k;
    const b = document.createElement('b'); b.textContent = String(v);
    d.append(s, b); kv.append(d);
  }
  body.append(kv);

  const title = document.createElement('p');
  title.className = 'micro';
  title.textContent = 'PLAYERS // 玩家';
  const board = document.createElement('div');
  board.className = 'board';
  for (const p of data.players.length ? data.players : room.seats) {
    const row = document.createElement('div');
    row.className = 'board__row';
    const left = document.createElement('span');
    left.textContent = `${p.name}${p.isBot ? ' [AI]' : ''}${p.alive === false ? ' · 已淘汰' : p.connected === false ? ' · 掉线' : ''}`;
    const right = document.createElement('small');
    right.textContent = p.lp != null ? `LP ${p.lp} · 资金 ${p.funds ?? '-'}` : (p.ready ? '已就绪' : '准备中');
    row.append(left, right);
    board.append(row);
  }
  body.append(title, board);

  const note = document.createElement('p');
  note.className = 'micro';
  note.textContent = `SERVER NOW ${new Date(data.publicView?.serverNow ?? Date.now()).toLocaleTimeString('zh-CN')}`;
  body.append(note);
}

function openLive(code) {
  openRoom = code;
  $('drawer-title').textContent = code;
  $('drawer').hidden = false;
  refreshLive();
}

// ---- notice form ------------------------------------------------------------------------------------

async function sendNotice(clear) {
  const text = $('notice-text').value.trim();
  if (!clear && !text) { say($('notice-now'), '请先填写公告内容', 'bad'); return; }
  busy = true;
  try {
    const body = clear ? { clear: true } : { text, kind: $('notice-kind').value, forMs: Number($('notice-for').value) || 0 };
    const { status, data } = await api('notice', { method: 'POST', body });
    if (status === 200) say($('notice-now'), clear ? '已撤回公告' : `已发布：${data.notice?.text || text}`, 'ok');
    else say($('notice-now'), `失败：${data.error || status}`, 'bad');
  } finally { busy = false; }
  refreshOverview();
}

// ---- state form -------------------------------------------------------------------------------------

async function applyState() {
  const body = {
    code: $('state-room').value,
    playerId: $('state-player').value,
    action: $('state-action').value,
    value: Number($('state-value').value),
  };
  if (body.action === 'layers') body.bondId = $('state-bond').value.trim();
  busy = true;
  try {
    const { status, data } = await api('state', { method: 'POST', body });
    if (status === 200) say($('state-out'), JSON.stringify(data.player), 'ok');
    else say($('state-out'), `失败：${data.error || status}`, 'bad');
  } finally { busy = false; }
}

// ---- wiring -----------------------------------------------------------------------------------------

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  refreshOverview();
  pollTimer = setInterval(() => { refreshOverview(); refreshLive(); }, 2000);
}

async function enterConsole() {
  $('gate').hidden = true;
  $('console').hidden = false;
  const health = await fetch('/healthz', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  $('chip-app').textContent = health ? `v${health.app} · ${Math.floor((health.uptimeSec || 0) / 60)}min` : 'v?';
  $('chip-link').classList.add('is-on');
  startPolling();
}

$('gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pass = $('gate-pass').value;
  const go = $('gate-go');
  go.disabled = true;
  $('gate-err').textContent = '';
  try {
    await login(pass);
    await enterConsole();
  } catch (err) {
    $('gate-err').textContent = err.message || '登录失败';
  } finally { go.disabled = false; }
});

$('sign-out').addEventListener('click', signOut);
$('notice-send').addEventListener('click', () => sendNotice(false));
$('notice-clear').addEventListener('click', () => sendNotice(true));
$('state-apply').addEventListener('click', applyState);
$('state-action').addEventListener('change', () => { $('state-bond-wrap').hidden = $('state-action').value !== 'layers'; });
$('state-room').addEventListener('change', async () => {
  const { data } = await api('overview');
  renderStatePlayers((data.list || []).find((r) => r.code === $('state-room').value) || null);
});
$('drawer-close').addEventListener('click', () => { openRoom = null; $('drawer').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openRoom) { openRoom = null; $('drawer').hidden = true; } });

if (token) {
  enterConsole().catch(() => signOut());
} else {
  $('gate').hidden = false;
}
