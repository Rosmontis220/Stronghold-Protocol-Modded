// server/match/match/spDraft.js — Match methods: the 机变 draft (SP_DRAFT: turn order, timers, AI picks, the card applied
// by choices.js applyCard) and the rolls the meta effects ask for — bounties (addBounty), item ids (rollItemId) and
// choices.json pools (rollPool).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { generateGroupDrafts, applyCard, bountyBattles, isMultiRoundBounty } from '../choices.js';
import { weightedPick } from '../waves.js';
import { botPickCard } from '../bot.js';
import { OK, fail, DELAYS } from './common.js';
import { installDraftFacade } from './phases.js';

export class MatchSpDraft {
  enterSpDraft() {
    if (!this.alivePlayers().length) { this.enterPrep(); return; }
    const groups = this.makeDraftGroups({ shuffle: false });
    const active = groups.filter((g) => g.order.length).map((g) => ({ id: g.id, playerIds: g.order.slice() }));
    const pages = generateGroupDrafts(this.gd, this.rngDraft, this.round, active, {
      stageId: this.stageId, bondAvailable: (bondId, group) => this.bondLive(bondId, group.playerIds[0]),
    });
    if (!pages || !pages.length) { this.enterPrep(); return; }
    for (const g of groups) {
      const page = pages.find((p) => p.id === g.id);
      Object.assign(g, page || { cards: [] }, { taken: {} });
      if (!this.isSolo) this.rngDraft.shuffle(g.order);
      this.prioritizeDraftOrder(g.order);
    }
    this.phase = PHASE.SP_DRAFT;
    this.sp = installDraftFacade({ ...pages[0], id: this.nextDraftId('sp'), groups, picks: {}, untimed: this.soloUntimed },
      ['order', 'idx', 'cards', 'taken', 'turnDeadline', 'turnSeconds']);
    this.setDeadline(0);
    for (const g of groups) this.startSpTurn(g);
    this.markPublic();
  }

  spGroup(playerId = null) {
    const groups = this.sp?.groups || [];
    return playerId == null ? groups[0] || null : groups.find((g) => g.playerIds.includes(playerId)) || null;
  }

  spTurn(playerId = null) {
    const g = this.spGroup(playerId);
    return g && !g.done ? g.order[g.idx] ?? null : null;
  }

  startSpTurn(group = this.spGroup()) {
    const s = this.sp;
    if (this.phase !== PHASE.SP_DRAFT || !s || !group) return;
    const g = group;
    this.clearDraftGroupTimer(g);
    while (g.idx < g.order.length) {
      const ps = this.players.get(g.order[g.idx]);
      if (ps && ps.alive && !ps.left && s.picks[ps.playerId] == null) break;
      g.idx++;
    }
    this.prioritizeDraftOrder(g.order, g.idx);
    const available = g.cards.map((c) => c.idx).filter((i) => g.taken[i] == null);
    g.done = g.idx >= g.order.length || !available.length;
    if (g.done) {
      this.syncDraftDeadline(s);
      this.markPublic();
      if (s.groups.every((x) => x.done) && !s.finishPending) {
        s.finishPending = true;
        this.later(0, () => {
          if (this.sp === s && this.phase === PHASE.SP_DRAFT && s.groups.every((x) => x.done)) this.finishSpDraft();
        });
      }
      return;
    }
    const token = g.token;
    if (!g.untimed) {
      const first = g.idx === 0;
      const secs = first ? this.gd.timer('spFirst') : this.gd.timer('spTurn');
      const ms = this.scaled(secs * 1000);
      g.turnSeconds = ms / 1000;
      g.turnDeadline = this.sched.now() + ms;
      g.timer = this.later(ms, () => {
        if (this.phase !== PHASE.SP_DRAFT || this.sp !== s || token !== g.token) return;
        const ps = this.players.get(g.order[g.idx]);
        if (!ps) return;
        const avail = g.cards.map((c) => c.idx).filter((i) => g.taken[i] == null);
        if (!avail.length) { this.startSpTurn(g); return; }
        this._applyCard(ps, avail[Math.floor(this.rngDraft() * avail.length)]);
      });
    }
    this.syncDraftDeadline(s);
    const cur = this.players.get(g.order[g.idx]);
    if (cur && cur.botControlled) this.scheduleSpBot(g);
    this.markPublic();
  }

  scheduleSpBot(group = this.spGroup()) {
    const s = this.sp;
    const g = group;
    if (!s || !g || g.done) return;
    const token = g.token;
    this.later(this.scaled(DELAYS.BOT_ACTION), () => {
      if (this.phase !== PHASE.SP_DRAFT || this.sp !== s || token !== g.token) return;
      const ps = this.players.get(g.order[g.idx]);
      if (!ps || !ps.botControlled) return;
      const avail = g.cards.map((c) => c.idx).filter((i) => g.taken[i] == null);
      if (!avail.length) return;
      this._applyCard(ps, botPickCard(this, ps, g.cards, avail));
    });
  }

  pickCard(ps, idx, opts = {}) {
    if (this.phase !== PHASE.SP_DRAFT || !this.sp) return fail(ERR.WRONG_PHASE);
    const g = this.spGroup(ps.playerId);
    const targetError = this.draftTargetError(this.sp, g, opts);
    if (targetError) return targetError;
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.sp.picks[ps.playerId] != null) return fail(ERR.ALREADY);
    if (this.spTurn(ps.playerId) !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (!Number.isInteger(idx) || idx < 0 || idx >= g.cards.length) return fail(ERR.BAD_TARGET);
    if (g.taken[idx] != null) return fail(ERR.SOLD_OUT);
    this._applyCard(ps, idx);
    return OK;
  }

  _applyCard(ps, idx) {
    const s = this.sp;
    const g = ps && this.spGroup(ps.playerId);
    if (!s || !g || !ps.alive || ps.left || s.picks[ps.playerId] != null || g.taken[idx] != null) return;
    const card = g.cards[idx];
    if (!card) return;
    s.picks[ps.playerId] = idx;
    g.picks[ps.playerId] = idx;
    g.taken[idx] = ps.playerId;
    try { applyCard(this, ps, card); } catch (e) { this.reportError(`applyCard ${card.id}`, e); }
    this.markPrivate(ps);
    this.markPublic();
    this.startSpTurn(g);
  }

  finishSpDraft() {
    if (this.phase !== PHASE.SP_DRAFT) return;
    for (const g of this.sp.groups) this.clearDraftGroupTimer(g);
    this.enterPrep();
  }

  addBounty(ps, card) {
    if (!ps || !card || !this.gd.enemy(card.enemyKey)) return null;
    // a multi-round card lasts MULTI_ROUND_BOUNTY_BATTLES battles (choices.js; the user's call after playtest #6)
    const rounds = bountyBattles(card);
    const b = {
      id: `bounty:${this.nextUid()}`,
      card: { effectId: card.effectId ?? card.id ?? null, name: card.name ?? '悬赏', desc: card.desc ?? '', tier: card.tier ?? 1, coin: Math.max(0, Math.trunc(Number(card.coin) || 0)), payout: card.payout === 'perfect' ? 'perfect' : 'kill', rounds, multiRound: isMultiRoundBounty(card), enemyKey: card.enemyKey, count: Math.max(1, Math.min(20, Number.isInteger(card.count) ? card.count : 1)) }, // i18n-ignore: a data-less card's fallback name
      roundsLeft: rounds,
    };
    ps.bounties.push(b);
    ps.dirty();
    return b.id;
  }

  /** Random item id: a choices.json server pool ({ pool }), a tier, or ≤ maxTier shop-eligible items. */
  rollItemId({ pool = null, tier = null, maxTier = 6, shopLevel = 6 } = {}) {
    const pools = this.gd.choices.pools && typeof this.gd.choices.pools === 'object' ? this.gd.choices.pools : {};
    const p = typeof pool === 'string' && Object.hasOwn(pools, pool) ? pools[pool] : null;
    const rng = this.rngMeta;
    const tierList = (lo, hi) => { const out = []; for (let t = lo; t <= hi; t++) for (const id of this.gd.shopItemsByTier[t] || []) out.push(id); return out; };
    if (p && p.kind === 'equip') {
      if (Array.isArray(p.weighted) && p.weighted.length) {
        const pairs = p.weighted.filter((x) => Array.isArray(x) && this.gd.item(x[0]));
        let total = 0;
        for (const [, w] of pairs) total += Math.max(0, Number(w) || 0);
        let r = rng() * total;
        for (const [id, w] of pairs) { r -= Math.max(0, Number(w) || 0); if (r < 0) return id; }
        return pairs.length ? pairs[pairs.length - 1][0] : null;
      }
      if (Array.isArray(p.items) && p.items.length) {
        const items = p.items.filter((id) => this.gd.item(id));
        return items.length ? items[Math.floor(rng() * items.length)] : null;
      }
      let list;
      if (Array.isArray(p.tiers) && p.tiers.length) list = p.tiers.flatMap((t) => this.gd.shopItemsByTier[t] || []);
      else list = tierList(1, p.maxTier === 'shopLevel' ? Math.max(1, Math.min(6, shopLevel)) : 6);
      return list.length ? list[Math.floor(rng() * list.length)] : null;
    }
    const list = Number.isInteger(tier) ? tierList(tier, tier) : tierList(1, Math.max(1, Math.min(6, maxTier)));
    return list.length ? list[Math.floor(rng() * list.length)] : null;
  }

  /**
   * Roll a choices.json pool (ctx.rollPool). Equip pools → rollItemId. Chess pools: an `items` (uniform) or `weighted`
   * list — only chess with a free pool copy (or outside the pool) qualify — else a copy-weighted draw from the shared
   * pool filtered by `tier` / `minTier` / `maxTier` (number or 'shopLevel') / `bond`; `golden: true` yields the elite id.
   * `extra` (the drawing player's 自选 stock, player/diy.js diyStockEntries) joins that shared-pool draw, `chessOf` reads the
   * bonds (the player's data view: a slotted slot's operator) — 0.2.0 WE2.
   * @returns {{ kind: 'item'|'chess', id: string, golden?: boolean } | null}
   */
  rollPool(poolId, { shopLevel = 6, extra = null, chessOf = null, player = null } = {}) {
    const pool = this.poolFor(player);
    const pools = this.gd.choices.pools && typeof this.gd.choices.pools === 'object' ? this.gd.choices.pools : {};
    const p = typeof poolId === 'string' && Object.hasOwn(pools, poolId) ? pools[poolId] : null;
    if (!p || typeof p !== 'object') return null;
    const lvl = Math.max(1, Math.min(6, Number.isInteger(shopLevel) ? shopLevel : 6));
    if (p.kind === 'equip') {
      const id = this.rollItemId({ pool: poolId, shopLevel: lvl });
      return id ? { kind: 'item', id } : null;
    }
    if (p.kind !== 'chess') return null;
    const rng = this.rngMeta;
    const free = (id) => {
      if (typeof id !== 'string' || !this.gd.chess(id)) return false;
      const base = this.gd.baseIdOf(id);
      return !pool.has(base) || pool.left(base) > 0;
    };
    let id = null;
    if (Array.isArray(p.weighted) && p.weighted.length) {
      const pairs = p.weighted.filter((x) => Array.isArray(x) && free(x[0]));
      id = pairs.length ? weightedPick(rng, pairs) : null;
    } else if (Array.isArray(p.items) && p.items.length) {
      const list = p.items.filter(free);
      id = list.length ? list[Math.floor(rng() * list.length)] : null;
    } else {
      const maxTier = p.maxTier === 'shopLevel' ? lvl : Number.isInteger(p.maxTier) ? p.maxTier : 6;
      const minTier = Number.isInteger(p.minTier) ? p.minTier : 1;
      const bond = typeof p.bond === 'string' ? p.bond : null;
      const recOf = typeof chessOf === 'function' ? chessOf : (cid) => this.gd.chess(cid);
      id = pool.roll(rng, {
        tier: Number.isInteger(p.tier) ? p.tier : null,
        maxTier,
        filter: (cid, e) => e.tier >= minTier && (!bond || (Array.isArray(recOf(cid)?.bonds) && recOf(cid).bonds.includes(bond))),
        extra,
      });
    }
    if (!id) return null;
    const golden = !!p.golden;
    return { kind: 'chess', id: golden ? this.gd.goldenIdOf(id) || id : id, golden };
  }
}
