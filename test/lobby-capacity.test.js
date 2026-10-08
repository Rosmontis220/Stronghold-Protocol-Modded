import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { ROOM_CAPACITIES, DEFAULT_SEATS, MAX_SEATS, MAX_DRAFT_CARDS } from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';

test('capacity and high seat/card indexes are bounded at the protocol boundary', () => {
  for (const capacity of ROOM_CAPACITIES) {
    assert.equal(validateC2S({ t: 'room.create', mode: 'coop', difficulty: 'HARD', capacity }), null);
    assert.equal(validateC2S({ t: 'room.setCapacity', capacity }), null);
  }
  for (const capacity of [0, 3, 21, 100, '20']) assert.notEqual(validateC2S({ t: 'room.setCapacity', capacity }), null);
  assert.equal(validateC2S({ t: 'room.removeBot', seat: MAX_SEATS - 1 }), null);
  assert.notEqual(validateC2S({ t: 'room.removeBot', seat: MAX_SEATS }), null);
  assert.equal(validateC2S({ t: 'g.choice', idx: MAX_DRAFT_CARDS - 1 }), null);
  assert.notEqual(validateC2S({ t: 'g.choice', idx: MAX_DRAFT_CARDS }), null);
});

test('group draft requests validate optional stage and group guards while preserving legacy shapes', () => {
  for (const msg of [{ t: 'g.band', bandId: 'band_sarkazb' }, { t: 'g.bandSkip' },
    { t: 'g.bandFocus', bandId: null }, { t: 'g.choice', idx: 5 }]) {
    assert.equal(validateC2S(msg), null);
    assert.equal(validateC2S({ ...msg, draftId: 'sp:m_123:3:2', groupId: 5 }), null);
    for (const groupId of [0, 6, 1.5, '1', null]) assert.notEqual(validateC2S({ ...msg, groupId }), null);
    for (const draftId of ['', 'bad id', 'a'.repeat(65), 1, null]) assert.notEqual(validateC2S({ ...msg, draftId }), null);
  }
  assert.notEqual(validateC2S({ t: 'g.choice', idx: 6, groupId: 1 }), null);
});

test('default eight seats, host resizing, occupied trailing seats and a full twenty-seat room', async () => {
  const clients = [];
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: StubMatch });
  try {
    const player = async (name) => {
      const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
      clients.push(c);
      c.id = (await c.hello(name)).playerId;
      return c;
    };
    const host = await player('Host');
    assert.equal((await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
    let state = await host.waitFor('room.state');
    assert.equal(state.capacity, DEFAULT_SEATS);
    assert.equal(state.seats.length, DEFAULT_SEATS);
    const guest = await player('Guest');
    assert.equal((await guest.request({ t: 'room.join', code: state.code })).t, 'ok');
    assert.equal((await guest.request({ t: 'room.setCapacity', capacity: 20 })).code, 'NOT_HOST');
    assert.equal((await guest.request({ t: 'room.ready', ready: true })).t, 'ok');
    assert.equal((await host.request({ t: 'room.setCapacity', capacity: 20 })).t, 'ok');
    state = await host.waitFor('room.state', (s) => s.capacity === 20);
    assert.equal(state.seats[1].ready, false);
    for (let i = 2; i < MAX_SEATS; i++) assert.equal((await host.request({ t: 'room.addBot' })).t, 'ok');
    state = await host.waitFor('room.state', (s) => s.seats.every(Boolean));
    assert.equal(state.seats[19].isBot, true);
    assert.equal((await host.request({ t: 'room.addBot' })).code, 'ROOM_FULL');
    assert.equal((await host.request({ t: 'room.setCapacity', capacity: 16 })).code, 'BAD_TARGET');
    assert.equal((await host.request({ t: 'room.removeBot', seat: 19 })).t, 'ok');
    assert.equal((await host.request({ t: 'room.removeBot', seat: 18 })).t, 'ok');
    assert.equal((await host.request({ t: 'room.removeBot', seat: 17 })).t, 'ok');
    assert.equal((await host.request({ t: 'room.removeBot', seat: 16 })).t, 'ok');
    assert.equal((await host.request({ t: 'room.setCapacity', capacity: 16 })).t, 'ok');
    state = await host.waitFor('room.state', (s) => s.capacity === 16);
    assert.equal(state.seats.length, 16);
    assert.equal(state.seats[1].playerId, guest.id, 'seats never compact during resize');
  } finally {
    await Promise.all(clients.map((c) => c.terminate()));
    await srv.close();
  }
});

test('twenty real WebSocket players can join and start the same co-op room', async () => {
  const clients = [];
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: StubMatch });
  try {
    const player = async (name) => {
      const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
      clients.push(c);
      c.id = (await c.hello(name)).playerId;
      return c;
    };
    const host = await player('Host');
    assert.equal((await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', capacity: 20 })).t, 'ok');
    const code = (await host.waitFor('room.state')).code;
    for (let i = 1; i < MAX_SEATS; i++) {
      const guest = await player(`Guest ${i}`);
      assert.equal((await guest.request({ t: 'room.join', code })).t, 'ok');
      assert.equal((await guest.request({ t: 'room.ready', ready: true })).t, 'ok');
    }
    const room = await host.waitFor('room.state', (s) => s.seats.every((seat) => seat && (seat.seat === 0 || seat.ready)));
    assert.equal(room.seats.length, MAX_SEATS);
    assert.equal(new Set(room.seats.map((seat) => seat.playerId)).size, MAX_SEATS);
    assert.equal((await host.request({ t: 'room.start' })).t, 'ok');
    const views = await Promise.all(clients.map((client) => client.waitFor('m.public', (pub) => pub.players?.length === MAX_SEATS)));
    for (const pub of views) assert.equal(new Set(pub.players.map((p) => p.playerId)).size, MAX_SEATS);
  } finally {
    await Promise.all(clients.map((c) => c.terminate()));
    await srv.close();
  }
});
