// tools/traffic-measure.mjs — measure the per-player traffic of a real match with the test harness:
// one match (1 human seat under AI 托管 + 7 AI seats, like a full 8-seat coop room), counting the bytes the
// human client receives per frame type and per virtual second, plus what the sim clients upload (b.progress /
// b.result, client-combat mode). `node tools/traffic-measure.mjs [client|server]` — client = production
// client-side combat (b.start once per battle), server = the legacy server-run snapshot streaming (b.snap 20 Hz).
import { makeMatch } from '../test/match/harness.js';

const mode = process.argv[2] === 'server' ? 'server' : 'client';

const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 7, seed: 9301, captureFrames: true, clientCombat: mode === 'client' });
h.autoHumans(); // AI 托管: the human seat plays itself (like a player who never touches the UI)

const down = { bytes: 0, msgs: 0, perType: {}, sizes: {}, samples: [] };
const up = { bytes: 0, msgs: 0, perType: {} };
let virtualSecs = 0;
let lastSec = -1;
const tick = () => {
  const s = Math.floor(h.m.gt ?? h.m.time ?? 0);
  if (s !== lastSec) { lastSec = s; virtualSecs = s; down.samples.push(down.bytes); }
};
const iv = setInterval(tick, 50);
iv.unref?.();

h.onSend.push((pid, msg) => {
  if (pid !== 'p_0') return;
  const b = Buffer.byteLength(JSON.stringify(msg));
  down.bytes += b; down.msgs++;
  down.perType[msg.t] = (down.perType[msg.t] || 0) + b;
  if (!down.sizes[msg.t]) down.sizes[msg.t] = { n: 0, total: 0, max: 0 };
  const st = down.sizes[msg.t]; st.n++; st.total += b; st.max = Math.max(st.max, b);
});
h.onBroadcast.push((msg) => {
  const b = Buffer.byteLength(JSON.stringify(msg));
  down.bytes += b; down.msgs++;
  down.perType[`${msg.t}(bc)`] = (down.perType[`${msg.t}(bc)`] || 0) + b;
  if (!down.sizes[`${msg.t}(bc)`]) down.sizes[`${msg.t}(bc)`] = { n: 0, total: 0, max: 0 };
  const st = down.sizes[`${msg.t}(bc)`]; st.n++; st.total += b; st.max = Math.max(st.max, b);
});

// the client's uploads in client-combat mode: count the b.* intents the sim clients would send
const origHandle = h.m.handle.bind(h.m);
h.m.handle = (pid, msg) => {
  if (mode === 'client' && msg && typeof msg.t === 'string' && msg.t.startsWith('b.')) {
    const b = Buffer.byteLength(JSON.stringify(msg));
    up.bytes += b; up.msgs++;
    up.perType[msg.t] = (up.perType[msg.t] || 0) + b;
  }
  return origHandle(pid, msg);
};

h.m.start();
h.runToEnd({ maxSteps: 6e6 });
clearInterval(iv);
tick();
const secs = Math.max(1, down.samples.length);
const peak = Math.max(...down.samples.map((v, i) => (i ? v - down.samples[i - 1] : 0)));
console.log(JSON.stringify({
  mode,
  rounds: h.m.round,
  virtualSecs,
  downTotalKB: +(down.bytes / 1024).toFixed(1),
  downMsgs: down.msgs,
  avgDownKBps: +(down.bytes / 1024 / secs).toFixed(2),
  peakDownKBps: +(peak / 1024).toFixed(1),
  avgFrameBytes: Math.round(down.bytes / Math.max(1, down.msgs)),
  upTotalKB: +(up.bytes / 1024).toFixed(1),
  upMsgs: up.msgs,
  upPerTypeKB: Object.fromEntries(Object.entries(up.perType).map(([k, v]) => [k, +(v / 1024).toFixed(1)])),
  perTypeKB: Object.fromEntries(Object.entries(down.perType).map(([k, v]) => [k, +(v / 1024).toFixed(1)])),
  frameSizes: Object.fromEntries(Object.entries(down.sizes).map(([k, st]) => [k, { n: st.n, avg: Math.round(st.total / st.n), max: st.max }])),
}, null, 1));
h.m.dispose();
process.exit(0);
