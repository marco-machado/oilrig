import {
  CLOSE,
  type ChatEntry,
  type ClientMessage,
  type ClockConfig,
  DEFAULT_EPOCH,
  DIMS,
  DroneCrew,
  type DronePose,
  type DronePoseMsg,
  type DroneScheduleOptions,
  DroneScheduler,
  type DroneState,
  ElevatorController,
  type ElevatorState,
  type Layout,
  NET,
  type PlayerInfo,
  type Rapier,
  type PlayerPose,
  type ServerMessage,
  type StaticWorld,
  type Vec3,
  WeatherControl,
  type WeatherMode,
  WeatherModel,
  type WeatherState,
  adjustClock,
  altitudeOf,
  buildStaticWorld,
  droneClearPath,
  dronePose,
  elevatorPanels,
  elevatorPose,
  gameTime,
  gateOpen,
  getLayout,
  inCar,
  inDoorway,
  padOccupied,
  seatPosition,
} from '@oilrig/shared';
import { MessageBudget } from './budget.ts';
import { Emitter } from './emitter.ts';
import type { WorldStore } from './store.ts';
import { MovementValidator, type Track } from './validation.ts';

export interface Connection {
  send(m: ServerMessage): void;
  sendRaw(json: string): void;
  close(code?: number, reason?: string): void;
}

/** A signed-in person, as their session cookie says. */
export interface Identity {
  userId: string;
  name: string;
}

interface Player {
  info: PlayerInfo;
  conn: Connection | null;
  /** Server-simulated AI avatar (always present until it leaves). */
  agent: boolean;
  pose: { p: Vec3; /** Server receive time, ms. */ t: number; yaw: number; pitch: number; speed: number; grounded: boolean };
  /** Movement bookkeeping for the validator. It belongs to `pose.p`: once the server puts the
   * person somewhere else, the next pose starts a new one from there. */
  track: Track | null;
  lastSeen: number;
  chatTimes: number[];
  poseTimes: number[];
  /** How many of each kind of message this person may still send. */
  budget: MessageBudget;
}

export interface WorldEvents {
  join: [PlayerInfo];
  leave: [PlayerInfo];
  chat: [ChatEntry];
  door: [{ id: string; open: boolean; by: string }];
  weather: [WeatherState];
  drone: [DroneState];
  elevator: [ElevatorState];
  displaced: [Player];
}

export type DoorResult = { ok: true; changed: boolean } | { ok: false; code: 'unknown-door' | 'too-far'; message: string };
export type ChatResult = { ok: true; entry: ChatEntry } | { ok: false; code: 'rate-limited' | 'empty'; message: string };

export interface WorldOptions {
  rapier: Rapier;
  clock: ClockConfig;
  weatherSeed: number;
  store: WorldStore;
  drone?: Partial<DroneScheduleOptions>;
}

// The drone lives here: it starts parked on the pad, stays a good while, and flies off on
// a short trip now and then.
const DRONE_DEFAULTS: DroneScheduleOptions = { intervalMs: 3 * 60_000, stayMs: 12 * 60_000, firstArrivalMs: 60_000, seed: 7, startLanded: true };

/** The pilot's stream may run this much over the drone's top speed (clock drift, late poses)… */
const DRONE_SPEED_SLACK = 1.2;
/** …and cover this many metres at once, for poses that arrive in a burst after a stall. */
const DRONE_REACH_CAP = DIMS.DRONE.maxSpeed * 0.5;

export function colorFor(name: string) {
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
export class World extends Emitter<WorldEvents> {
  readonly layout: Layout;
  readonly sw: StaticWorld;
  clock: ClockConfig;
  private readonly weather: WeatherControl;
  private readonly validator: MovementValidator;
  private readonly players = new Map<string, Player>();
  private readonly doors = new Map<string, boolean>();
  private readonly chat: ChatEntry[];
  private readonly opts: WorldOptions;
  private timers: Array<ReturnType<typeof setInterval>> = [];
  /** The configured clock, which a saved clock only replaces if it was set from the same one. */
  private readonly clockBase: string;
  private lastWeather: WeatherState;
  readonly drone: DroneScheduler;
  readonly crew = new DroneCrew();
  /** The pilot's latest drone pose (server receive time), while someone flies it. */
  private droneLive: (DronePoseMsg & { t: number; reach: number }) | null = null;
  readonly elevator: ElevatorController;

  private constructor(sw: StaticWorld, opts: WorldOptions, doors: Record<string, boolean>) {
    super();
    this.opts = opts;
    this.layout = getLayout();
    this.sw = sw;
    this.clockBase = JSON.stringify(opts.clock);
    const saved = opts.store.savedClock();
    this.clock = saved && saved.base === this.clockBase ? saved.clock : opts.clock;
    this.weather = new WeatherControl(new WeatherModel(opts.weatherSeed, DEFAULT_EPOCH));
    const mode = opts.store.savedWeatherMode();
    if (mode) this.weather.restore(mode);
    this.validator = new MovementValidator(sw);
    for (const d of this.layout.doors) this.doors.set(d.id, doors[d.id] ?? false);
    this.chat = opts.store.recentChat(NET.chatHistory);
    this.lastWeather = this.currentWeather();
    this.drone = new DroneScheduler({ ...DRONE_DEFAULTS, ...opts.drone }, Date.now(), {
      padOccupied: () => padOccupied(this.online().filter((p) => this.crew.seatOf(p.info.id) === null).map((p) => p.pose.p)),
      windDirection: () => this.lastWeather.windDirection,
      aboard: () => this.crew.count > 0,
      clearPath: (a, b) => droneClearPath(this.sw, a, b),
      onChange: (next, prev) => this.onDroneChange(next, prev),
    });
    if (this.drone.state.phase === 'landed') this.sw.setDrone({ position: this.drone.state.from, yaw: this.drone.state.padYaw });
    this.elevator = new ElevatorController(Date.now(), {
      doorwayOccupied: (stop) => this.online().some((p) => inDoorway(stop, p.pose.p)),
      onChange: (s) => {
        this.broadcast({ type: 'elevator', state: s });
        this.emit('elevator', s);
      },
    });
    this.syncElevator(Date.now());
  }

  /** `opts.rapier` must already be initialised. */
  static create(opts: WorldOptions) {
    const layout = getLayout();
    const known = new Set(layout.doors.map((d) => d.id));
    const doors = Object.fromEntries(Object.entries(opts.store.doors()).filter(([id]) => known.has(id)));
    return new World(buildStaticWorld(opts.rapier, layout, doors), opts, doors);
  }

  currentWeather(now = Date.now()): WeatherState {
    return this.weather.sample(gameTime(this.clock, now), now);
  }

  get weatherMode(): WeatherMode {
    return this.weather.mode;
  }

  /** Runs the clocks: snapshots, weather, the drone and the elevator. Safe to call twice. */
  start() {
    if (this.timers.length) return;
    // The drone and the elevator have been idle; their schedules pick up from now.
    const now = Date.now();
    // Nor did anyone's place expire while the clocks were stopped.
    this.expirePlayers(now);
    this.drone.update(now);
    this.elevator.update(now);
    this.syncElevator(now);
    this.timers.push(setInterval(() => this.broadcastSnapshot(), 1000 / NET.snapshotHz));
    this.timers.push(
      setInterval(() => {
        const w = this.currentWeather();
        if (w.kind !== this.lastWeather.kind) this.emit('weather', w);
        this.lastWeather = w;
        this.broadcast({ type: 'env', t: Date.now(), weather: w });
      }, 1000 / NET.envHz),
    );
    this.timers.push(setInterval(() => this.expirePlayers(), 30_000));
    this.timers.push(
      setInterval(() => {
        const now = Date.now();
        this.drone.update(now);
        this.elevator.update(now);
        this.syncElevator(now);
      }, 100),
    );
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  get running() {
    return this.timers.length > 0;
  }

  get playerCount() {
    return this.online().length;
  }

  /** Everyone currently aboard: connected people and AI agents. */
  online(): Player[] {
    return [...this.players.values()].filter((p) => p.conn || p.agent);
  }

  get humanCount() {
    return [...this.players.values()].filter((p) => p.conn).length;
  }

  get agentCount() {
    return [...this.players.values()].filter((p) => p.agent).length;
  }

  player(id: string) {
    return this.players.get(id);
  }

  private broadcast(m: ServerMessage, except?: Player) {
    const json = JSON.stringify(m);
    for (const p of this.online()) if (p !== except) p.conn?.sendRaw(json);
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
    const live = this.drone.state.phase === 'piloted' ? this.droneLive : null;
    const drone = live ? { p: live.p, v: live.v, yaw: live.yaw, pitch: live.pitch, roll: live.roll, rotor: live.rotor, grounded: live.grounded } : undefined;
    this.broadcast({ type: 'snapshot', t: Date.now(), players, ...(drone ? { drone } : {}) });
  }

  /** People who left keep their place for a while, so a reconnect puts them back where they were. */
  private expirePlayers(now = Date.now()) {
    for (const p of this.players.values()) {
      if (!p.agent && !p.conn && now - p.lastSeen > NET.sessionTtlMs) this.players.delete(p.info.id);
    }
  }

  /** Handles one validated message from a connection. Returns the player once joined (`who`
   * is needed until then). */
  handle(conn: Connection, current: Player | null, m: ClientMessage, who?: Identity): Player | null {
    if (!current) {
      if (m.type !== 'hello' || !who) {
        conn.send({ type: 'error', code: 'not-joined', message: 'Send hello first.' });
        return null;
      }
      return this.join(conn, who);
    }
    const now = Date.now();
    current.lastSeen = now;
    if (!current.budget.take(m.type, now)) {
      // Sent faster than anyone does by hand: dropped, so one person cannot flood the others.
      if (current.budget.shouldTell(m.type, now)) conn.send({ type: 'error', code: 'rate-limited', message: 'Slow down a little.' });
      return current;
    }
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
        if (this.crew.seatOf(current.info.id) === null) this.respawn(current, 'respawn');
        return current;
      case 'board':
        this.board(current, now);
        return current;
      case 'unboard':
        this.unboard(current, m.p as Vec3, now);
        return current;
      case 'drone':
        this.onDronePose(current, m, now);
        return current;
      case 'elevator':
        this.callElevator(current, m.stop, now);
        return current;
      case 'setenv':
        this.setEnv(current, m, now);
        return current;
    }
  }

  /** Brings someone aboard, or back to where they were. The newest connection wins: an older
   * one for the same person is told why and closed. */
  join(conn: Connection, who: Identity): Player {
    const name = sanitize(who.name).slice(0, NET.nameMaxLength) || 'Guest';
    const now = Date.now();
    let player = this.players.get(who.userId);
    const wasHere = !!player?.conn;
    if (player) {
      const old = player.conn;
      if (old && old !== conn) {
        old.send({ type: 'error', code: 'replaced', message: 'Signed in elsewhere.' });
        old.close(CLOSE.replaced, 'signed in elsewhere');
      }
      player.conn = conn;
      player.info.name = name;
      player.lastSeen = now;
      player.pose.t = now;
    } else {
      const spawn = this.layout.spawn;
      player = {
        info: { id: who.userId, name, color: colorFor(who.userId), kind: 'human' },
        conn,
        agent: false,
        pose: { p: spawn.position, t: now, yaw: spawn.yaw, pitch: 0, speed: 0, grounded: true },
        track: null,
        lastSeen: now,
        chatTimes: [],
        poseTimes: [],
        budget: new MessageBudget(),
      };
      this.players.set(player.info.id, player);
    }
    conn.send({
      type: 'welcome',
      you: player.info,
      pose: { p: player.pose.p, yaw: player.pose.yaw },
      serverTime: now,
      clock: this.clock,
      weather: this.currentWeather(now),
      players: this.online().map((p) => p.info),
      doors: Object.fromEntries(this.doors),
      chat: this.chat,
      drone: this.drone.state,
      crew: [...this.crew.seats],
      elevator: this.elevator.state,
      weatherMode: this.weather.mode,
    });
    if (!wasHere) {
      this.broadcast({ type: 'join', player: player.info }, player);
      this.emit('join', player.info);
    }
    return player;
  }

  /** A connection closed. Only the player's current connection counts: one it replaced does not. */
  disconnect(player: Player, conn: Connection) {
    if (!player.conn || player.conn !== conn) return;
    if (this.crew.seatOf(player.info.id) !== null) {
      // Whoever drops out of the drone comes back on the terrace.
      this.leaveDrone(player, Date.now());
      player.pose = { ...player.pose, p: this.layout.spawn.position, t: Date.now() };
    }
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
    const seat = this.crew.seatOf(p.info.id);
    if (seat !== null) {
      // Seated: the body goes where the drone goes; the server places it in its seat.
      const at = seatPosition(this.dronePose(now), seat);
      p.pose = { p: [at[0], at[1] - 0.45, at[2]], t: now, yaw: m.yaw, pitch: Math.max(-1.6, Math.min(1.6, m.pitch)), speed: 0, grounded: true };
      return;
    }
    // A track only continues from the position it accepted: after a respawn, a seat in the
    // drone or any other move by the server, movement is judged afresh from where they stand.
    if (p.track?.p !== p.pose.p) p.track = this.validator.start(p.pose.p, now);
    const verdict = this.validator.check(p.track, m.p as Vec3, now);
    if (!verdict.ok) {
      // In mid-air with nothing to explain it: back to the last ground, not to the air.
      if (verdict.reason === 'unsupported') p.pose = { ...p.pose, p: verdict.to, speed: 0, grounded: true };
      p.pose.t = now;
      p.conn?.send({ type: 'correct', seq: m.seq, p: p.pose.p, reason: verdict.reason });
      return;
    }
    p.pose = {
      p: p.track.p,
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
    const r = this.say(p, raw, now);
    if (!r.ok && r.code === 'rate-limited') p.conn?.send({ type: 'error', code: r.code, message: r.message });
  }

  /** Posts a chat line from a player or agent. */
  say(p: Player, raw: string, now = Date.now()): ChatResult {
    p.chatTimes = p.chatTimes.filter((t) => now - t < 10_000);
    if (p.chatTimes.length >= 5) return { ok: false, code: 'rate-limited', message: 'Slow down a little.' };
    const text = sanitize(raw).slice(0, NET.chatMaxLength);
    if (!text) return { ok: false, code: 'empty', message: 'Nothing to say.' };
    p.chatTimes.push(now);
    const entry: ChatEntry = { id: crypto.randomUUID(), from: p.info.id, name: p.info.name, text, t: now };
    this.chat.push(entry);
    while (this.chat.length > NET.chatHistory) this.chat.shift();
    this.opts.store.addChat(entry);
    this.broadcast({ type: 'chat', entry });
    this.emit('chat', entry);
    return { ok: true, entry };
  }

  recentChat(): readonly ChatEntry[] {
    return this.chat;
  }

  private onDoor(p: Player, id: string, open: boolean) {
    const r = this.setDoor(p, id, open);
    if (!r.ok && r.code === 'too-far') p.conn?.send({ type: 'error', code: r.code, message: r.message });
  }

  /** Opens or closes a door for someone standing within reach of it. */
  setDoor(p: Player, id: string, open: boolean): DoorResult {
    const def = this.layout.doors.find((d) => d.id === id);
    if (!def) return { ok: false, code: 'unknown-door', message: `No door called ${id}.` };
    const [x, y, z] = p.pose.p;
    const dist = Math.hypot(def.center[0] - x, def.center[1] - (y + 1), def.center[2] - z);
    if (dist > 4) return { ok: false, code: 'too-far', message: 'Too far from the door.' };
    if (this.doors.get(id) === open) return { ok: true, changed: false };
    this.doors.set(id, open);
    this.sw.setDoorOpen(id, open);
    this.opts.store.saveDoor(id, open);
    this.broadcast({ type: 'door', id, open, by: p.info.id });
    this.emit('door', { id, open, by: p.info.id });
    return { ok: true, changed: true };
  }

  doorStates(): Record<string, boolean> {
    return Object.fromEntries(this.doors);
  }

  // ---------- AI agents ----------

  /** Brings a server-simulated avatar aboard. Browsers see it as a normal avatar. */
  addAgent(name: string, position: Vec3, yaw: number): Player {
    const clean = sanitize(name).slice(0, NET.nameMaxLength) || 'Agent';
    const now = Date.now();
    const player: Player = {
      info: { id: crypto.randomUUID().slice(0, 8), name: clean, color: colorFor(`agent:${clean}`), kind: 'agent' },
      conn: null,
      agent: true,
      pose: { p: position, t: now, yaw, pitch: 0, speed: 0, grounded: true },
      track: null,
      lastSeen: now,
      chatTimes: [],
      poseTimes: [],
      budget: new MessageBudget(),
    };
    this.players.set(player.info.id, player);
    this.broadcast({ type: 'join', player: player.info });
    this.emit('join', player.info);
    return player;
  }

  removeAgent(p: Player) {
    if (!p.agent || !this.players.has(p.info.id)) return;
    this.players.delete(p.info.id);
    this.broadcast({ type: 'leave', id: p.info.id });
    this.emit('leave', p.info);
  }

  /** Server-authoritative pose update for an agent (its motor already obeys the colliders). */
  setAgentPose(p: Player, pos: Vec3, yaw: number, pitch: number, speed: number, grounded: boolean) {
    p.pose = { p: pos, t: Date.now(), yaw, pitch, speed, grounded };
  }

  // ---------- drone ----------

  private droneMessage(): ServerMessage {
    return { type: 'drone', state: this.drone.state, crew: [...this.crew.seats] };
  }

  private onDroneChange(next: DroneState, prev: DroneState) {
    if (next.phase === 'landed') {
      const atPad = Math.hypot(next.from[0] - DIMS.DRONE.pad[0], next.from[2] - DIMS.DRONE.pad[2]) < 1 && Math.abs(next.from[1] - DIMS.DRONE.pad[1]) < 0.5;
      if (prev.phase === 'descend' && atPad) this.clearPadFootprint();
      this.sw.setDrone({ position: next.from, yaw: next.padYaw });
    } else if (prev.phase === 'landed') {
      this.sw.setDrone(null);
    }
    if (next.phase !== 'piloted') this.droneLive = null;
    this.broadcast(this.droneMessage());
    this.emit('drone', next);
  }

  /** The drone as everyone should see it now: the pilot's stream while flown, else the schedule. */
  dronePose(now = Date.now()): DronePose {
    const live = this.drone.state.phase === 'piloted' ? this.droneLive : null;
    if (live) return { visible: true, position: live.p as Vec3, velocity: live.v as Vec3, yaw: live.yaw, pitch: live.pitch, roll: live.roll, rotor: live.rotor, altitude: altitudeOf(live.p as Vec3) };
    return dronePose(this.drone.state, now);
  }

  get droneGrounded() {
    const s = this.drone.state;
    if (s.phase === 'landed') return true;
    return s.phase === 'piloted' && (this.droneLive?.grounded ?? true);
  }

  private board(p: Player, now: number) {
    const s = this.drone.state;
    const fail = (message: string) => p.conn?.send({ type: 'error', code: 'cannot-board', message });
    if (s.phase !== 'landed' && s.phase !== 'piloted') return fail('The drone is not here.');
    if (!this.droneGrounded) return fail('The drone is in the air.');
    const d = this.dronePose(now);
    const [x, y, z] = p.pose.p;
    if (Math.hypot(x - d.position[0], z - d.position[2]) > 6 || Math.abs(y - d.position[1]) > 2.5) return fail('Too far from the drone.');
    const seat = this.crew.board(p.info.id);
    if (seat === null) return fail('The drone is full.');
    if (seat === 0 && s.phase === 'landed') {
      this.drone.takeControl(now);
      this.droneLive = { p: s.from, v: [0, 0, 0], yaw: s.padYaw, pitch: 0, roll: 0, rotor: 0.4, grounded: true, t: now, reach: DRONE_REACH_CAP };
    }
    this.broadcast(this.droneMessage());
  }

  private unboard(p: Player, at: Vec3, now: number) {
    if (this.crew.seatOf(p.info.id) === null) return;
    const fail = (message: string) => p.conn?.send({ type: 'error', code: 'cannot-unboard', message });
    if (!this.droneGrounded) return fail('Land first.');
    const d = this.dronePose(now);
    const near = Math.hypot(at[0] - d.position[0], at[2] - d.position[2]) < 8 && Math.abs(at[1] - d.position[1]) < 3;
    const spot = near && this.validator.standable(at) ? at : null;
    this.leaveDrone(p, now);
    const out = spot ?? this.layout.spawn.position;
    p.pose = { ...p.pose, p: out, t: now, speed: 0, grounded: true };
    if (!spot) p.conn?.send({ type: 'correct', seq: -1, p: out, reason: 'unboard' });
  }

  /** Frees the seat; a pilot leaving parks the drone where it stands, or sends it home if airborne. */
  private leaveDrone(p: Player, now: number) {
    const seat = this.crew.leave(p.info.id);
    if (seat === null) return;
    if (seat === 0 && this.drone.state.phase === 'piloted') {
      const live = this.droneLive;
      const pose = this.dronePose(now);
      // Airborne, it flies itself back to the pad with any passengers still aboard.
      this.drone.release(now, pose.position, pose.yaw, live?.grounded ?? true);
    }
    this.broadcast(this.droneMessage());
  }

  private onDronePose(p: Player, m: Extract<ClientMessage, { type: 'drone' }>, now: number) {
    if (this.crew.pilot !== p.info.id || this.drone.state.phase !== 'piloted') return;
    if (m.p[1] < -1 || m.p[1] > DIMS.DRONE.maxAltitude + 20) return;
    const prev = this.droneLive;
    let reach = DRONE_REACH_CAP;
    let at = m.p as Vec3;
    if (prev) {
      // A pilot cannot outfly the drone. The distance allowed fills with time, not with
      // messages. A pose beyond it (a speed hack, or poses that arrive late after a stall)
      // moves the drone as far towards it as the allowance goes: at more than top speed, so
      // an honest pilot's drone catches up with the stream instead of being left behind.
      const dt = Math.min(Math.max((now - prev.t) / 1000, 0), 1);
      reach = Math.min(DRONE_REACH_CAP, prev.reach + DIMS.DRONE.maxSpeed * DRONE_SPEED_SLACK * dt);
      const d = Math.hypot(m.p[0] - prev.p[0], m.p[1] - prev.p[1], m.p[2] - prev.p[2]);
      if (d > reach) {
        const k = reach / d;
        at = [prev.p[0] + (m.p[0] - prev.p[0]) * k, prev.p[1] + (m.p[1] - prev.p[1]) * k, prev.p[2] + (m.p[2] - prev.p[2]) * k];
        reach = 0;
      } else reach -= d;
    }
    // Short of where the pilot says it is, it is still on its way there: not landed.
    this.droneLive = { ...m, p: at, grounded: m.grounded && at === m.p, t: now, reach };
    this.drone.track(at, m.yaw);
  }

  /** At touchdown, anyone who walked under the descending drone is moved clear. */
  private clearPadFootprint() {
    const [px, py, pz] = DIMS.DRONE.pad;
    const r = DIMS.DRONE.clearRadius;
    for (const p of this.online()) {
      if (this.crew.seatOf(p.info.id) !== null) continue;
      const [x, y, z] = p.pose.p;
      const d = Math.hypot(x - px, z - pz);
      if (d >= r || y < py - 0.6 || y > py + 4) continue;
      const k = d > 0.1 ? 1 / d : 1;
      const out: Vec3 = [px + (d > 0.1 ? (x - px) * k : -1) * (r + 0.5), py, pz + (d > 0.1 ? (z - pz) * k : 0) * (r + 0.5)];
      p.pose = { ...p.pose, p: out, t: Date.now() };
      p.conn?.send({ type: 'correct', seq: -1, p: out, reason: 'drone' });
      this.emit('displaced', p);
    }
  }

  // ---------- elevator ----------

  /** Server colliders follow the car; gates count as open a moment either side of the client's view. */
  private syncElevator(now: number) {
    const s = this.elevator.state;
    const pose = elevatorPose(s, now);
    const open = DIMS.ELEVATOR.stops.map((_, i) => [now - 300, now, now + 300].some((t) => gateOpen(elevatorPose(s, t), i)));
    this.sw.setElevator(pose.y, open);
  }

  private callElevator(p: Player, stop: number, now: number) {
    const pose = elevatorPose(this.elevator.state, now);
    const reach = inCar(pose.y, p.pose.p) || elevatorPanels().some((q) => Math.hypot(q.position[0] - p.pose.p[0], q.position[1] - (p.pose.p[1] + 1.2), q.position[2] - p.pose.p[2]) < 4);
    if (!reach) {
      p.conn?.send({ type: 'error', code: 'too-far', message: 'Too far from the elevator buttons.' });
      return;
    }
    this.elevator.call(stop, now);
  }

  // ---------- environment ----------

  /** Someone changed the time of day, the speed of the day or the weather, for everyone. */
  private setEnv(p: Player, m: Extract<ClientMessage, { type: 'setenv' }>, now: number) {
    if (p.agent) return;
    this.changeEnvironment({ hour: m.hour, rate: m.rate, weather: m.weather as WeatherMode | undefined }, now, p.info.name);
  }

  /** Same as a player's controls, for tests and tools. */
  setEnvironment(o: { hour?: number; rate?: number; weather?: WeatherMode }, now = Date.now()) {
    this.changeEnvironment(o, now);
  }

  private changeEnvironment(o: { hour?: number; rate?: number; weather?: WeatherMode }, now: number, by?: string) {
    if (o.hour !== undefined || o.rate !== undefined) {
      this.clock = adjustClock(this.clock, now, { hour: o.hour, rate: o.rate });
      this.opts.store.saveClock(this.clock, this.clockBase);
    }
    if (o.weather) {
      this.weather.set(o.weather, gameTime(this.clock, now), now);
      this.opts.store.saveWeatherMode(o.weather);
    }
    this.broadcast({ type: 'envctl', clock: this.clock, weatherMode: this.weather.mode, ...(by ? { by } : {}) });
  }

  // ---------- accounts ----------

  /** Someone changed their display name: everyone aboard sees it at once. */
  rename(userId: string, name: string) {
    const p = this.players.get(userId);
    if (!p || p.agent) return;
    p.info.name = sanitize(name).slice(0, NET.nameMaxLength) || p.info.name;
    if (p.conn) this.broadcast({ type: 'player', player: p.info });
  }

  doorState(id: string) {
    return this.doors.get(id);
  }
}

export type { Player };
