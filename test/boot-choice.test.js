// The start page's resource choice (public/js/boot.js + index.html + public/sw.js ACTIVATE_INDEX + the settings
// dialog's 资源预下载, 方案B): the player picks 预下载全部资源 / 跳过，边玩边下载 once, the choice is remembered
// (sp.pref.download) and the page stops asking; a complete local snapshot always skips the page and verifies. The
// streamed mode registers the verified index with the cache service WITHOUT downloading — the service worker's fetch
// handler downloads + verifies every requested asset on demand while the game plays. These tests: the panel's markup
// and wiring, the remembered-choice branches, the service-worker activation, and the settings dialog's entry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('the start page has the choice panel with the two tiles; boot.js wires both behind a complete snapshot', () => {
  const page = read('public/index.html');
  assert.match(page, /<div id="boot-choice" class="boot__dl boot__choice" hidden>/, 'the panel starts hidden');
  assert.match(page, /id="boot-choice-predl"[^>]*>预下载全部资源（推荐）</, 'the 预下载 tile');
  assert.match(page, /id="boot-choice-stream"[^>]*>跳过，边玩边下载</, 'the 边玩边下载 tile');
  const mobile = read('mobile-web/index.html');
  assert.match(mobile, /id="boot-choice"/, 'the Android shell mirrors the panel');

  const boot = read('public/js/boot.js');
  const flow = boot.slice(boot.indexOf('async function bootFromLocalOrDownload('));
  const snapshotCheck = flow.indexOf('detectRequiredLocalSnapshot(index)');
  const prefBranch = flow.indexOf("readDownloadPref()");
  const offer = flow.indexOf('showChoice(index)');
  assert.ok(snapshotCheck > 0 && offer > snapshotCheck, 'the choice shows only after the snapshot inspection');
  assert.ok(prefBranch > snapshotCheck && offer > prefBranch, 'a saved choice skips the page');
  assert.match(flow, /pref === 'predownload' \|\| pref === 'stream'/, 'the saved choice branches');
  assert.match(boot, /choicePredl\.onclick = \(\) => choose\('predownload'\)/, 'the 预下载 tile picks predownload');
  assert.match(boot, /choiceStream\.onclick = \(\) => choose\('stream'\)/, 'the 边玩边下载 tile picks stream');
  assert.match(boot, /function choose\(mode\)/, 'both tiles share one choose() that remembers');
});

test('the streamed mode registers the index with the cache service without downloading; the mode fails loudly', () => {
  const boot = read('public/js/boot.js');
  assert.match(boot, /await activateStreamIndex\(index\)/, 'the streamed path registers the index');
  assert.match(boot, /type: 'STREAMED'/, 'the preload result marks the streamed mode');
  const stream = boot.slice(boot.indexOf('async function beginStream('), boot.indexOf('async function bootFromLocalOrDownload('));
  assert.ok(!stream.includes('prepareAssets'), 'the streamed path downloads nothing');
  assert.match(stream, /saveDownloadPref\(null\)/, 'a failed mode asks again next time');
  assert.match(stream, /effects\.finish\(\)/, 'the boot effects stop once the shell runs');

  const preload = read('public/js/preload.js');
  assert.match(preload, /export async function activateStreamIndex\(index\)/, 'preload.js exports the activation');
  assert.match(preload, /type: 'ACTIVATE_INDEX', index/, 'the activation message carries the index');
  assert.match(preload, /data\.type === 'INDEX_ACTIVE'/, 'the activation resolves on INDEX_ACTIVE');
  assert.match(preload, /if \(!\('serviceWorker' in navigator\)/, 'the activation needs the cache service');
  assert.match(stream, /saveDownloadPref\(null\)/, 'the retry clears the saved mode and asks again');

  const sw = read('public/sw.js');
  assert.match(sw, /async function activateIndex\(index, port, clientId\)/, 'the worker validates and activates');
  assert.match(sw, /data\.type === 'ACTIVATE_INDEX'/, 'the message handler is wired');
  assert.match(sw, /await writeMeta\(ACTIVE_KEY, index\)/, 'the activation stores the active index');
  assert.match(sw, /await writeMeta\(clientKey\(clientId\), index\)/, 'the activation stores the client index');
  const handler = sw.slice(sw.indexOf('if (data.type === \'ACTIVATE_INDEX\')'));
  assert.match(handler, /event\.waitUntil/, 'the activation runs inside waitUntil');
});

test('the settings dialog has 资源预下载 (方案B): the same download with progress, hidden on a packaged client', () => {
  const settings = read('public/js/ui/settings.js');
  const section = settings.slice(settings.indexOf('function PredownloadSection('), settings.indexOf('export function SettingsModal('));
  assert.match(section, /fetchResourceIndex\(\)/, 'it fetches the index itself');
  assert.match(section, /prepareAssets\(\{ index/, 'it runs the same verified download');
  assert.match(section, /下载中 \$\{pct\}%/, 'the button shows the progress');
  assert.match(section, /saveDownloadPref\('predownload'\)/, 'success saves the choice');
  assert.match(section, /__SP_PACKAGED\) return null/, 'a packaged client hides the section');
  assert.match(settings, /<\$\{PredownloadSection\} \/>/, 'the modal renders the section');
  assert.match(settings, /import \{ prepareAssets, fetchResourceIndex, saveDownloadPref \} from '\.\.\/preload\.js';/, 'the section reuses preload.js');
});

test('the choice styles exist; the saved-choice key has one source', () => {
  const css = read('public/css/theme.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.boot__choice-btns \{[^}]*display: flex/, 'the two tiles row');
  assert.match(css, /\.boot__choice-btn \{[^}]*cursor: pointer/, 'the tile');
  assert.match(css, /\.boot__choice-btn--primary \{/, 'the primary tile');
  assert.match(css, /\.boot \[hidden\] \{ display: none !important; \}/, 'the panel hides');
  const boot = read('public/js/boot.js');
  assert.match(boot, /import \{ prepareAssets, inspectCachedSnapshot, fetchResourceIndex, activateStreamIndex, readDownloadPref, saveDownloadPref \} from '\.\/preload\.js';/, 'boot.js reads the key from preload.js');
  assert.ok(!boot.includes("'sp.pref.download'"), 'the key is not re-declared in boot.js');
  const preload = read('public/js/preload.js');
  assert.match(preload, /export const DOWNLOAD_PREF_KEY = 'sp\.pref\.download';/, 'one key source');
});
