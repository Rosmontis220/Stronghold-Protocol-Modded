// Custom avatar (players[].avatar = a chess id): the picker's operator list, the apply path (remember + re-announce),
// and the room seat card that draws the picked operator's 头像 and 半身像 (screens/room.js, ui/avatarPicker.js).
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

  test('picking remembers the operator and re-announces the hello (the room updates at once)', async () => {
    const { applyAvatar, avatarStore, openAvatarPicker, closeAvatarPicker } = await import('../../public/js/ui/avatarPicker.js');
    const { identity, net } = await import('../../public/js/net.js');
    const calls = [];
    const save = identity.saveAvatar;
    const resend = net.resendHello;
    identity.saveAvatar = (id) => { calls.push(['save', id]); };
    net.resendHello = () => { calls.push(['resend']); return true; };
    try {
      applyAvatar('char_2_10_a');
      applyAvatar(null);
      assert.deepEqual(calls, [['save', 'char_2_10_a'], ['resend'], ['save', null], ['resend']]);
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
    const vnode = AvatarPickerBody({ assets, list, mine: 'char_1_b', mineRec: list[1] });
    const json = JSON.stringify(vnode);
    assert.match(json, /char_4040_rockr/);
    assert.match(json, /char_1_b/);
    assert.match(json, /is-on/, 'the current choice is marked');
    assert.match(json, /跟随默认/, 'and can be dropped again');
    assert.match(json, /搜索干员名字/, 'searchable');
    const empty = JSON.stringify(AvatarPickerBody({ assets, list, mine: null, mineRec: null, query: 'zzz' }));
    assert.match(empty, /没有匹配的干员/);
    assert.equal(avatarRecord(list, 'char_4040_rockr')?.name, '甲');
    assert.equal(avatarRecord(list, null), null);
  });

  test('the seat card draws the portrait, the avatar + ID row, DOCTOR #… and the state; your own avatar opens the picker', () => {
    const room = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');
    assert.match(room, /avatarRecord\(data\.list\('chess'\), seat\.avatar\)/, 'the stored character id finds its operator record');
    assert.match(room, /chessPortraitUrl\(assets, rec\)/, 'the picked operator gives the 半身像');
    assert.match(room, /class="seat__portrait" style=\$\{`--portrait:url\("\$\{portrait\}"\)`\}/, 'portrait layer with its bleed/fade backdrop');
    assert.match(room, /<div class="seat__idrow">/, '头像 + ID row');
    assert.match(room, /seat__avatar-btn[\s\S]{0,200}openAvatarPicker\(\)/, 'your own avatar is the picker trigger');
    assert.match(room, /seat__idrow[\s\S]{0,2000}DOCTOR #\$\{doctorNo\(seat\.playerId\)\}/, 'DOCTOR #序列号 follows the avatar + ID row');
    assert.match(room, /seat__foot[\s\S]{0,2000}seat__state/, '待命/就绪 stays the last row');
    assert.match(room, /<\$\{AvatarPicker\} \/>/, 'the picker is mounted by the room screen');
    const picker = readFileSync(path.join(ROOT, 'public/js/ui/avatarPicker.js'), 'utf8');
    assert.match(picker, /identity\.saveAvatar\(id \|\| null\)/, 'the choice is remembered locally');
    assert.match(picker, /net\.resendHello\(\)/, 'and announced so teammates see it');
    assert.match(picker, /搜索干员名字/, 'the list is searchable');
    // the room screen crashed in the browser when the picker subscribed with useStore(store) — the custom-store form
    // is useStore(selector, isEqual, store) (ui/guide.js does the same); keep it pinned
    assert.match(picker, /useStore\(\(s\) => s, Object\.is, avatarStore\)/);
  });

  test('the server keeps the avatar per session and the client only sends a valid chess id', () => {
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
    assert.match(avatars, /chessAvatarUrl\(data\.get\('assets'\), \{ charId: player\.avatar \}\)/, 'the chip avatar resolves the character id');
  });
});
