import WebSocket from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '@ocean-home/shared';

/** A minimal browser-like player: a WebSocket with a typed inbox and waiters. */
export class WsClient {
  readonly ws: WebSocket;
  readonly inbox: ServerMessage[] = [];
  private waiters: Array<{ pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];

  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      this.inbox.push(m);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(m)) {
          w.resolve(m);
          return false;
        }
        return true;
      });
    });
  }

  opened() {
    return new Promise<void>((res, rej) => {
      if (this.ws.readyState === WebSocket.OPEN) res();
      this.ws.once('open', () => res());
      this.ws.once('error', rej);
    });
  }

  send(m: unknown) {
    this.ws.send(typeof m === 'string' ? m : JSON.stringify(m));
  }

  next<T extends ServerMessage['type']>(type: T, pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true, timeoutMs = 4000) {
    const found = this.inbox.find((m) => m.type === type && pred(m as Extract<ServerMessage, { type: T }>));
    if (found) {
      this.inbox.splice(this.inbox.indexOf(found), 1);
      return Promise.resolve(found as Extract<ServerMessage, { type: T }>);
    }
    return new Promise<Extract<ServerMessage, { type: T }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
      this.waiters.push({
        pred: (m) => m.type === type && pred(m as Extract<ServerMessage, { type: T }>),
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { type: T }>);
        },
      });
    });
  }

  async join(name: string, session?: string) {
    await this.opened();
    this.send({ type: 'hello', version: PROTOCOL_VERSION, name, session });
    return this.next('welcome');
  }

  close() {
    this.ws.close();
  }
}
