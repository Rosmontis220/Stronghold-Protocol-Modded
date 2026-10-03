// Server-wide announcement banner (global chrome, mounted once by main.js next to the connection banner).
//
// The server sends `app.notice { text, kind, until }` (server/notice.js) to every socket when the notice changes and
// to each player right after `welcome`. It is an *operator* message — "服务器将于 23:30 维护重启" — so it shows on
// every screen, before entering included: warning a player must not require them to already be in a match.
//
// Dismissal is per notice text: closing it hides that exact announcement for this browser, and a new/edited notice
// shows again. `until` is absolute server ms, compared against the server clock (net.serverNow) so a wrong client
// clock does not keep a stale notice up (or hide a live one).
//
// Like the connection banner, it sets a doc class (html.sp-notice) so the toasts and the connection banner move out
// of its way instead of overlapping it — no CSS :has() (Firefox ESR 115 / older Safari lack it).

import { html, Icon, useTicker } from './components.js';
import { useState } from '../../vendor/hooks.module.js';
import { net } from '../net.js';
import { useStore, shallowEqual } from '../store.js';
import { useDocClass } from './device.js';

const K_SEEN = 'sp.notice.closed';

/** Announcement kinds and the icon each one shows (server/notice.js NOTICE_KINDS). */
const KIND_ICON = { info: 'info', maintenance: 'hourglass', update: 'refresh', emergency: 'warn' };
const KIND_LABEL = { info: '公告', maintenance: '维护', update: '更新', emergency: '紧急' };

function readClosed() {
  try {
    const v = JSON.parse(localStorage.getItem(K_SEEN) || 'null');
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

function rememberClosed(text) {
  try {
    localStorage.setItem(K_SEEN, JSON.stringify(text));
  } catch { /* private mode: the banner just comes back on reload */ }
}

/** Is the notice still live? (no `until` = until it is withdrawn) */
export function noticeLive(notice, now) {
  if (!notice || typeof notice.text !== 'string' || !notice.text) return false;
  return notice.until == null || notice.until > now;
}

/** The banner shows when there is a live, not-yet-dismissed notice (exported for tests). */
export function noticeVisible(notice, closedText, now) {
  return noticeLive(notice, now) && notice.text !== closedText;
}

export function NoticeBanner() {
  const notice = useStore((s) => s.notice, shallowEqual);
  const [closed, setClosed] = useState(readClosed);
  // `until` needs a re-check while the banner is up (it may expire during a session); 15 s is plenty for a banner
  useTicker(notice && notice.until ? 15_000 : 0);
  const shown = noticeVisible(notice, closed, net.serverNow());
  useDocClass('sp-notice', shown);
  if (!shown) return null;
  const kind = KIND_ICON[notice.kind] ? notice.kind : 'info';
  const close = () => {
    rememberClosed(notice.text);
    setClosed(notice.text);
  };
  return html`<div class=${`notice-banner notice-banner--${kind}`} role="status" aria-live="polite">
    <span class="notice-banner__tag">${KIND_LABEL[kind]}</span>
    <${Icon} name=${KIND_ICON[kind]} />
    <span class="notice-banner__text">${notice.text}</span>
    <button class="notice-banner__close" type="button" title="关闭公告" aria-label="关闭公告" onClick=${close}>
      <${Icon} name="close" />
    </button>
  </div>`;
}
