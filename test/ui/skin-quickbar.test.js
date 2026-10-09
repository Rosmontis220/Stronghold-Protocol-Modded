// 干员调配列表行的皮肤快捷格 (screens/loadout.js QuickSkin + the row's fifth column): one tile per installed skin beside
// the 潜能 / 练度 selects — tap to wear without opening the detail panel, like the row's skill / module quick choices
// (PR #301). The fork's own addition to the roster list. These tests: the column's place in the row and the head, the
// reuse of the picker's own store helpers (no duplicate skin logic), the guards (an operator without skins leaves the
// column empty; 默认 clears), and the css (the shared grid keeps the columns aligned; a narrow phone drops the column).
// (The full 换装 tab of the detail panel: test/ui/skins.e2e.test.js.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('the row has a 皮肤 column after 潜能 / 练度, headed in the sticky list head; the detail keeps its 换装 tab', () => {
  const src = read('public/js/screens/loadout.js');
  const row = src.slice(src.indexOf('export function RosterRow('), src.indexOf('// ---- detail'));
  const head = src.slice(src.indexOf('export function RosterHead('), row.indexOf === -1 ? undefined : src.indexOf('export function RosterRow('));
  assert.ok(head.indexOf("lo-list__h--skin") > head.indexOf("lo-list__h--cult"), 'the head: 皮肤 after 潜能 · 练度');
  const cult = row.indexOf('<${CultivationSelects}');
  const skins = row.indexOf('class="lo-card__skins');
  assert.ok(cult > 0 && skins > cult, 'the row: the skin tiles after the cultivation selects');
  assert.equal(row.split('lo-card__skins').length - 1, 1, 'the skins column renders exactly once');
  // the row gets the picked skins and picks through the picker's own helpers — no second skin store
  assert.match(row, /chosenSkin = skins\[chess\.chessId\]/);
  assert.match(src, /import \{ skinsStore, setSkins, setSkin, clearSkin, availableSkins, loadSkinData \} from '\.\.\/ui\/skins\.js';/);
  assert.match(src, /import \{ SkinSection, skinAvatar \} from '\.\.\/ui\/skinPicker\.js';/);
  // the detail panel's full 换装 tab stays
  assert.match(src, /\$\{activeTab === 'skin' \? html`<\$\{SkinSection\} chess=\$\{chess\} \/>` : null\}/);
});

test('the tiles: 默认 clears (first, on only without a skin), every skin picks; an operator without skins leaves the column empty', () => {
  const src = read('public/js/screens/loadout.js');
  const row = src.slice(src.indexOf('export function RosterRow('), src.indexOf('// ---- detail'));
  assert.match(row, /skinList\.length \? html`<button[^]*aria-label=\$\{'默认立绘'\}[^]*clearSkin\(chess\.chessId\)/s, '默认 first, clears');
  assert.match(row, /chosenSkin === sk\.id/, 'a skin tile is on only while worn');
  assert.match(row, /setSkin\(chess\.chessId, skinId\)/, 'a skin tile picks through the store helper');
  assert.match(row, /skinList\.length \?/, 'the 默认 tile (and the whole column) only when the operator has skins');
  const quick = src.slice(src.indexOf('function QuickSkin('), src.indexOf('export function RosterHead('));
  assert.match(quick, /skinAvatar\(charId, skin\.id\) \|\| defaultArt/, 'a tile falls back to the operator art');
  assert.match(quick, /aria-label=\$\{label\}/, 'the tile names the skin');
});

test('css: the fifth column is a fixed 3-tile band like the skills (the columns stay aligned), the tile keeps px floors, a narrow phone drops the column', () => {
  const css = read('public/css/screens/loadout.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const listRule = rules.find((r) => r.sel === '.lo-list')?.body || '';
  assert.match(listRule, /max\(2\.2rem, 160px\) calc\(3 \* var\(--q\) \+ 2 \* var\(--qg\)\)/, 'the fifth column is the fixed 3-tile band');
  const group = (sel) => rules.find((r) => r.sel === sel)?.body || '';
  assert.match(group('.lo-card__skills, .lo-card__mods, .lo-card__skins'), /gap: var\(--qg\)/, 'the skin tiles share the quick grid');
  const tile = (sel) => rules.find((r) => r.sel === sel)?.body || '';
  for (const m of tile('.lo-q--skin').matchAll(/font-size:\s*([^;]+);/g)) {
    assert.match(m[1], /^max\([^)]*\d+px\)$/, `.lo-q--skin font-size ${m[1]} keeps a px floor`);
  }
  assert.match(tile('.lo-q--skin.is-on'), /border-color:\s*rgba\(78, 216, 175, \.75\)/, 'the worn tile lights like the 换装 tab');
  const narrow = css.slice(css.indexOf('@media (max-width: 700px)'));
  assert.match(narrow, /\.lo-list__h--skin, \.lo-card__skins \{ display: none; \}/, 'a narrow phone drops the column');
  assert.match(narrow, /--cols: minmax\(max\(2\.2rem, 110px\), max\(3\.2rem, 260px\)\) calc\(3 \* var\(--q\) \+ 2 \* var\(--qg\)\) calc\(4 \* var\(--q\) \+ 3 \* var\(--qg\)\) max\(2\.2rem, 160px\);\s*\}/, 'the phone grid is back to four columns');
});
