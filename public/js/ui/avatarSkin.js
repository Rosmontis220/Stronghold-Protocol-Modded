// public/js/ui/avatarSkin.js — 头像跟随皮肤 (the avatar follows the skin).
//
// A player's avatar is a CHARACTER id (`char_4040_rockr`, ui/avatarPicker.js) while a skin choice is stored per CHESS
// record (`{ [chessId]: skinId }`, ui/skins.js) — one operator has a base and an elite record, and either may carry
// the choice. This module is the one place that joins the two: it walks data/chess.json for every record that shares
// the avatar's character id and takes the first skin the player chose for one of them, then asks assets.js for that
// skin's own avatar art (`chars[charId].skins[skinId].avatar`, docs/SKINS.md). A skin without its own avatar art falls
// back to the operator's (avatarUrl does that by itself), and a player without a skin keeps the operator's avatar.
//
// Used by the lobby chip and the picker (the local player, from ui/skins.js), the room seats (`seat.skins`, the
// server's copy from `room.skins`) and the in-match avatar (`m.public players[].skins`).

import { data } from '../data.js';
import { avatarUrl } from '../assets.js';
import { skinsStore } from './skins.js';

/** The character id a chess record's avatar is stored as (mirrors ui/avatarPicker.js `avatarId`). */
const charIdOf = (chess) => {
  const id = chess?.assets?.avatar || chess?.charId;
  return typeof id === 'string' && id ? id : null;
};

/** `char_4040_rockr_2` → `char_4040_rockr`: an elite record's art id and its operator's avatar are the same person. */
const baseCharId = (id) => (typeof id === 'string' ? id.replace(/_(1|2)$/, '') : id);

/** @type {Map<string, string>} */
const EMPTY_MAP = new Map();
/** One map per skins object (the store replaces the object on every change), so a render never rescans chess.json. */
const cache = new WeakMap();

/**
 * `{ charId → skinId }` for every operator whose avatar the skins map covers: the choice is keyed by chess id, this
 * is the same choice keyed by the character id an avatar is stored as.
 * @param {Record<string, string>|null|undefined} skins
 * @param {any[]|null} [list] data.list('chess') to read instead (tests); the default is cached per skins object
 * @returns {Map<string, string>}
 */
export function avatarSkinMap(skins, list = null) {
  if (!skins || typeof skins !== 'object') return EMPTY_MAP;
  const shared = list === null;
  if (shared) {
    const hit = cache.get(skins);
    if (hit) return hit;
  }
  const out = new Map();
  for (const chess of list || data.list('chess')) {
    if (!chess) continue;
    const raw = charIdOf(chess);
    if (!raw) continue;
    const skin = skins[chess.chessId];
    if (typeof skin !== 'string' || !skin) continue;
    // both the record's own art id and its operator's base id answer for this choice: an elite (精锐) record shares
    // its base operator's avatar, and the picker only ever stores the base id (ui/avatarPicker.js filters isGolden)
    if (!out.has(raw)) out.set(raw, skin);
    const base = baseCharId(raw);
    if (base !== raw && !out.has(base)) out.set(base, skin);
  }
  if (shared) cache.set(skins, out);
  return out;
}

/**
 * The skin chosen for the operator behind an avatar character id, out of a `{ [chessId]: skinId }` map.
 * @param {string|null|undefined} charId
 * @param {Record<string, string>|null|undefined} skins
 * @param {any[]|null} [list]
 * @returns {string|null}
 */
export const avatarSkinOf = (charId, skins, list = null) => (charId ? avatarSkinMap(skins, list).get(charId) || null : null);

/** This browser's own choice for an avatar character id (ui/skins.js), for the local player. */
export const localAvatarSkin = (charId) => avatarSkinOf(charId, skinsStore.get().entries);

/**
 * The picture behind a player's avatar: their chosen skin's art when it has one, else the operator's own avatar.
 * @param {any} m asset manifest (data/assets.json)
 * @param {{ avatar?: string|null, skins?: Record<string, string>|null }|null|undefined} player
 * @param {any[]|null} [list]
 * @returns {string|null}
 */
export function playerAvatarUrl(m, player, list = null) {
  const id = player?.avatar;
  if (!id) return null;
  const skin = avatarSkinOf(id, player?.skins, list);
  return avatarUrl(m, id, skin ? { skin } : undefined);
}

/**
 * The same for the local player, without a server round trip: the choice lives in this browser (ui/skins.js).
 * @param {any} m asset manifest @param {string|null|undefined} charId
 * @returns {string|null}
 */
export function selfAvatarUrl(m, charId) {
  if (!charId) return null;
  const skin = localAvatarSkin(charId);
  return avatarUrl(m, charId, skin ? { skin } : undefined);
}
