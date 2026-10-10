// The chosen skin reaches the battlefield (docs/SKINS.md): PlayerState.battleInput carries the per-chess skin and the
// sim ally is created with it (units.js `skin`), so a unit fights — and shows — the skin's own model, and the battle
// snapshot passes it to the views. Regression: the sim dropped `inp.skin` at _createAllyFromInput (units always came
// out on their default art after the battle started, while the prep field kept showing the choice).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from '../helpers/battleHarness.js';

const SKIN = 'char_4040_rockr@sea#1'; // a skin id shape (charId@series#n)

test('a fielded unit keeps the chosen skin: the input carries it, the sim unit and the snapshot keep it', () => {
  const h = makeBattle({ units: [{ chessId: 'chess_char_5_13_a', row: 10, col: 4, skin: SKIN }] });
  const u = h.battle.units.find((x) => x.kind === 'op');
  assert.ok(u, 'the operator fields');
  assert.equal(u.skin, SKIN, 'the sim unit fights with the chosen skin');
  const snap = typeof h.battle.snapshot === 'function' ? h.battle.snapshot() : null;
  if (snap) {
    const s = (snap.units || []).find((x) => x.uid === u.uid);
    if (s) assert.equal(s.skin, SKIN, 'the snapshot passes the skin to the views');
  }
});

test('a unit without a skin stays on its own art', () => {
  const h = makeBattle({ units: [{ chessId: 'chess_char_5_13_a', row: 10, col: 4 }] });
  const u = h.battle.units.find((x) => x.kind === 'op');
  assert.equal(u.skin, null, 'no skin, no art');
});
