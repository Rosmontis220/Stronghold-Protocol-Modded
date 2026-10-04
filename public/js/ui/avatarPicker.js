// public/js/ui/avatarPicker.js — 自定义头像 (custom avatar): pick an operator as your avatar.
//
// Opened by tapping your own seat avatar in the room (screens/room.js). The choice is remembered in this browser
// (net.js identity.loadAvatar/saveAvatar) and announced with a fresh `hello`, so the server re-broadcasts room.state
// and every teammate sees the operator avatar (m.public players[].avatar = a chess id) and its 半身像 right away.
// A player who never picks one keeps the seat-coloured glyph, and the frame sent on hello stays the 0.1.2 shape.

import { useMemo, useState } from '../../vendor/hooks.module.js';
import { html, Button, AvatarFrame, Modal } from './components.js';
import { UnitThumb } from './gameComponents.js';
import { createStore, useStore } from '../store.js';
import { data, useData } from '../data.js';
import { identity, net } from '../net.js';
import { chessAvatarUrl } from './assetUrls.js';

/** Open/closed state of the picker (a store so the room's seat card can open it). */
export const avatarStore = createStore({ open: false });
export const openAvatarPicker = () => avatarStore.set({ open: true });
export const closeAvatarPicker = () => avatarStore.set({ open: false });

/**
 * The operators that can be an avatar: visible, normal (精锐 share their base operator's art) and with avatar art in
 * the manifest, in tier order then by name.
 * @param {any[]} list data.list('chess')
 * @param {any} assets the asset manifest (data.get('assets'))
 */
export function avatarChoices(list, assets) {
  const name = (c) => String(c?.name || c?.chessId || '');
  return (Array.isArray(list) ? list : [])
    .filter((c) => c && c.visible && !c.isGolden && !!chessAvatarUrl(assets, c))
    .sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || name(a).localeCompare(name(b), 'zh'));
}

/**
 * The operator shown as an avatar, or null for the default look.
 * @param {any} list data.list('chess') @param {string|null} id
 */
export function avatarRecord(list, id) {
  if (!id) return null;
  return (Array.isArray(list) ? list : []).find((c) => c && c.chessId === id) || null;
}

/**
 * The picker's blocks — hookless, so the tests can call them: the current choice, the search box and the operator
 * grid (a click picks that operator; 跟随默认 goes back to the seat-coloured look).
 * @param {{ assets:any, list:any[], mine:string|null, mineRec:any, query?:string,
 *   onQuery?:(v:string)=>void, onPick?:(id:string|null)=>void }} props
 */
export function AvatarPickerBody({ assets, list, mine, mineRec, query = '', onQuery = () => {}, onPick = () => {} }) {
  const q = String(query).trim().toLowerCase();
  const shown = q ? list.filter((c) => `${c.name || ''}${c.chessId || ''}`.toLowerCase().includes(q)) : list;
  return html`<p class="avpick__hint">选择一名干员作为头像：准备大厅里其他博士会看到该干员的头像与半身像。</p>
    <div class="avpick__head">
      <${AvatarFrame} size="md" name=${mineRec?.name || ''} src=${mineRec ? chessAvatarUrl(assets, mineRec) : null} self=${true} />
      <div class="avpick__cur">
        <b>${mineRec ? mineRec.name : '跟随默认'}</b>
        <span>${mineRec ? '当前头像' : '未选择干员头像（座位色图标）'}</span>
      </div>
      ${mineRec ? html`<${Button} variant="secondary" size="sm" icon="refresh" onClick=${() => onPick(null)}>跟随默认<//>` : null}
    </div>
    <input class="avpick__search" type="search" value=${query} placeholder="搜索干员名字…" aria-label="搜索干员"
      onInput=${(e) => onQuery(e.target.value)} />
    <div class="avpick__grid" role="listbox" aria-label="干员">
      ${shown.map((c) => html`<button key=${c.chessId} type="button" role="option" aria-selected=${mine === c.chessId ? 'true' : 'false'}
          class=${`avpick__one${mine === c.chessId ? ' is-on' : ''}`} title=${c.name || c.chessId} onClick=${() => onPick(c.chessId)}>
        <${UnitThumb} kind="chess" id=${c.chessId} size="sm" />
        <span class="avpick__name">${c.name || c.chessId}</span>
      </button>`)}
      ${shown.length ? null : html`<p class="avpick__empty">没有匹配的干员</p>`}
    </div>`;
}

/** The dialog. Mounted once by the room screen; open/close goes through avatarStore. */
export function AvatarPicker() {
  const { open } = useStore((s) => s, Object.is, avatarStore);
  const ready = useData('chess', 'assets');
  const [query, setQuery] = useState('');
  const assets = data.get('assets');
  const list = useMemo(() => avatarChoices(data.list('chess'), assets), [ready, open, assets]);
  const mine = identity.loadAvatar();
  const mineRec = avatarRecord(data.list('chess'), mine);
  const pick = (id) => { applyAvatar(id); closeAvatarPicker(); };
  return html`<${Modal} open=${open} onClose=${closeAvatarPicker} title="选择头像" micro="AVATAR // PICK AN OPERATOR"
      width="min(9.4rem, 96vw)" class="avpick">
    <${AvatarPickerBody} assets=${assets} list=${list} mine=${mine} mineRec=${mineRec} query=${query} onQuery=${setQuery} onPick=${pick} />
  </${Modal}>`;
}

/**
 * Remember a choice and announce it: `net.resendHello` re-sends the same hello, the server sees a changed
 * `session.avatar` (lobby.onHello) and broadcasts the room state, so teammates update at once.
 * @param {string|null} id chess id, or null for the default look
 */
export function applyAvatar(id) {
  identity.saveAvatar(id || null);
  net.resendHello();
}
