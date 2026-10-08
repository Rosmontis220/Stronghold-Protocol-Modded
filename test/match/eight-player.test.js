import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { generateDraft } from '../../server/match/choices.js';
import { compactResult } from '../../server/sim/spec.js';
import { validateC2S, RESULT_LIMITS } from '../../shared/protocol.js';
import { MAX_SEATS } from '../../shared/constants.js';

test('co-op boss pool uses the modern per-player baseline', () => {
  const gd = makeMatch({ humans: 1, fake: true }).m.gd;
  const base = gd.bossPoolShare(1);
  for (const n of [1, 4, 5, 8, 20]) assert.equal(gd.bossPoolShare(n), base * n);
});

test('twenty-player battle reports and last draft index pass protocol validation', () => {
  assert.equal(MAX_SEATS, 20);
  assert.equal(RESULT_LIMITS.players, 20);
  const perPlayer = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p_${i}`, { total: 1, killed: 1 }]));
  assert.equal(Object.keys(compactResult({ perPlayer }).perPlayer).length, 20);
  assert.equal(validateC2S({ t: 'g.choice', idx: 5 }), null);
  assert.notEqual(validateC2S({ t: 'g.choice', idx: 6 }), null);
});

test('twenty-player drafts cover every seat, including fixed secret-shop pools', () => {
  const h = makeMatch({ humans: 20, seed: 82, fake: true });
  try {
    for (const round of [3, 6, 9, 11, 13]) {
      const draft = generateDraft(h.m.gd, h.m.rngDraft, round, { stageId: h.m.stageId, playerCount: 20 });
      if (draft) {
        assert.equal(draft.cards.length, 6, `R${round} ${draft.family} uses six independent cards per group`);
        assert.equal(!!draft.repeatable, false);
        assert.equal(new Set(draft.cards.map((c) => c.idx)).size, draft.cards.length);
      }
    }
  } finally { h.m.dispose(); }
});

test('one human and nineteen AI complete a match with twenty players', () => {
  const h = makeMatch({ humans: 1, bots: 19, fake: true, seed: 85, script: () => ({ duration: 1 }), checkFrames: true });
  try {
    h.autoHumans().start();
    h.runToEnd();
    assert.equal(h.m.players.size, 20);
    assert.deepEqual(h.logs.error, []);
    assert.deepEqual(h.badFrames, []);
    h.invariants();
  } finally { h.m.dispose(); }
});
