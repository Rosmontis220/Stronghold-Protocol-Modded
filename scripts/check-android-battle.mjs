// Probe the actual installed Capacitor WebView through an ADB-forwarded DevTools page socket.
import WebSocket from 'ws';
const targets = await (await fetch('http://127.0.0.1:9223/json')).json();
const target = targets.find((t) => t.type === 'page');
if (!target) throw new Error('No Android WebView page target');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
const expression = process.argv[2] || ` (async () => {
  try {
    const { loadBrowserSim } = await import('/js/battle/runner.js');
    const { spec, ds } = await loadBrowserSim();
    const battle = spec.createBattleFromSpec(spec.buildBattleSpec({
      seed: 1, stageId: 'act1autochess_m03', timeLimit: 30,
      players: [{ playerId: 'probe', units: [] }],
      spawns: [{ time: 0, enemyKey: 'enemy_1000_gopro_2', count: 3, interval: 0.1 }],
      routes: [{ motion: 'WALK', start: [12, 10], end: [9, 2], checkpoints: [] }],
    }), ds);
    for (let tick = 0; tick < 15; tick++) battle.step();
    return { loaded: true, time: battle.time, total: battle.total, enemies: battle.enemies.length,
      alive: battle.aliveEnemies().length };
  } catch (error) { return { loaded: false, error: String(error), stack: error.stack }; }
})()`;
const result = await new Promise((resolve, reject) => {
  socket.on('message', (raw) => { const msg = JSON.parse(raw); if (msg.id === 1) resolve(msg); });
  socket.once('error', reject);
  socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
});
console.log(JSON.stringify(result, null, 2));
socket.close();
