// 干员调配的皮肤快捷栏 (ui/skinPicker.js SkinQuickBar): a compact row of skin avatars under the 潜能 / 练度
// selects of the detail panel — tap to wear without opening the 换装 tab. These tests: the place in the detail
// (after the cultivation selects, before the garrisons; the 换装 tab keeps the full 皮肤 section), the component's
// guards (null before the config arrives and for operators without skins), the reuse of the picker's own state
// helpers (no duplicate skin logic in the screen), and the css floors that keep it readable on a phone.
// (The real-browser side of the picker: test/ui/skins.e2e.test.js.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('place in the detail: after the 潜能 / 练度 selects, before the garrisons; the 换装 tab keeps the full 皮肤 section', () => {
  const src = read('public/js/screens/loadout.js');
  assert.match(src, /import \{ SkinSection, SkinQuickBar \} from '\.\.\/ui\/skinPicker\.js';/);
  const detail = src.slice(src.indexOf('function Detail('), src.indexOf('// ---- filters'));
  const branch = detail.indexOf("activeTab === 'skin' ? null : html`<${CultivationSection}");
  const quick = detail.indexOf('<${SkinQuickBar} chess=${chess} />');
  const garrisons = detail.indexOf('<${LoadoutGarrisons}');
  const full = detail.indexOf('<${SkinSection} chess=${chess} />');
  assert.ok(branch > 0, 'the non-skin branch starts at the cultivation section');
  assert.ok(quick > branch && garrisons > quick, '皮肤快捷栏 sits between 潜能 / 练度 and the garrisons');
  assert.ok(full > 0 && detail.indexOf("activeTab === 'skin' ? html`<${SkinSection}") >= 0, 'the full section stays on the 换装 tab');
  // the quick bar renders exactly once, in that branch only
  assert.equal(detail.split('<${SkinQuickBar}').length - 1, 1);
});

test('the component reuses the picker state helpers and hides itself without skins or before the config arrives', () => {
  const src = read('public/js/ui/skinPicker.js');
  assert.match(src, /export function SkinQuickBar\(/);
  const fn = src.slice(src.indexOf('export function SkinQuickBar('));
  assert.match(fn, /availableSkins\(charId\)/);
  assert.match(fn, /if \(!list\.length\) return null;/, 'no skins → nothing (after the config arrives)');
  assert.match(fn, /data\.status\('skins'\) !== 'ready'/, 'nothing while the config streams in');
  assert.match(fn, /setSkin\(chessId, x\.id\)/);
  assert.match(fn, /clearSkin\(chessId\)/);
  // no duplicate logic: the shared useSkinData hook feeds both the section and the quick bar
  assert.match(src, /function useSkinData\(chessId\)/);
  assert.equal(src.split('useSkinData(').length - 1, 3, 'the hook is declared once and used by both components');
});

test('css: the quick bar keeps px floors on every font size and the tile is square (readable at 1 rem = 40 px)', () => {
  const css = read('public/css/screens/loadout.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const mine = rules.filter((r) => /\.lo-skinbar/.test(r.sel));
  assert.ok(mine.length >= 6, 'the quick-bar rules exist');
  for (const r of mine) for (const m of r.body.matchAll(/font-size:\s*([^;]+);/g)) {
    assert.match(m[1], /^max\([^)]*\d+px\)$/, `${r.sel}: font-size ${m[1]} keeps a px floor`);
  }
  const tile = (sel) => rules.find((r) => r.sel === sel)?.body || '';
  assert.match(tile('.lo-skinbar__tile'), /width:\s*max\(\.48rem, 36px\)/);
  assert.match(tile('.lo-skinbar__tile'), /height:\s*max\(\.48rem, 36px\)/);
  assert.match(tile('.lo-skinbar__tile.is-on'), /border-color:\s*rgba\(78, 216, 175, \.75\)/, 'the worn tile lights like the picker rows');
  assert.match(tile('.lo-skinbar__row'), /flex-wrap:\s*wrap/, 'many skins wrap instead of overflowing');
});
