import {
  type ClientMessage,
  NET,
  PROTOCOL_VERSION,
  ServerMessage,
  type WelcomeMessage,
} from '@ocean-home/shared';

type Msg = ServerMessage;

export interface NetHandlers {
  onWelcome(w: WelcomeMessage): void;
  onMessage(m: Msg): void;
  /** `unreachable`: the socket never opened, i.e. the server is down or not there. */
  onClose(reason: string, willRetry: boolean, unreachable: boolean): void;
}

const SESSION_KEY = 'ocean-home.session';

/** WebSocket connection with clock sync and automatic reconnect (same session). */
export class NetClient {
  private ws: WebSocket | null = null;
  private name = '';
  private password = '';
  private session: string | null = null;
  private offset = 0;
  private offsetSamples = 0;
  private pingTimer = 0;
  private retry = 0;
  private retryTimer = 0;
  private closedByUser = false;
  private welcomed = false;
  connected = false;
  private readonly handlers: NetHandlers;

  constructor(handlers: NetHandlers) {
    this.handlers = handlers;
    try {
      this.session = sessionStorage.getItem(SESSION_KEY);
    } catch {
      this.session = null;
    }
  }

  /** Server clock estimate in ms. */
  serverNow() {
    return Date.now() + this.offset;
  }

  connect(name: string, password: string) {
    this.name = name;
    this.password = password;
    this.closedByUser = false;
    this.open();
  }

  /** Stops connecting (and reconnecting) until the next connect(). */
  disconnect() {
    this.closedByUser = true;
    window.clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
  }

  private open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.welcomed = false;
    ws.addEventListener('open', () => {
      this.send({
        type: 'hello',
        version: PROTOCOL_VERSION,
        name: this.name,
        password: this.password || undefined,
        session: this.session ?? undefined,
      });
    });
    ws.addEventListener('message', (ev) => {
      let data: unknown;
      try {
        data = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const parsed = ServerMessage.safeParse(data);
      if (!parsed.success) return;
      const m = parsed.data;
      if (m.type === 'welcome') {
        this.connected = true;
        this.welcomed = true;
        this.retry = 0;
        this.session = m.session;
        try {
          sessionStorage.setItem(SESSION_KEY, m.session);
        } catch {
          // storage unavailable
        }
        this.offset = m.serverTime - Date.now();
        this.offsetSamples = 1;
        this.startPing();
        this.handlers.onWelcome(m);
        return;
      }
      if (m.type === 'pong') {
        const now = Date.now();
        const est = m.serverTime + (now - m.t) / 2 - now;
        this.offsetSamples = Math.min(this.offsetSamples + 1, 10);
        this.offset += (est - this.offset) / this.offsetSamples;
        return;
      }
      if (m.type === 'error' && !this.welcomed) {
        this.closedByUser = true;
        this.handlers.onClose(m.message, false, false);
        ws.close();
        return;
      }
      this.handlers.onMessage(m);
    });
    ws.addEventListener('close', () => {
      const wasConnected = this.connected;
      this.connected = false;
      window.clearInterval(this.pingTimer);
      if (this.closedByUser) return;
      const willRetry = wasConnected || this.retry < 3;
      this.handlers.onClose(wasConnected ? 'Connection lost. Reconnecting…' : 'Could not reach the server.', willRetry, !wasConnected);
      if (willRetry) {
        this.retry += 1;
        this.retryTimer = window.setTimeout(() => this.open(), Math.min(8000, 500 * 2 ** this.retry));
      }
    });
  }

  private startPing() {
    window.clearInterval(this.pingTimer);
    const ping = () => this.send({ type: 'ping', t: Date.now() });
    ping();
    this.pingTimer = window.setInterval(ping, 2000);
  }

  send(m: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  get poseIntervalMs() {
    return 1000 / NET.poseHz;
  }
}

export interface ServerHealth {
  online: boolean;
  players?: number;
}

/** Asks the server's /healthz whether it is up, and how many people are aboard. */
export async function probeServer(timeoutMs = 3000): Promise<ServerHealth> {
  try {
    const res = await fetch('/healthz', { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { online: false };
    const body = (await res.json()) as { players?: number };
    return { online: true, players: body.players };
  } catch {
    return { online: false };
  }
}
