import { EventEmitter } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  type ChatEntry,
  type ClientMessage,
  type ClockConfig,
  DEFAULT_EPOCH,
  type Layout,
  NET,
  type PlayerInfo,
  type PlayerPose,
  type ServerMessage,
  type StaticWorld,
  type Vec3,
  WeatherModel,
  type WeatherState,
  buildStaticWorld,
  gameTime,
  getLayout,
} from '@ocean-home/shared';
import type { Store } from '../db.ts';
import { type AcceptedPose, MovementValidator } from './validation.ts';

export interface Connection {
  send(m: ServerMessage): void;
  sendRaw(json: string): void;
  close(code?: number, reason?: string): void;
}

interface Player {
  info: PlayerInfo;
  session: string;
  conn: Connection | null;
  pose: AcceptedPose & { yaw: number; pitch: number; speed: number; grounded: boolean };
  lastSeen: number;
  chatTimes: number[];
  poseTimes: number[];
}

export interface WorldEvents {
  join: [PlayerInfo];
  leave: [PlayerInfo];
  chat: [ChatEntry];
  door: [{ id: string; open: boolean; by: string }];
  weather: [WeatherState];
}

export interface WorldOptions {
  clock: ClockConfig;
  weatherSeed: number;
  joinPassword: string | null;
  store: Store;
}

function colorFor(name: string) {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const hue = (h >>> 0) % 360;
  // HSL(hue, 62%, 55%) to hex
  const s = 0.62;
  const l = 0.55;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

const sanitize = (text: string) => text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();

/** Authoritative shared world: players, doors, chat, clock and weather. */
export class World extends EventEmitter<WorldEvents> {
  readonly layout: Layout;
  readonly sw: StaticWorld;
  readonly clock: ClockConfig;
  private readonly weather: WeatherModel;
  private readonly validator: MovementValidator;
  private readonly players = new Map<string, Player>();
  private readonly sessions = new Map<string, Player>();
  private readonly doors = new Map<string, boolean>();
  private readonly chat: ChatEntry[];
  private readonly opts: WorldOptions;
  private timers: NodeJS.Timeout[] = [];
  private lastWeather: WeatherState;

  private constructor(sw: StaticWorld, opts: WorldOptions) {
    super();
    this.opts = opts;
    this.layout = getLayout();
    this.sw = sw;
    this.clock = opts.clock;
    this.weather = new WeatherModel(opts.weatherSeed, DEFAULT_EPOCH);
    this.validator = new MovementValidator(sw);
    for (const d of this.layout.doors) this.doors.set(d.id, false);
    this.chat = opts.store.recentChat(NET.chatHistory);
    this.lastWeather = this.currentWeather();
  }

  static async create(opts: WorldOptions) {
    await RAPIER.init();
    return new World(buildStaticWorld(RAPIER, getLayout()), opts);
  }

  currentWeather(now = Date.now()): WeatherState {
    return this.weather.sample(gameTime(this.clock, now));
  }

  start() {
    this.timers.push(setInterval(() => this.broadcastSnapshot(), 1000 / NET.snapshotHz));
    this.timers.push(
      setInterval(() => {
        const w = this.currentWeather();
        if (w.kind !== this.lastWeather.kind) this.emit('weather', w);
        this.lastWeather = w;
        this.broadcast({ type: 'env', t: Date.now(), weather: w });
      }, 1000 / NET.envHz),
    );
    this.timers.push(setInterval(() => this.expireSessions(), 30_000));
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  get playerCount() {
    return [...this.players.values()].filter((p) => p.conn).length;
  }

  private online(): Player[] {
    return [...this.players.values()].filter((p) => p.conn);
  }

  private broadcast(m: ServerMessage, except?: Player) {
    const json = JSON.stringify(m);
    for (const p of this.online()) if (p !== except) p.conn!.sendRaw(json);
  }

  private broadcastSnapshot() {
    const list = this.online();
    if (list.length === 0) return;
    const players: PlayerPose[] = list.map((p) => ({
      id: p.info.id,
      p: p.pose.p,
      yaw: p.pose.yaw,
      pitch: p.pose.pitch,
      speed: p.pose.speed,
      grounded: p.pose.grounded,
    }));
    this.broadcast({ type: 'snapshot', t: Date.now(), players });
  }

  private expireSessions() {
    const now = Date.now();
    for (const [token, p] of this.sessions) {
      if (!p.conn && now - p.lastSeen > NET.sessionTtlMs) {
        this.sessions.delete(token);
        this.players.delete(p.info.id);
      }
    }
  }

  /** Handles one validated message from a connection. Returns the player once joined. */
  handle(conn: Connection, current: Player | null, m: ClientMessage): Player | null {
    if (!current) {
      if (m.type !== 'hello') {
        conn.send({ type: 'error', code: 'not-joined', message: 'Send hello first.' });
        return null;
      }
      return this.join(conn, m);
    }
    const now = Date.now();
    current.lastSeen = now;
    switch (m.type) {
      case 'hello':
        conn.send({ type: 'error', code: 'already-joined', message: 'Already joined.' });
        return current;
      case 'ping':
        conn.send({ type: 'pong', t: m.t, serverTime: now });
        return current;
      case 'pose':
        this.onPose(current, m, now);
        return current;
      case 'chat':
        this.onChat(current, m.text, now);
        return current;
      case 'door':
        this.onDoor(current, m.id, m.open);
        return current;
      case 'respawn':
        this.respawn(current, 'respawn');
        return current;
    }
  }

  private join(conn: Connection, m: Extract<ClientMessage, { type: 'hello' }>): Player | null {
    if (this.opts.joinPassword && m.password !== this.opts.joinPassword) {
      conn.send({ type: 'error', code: 'bad-password', message: 'Wrong password.' });
      return null;
    }
    const name = sanitize(m.name).slice(0, NET.nameMaxLength) || 'Guest';
    const now = Date.now();
    let player = m.session ? this.sessions.get(m.session) : undefined;
    if (player && player.conn) player = undefined; // session already in use: start fresh
    if (player) {
      player.conn = conn;
      player.info.name = name;
      player.lastSeen = now;
      player.pose.t = now;
    } else {
      const spawn = this.layout.spawn;
      const color = this.opts.store.profileColor(name) ?? colorFor(name);
      player = {
        info: { id: randomUUID().slice(0, 8), name, color },
        session: randomBytes(18).toString('base64url'),
        conn,
        pose: { p: spawn.position, t: now, yaw: spawn.yaw, pitch: 0, speed: 0, grounded: true },
        lastSeen: now,
        chatTimes: [],
        poseTimes: [],
      };
      this.players.set(player.info.id, player);
      this.sessions.set(player.session, player);
    }
    this.opts.store.touchProfile(name, player.info.color);
    conn.send({
      type: 'welcome',
      you: player.info,
      session: player.session,
      pose: { p: player.pose.p, yaw: player.pose.yaw },
      serverTime: now,
      clock: this.clock,
      weather: this.currentWeather(now),
      players: this.online().map((p) => p.info),
      doors: Object.fromEntries(this.doors),
      chat: this.chat,
    });
    this.broadcast({ type: 'join', player: player.info }, player);
    this.emit('join', player.info);
    return player;
  }

  disconnect(player: Player) {
    if (!player.conn) return;
    player.conn = null;
    player.lastSeen = Date.now();
    this.broadcast({ type: 'leave', id: player.info.id });
    this.emit('leave', player.info);
  }

  private onPose(p: Player, m: Extract<ClientMessage, { type: 'pose' }>, now: number) {
    // Rate limit: drop poses beyond ~2x the expected rate.
    p.poseTimes = p.poseTimes.filter((t) => now - t < 1000);
    if (p.poseTimes.length >= NET.poseHz * 2) return;
    p.poseTimes.push(now);
    const verdict = this.validator.check(p.pose, m.p, now);
    if (!verdict.ok) {
      p.pose.t = now;
      p.conn?.send({ type: 'correct', seq: m.seq, p: p.pose.p, reason: verdict.reason });
      return;
    }
    p.pose = {
      p: m.p as Vec3,
      t: now,
      yaw: m.yaw,
      pitch: Math.max(-1.6, Math.min(1.6, m.pitch)),
      speed: Math.min(Math.hypot(m.v[0], m.v[2]), 20),
      grounded: m.grounded,
    };
    if (m.p[1] < -2) this.respawn(p, 'fell');
  }

  private respawn(p: Player, reason: string) {
    const r = this.layout.respawn;
    p.pose = { ...p.pose, p: r.position, t: Date.now(), yaw: r.yaw, speed: 0 };
    p.conn?.send({ type: 'correct', seq: -1, p: r.position, reason });
  }

  private onChat(p: Player, raw: string, now: number) {
    p.chatTimes = p.chatTimes.filter((t) => now - t < 10_000);
    if (p.chatTimes.length >= 5) {
      p.conn?.send({ type: 'error', code: 'rate-limited', message: 'Slow down a little.' });
      return;
    }
    const text = sanitize(raw).slice(0, NET.chatMaxLength);
    if (!text) return;
    p.chatTimes.push(now);
    const entry: ChatEntry = { id: randomUUID(), from: p.info.id, name: p.info.name, text, t: now };
    this.chat.push(entry);
    while (this.chat.length > NET.chatHistory) this.chat.shift();
    this.opts.store.addChat(entry);
    this.broadcast({ type: 'chat', entry });
    this.emit('chat', entry);
  }

  private onDoor(p: Player, id: string, open: boolean) {
    const def = this.layout.doors.find((d) => d.id === id);
    if (!def) return;
    const [x, y, z] = p.pose.p;
    const dist = Math.hypot(def.center[0] - x, def.center[1] - (y + 1), def.center[2] - z);
    if (dist > 4) {
      p.conn?.send({ type: 'error', code: 'too-far', message: 'Too far from the door.' });
      return;
    }
    if (this.doors.get(id) === open) return;
    this.doors.set(id, open);
    this.sw.setDoorOpen(id, open);
    this.broadcast({ type: 'door', id, open, by: p.info.id });
    this.emit('door', { id, open, by: p.info.id });
  }

  doorState(id: string) {
    return this.doors.get(id);
  }
}

export type { Player };
