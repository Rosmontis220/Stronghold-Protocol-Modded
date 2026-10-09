// Custom avatar (players[].avatar = an operator character id, e.g. char_4040_rockr): the picker's operator list, the
// apply path (remember + re-announce), the protocol-selection screen's top-right trigger, and the room seat chip that
// only displays it (ui/avatarPicker.js, screens/lobby.js, screens/room.js).
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('custom avatar', () => {
  test('the picker lists visible operators with avatar art, in tier then name order, keyed by character id', async () => {
    const { avatarChoices, avatarId, avatarRecord } = await import('../../public/js/ui/avatarPicker.js');
    const assets = { chars: {
      char_4040_rockr: { avatar: '/a/rockr.png', portrait: '/p/rockr.png' },
      char_1014_nearl2: { avatar: '/a/nearl.png' }, char_x: {} } };
    const list = [
      { chessId: 'chess_a', name: '甲', tier: 3, visible: true, charId: 'char_4040_rockr' },
      { chessId: 'chess_b', name: '乙', tier: 1, visible: true, charId: 'char_1014_nearl2' },
      { chessId: 'chess_b2', name: '乙', tier: 1, visible: true, isGolden: true, charId: 'char_1014_nearl2' },
      { chessId: 'chess_c', name: '丙', tier: 2, visible: true, charId: 'char_x' },
      { chessId: 'chess_d', name: '丁', tier: 1, visible: false, charId: 'char_4040_rockr' },
    ];
    assert.deepEqual(avatarChoices(list, assets).map(avatarId), ['char_1014_nearl2', 'char_4040_rockr'],
      '精锐 shares its base art, no avatar art and hidden operators are out');
    assert.equal(avatarId({ assets: { avatar: 'char_1_a' }, charId: 'char_1' }), 'char_1_a', 'assets.avatar wins');
    assert.equal(avatarId({}), null);
    assert.deepEqual(avatarChoices(null, assets), []);
    assert.deepEqual(avatarChoices(list, null), [], 'no manifest: nothing to show');
    assert.equal(avatarRecord(list, 'char_4040_rockr')?.name, '甲', 'a stored avatar id finds its record');
    assert.equal(avatarRecord(list, 'chess_a'), null, 'a chess record id is not an avatar id');
    assert.equal(avatarRecord(list, null), null);
  });

  test('picking remembers the operator and re-announces the hello (teammates update at once)', async () => {
    const { applyAvatar, avatarStore, openAvatarPicker, closeAvatarPicker } = await import('../../public/js/ui/avatarPicker.js');
    const { identity, net } = await import('../../public/js/net.js');
    const calls = [];
    const save = identity.saveAvatar;
    const resend = net.resendHello;
    identity.saveAvatar = (id) => { calls.push(['save', id]); };
    net.resendHello = () => { calls.push(['resend']); return true; };
    try {
      applyAvatar('char_4040_rockr');
      applyAvatar(null);
      assert.deepEqual(calls, [['save', 'char_4040_rockr'], ['resend'], ['save', null], ['resend']]);
      openAvatarPicker();
      assert.equal(avatarStore.get().open, true);
      closeAvatarPicker();
      assert.equal(avatarStore.get().open, false);
    } finally { identity.saveAvatar = save; net.resendHello = resend; }
  });

  test('the picker body lists the operators, marks the current one and offers 跟随默认', async () => {
    const { AvatarPickerBody, avatarRecord } = await import('../../public/js/ui/avatarPicker.js');
    const assets = { chars: { char_4040_rockr: { avatar: '/a/rockr.png' } } };
    const list = [
      { chessId: 'chess_a', name: '甲', tier: 1, charId: 'char_4040_rockr' },
      { chessId: 'chess_b', name: '乙', tier: 2, charId: 'char_1_b' },
    ];
    const json = JSON.stringify(AvatarPickerBody({ assets, list, mine: 'char_1_b', mineRec: list[1] }));
    assert.match(json, /char_4040_rockr/);
    assert.match(json, /char_1_b/);
    assert.match(json, /is-on/, 'the current choice is marked');
    assert.match(json, /跟随默认/, 'and can be dropped again');
    assert.match(json, /搜索干员名字/, 'searchable');
    const empty = JSON.stringify(AvatarPickerBody({ assets, list, mine: null, mineRec: null, query: 'zzz' }));
    assert.match(empty, /没有匹配的干员/);
    assert.equal(avatarRecord(list, 'char_4040_rockr')?.name, '甲');
    assert.equal(avatarRecord(list, null), null);
    const picker = readFileSync(path.join(ROOT, 'public/js/ui/avatarPicker.js'), 'utf8');
    assert.match(picker, /identity\.saveAvatar\(id \|\| null\)/, 'the choice is remembered locally');
    assert.match(picker, /net\.resendHello\(\)/, 'and announced so teammates see it');
    // the room screen crashed in the browser when the picker subscribed with useStore(store) — the custom-store form
    // is useStore(selector, isEqual, store) (ui/guide.js does the same); keep it pinned
    assert.match(picker, /useStore\(\(s\) => s, Object\.is, avatarStore\)/);
  });

  test('the protocol-selection screen is the only place to change it; the room only displays it (no half-body portrait)', () => {
    const lobby = readFileSync(path.join(ROOT, 'public/js/screens/lobby.js'), 'utf8');
    assert.match(lobby, /class="me-chip me-chip--pick"[\s\S]{0,220}openAvatarPicker\(\)/, 'the top-right 博士 chip is the trigger');
    assert.match(lobby, /src=\$\{myAvatarSrc\}/, 'the chip shows the picked operator, in the skin picked for them');
    assert.match(lobby, /<\$\{AvatarPicker\} \/>/, 'the picker is mounted by this screen');
    const room = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');
    assert.match(room, /avatarRecord\(data\.list\('chess'\), seat\.avatar\)/, 'the seat resolves the operator for its 头像');
    assert.match(room, /src=\$\{avatarSrc\}/, 'and draws it in the seat frame');
    assert.doesNotMatch(room, /openAvatarPicker|<\$\{AvatarPicker\}/, 'the room neither opens nor mounts the picker');
    assert.doesNotMatch(room, /seat__portrait|chessPortraitUrl|seat__idrow/, 'no half-body portrait: one avatar is enough');
    assert.match(readFileSync(path.join(ROOT, 'public/css/screens/lobby.css'), 'utf8'), /\.avpick__grid/, 'the picker styles live with their screen');
    assert.doesNotMatch(readFileSync(path.join(ROOT, 'public/css/screens/room.css'), 'utf8'), /seat__portrait|avpick__/);
    assert.match(readFileSync(path.join(ROOT, 'public/css/components.css'), 'utf8'), /button\.me-chip--pick/, 'the chip is styled as a button');
  });

  test('the server keeps the avatar per session and the client only sends a valid character id', () => {
    const net = readFileSync(path.join(ROOT, 'server/net.js'), 'utf8');
    assert.match(net, /session\.avatar = typeof msg\.avatar === 'string' && \/\^char_\[a-z0-9_\]\{1,24\}\$\/\.test\(msg\.avatar\) \? msg\.avatar : null;/);
    assert.match(net, /avatar: session\.avatar,/, 'welcome echoes it');
    const lobby = readFileSync(path.join(ROOT, 'server/lobby.js'), 'utf8');
    assert.match(lobby, /avatar: s\.avatar \?\? null/, 'room.state seats carry it');
    assert.match(lobby, /\(seat\.avatar \?\? null\) !== \(session\.avatar \?\? null\)/, 'a change is a visible change (normalized)');
    const client = readFileSync(path.join(ROOT, 'public/js/net.js'), 'utf8');
    assert.match(client, /const AVATAR_ID = \/\^char_\[a-z0-9_\]\{1,24\}\$\/;/, 'the client validates before sending');
    assert.match(client, /if \(typeof avatar === 'string' && AVATAR_ID\.test\(avatar\)\) msg\.avatar = avatar;/, 'only a valid id is announced');
    assert.match(client, /resendHello\(\) \{/, 'the picker re-announces on the live socket');
    const avatars = readFileSync(path.join(ROOT, 'public/js/ui/gameComponents.js'), 'utf8');
    assert.match(avatars, /playerAvatarUrl\(data\.get\('assets'\), player\)/, 'the chip avatar follows the skin picked for that operator');
  });
});
