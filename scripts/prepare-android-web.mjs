// Prepare the complete offline web payload for Capacitor Android.
// Requires the fetched asset tree in public/assets and public/fonts; a shell APK is intentionally refused.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import './prepare-local-runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'mobile-web');
const requiredDirs = ['public/assets', 'public/fonts', 'public/vendor'];
const copy = async (src, dst) => { await fs.mkdir(path.dirname(dst), { recursive: true }); await fs.cp(src, dst, { recursive: true, force: true }); };
const walk = async (dir, prefix = '', out = []) => {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(abs, rel, out); else if (entry.isFile()) out.push([abs, rel]);
  }
  return out;
};
const digest = async (file) => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');

for (const rel of requiredDirs) {
  const abs = path.join(ROOT, rel);
  try { await fs.access(abs); } catch { throw new Error(`缺少完整素材目录 ${rel}，拒绝生成不完整 APK`); }
}
await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
await copy(path.join(ROOT, 'public'), OUT);
await copy(path.join(ROOT, 'data'), path.join(OUT, 'data'));
await copy(path.join(ROOT, 'shared'), path.join(OUT, 'shared'));
// Client-side combat imports /sim/* and /data.js, which the Node server normally serves dynamically.
// Capacitor serves only this static payload, so ship the browser modules and the same data bridge here.
await copy(path.join(ROOT, 'server', 'sim'), path.join(OUT, 'sim'));
await fs.writeFile(path.join(OUT, 'data.js'), `import { getSimData } from './sim/simdata.js';
export function getData() { return getSimData() || {}; }
export function resetData() {}
`);
const mobileIndex = path.join(OUT, 'index.html');
let html = await fs.readFile(mobileIndex, 'utf8');
html = html.replace('</head>', `<script>globalThis.__SP_PACKAGED=true;globalThis.__SP_DESKTOP_SERVER='https://wsxy.rosmontis220.top';</script></head>`);
await fs.writeFile(mobileIndex, html);
const files = [];
for (const root of ['public/assets', 'public/fonts', 'data']) {
  for (const [abs, rel] of await walk(path.join(ROOT, root), root.replaceAll('\\', '/'))) {
    const url = `/${rel.replace(/^public\//, '')}`;
    files.push({ url, bytes: (await fs.stat(abs)).size, sha256: await digest(abs) });
  }
}
files.sort((a, b) => a.url.localeCompare(b.url));
const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
const hash = crypto.createHash('sha256').update(files.map((f) => `${f.url}\0${f.bytes}\0${f.sha256}`).join('\n')).digest('hex');
await fs.writeFile(path.join(OUT, 'resource-manifest.json'), JSON.stringify({ version: 2, hash, bytes, files }, null, 2));
console.log(`Android offline payload ready: ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB`);
