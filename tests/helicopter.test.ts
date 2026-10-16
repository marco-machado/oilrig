import { describe, expect, it } from 'vitest';
import { DIMS, type HeliPhase, HeliScheduler, HELI_TIMING, type Vec3, heliPose } from '@ocean-home/shared';
import { motor, walk, world as staticWorld, makeWorld } from './helpers.ts';

// The helicopter is a schedule plus a pure pose function. These tests fly it in simulated
// time and check what an observer would notice: where it lands, that it never jumps or
// dips into the deck or the sea, that it waits for a clear pad, and that it is solid.

const PAD = DIMS.HELI.pad;
const STEP = 100;

function fly(sched: HeliScheduler, from: number, ms: number, each?: (now: number) => void) {
  const phases: HeliPhase[] = [sched.state.phase];
  for (let now = from; now <= from + ms; now += STEP) {
    sched.update(now);
    if (phases[phases.length - 1] !== sched.state.phase) phases.push(sched.state.phase);
    each?.(now);
  }
  return phases;
}

const opts = { intervalMs: 10 * 60_000, stayMs: 2 * 60_000, firstArrivalMs: 1000, seed: 1 };

describe('helicopter', () => {
  it('arrives, lands on the pad, spins down, spins up and leaves, moving smoothly throughout', () => {
    const t0 = 1_000_000;
    const s = new HeliScheduler(opts, t0);
    let prev: Vec3 | null = null;
    let maxJump = 0;
    let lowestOverPad = Infinity;
    let lowestElsewhere = Infinity;
    let landedAt: Vec3 | null = null;
    let minRotorLanded = 1;
    let rotorAtLiftoff = 0;
    const phases = fly(s, t0, 6 * 60_000, (now) => {
      const p = heliPose(s.state, now);
      if (!p.visible) {
        prev = null;
        return;
      }
      if (prev) maxJump = Math.max(maxJump, Math.hypot(p.position[0] - prev[0], p.position[1] - prev[1], p.position[2] - prev[2]));
      prev = p.position;
      const overPad = Math.abs(p.position[0] - PAD[0]) < 10 && Math.abs(p.position[2] - PAD[2]) < 10;
      if (overPad) lowestOverPad = Math.min(lowestOverPad, p.position[1]);
      else lowestElsewhere = Math.min(lowestElsewhere, p.position[1]);
      if (s.state.phase === 'landed') {
        landedAt = p.position;
        minRotorLanded = Math.min(minRotorLanded, p.rotor);
        if (s.state.until - now <= STEP) rotorAtLiftoff = p.rotor;
      }
    });
    expect(phases).toEqual(['away', 'approach', 'descend', 'landed', 'depart', 'away']);
    expect(landedAt![0]).toBeCloseTo(PAD[0], 2);
    expect(landedAt![1]).toBeCloseTo(PAD[1], 2);
    expect(landedAt![2]).toBeCloseTo(PAD[2], 2);
    expect(lowestOverPad).toBeGreaterThanOrEqual(PAD[1] - 1e-6); // never sinks into the deck
    expect(lowestElsewhere).toBeGreaterThan(20); // never skims the sea
    expect(maxJump).toBeLessThan(65 * (STEP / 1000) + 0.5); // ≤ ~125 kt between samples
    expect(minRotorLanded).toBeLessThan(0.01); // engines off while parked
    expect(rotorAtLiftoff).toBeGreaterThan(0.95); // back at flight rpm before lifting
  });

  it('holds off while someone stands on the landing circle, then lands once they leave', () => {
    const t0 = 2_000_000;
    let occupied = true;
    const s = new HeliScheduler(opts, t0, { padOccupied: () => occupied });
    const phases = fly(s, t0, HELI_TIMING.approachMs + 30_000);
    expect(phases).toEqual(['away', 'approach', 'hold']);
    const holdPose = s.pose(t0 + HELI_TIMING.approachMs + 30_000);
    expect(holdPose.position[1] - PAD[1]).toBeGreaterThan(15); // waiting well above the deck
    occupied = false;
    const after = fly(s, t0 + HELI_TIMING.approachMs + 30_000, HELI_TIMING.descendMs + 5000);
    expect(after).toEqual(['hold', 'descend', 'landed']);
  });

  it('waves off if someone walks onto the pad during the descent', () => {
    const t0 = 3_000_000;
    let occupied = false;
    const s = new HeliScheduler(opts, t0, { padOccupied: () => occupied });
    fly(s, t0, HELI_TIMING.approachMs + 5000);
    expect(s.state.phase).toBe('descend');
    occupied = true;
    const now = t0 + HELI_TIMING.approachMs + 5100;
    s.update(now);
    expect(s.state.phase).toBe('hold');
    const later = s.pose(now + HELI_TIMING.holdSettleMs + 1000);
    expect(later.position[1] - PAD[1]).toBeGreaterThan(15); // climbed back to the hover point
  });

  it('comes in from downwind on the open-sea side and lands facing into the wind', () => {
    const t0 = 4_000_000;
    // Wind blowing toward 100° (from the west-north-west... i.e. toward the east-south-east).
    const a = new HeliScheduler(opts, t0, { windDirection: () => 100 });
    fly(a, t0, 2000);
    expect(a.state.bearing).toBe(100);
    const pose = heliPose(a.state, a.state.t0 + 1000);
    expect(pose.position[0]).toBeGreaterThan(PAD[0] + 1000); // far out to the east
    // Wind blowing toward the platform (west): it still approaches from the open sea.
    const b = new HeliScheduler(opts, t0, { windDirection: () => 290 });
    fly(b, t0, 2000);
    expect(b.state.bearing).toBeGreaterThanOrEqual(40);
    expect(b.state.bearing).toBeLessThanOrEqual(140);
  });

  it('once parked it is solid: walking across the pad stops at the fuselage; after it leaves the way is clear', async () => {
    const sw = await staticWorld({});
    sw.setHelicopter(Math.PI / 2); // nose west, fuselage across the walking line
    const m = motor(sw, [31, 20, 0]);
    const blocked = walk(m, [[52, 0]]);
    expect(blocked.reached).toBe(false);
    expect(blocked.final[0]).toBeLessThan(40);
    sw.setHelicopter(null);
    expect(walk(m, [[45, 0]]).reached).toBe(true);
  });

  it('at touchdown, the world moves anyone standing underneath clear of the helicopter', async () => {
    const world = await makeWorld();
    const p = world.addAgent('Late', [PAD[0] + 1, PAD[1], PAD[2] + 1], 0);
    const t0 = Date.now();
    world.heli.state = {
      phase: 'descend',
      t0: t0 - HELI_TIMING.descendMs + 50,
      until: t0 + 50,
      bearing: 90,
      from: [PAD[0] + 55, PAD[1] + 22, PAD[2]],
      fromYaw: Math.PI / 2,
      padYaw: Math.PI / 2,
    };
    const seen: string[] = [];
    world.on('helicopter', (st) => seen.push(st.phase));
    world.heli.update(t0 + 100);
    expect(seen).toEqual(['landed']);
    expect(world.sw.helicopterParked).toBe(true);
    const [x, , z] = p.pose.p;
    expect(Math.hypot(x - PAD[0], z - PAD[2])).toBeGreaterThanOrEqual(DIMS.HELI.clearRadius);
  });
});
