import { beforeAll, describe, expect, it } from 'vitest';
import { DIMS, PLAYER, type Vec3, droneBodyBoxes, findPlace, getLayout } from '@oilrig/shared';
import { AGENT_DT, Agent, type TaskResult } from '../../apps/server/src/agents/agent.ts';
import { NavigationMesh } from '../../apps/server/src/agents/navmesh.ts';
import type { World } from '../../apps/server/src/world/world.ts';
import { makeWorld } from './helpers.ts';

// AI agents plan routes on a navmesh generated from the colliders, and then walk them with
// the same character motor people use. These tests run that whole loop in simulated time.

let world: World;
let nav: NavigationMesh;

beforeAll(async () => {
  world = await makeWorld();
  nav = await NavigationMesh.build(world.sw);
});

const place = (id: string) => findPlace(id).position;

function spawn(at: Vec3, name = 'Walker') {
  return new Agent(world, nav, world.addAgent(name, at, 0), 'test-key');
}

/** Steps the simulation until the task settles (or a generous time limit passes). */
async function settle(a: Agent, task: Promise<TaskResult>, maxSeconds = 120) {
  let result: TaskResult | null = null;
  void task.then((r) => (result = r));
  for (let i = 0; i < maxSeconds / AGENT_DT && !result; i++) {
    a.step(AGENT_DT);
    if (i % 30 === 0) await Promise.resolve();
  }
  await Promise.resolve();
  return result as TaskResult | null;
}

/** Someone walks up to each door and slides it shut. */
function closeAllDoors() {
  const closer = world.addAgent('Door closer', place('terrace'), 0);
  for (const d of getLayout().doors) {
    closer.pose = { ...closer.pose, p: [d.center[0], d.center[1] - 1.2, d.center[2]] };
    expect(world.setDoor(closer, d.id, false).ok).toBe(true);
    expect(world.sw.isDoorOpen(d.id)).toBe(false);
  }
  world.removeAgent(closer);
}

describe('agent navigation', () => {
  it('walks from the terrace to every named place, stairs and tower included', async () => {
    const a = spawn(place('terrace'));
    for (const p of getLayout().places) {
      a.teleport(place('terrace'));
      const r = await settle(a, a.moveTo(p.position, p.name));
      expect(r?.status, `to ${p.id}: ${r?.message}`).toBe('arrived');
      const [x, y, z] = a.position;
      expect(Math.hypot(x - p.position[0], z - p.position[2]), p.id).toBeLessThan(0.6);
      expect(Math.abs(y - p.position[1]), p.id).toBeLessThan(0.3);
    }
    a.dispose();
  });

  it('opens closed doors on its way, and the world sees them open', async () => {
    closeAllDoors();
    const a = spawn(place('terrace'));
    const r = await settle(a, a.moveTo(place('bedroom'), 'Bedroom'));
    expect(r?.status).toBe('arrived');
    expect(r?.doorsOpened.length).toBeGreaterThan(0);
    for (const id of r!.doorsOpened) expect(world.doorStates()[id]).toBe(true);
    a.dispose();
    world.removeAgent(a.player);
  });

  it('keeps routes clear of furniture by at least the body radius', () => {
    const { R, world: physics, info } = world.sw;
    const body = new R.Capsule((PLAYER.height - 2 * PLAYER.radius) / 2 - 0.1, PLAYER.radius - 0.02);
    const furniture = (c: { handle: number }) => !!info.get(c.handle)?.object && info.get(c.handle)!.kind !== 'door';
    const routes: Array<[string, string]> = [
      ['living-room', 'kitchen'],
      ['living-room', 'bedroom'],
      ['firepit', 'pool-deck'],
      ['bedroom', 'pool-deck'],
      ['walkway-west', 'hammocks'],
    ];
    for (const [from, to] of routes) {
      const path = nav.path(place(from), place(to));
      expect(path?.complete, `${from} → ${to}`).toBe(true);
      const pts = path!.points;
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]];
        const n = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.2);
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          const p = { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t + PLAYER.height / 2 + 0.05, z: a[2] + (b[2] - a[2]) * t };
          const hit = physics.intersectionWithShape(p, { x: 0, y: 0, z: 0, w: 1 }, body, undefined, undefined, undefined, undefined, furniture);
          expect(hit ? info.get(hit.handle)?.object : null, `${from} → ${to} at ${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBeNull();
        }
      }
    }
  });

  it('walks around the parked drone and stops beside its cabin', async () => {
    const stand = { position: [...DIMS.DRONE.pad] as Vec3, yaw: 0 };
    world.sw.setDrone(stand);
    nav.setDrone(stand);
    try {
      const a = spawn(place('terrace'), 'Spotter');
      const r = await settle(a, a.moveTo(place('helipad'), 'Helipad'));
      expect(r?.status).toBe('nearest');
      const [x, , z] = a.position;
      const cabin = droneBodyBoxes(stand.position, 0)[0];
      expect(Math.abs(x - cabin.center[0]) < cabin.half[0] && Math.abs(z - cabin.center[2]) < cabin.half[2]).toBe(false);
      expect(Math.hypot(x - 42, z)).toBeLessThan(3.5);
      a.dispose();
      world.removeAgent(a.player);
    } finally {
      world.sw.setDrone(null);
      nav.setDrone(null);
    }
  });

  it('asked to stand on the pavilion roof, it gets as close as it can and stays on the deck', async () => {
    const a = spawn(place('terrace'), 'Climber');
    const r = await settle(a, a.moveTo([-8, 23.72, -5], 'the roof'));
    expect(['nearest', 'unreachable']).toContain(r?.status);
    expect(a.position[1]).toBeLessThan(20.5);
    expect(a.position[1]).toBeGreaterThan(19.9);
    a.dispose();
    world.removeAgent(a.player);
  });

  it('walking straight off the helipad edge is stopped by the net stop', async () => {
    const a = spawn(place('helipad'), 'Edge');
    await settle(a, a.turnTo(-Math.PI / 2)); // face east
    const r = await settle(a, a.walk({ forward: 1, right: 0, distance: 25, run: true }));
    expect(r?.status).toBe('blocked');
    expect(a.position[1]).toBeGreaterThan(19.5);
    expect(a.position[0]).toBeLessThan(54);
    a.dispose();
    world.removeAgent(a.player);
  });
});
