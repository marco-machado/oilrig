import { type ChatEntry, DIMS, type Vec3, elevatorPose } from '@ocean-home/shared';
import type { Agent, TaskResult } from '../agents/agent.ts';
import { AgentError, type AgentManager, type AvatarStatus } from '../agents/manager.ts';
import { type Perception, areaAt, timeReport, weatherReport } from '../agents/perception.ts';
import type { World } from '../world/world.ts';
import type { Action } from './schemas.ts';

// The operations behind both the REST endpoints and the MCP tools, so both behave alike.

export interface ActionOutcome {
  status: string;
  message: string;
  result: TaskResult | null;
  avatar: AvatarStatus;
}

const iso = (ms: number) => new Date(ms).toISOString();

export class ApiService {
  readonly world: World;
  readonly agents: AgentManager;

  constructor(world: World, agents: AgentManager) {
    this.world = world;
    this.agents = agents;
  }

  worldStatus(now = Date.now()) {
    const w = this.world;
    const drone = w.drone.state;
    const pose = w.dronePose(now);
    const pilot = w.crew.pilot;
    const round = (p: Vec3): Vec3 => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, Math.round(p[2] * 10) / 10];
    return {
      time: timeReport(w, now),
      weather: weatherReport(w, now),
      avatars: w.online().map((p) => ({
        id: p.info.id,
        name: p.info.name,
        kind: p.info.kind ?? ('human' as const),
        position: round(p.pose.p),
        area: areaAt(w, p.pose.p)?.id ?? null,
      })),
      doors: Object.fromEntries(Object.entries(w.doorStates()).map(([id, open]) => [id, open ? ('open' as const) : ('closed' as const)])),
      drone: {
        phase: drone.phase,
        position: drone.phase === 'away' ? null : round(pose.position),
        nextArrival: drone.phase === 'away' ? iso(drone.until) : null,
        departs: drone.phase === 'landed' ? iso(drone.until) : null,
        pilot: pilot ? (w.player(pilot)?.info.name ?? null) : null,
        passengers: w.crew.seats.slice(1).filter(Boolean).length,
      },
      elevator: (() => {
        const e = elevatorPose(w.elevator.state, now);
        return { at: e.stop === null ? null : DIMS.ELEVATOR.stopNames[e.stop], moving: e.phase === 'travel', doors: e.doors > 0.5 ? ('open' as const) : ('closed' as const) };
      })(),
    };
  }

  places() {
    return this.world.layout.places.map((p) => ({ id: p.id, name: p.name, position: p.position as Vec3 }));
  }

  avatars(keyId: string) {
    return this.agents.forKey(keyId).map((a) => this.agents.status(a));
  }

  /** Joins with a new avatar, or returns the key's avatar of the same name if it is already aboard. */
  join(keyId: string, name: string, place?: string): { avatar: AvatarStatus; created: boolean } {
    const same = this.agents.forKey(keyId).find((a) => a.name.toLowerCase() === name.trim().toLowerCase());
    if (same) {
      same.touch();
      return { avatar: this.agents.status(same), created: false };
    }
    const a = this.agents.spawn(keyId, name, place);
    return { avatar: this.agents.status(a), created: true };
  }

  leave(keyId: string, id?: string) {
    const a = this.agents.get(keyId, id);
    const status = this.agents.status(a);
    this.agents.remove(a);
    return status;
  }

  status(keyId: string, id?: string) {
    return this.agents.status(this.agents.get(keyId, id));
  }

  perception(keyId: string, id?: string): Perception {
    return this.agents.perceive(this.agents.get(keyId, id));
  }

  say(keyId: string, id: string | undefined, text: string): ChatEntry {
    const a = this.agents.get(keyId, id);
    const r = this.world.say(a.player, text);
    if (!r.ok) throw new AgentError(r.code, r.message, r.code === 'rate-limited' ? 429 : 422);
    return r.entry;
  }

  readMessages(keyId: string, id: string | undefined, opts: { since?: number; limit?: number }) {
    const a = this.agents.get(keyId, id);
    const messages = a.readMessages(opts).map((m) => ({ ...m, self: m.from === a.id }));
    return { avatar: a.id, messages };
  }

  chatLog(opts: { since?: number; limit?: number }) {
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
    return this.world
      .recentChat()
      .filter((m) => opts.since === undefined || m.t > opts.since)
      .slice(-limit);
  }

  async act(keyId: string, id: string | undefined, action: Action, opts: { wait?: boolean; timeoutMs?: number } = {}): Promise<ActionOutcome> {
    const a = this.agents.get(keyId, id);
    const wait = opts.wait ?? true;
    const timeoutMs = opts.timeoutMs ?? 90_000;
    const outcome = (status: string, message: string, result: TaskResult | null): ActionOutcome => ({
      status,
      message,
      result,
      avatar: this.agents.status(a),
    });

    switch (action.type) {
      case 'stop': {
        const was = a.currentTask;
        a.stop('Stopped on request.');
        return outcome('done', was ? `Stopped ${was}.` : 'Already standing still.', null);
      }
      case 'interact':
        return this.interact(a, action.target, action.action ?? 'toggle', outcome);
      case 'move_to': {
        const target = this.agents.resolveTarget(a, action);
        return this.await(a, a.moveTo(target.point, target.label, action.run), wait, timeoutMs, outcome, `Walking to ${target.label}.`);
      }
      case 'walk': {
        if (action.distance === undefined && action.seconds === undefined) throw new AgentError('no-amount', 'Give distance or seconds.', 422);
        const dir = action.direction ?? 'forward';
        const forward = dir === 'forward' ? 1 : dir === 'backward' ? -1 : 0;
        const right = dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
        const p = a.walk({ forward, right, distance: action.distance, seconds: action.seconds, run: action.run });
        return this.await(a, p, wait, timeoutMs, outcome, `Walking ${dir}.`);
      }
      case 'turn': {
        const yaw = this.agents.turnYaw(a, action);
        return this.await(a, a.turnTo(yaw), true, timeoutMs, outcome, 'Turning.');
      }
    }
  }

  private async await(
    a: Agent,
    p: Promise<TaskResult>,
    wait: boolean,
    timeoutMs: number,
    outcome: (s: string, m: string, r: TaskResult | null) => ActionOutcome,
    startedMessage: string,
  ): Promise<ActionOutcome> {
    if (!wait) {
      // An immediate result (e.g. unreachable) is still reported straight away.
      const quick = await Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), 0))]);
      return quick ? outcome(quick.status, quick.message, quick) : outcome('moving', startedMessage, null);
    }
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((r) => {
      timer = setTimeout(() => r(null), timeoutMs);
    });
    const r = await Promise.race([p, timeout]);
    clearTimeout(timer);
    a.touch();
    if (!r) return outcome('moving', `${startedMessage} Still on the way after ${Math.round(timeoutMs / 1000)} s; it keeps going.`, null);
    return outcome(r.status, r.message, r);
  }

  private interact(a: Agent, target: string, mode: 'open' | 'close' | 'toggle', outcome: (s: string, m: string, r: TaskResult | null) => ActionOutcome): ActionOutcome {
    const door = this.world.layout.doors.find((d) => d.id === target);
    if (!door) {
      const known = this.world.layout.doors.map((d) => d.id).join(', ');
      throw new AgentError('not-interactive', `"${target}" is not something you can operate. Doors are: ${known}.`, 422);
    }
    const isOpen = this.world.sw.isDoorOpen(door.id);
    const open = mode === 'toggle' ? !isOpen : mode === 'open';
    const r = this.world.setDoor(a.player, door.id, open);
    if (!r.ok) {
      const d = Math.hypot(door.center[0] - a.position[0], door.center[2] - a.position[2]);
      throw new AgentError(r.code, `${r.message} (${d.toFixed(1)} m away; move_to "${door.id}" first.)`, 422);
    }
    const word = open ? 'opened' : 'closed';
    return outcome(word, r.changed ? `${door.name} ${word}.` : `${door.name} was already ${word === 'opened' ? 'open' : 'closed'}.`, null);
  }
}
