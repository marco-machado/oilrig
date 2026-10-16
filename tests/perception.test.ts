import { beforeAll, describe, expect, it } from 'vitest';
import type { Vec3 } from '@ocean-home/shared';
import { type PerceptionContext, Sight, perceivables, perceive } from '../apps/server/src/agents/perception.ts';
import type { World } from '../apps/server/src/world/world.ts';
import { makeWorld } from './helpers.ts';

// Perception is computed, not rendered: field of view plus Rapier ray casts against the
// colliders. These cases pin down what blocks sight (walls, frosted glass) and what
// does not (clear glass), and that bearings point the right way.

let world: World;
let ctx: PerceptionContext;

beforeAll(async () => {
  world = await makeWorld();
  ctx = { world, sight: new Sight(world), objects: perceivables(world.layout) };
});

// Yaw convention: 0 faces north (-z), +π/2 faces west, -π/2 faces east, π faces south.
const NORTH = 0;
const WEST = Math.PI / 2;
const EAST = -Math.PI / 2;
const SOUTH = Math.PI;

function look(position: Vec3, yaw: number) {
  return perceive(ctx, { id: 'viewer', position, yaw }, { name: 'Viewer', task: null, surface: null });
}
const ids = (p: ReturnType<typeof look>) => p.visible.map((o) => o.id);

describe('perception', () => {
  it('sees the sofa and the closed sliding door through the clear glass from the terrace', () => {
    const p = look([-8.5, 20.05, 4.5], NORTH);
    expect(ids(p)).toContain('living-sofa');
    const door = p.visible.find((o) => o.id === 'door-south-1');
    expect(door?.state).toBe('closed');
  });

  it('does not see the bed through the bedroom divider wall, but does from the bedroom doorway', () => {
    expect(ids(look([-9, 20.12, -10], WEST))).not.toContain('bed');
    expect(ids(look([-15, 20.12, -4.5], NORTH))).toContain('bed');
  });

  it('frosted glass hides the bathtub; from inside the bath it is in plain view', () => {
    expect(ids(look([-16, 20.12, -10], WEST))).not.toContain('bathtub');
    expect(ids(look([-19.5, 20.12, -8], WEST))).toContain('bathtub');
  });

  it('reports only what is within the field of view; turning around reveals what was behind', () => {
    const at: Vec3 = [-9, 20.05, 8.6]; // between the terrace and the firepit lounge
    const facingNorth = ids(look(at, NORTH));
    const facingSouth = ids(look(at, SOUTH));
    expect(facingNorth).not.toContain('firepit');
    expect(facingSouth).toContain('firepit');
    expect(facingSouth).not.toContain('living-sofa');
  });

  it('gives distance, bearing and direction of other avatars, and whether they can be seen', () => {
    const east = world.addAgent('East', [5, 20.05, 8], 0);
    const behindWall = world.addAgent('Hidden', [-15, 20.12, -10], 0); // in the bedroom
    try {
      const p = look([0, 20.05, 8], NORTH);
      const e = p.avatars.find((a) => a.name === 'East')!;
      expect(e.distance).toBeCloseTo(5, 1);
      expect(e.bearing).toBe(90);
      expect(e.direction).toBe('right');
      expect(e.visible).toBe(false); // directly to the side: outside a 120° field of view
      const turned = look([0, 20.05, 8], EAST).avatars.find((a) => a.name === 'East')!;
      expect(turned.bearing).toBe(0);
      expect(turned.direction).toBe('ahead');
      expect(turned.visible).toBe(true);
      const fromLiving = look([-9, 20.12, -10], WEST).avatars.find((a) => a.name === 'Hidden')!;
      expect(fromLiving.visible).toBe(false);
    } finally {
      world.removeAgent(east);
      world.removeAgent(behindWall);
    }
  });

  it('knows where it is: zone, nearest named area, time and weather in physical ranges', () => {
    const p = look([-6, 20.12, -5], NORTH);
    expect(p.self.zone).toBe('pavilion');
    expect(p.self.area?.id).toBe('living-room');
    expect(p.self.facing).toBe('N');
    const out = look([42, 20, 0], WEST);
    expect(out.self.zone).toBe('helipad');
    expect(out.time.hour).toBeGreaterThanOrEqual(0);
    expect(out.time.hour).toBeLessThan(24);
    expect(['day', 'twilight', 'night']).toContain(out.time.daylight);
    expect(out.weather.windSpeedMs).toBeGreaterThanOrEqual(0);
    expect(out.weather.windFromDeg).toBeGreaterThanOrEqual(0);
    expect(out.weather.windFromDeg).toBeLessThan(360);
  });

  it('sees the parked helicopter from the bridge, but not from inside the pavilion looking away', () => {
    world.heli.state = { ...world.heli.state, phase: 'landed', t0: Date.now(), until: Date.now() + 60_000, padYaw: 0 };
    world.sw.setHelicopter(0);
    try {
      const fromBridge = look([30.5, 20, 0], EAST);
      expect(ids(fromBridge)).toContain('helicopter');
      expect(fromBridge.helicopter?.phase).toBe('landed');
      const inside = look([-6, 20.12, -5], WEST);
      expect(inside.helicopter?.visible).toBe(false);
    } finally {
      world.sw.setHelicopter(null);
      world.heli.state = { ...world.heli.state, phase: 'away' };
    }
  });
});
