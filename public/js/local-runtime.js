// Run the same lobby, AI and match engine in the packaged client, without a network socket.
export async function createLocalTransport() {
  const [{ Lobby }, { Network, SessionRegistry }] = await Promise.all([
    import('/local-server/lobby.js'), import('/local-server/net.js'),
  ]);
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry });
  const network = new Network({ registry, handler: lobby });
  class LocalSocket {
    constructor() {
      this.readyState = 0;
      this.bufferedAmount = 0;
      this.handlers = new Map();
      this.peer = {
        readyState: 1, bufferedAmount: 0,
        on: (type, fn) => this.handlers.set(type, fn),
        send: (text) => queueMicrotask(() => this.onmessage?.({ data: text })),
        ping: () => this.handlers.get('pong')?.(),
        close: (code = 1000, reason = '') => this.finish(code, reason),
        terminate: () => this.finish(1000, ''),
      };
      queueMicrotask(() => {
        this.readyState = 1;
        network.handleConnection(this.peer);
        this.onopen?.({});
      });
    }
    send(text) {
      const msg = JSON.parse(text);
      if (['room.join', 'room.spectate'].includes(msg.t)) {
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ t: 'error', rid: msg.rid, code: 'OFFLINE', msg: '本地模拟只能与你的 AI 队友一起玩' }) }));
        return;
      }
      queueMicrotask(() => this.handlers.get('message')?.(text, false));
    }
    finish(code, reason) {
      if (this.readyState === 3) return;
      this.readyState = this.peer.readyState = 3;
      this.handlers.get('close')?.();
      this.onclose?.({ code, reason });
    }
    close(code, reason) { this.finish(code, reason); }
  }
  return { WebSocket: LocalSocket, url: 'ws://local-game/ws', dispose() { lobby.shutdown(); network.close(); } };
}
