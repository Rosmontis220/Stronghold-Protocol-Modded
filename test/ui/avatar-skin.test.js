// 头像跟随皮肤 (ui/avatarSkin.js): an avatar is a CHARACTER id while a skin choice is keyed by CHESS record, so this
// is the join between the two — the lobby chip, the room seats and the in-match avatar all draw the skin's own art.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { avatarSkinMap, avatarSkinOf, playerAvatarUrl } from '../../public/js/ui/avatarSkin.js';

const manifest = { chars: {
  char_4040_rockr: { avatar: '/a/rockr.png', skins: { 'rockr@dream': { avatar: '/a/rockr@dream.png' } } },
  char_1014_nearl2: { avatar: '/a/nearl.png', skins: { 'nearl@plain': { name: '无独立头像的皮肤' } } },
} };

// one operator, a base and an elite record (both keyed to the same character id), plus an operator without a skin
const list = [
  { chessId: 'chess_rockr', charId: 'char_4040_rockr', assets: { avatar: 'char_4040_rockr' } },
  { chessId: 'chess_rockr_g', charId: 'char_4040_rockr', isGolden: true, assets: { avatar: 'char_4040_rockr_2' } },
  { chessId: 'chess_nearl', charId: 'char_1014_nearl2', assets: { avatar: 'char_1014_nearl2' } },
];

describe('头像跟随皮肤', () => {
  test('the chess-keyed choice is read back per character id, whichever record carries it', () => {
    assert.equal(avatarSkinOf('char_4040_rockr', { chess_rockr: 'rockr@dream' }, list), 'rockr@dream');
    assert.equal(avatarSkinOf('char_4040_rockr', { chess_rockr_g: 'rockr@dream' }, list), 'rockr@dream',
      'a choice stored on the elite record answers for the same operator');
    assert.equal(avatarSkinOf('char_1014_nearl2', { chess_rockr: 'rockr@dream' }, list), null, 'another operator is untouched');
    assert.equal(avatarSkinOf('char_4040_rockr', null, list), null);
    assert.equal(avatarSkinOf(null, { chess_rockr: 'rockr@dream' }, list), null);
    const map = avatarSkinMap({ chess_rockr: 'rockr@dream' }, list);
    assert.deepEqual([...map], [['char_4040_rockr', 'rockr@dream']]);    assert.deepEqual([...avatarSkinMap(null, list)], []);
    assert.deepEqual([...avatarSkinMap({ chess_rockr: '' }, list)], [], 'an empty skin id is not a choice');
  });

  test('the avatar picture is the skin art when the skin has one, else the operator art (never blank)', () => {
    assert.equal(playerAvatarUrl(manifest, { avatar: 'char_4040_rockr', skins: { chess_rockr: 'rockr@dream' } }, list),
      '/a/rockr@dream.png', '迷迭香 with 轻盈一梦 shows that skin');
    assert.equal(playerAvatarUrl(manifest, { avatar: 'char_4040_rockr' }, list), '/a/rockr.png', 'no skin: the operator avatar');
    assert.equal(playerAvatarUrl(manifest, { avatar: 'char_1014_nearl2', skins: { chess_nearl: 'nearl@plain' } }, list),
      '/a/nearl.png', 'a skin without its own avatar art falls back to the operator');
    assert.equal(playerAvatarUrl(manifest, { avatar: null, skins: { chess_rockr: 'rockr@dream' } }, list), null);
    assert.equal(playerAvatarUrl(manifest, null, list), null, 'no avatar picked: the seat glyph');
    assert.equal(playerAvatarUrl(null, { avatar: 'char_4040_rockr' }, list), null, 'no manifest: nothing to draw');
  });
});
