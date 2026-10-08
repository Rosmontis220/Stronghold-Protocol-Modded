// Prepare a browser-compatible copy of the production rules, preserving its import graph.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public/local-server');
await fs.mkdir(out, { recursive: true });
for (const name of ['match', 'sim']) await fs.cp(path.join(root, 'server', name), path.join(out, name), { recursive: true });
for (const name of ['lobby.js', 'net.js']) {
  let text = await fs.readFile(path.join(root, 'server', name), 'utf8');
  text = text.replace(/from 'node:crypto'/g, "from './platform.js'").replace(/from 'node:net'/g, "from './platform.js'");
  text = text.replace(/setImmediate\(/g, 'setTimeout(');
  await fs.writeFile(path.join(out, name), text);
}
await fs.writeFile(path.join(out, 'platform.js'), `export function randomBytes(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return { toString: () => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('') };
}
export function randomInt(max) {
  const limit = Math.floor(4294967296 / max) * max;
  let n; do { n = crypto.getRandomValues(new Uint32Array(1))[0]; } while (n >= limit);
  return n % max;
}
export function isIP(value) { return value?.includes(':') ? 6 : /^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(value || '') ? 4 : 0; }
`);
const original = await fs.readFile(path.join(root, 'server/data.js'), 'utf8');
const names = ['config', 'chess', 'bonds', 'garrisons', 'items', 'bands', 'effects', 'choices', 'enemies', 'factions', 'waves', 'stages', 'bosses', 'tokens', 'assets', 'skins'];
await fs.writeFile(path.join(out, 'data.js'), `const singleton = Object.fromEntries(await Promise.all(${JSON.stringify(names)}.map(async name => {
 const response = await fetch('/data/' + name + '.json');
 if (!response.ok) throw new Error('Missing local game data: ' + name);
 return [name, await response.json()];
})));
export const getData = () => singleton;
export function resetData() {}
` + original.slice(original.indexOf('export const INDEXED_FILES')));
console.log('Complete local lobby, AI, match and combat runtime prepared.');
