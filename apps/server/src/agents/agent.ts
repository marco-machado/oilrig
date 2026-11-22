import {
  CharacterMotor,
  type ChatEntry,
  type DoorDef,
  type MoveInput,
  PLAYER,
  type Vec3,
} from '@oilrig/shared';
import type { Player, World } from '../world/world.ts';
import type { NavigationMesh } from './navmesh.ts';

// One AI avatar, simulated on the server with the same character motor players use.
// Movement commands become tasks; the motor steps them at a fixed rate.

export const AGENT_DT = 1 / 60;
const TURN_RATE = (300 * Math.PI) / 180; // rad/s
const CORNER_REACHED = 0.35;
const FINAL_REACHED = 0.3;
const STUCK_MS = 1500;
const MAX_REPLANS = 3;
const DOOR_REACH = 2.6;

export type TaskStatus =
  | 'arrived'
  | 'nearest'
  | 'blocked'
  | 'unreachable'
  | 'done'
  | 'interrupted'
  | 'timeout';

export interface TaskResult {
  task: 'move_to' | 'walk' | 'turn';
  status: TaskStatus;
  /** Human-readable summary for language models. */
  message: string;
  position: Vec3;
  heading: number;
  /** Distance travelled during the task, metres. */
  travelled: number;
  /** Doors opened on the way. */
  doorsOpened: string[];
}

interface TaskBase {
  started: number;
  travelled: number;
  doorsOpened: string[];
  resolve: (r: TaskResult) => void;
  done: Promise<TaskResult>;
}

interface MoveTask extends TaskBase {
  kind: 'move_to';
  target: Vec3;
  label: string;
  run: boolean;
  path: Vec3[];
  idx: number;
  complete: boolean;
  best: number;
  bestAt: number;
  replans: number;
}

interface WalkTask extends TaskBase {
  kind: 'walk';
  forward: number;
  right: number;
  run: boolean;
  /** Remaining distance (m) or time (s), whichever was asked. */
  distance?: number;
  seconds?: number;
  yaw: number;
  lastPos: Vec3;
  stillFor: number;
}

interface TurnTask extends TaskBase {
  kind: 'turn';
  yaw: number;
}

type Task = MoveTask | WalkTask | TurnTask;

/** Compass heading (degrees clockwise from north) of a layout yaw. */
export function headingOf(yaw: number) {
  const d = (-yaw * 180) / Math.PI;
  return ((d % 360) + 360) % 360;
}

export function yawOfHeading(deg: number) {
  return (-deg * Math.PI) / 180;
}

function wrapAngle(a: number) {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function deferred(): { resolve: (r: TaskResult) => void; done: Promise<TaskResult> } {
  let resolve!: (r: TaskResult) => void;
  const done = new Promise<TaskResult>((r) => {
    resolve = r;
  });
  return { resolve, done };
}

/** Where a door panel lies in the XZ plane: centre, unit normal and half-width along it. */
function doorPlane(d: DoorDef) {
  const thinX = d.size[0] < d.size[2];
  return {
    cx: d.center[0],
    cz: d.center[2],
    nx: thinX ? 1 : 0,
    nz: thinX ? 0 : 1,
    half: (thinX ? d.size[2] : d.size[0]) / 2,
  };
}

export class Agent {
  readonly player: Player;
  readonly keyId: string;
  readonly motor: CharacterMotor;
  readonly created = Date.now();
  lastActivity = Date.now();
  yaw: number;
  pitch = 0;
  private task: Task | null = null;
  /** Simulated time (ms) advanced by step(), so stuck detection is independent of wall-clock. */
  private clock = 0;
  private lastResult: TaskResult | null = null;
  /** Chat lines heard since the agent joined (newest last). */
  readonly inbox: ChatEntry[] = [];
  private readCursor = 0;
  private readonly world: World;
  private readonly nav: NavigationMesh;

  constructor(world: World, nav: NavigationMesh, player: Player, keyId: string) {
    this.world = world;
    this.nav = nav;
    this.player = player;
    this.keyId = keyId;
    this.yaw = player.pose.yaw;
    this.motor = new CharacterMotor(world.sw, player.pose.p, world.layout.zones);
    for (let i = 0; i < 20; i++) this.motor.step(this.idle(), AGENT_DT);
    this.sync();
  }

  get id() {
    return this.player.info.id;
  }

  get name() {
    return this.player.info.name;
  }

  get position(): Vec3 {
    return this.motor.state.position;
  }

  get heading() {
    return headingOf(this.yaw);
  }

  get busy() {
    return this.task !== null;
  }

  get currentTask() {
    return this.task?.kind ?? null;
  }

  get previousResult() {
    return this.lastResult;
  }

  /** Remaining path corners of the current move, for status reports. */
  get route(): Vec3[] {
    return this.task?.kind === 'move_to' ? this.task.path.slice(this.task.idx) : [];
  }

  touch() {
    this.lastActivity = Date.now();
  }

  hear(e: ChatEntry) {
    this.inbox.push(e);
    if (this.inbox.length > 200) {
      const drop = this.inbox.length - 200;
      this.inbox.splice(0, drop);
      this.readCursor = Math.max(0, this.readCursor - drop);
    }
  }

  /** Messages not yet read (or all since `since`, if given). */
  readMessages(opts: { since?: number; limit?: number } = {}): ChatEntry[] {
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
    let list: ChatEntry[];
    if (opts.since !== undefined) {
      list = this.inbox.filter((e) => e.t > opts.since!);
    } else {
      list = this.inbox.slice(this.readCursor);
      this.readCursor = this.inbox.length;
    }
    return list.slice(-limit);
  }

  private idle(): MoveInput {
    return { forward: 0, right: 0, run: false, jump: false, yaw: this.yaw };
  }

  private result(t: Task, status: TaskStatus, message: string): TaskResult {
    const [x, y, z] = this.position;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return { task: t.kind, status, message, position: [r2(x), r2(y), r2(z)], heading: Math.round(this.heading), travelled: Math.round(t.travelled * 10) / 10, doorsOpened: t.doorsOpened };
  }

  private finish(status: TaskStatus, message: string) {
    const t = this.task;
    if (!t) return;
    this.task = null;
    const r = this.result(t, status, message);
    this.lastResult = r;
    t.resolve(r);
  }

  /** Cancels whatever the agent is doing. */
  stop(reason = 'Stopped.') {
    this.finish('interrupted', reason);
  }

  private begin<T extends Task>(t: Omit<T, keyof TaskBase>): Promise<TaskResult> {
    this.stop('Interrupted by a new command.');
    const d = deferred();
    this.task = { ...(t as object), started: Date.now(), travelled: 0, doorsOpened: [], ...d } as unknown as Task;
    return d.done;
  }

  moveTo(target: Vec3, label: string, run = false): Promise<TaskResult> {
    const path = this.nav.path(this.position, target);
    if (!path) {
      const d = deferred();
      const r: TaskResult = { task: 'move_to', status: 'unreachable', message: `There is no walkable route to ${label}.`, position: this.position, heading: Math.round(this.heading), travelled: 0, doorsOpened: [] };
      this.lastResult = r;
      d.resolve(r);
      return d.done;
    }
    return this.begin<MoveTask>({
      kind: 'move_to',
      target,
      label,
      run,
      path: path.points,
      idx: path.points.length > 1 ? 1 : 0,
      complete: path.complete,
      best: Infinity,
      bestAt: this.clock,
      replans: 0,
    });
  }

  walk(o: { forward: number; right: number; distance?: number; seconds?: number; run?: boolean }): Promise<TaskResult> {
    return this.begin<WalkTask>({
      kind: 'walk',
      forward: o.forward,
      right: o.right,
      run: !!o.run,
      distance: o.distance,
      seconds: o.seconds,
      yaw: this.yaw,
      lastPos: this.position,
      stillFor: 0,
    });
  }

  turnTo(yaw: number): Promise<TaskResult> {
    return this.begin<TurnTask>({ kind: 'turn', yaw });
  }

  teleport(p: Vec3) {
    this.stop('Moved by the world.');
    this.motor.teleport(p);
    this.sync();
  }

  private turnToward(target: number, dt: number) {
    const d = wrapAngle(target - this.yaw);
    const step = TURN_RATE * dt;
    this.yaw = wrapAngle(this.yaw + Math.max(-step, Math.min(step, d)));
    return Math.abs(d);
  }

  /** Opens a closed door that the next stretch of the route passes through. */
  private openDoorsAhead(t: MoveTask) {
    const [x, , z] = this.position;
    const next = t.path[t.idx] ?? t.path[t.path.length - 1];
    const after = t.path[t.idx + 1] ?? next;
    for (const d of this.world.layout.doors) {
      if (this.world.sw.isDoorOpen(d.id)) continue;
      const pl = doorPlane(d);
      if (Math.hypot(pl.cx - x, pl.cz - z) > DOOR_REACH + pl.half) continue;
      const crosses = (a: Vec3, b: Vec3) => {
        const sa = (a[0] - pl.cx) * pl.nx + (a[2] - pl.cz) * pl.nz;
        const sb = (b[0] - pl.cx) * pl.nx + (b[2] - pl.cz) * pl.nz;
        if (sa * sb > 0) return false;
        const u = sa / (sa - sb || 1e-9);
        const px = a[0] + (b[0] - a[0]) * u;
        const pz = a[2] + (b[2] - a[2]) * u;
        const along = Math.abs((px - pl.cx) * pl.nz + (pz - pl.cz) * pl.nx);
        return along < pl.half + 0.3;
      };
      if (crosses(this.position, next) || crosses(next, after)) {
        const r = this.world.setDoor(this.player, d.id, true);
        if (r.ok && r.changed) t.doorsOpened.push(d.id);
      }
    }
  }

  step(dt: number) {
    this.clock += dt * 1000;
    const t = this.task;
    const before = this.position;
    let input = this.idle();
    if (t?.kind === 'turn') {
      if (this.turnToward(t.yaw, dt) < 1e-3) {
        this.yaw = t.yaw;
        this.finish('done', `Now facing ${Math.round(this.heading)}°.`);
      }
      input = this.idle();
    } else if (t?.kind === 'walk') {
      input = { forward: t.forward, right: t.right, run: t.run, jump: false, yaw: t.yaw };
    } else if (t?.kind === 'move_to') {
      input = this.steer(t, dt);
    }
    this.motor.step(input, dt);
    const after = this.position;
    const moved = Math.hypot(after[0] - before[0], after[2] - before[2]);
    if (t && this.task === t) {
      t.travelled += moved;
      if (t.kind === 'walk') this.progressWalk(t, moved, dt);
    }
    if (after[1] < 0.5) {
      // Fell into the sea: back to the boat landing, like a person would be.
      this.teleport(this.world.layout.respawn.position);
    }
    this.sync();
  }

  private progressWalk(t: WalkTask, moved: number, dt: number) {
    if (t.distance !== undefined) {
      t.distance -= moved;
      if (t.distance <= 0.02) return this.finish('done', `Walked ${t.travelled.toFixed(1)} m.`);
    }
    if (t.seconds !== undefined) {
      t.seconds -= dt;
      if (t.seconds <= 0) return this.finish('done', `Walked ${t.travelled.toFixed(1)} m.`);
    }
    t.stillFor = moved < 0.2 * PLAYER.walkSpeed * dt ? t.stillFor + dt : 0;
    if (t.stillFor > 0.75) this.finish('blocked', `Something is in the way after ${t.travelled.toFixed(1)} m.`);
  }

  private steer(t: MoveTask, dt: number): MoveInput {
    const [x, y, z] = this.position;
    let corner = t.path[t.idx];
    const last = t.idx === t.path.length - 1;
    let dist = Math.hypot(corner[0] - x, corner[2] - z);
    // Corners stack up in the stair tower; only count one as reached at its own level.
    const level = Math.abs(corner[1] - y) < (last ? 0.8 : 1.2);
    if (dist < (last ? FINAL_REACHED : CORNER_REACHED) && level) {
      if (last) {
        this.finish(
          t.complete ? 'arrived' : 'nearest',
          t.complete ? `Arrived at ${t.label}.` : `Got as close as possible to ${t.label} (${this.distanceTo(t.target).toFixed(1)} m away).`,
        );
        return this.idle();
      }
      t.idx += 1;
      t.best = Infinity;
      t.bestAt = this.clock;
      corner = t.path[t.idx];
      dist = Math.hypot(corner[0] - x, corner[2] - z);
    }
    this.openDoorsAhead(t);
    const now = this.clock;
    if (dist < t.best - 0.05) {
      t.best = dist;
      t.bestAt = now;
    } else if (now - t.bestAt > STUCK_MS) {
      if (!this.replan(t)) return this.idle();
    }
    const want = Math.atan2(-(corner[0] - x), -(corner[2] - z));
    const err = this.turnToward(want, dt);
    // Slow down for tight corners and near the end so the motor does not overshoot.
    const forward = err > 1.0 ? 0.15 : err > 0.5 ? 0.5 : last && dist < 1.2 ? 0.6 : 1;
    return { forward, right: 0, run: t.run && dist > 2, jump: false, yaw: this.yaw };
  }

  private replan(t: MoveTask): boolean {
    if (t.replans >= MAX_REPLANS) {
      this.finish('blocked', `The way to ${t.label} is blocked.`);
      return false;
    }
    t.replans += 1;
    const path = this.nav.path(this.position, t.target);
    if (!path) {
      this.finish('blocked', `The way to ${t.label} is blocked.`);
      return false;
    }
    t.path = path.points;
    t.idx = path.points.length > 1 ? 1 : 0;
    t.complete = path.complete;
    t.best = Infinity;
    t.bestAt = this.clock;
    return true;
  }

  distanceTo(p: Vec3) {
    const [x, y, z] = this.position;
    return Math.hypot(p[0] - x, p[1] - y, p[2] - z);
  }

  private sync() {
    const s = this.motor.state;
    this.world.setAgentPose(this.player, s.position, this.yaw, this.pitch, Math.hypot(s.velocity[0], s.velocity[2]), s.grounded);
  }

  dispose() {
    this.stop('Left the world.');
    this.motor.dispose();
  }
}
