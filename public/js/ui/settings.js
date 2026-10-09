// Player settings (BGM/SFX/voice volume, the voice dub 语音语言, mute, damage numbers, render quality, the shortcut keys): a
// tiny observable store persisted in localStorage (`sp.pref.settings`), applied to the audio manager on every change, plus
// the settings modal and the 快捷键 section that rebinds the in-match shortcuts (the key map:
// ui/gameLogic/shortcuts.js; the community request
// 「快捷键可不可以自己设置」, the owner's decision of 2026-10-07). The
// lobby and the room open it from a 设置 button next to 玩法说明 (SettingsButton, GitHub #238); the title screen and the
// match have their own gear.

import { useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button, Icon, MicroLabel } from './components.js';
import { GIcon } from './gameComponents.js';
import { createStore, useStore, loadPref, savePref, store } from '../store.js';
// The fork's own wrapper below (line 30) defaults 语音语言 to 日本語, so upstream's sanitizeSettings arrives aliased.
import { sanitizeSettings as sanitizeBaseSettings, HOTKEY_ACTIONS, DEFAULT_HOTKEYS, hotkeyLabel, rebindHotkey, isDefaultHotkeys, captureHotkey, VOICE_LANGS } from './gameLogic.js';
import { audio } from '../audio.js';
import { openGuide } from './guide.js';
import { detectFeatures } from './device.js';
// The fork's 资源预下载 (the start page's picker, 方案B): the player who chose 边玩边下载 predownloads here.
import { prepareAssets, fetchResourceIndex, saveDownloadPref } from '../preload.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const sanitizeSettings = (raw) => ({ ...sanitizeBaseSettings(raw), voiceLang: raw?.voiceLang === 'cn' ? 'cn' : 'jp' });

/** Settings store: { bgm, sfx, voice, voiceLang, muted, damageNumbers, quality, keys }. */
export const settingsStore = createStore(sanitizeSettings(loadPref('settings', null)));

settingsStore.subscribe((s) => {
  savePref('settings', sanitizeSettings(s));
  audio.setVolumes(s);
  audio.setVoiceLang(s.voiceLang);
});
audio.setVolumes(settingsStore.get());
audio.setVoiceLang(settingsStore.get().voiceLang);

/** @param {Partial<ReturnType<typeof sanitizeSettings>>} patch */
export function updateSettings(patch) {
  settingsStore.set(sanitizeSettings({ ...settingsStore.get(), ...patch }));
}

/** Preact hook: current settings. */
export const useSettings = () => useStore((s) => s, Object.is, settingsStore);

/**
 * The label of the key a rebindable shortcut has right now ('R', 'Space' …) — the HUD's key hints (shop bar, ready /
 * pause, underframe). Read at render: the game screen re-renders when the settings dialog closes.
 * @param {'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready'} action
 */
export const hotkeyLabelOf = (action) => hotkeyLabel(settingsStore.get().keys?.[action]);

function Slider({ label, micro, value, onInput, icon }) {
  const pct = Math.round(value * 100);
  return html`<label class="set-row">
    <span class="set-row__label"><${Icon} name=${icon} />${label}<${MicroLabel}>${micro}<//></span>
    <input class="set-range" type="range" min="0" max="100" step="5" value=${pct} style=${`--pct:${pct}%`}
      onInput=${(e) => onInput(Number(e.currentTarget.value) / 100)} />
    <span class="set-row__val num">${pct}</span>
  </label>`;
}

function Toggle({ label, micro, value, onChange }) {
  return html`<div class="set-row">
    <span class="set-row__label">${label}<${MicroLabel}>${micro}<//></span>
    <button type="button" class=${`set-toggle${value ? ' is-on' : ''}`} role="switch" aria-checked=${value ? 'true' : 'false'}
      onClick=${() => onChange(!value)}><i></i><span>${value ? '开启' : '关闭'}</span></button>
  </div>`;
}

const QUALITY = [['high', '高'], ['medium', '中'], ['low', '低']];
/**
 * 语音语言: each dub named in its own language — the owner's 「中文 / 日本語」 (2026-10-08); VOICE_LANGS order.
 */
const VOICE_LANG_NAMES = { cn: '中文', jp: '日本語' };
/** The rebindable shortcuts' names, by action. */
const HOTKEY_NAMES = { refresh: '刷新商店', freeze: '冻结 / 解冻商店', levelUp: '升级调度中心', retreat: '撤退选中干员',
  sell: '出售选中干员', ready: '准备就绪 / 暂停（独立模拟）' };

/**
 * 快捷键: each shortcut with its key. Click its key (or Enter / Space on it) and press the new one: Esc cancels (the
 * dialog stays open), Tab leaves, a key held with Ctrl / Alt / ⌘ or one the interface keeps is refused, a key another
 * shortcut has is swapped — the line under the list says what happened; 恢复默认 restores the keys of 0.1.4. Esc
 * (cancel / close) is fixed. On a touch-only device the section says the keys need a keyboard and folds the list (an
 * attached keyboard still uses it).
 * @param {{ keys: Record<string, string>, touchUi: boolean }} props
 */
function HotkeySection({ keys, touchUi }) {
  const [waiting, setWaiting] = useState(null); // the action waiting for its new key
  const [note, setNote] = useState(null);       // { text, warn }: the result line
  // a layout effect: the key listener is on as soon as the key shows that it waits (an Esc right after the click must
  // end the wait, never reach the dialog's own Esc)
  useLayoutEffect(() => {
    if (!waiting) return undefined;
    const name = (HOTKEY_NAMES[waiting]);
    const onKey = (e) => {
      const r = captureHotkey(e);
      if (r.kind === 'leave') { setWaiting(null); return; } // Tab: the focus moves on
      // ahead of the dialog's own Esc (it stays open), a focused button's Enter / Space and every other key handler
      e.preventDefault();
      e.stopImmediatePropagation();
      if (r.kind === 'ignore') return;
      const cur = settingsStore.get().keys;
      if (r.kind === 'cancel') {
        setWaiting(null);
        setNote({ text: `已取消，「${(name) ?? ''}」仍是 ${(hotkeyLabel(cur[waiting])) ?? ''}` });
        return;
      }
      if (r.kind === 'refuse') {
        setNote({ warn: true, text: r.reason === 'modifier' ? '快捷键只能是单个按键，不能搭配 Ctrl、Alt 或 ⌘'
          : `${(r.name) ?? ''} 不能设为快捷键：Esc、Tab、Enter、方向键和功能键留给界面使用` });
        return;
      }
      const res = rebindHotkey(cur, waiting, r.code);
      updateSettings({ keys: res.keys });
      setWaiting(null);
      const key = hotkeyLabel(r.code);
      setNote({ text: res.swapped
        ? `「${(name) ?? ''}」已改为 ${(key) ?? ''}；「${(HOTKEY_NAMES[res.swapped]) ?? ''}」原来用 ${(key) ?? ''}，已换成 ${(hotkeyLabel(res.keys[res.swapped])) ?? ''}`
        : `「${(name) ?? ''}」已改为 ${(key) ?? ''}` });
    };
    // a press anywhere but the waiting key ends the wait (another key starts its own)
    const onDown = (e) => { if (!(e.target instanceof Element) || !e.target.closest('.set-key.is-waiting')) setWaiting(null); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
  }, [waiting]);

  const status = note ? note.text : waiting ? `请按下「${(HOTKEY_NAMES[waiting]) ?? ''}」的新按键（Esc 取消）` : '';
  const list = html`<ul class="set-keys__list">
    ${HOTKEY_ACTIONS.map((a) => {
      const on = waiting === a;
      const label = hotkeyLabel(keys?.[a]);
      return html`<li key=${a} class="set-keys__row">
        <span class="set-keys__name">${(HOTKEY_NAMES[a])}</span>
        <button type="button" class=${cx('set-key', on && 'is-waiting')} data-action=${a} aria-pressed=${on ? 'true' : 'false'}
          aria-label=${`更改「${(HOTKEY_NAMES[a]) ?? ''}」的快捷键（当前：${(label) ?? ''}）`}
          onClick=${() => { setNote(null); setWaiting((w) => (w === a ? null : a)); }}>
          ${on ? html`<span class="set-key__wait">${'按下新按键…'}</span>` : html`<kbd>${label}</kbd>`}
        </button>
      </li>`;
    })}
    <li class="set-keys__row is-fixed">
      <span class="set-keys__name">${'取消 / 关闭'}</span>
      <span class="set-key is-fixed"><kbd>Esc</kbd><small>${'不可更改'}</small></span>
    </li>
  </ul>
  <p class=${cx('set-keys__note', note?.warn && 'is-warn')} role="status" aria-live="polite">${status}</p>`;
  return html`<section class="set-keys" aria-labelledby="set-keys-title">
    <div class="set-keys__head">
      <span class="set-row__label" id="set-keys-title">${'快捷键'}<${MicroLabel}>HOTKEYS<//></span>
      <${Button} variant="ghost" size="sm" icon="refresh" class="set-keys__reset" disabled=${isDefaultHotkeys(keys)}
        onClick=${() => { setWaiting(null); updateSettings({ keys: DEFAULT_HOTKEYS }); setNote({ text: '已恢复默认快捷键' }); }}>${'恢复默认'}<//>
    </div>
    ${touchUi ? html`<p class="set-hint">${'快捷键需要实体键盘；触屏设备连接键盘后可用'}</p>
      <details class="set-keys__more"><summary>${'查看 / 更改快捷键'}</summary>${list}</details>` : list}
  </section>`;
}

/**
 * 资源预下载 (方案B — the start page's picker runs once, this is the player's way to change later): the same complete
 * verified download as the boot page, with a progress line; success saves the 预下载 choice so the next boot verifies
 * instead of asking. Hidden on a packaged client (the assets ship with the installation).
 */
function PredownloadSection() {
  const [state, setState] = useState('idle'); // idle | busy | done | failed
  const [pct, setPct] = useState(0);
  const [note, setNote] = useState('');
  if (globalThis.__SP_PACKAGED) return null;
  const startPredl = async () => {
    if (state === 'busy') return;
    setState('busy'); setPct(0); setNote('');
    try {
      const index = await fetchResourceIndex();
      await prepareAssets({ index, onProgress: (p) => {
        if (Number.isFinite(p?.total) && p.total > 0) setPct(Math.round(((p.done || 0) / p.total) * 100));
      } });
      saveDownloadPref('predownload');
      setState('done');
      setNote('预下载完成，下次启动直接校验进入');
    } catch (err) {
      setState('failed');
      setNote(`预下载未完成：${String(err?.message || err).slice(0, 160)}`);
    }
  };
  const label = state === 'busy' ? `下载中 ${pct}%` : state === 'failed' ? '重试预下载' : '预下载全部资源';
  return html`<div class="set-row">
    <span class="set-row__label">${'资源预下载'}<${MicroLabel}>RESOURCES<//></span>
    <${Button} variant="secondary" size="sm" disabled=${state === 'busy'} onClick=${startPredl} class="set-predl__btn">${label}<//>
  </div>
  <p class="set-hint" role="status" aria-live="polite">${state === 'busy' ? '正在下载并校验全部资源，可以继续游玩…'
    : note || '边玩边下载时资源在用到时下载；预下载后启动无需等待'}</p>`;
}

/**
 * Settings modal.
 * @param {{ open: boolean, onClose: Function }} props
 */
export function SettingsModal({ open, onClose }) {
  const s = useSettings();
  const [tested, setTested] = useState(false);
  const [touchUi] = useState(() => detectFeatures().coarse && !detectFeatures().fine);
  return html`<${Modal} open=${open} onClose=${onClose} title=${'设置'} micro="SETTINGS" width="7.4rem"
    actions=${html`<${Button} variant="secondary" icon="book" class="set-guide" onClick=${() => openGuide(0)}>${'玩法说明'}<//>
      <${Button} variant="primary" icon="check" onClick=${onClose}>${'完成'}<//>`}>
    <div class="set-list">
      <${Slider} label=${'背景音乐'} micro="BGM" icon="play" value=${s.bgm} onInput=${(v) => updateSettings({ bgm: v })} />
      <${Slider} label=${'干员语音'} micro="VOICE" icon="mic" value=${s.voice} onInput=${(v) => updateSettings({ voice: v })} />
      <div class="set-row">
        <span class="set-row__label">${'语音语言'}<${MicroLabel}>VOICE LANGUAGE<//></span>
        <div class="set-seg" role="radiogroup" aria-label=${'语音语言'} data-testid="voice-lang">
          ${VOICE_LANGS.map((id) => html`<button key=${id} type="button" role="radio" aria-checked=${s.voiceLang === id ? 'true' : 'false'}
            lang=${id === 'jp' ? 'ja' : 'zh'} class=${s.voiceLang === id ? 'is-on' : ''} onClick=${() => updateSettings({ voiceLang: id })}>${VOICE_LANG_NAMES[id]}</button>`)}
        </div>
      </div>
      <${Slider} label=${'音效'} micro="SFX" icon="signal" value=${s.sfx}
        onInput=${(v) => { updateSettings({ sfx: v }); if (!tested) { setTested(true); setTimeout(() => setTested(false), 400); audio.sfx('click'); } }} />
      <${Toggle} label=${'静音'} micro="MUTE" value=${s.muted} onChange=${(v) => updateSettings({ muted: v })} />
      <${Toggle} label=${'显示伤害数字'} micro="DAMAGE NUMBERS" value=${s.damageNumbers} onChange=${(v) => updateSettings({ damageNumbers: v })} />
      <div class="set-row">
        <span class="set-row__label">${'画面质量'}<${MicroLabel}>QUALITY<//></span>
        <div class="set-seg" role="radiogroup">
          ${QUALITY.map(([id, label]) => html`<button key=${id} type="button" role="radio" aria-checked=${s.quality === id ? 'true' : 'false'}
            class=${s.quality === id ? 'is-on' : ''} onClick=${() => updateSettings({ quality: id })}>${(label)}</button>`)}
        </div>
      </div>
      <${HotkeySection} keys=${s.keys} touchUi=${touchUi} />
      <${PredownloadSection} />
      <p class="set-hint">${touchUi ? '触屏操作：点击单位选中（撤退 / 出售）· 长按单位或卡牌查看详情 · 拖动部署后滑动选择朝向' : '右键查看详情'}</p>
    </div>
  <//>`;
}

/**
 * The 设置 button of the lobby and the room (GitHub #238 — before it the settings were reachable only from the title
 * screen and a running match): the twin of the 玩法说明 button (ui/guide.js GuideButton), with the settings modal behind it
 * (mounted only while open). The same modal as the title screen's and the match's: nothing in it is match-only.
 * @param {{ class?: string, size?: 'sm'|'md'|'lg'|'xl', variant?: string, label?: string }} props
 */
export function SettingsButton({ class: cls, size = 'sm', variant = 'ghost', label = '设置' }) {
  const [open, setOpen] = useState(false);
  return html`<${Button} variant=${variant} size=${size} class=${cx('settings-btn', cls)} onClick=${() => setOpen(true)}
      title=${'设置'} aria-label=${'设置'} data-testid="settings-btn"><${GIcon} name="gear" class="btn__icon" />${label}<//>
    ${open ? html`<${SettingsModal} open=${true} onClose=${() => setOpen(false)} />` : null}`;
}
