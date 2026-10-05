import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.RESOURCE_BASE || 'https://wsxy.rosmontis220.top';
const OUT = path.join(ROOT, 'public');
const manifest = await (await fetch(`${BASE}/resource-manifest.json`, { cache: 'no-store' })).json();
if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('invalid production manifest');
let done = 0;
for (const entry of manifest.files) {
  const target = path.join(OUT, entry.url.replace(/^\//, '').replaceAll('/', path.sep));
  await fs.mkdir(path.dirname(target), { recursive: true });
  let valid = false;
  try {
    const bytes = await fs.readFile(target);
    valid = bytes.length === entry.bytes && crypto.createHash('sha256').update(bytes).digest('hex') === entry.sha256;
  } catch { /* fetch below */ }
  if (!valid) {
    const response = await fetch(`${BASE}${entry.runtime || entry.url}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${entry.url}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== entry.bytes || hash !== entry.sha256) throw new Error(`${entry.url}: integrity mismatch`);
    await fs.writeFile(target, bytes);
  }
  done++;
  if (done % 50 === 0 || done === manifest.files.length) console.log(`${done}/${manifest.files.length}`);
}
console.log(`production assets ready: ${manifest.files.length} files`);
