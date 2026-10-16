import { describe, expect, it } from 'vitest';
import { findPlace } from '@ocean-home/shared';
import { DT, allDoorsOpen, motor, mulberry, world } from './helpers.ts';

// Bots wander at random (turning, running, jumping) for several simulated minutes.
// Rails, nets, walls and chains must keep every one of them out of the sea.

const STARTS = ['terrace', 'helipad', 'walkway-east', 'walkway-west', 'tower-top', 'boat-landing', 'swim-platform', 'pool-deck', 'living-room'];
const MINUTES = 4;

describe('containment', () => {
  for (const [i, start] of STARTS.entries()) {
    it(`a random walker starting at ${start} never leaves the structure`, async () => {
      const sw = await world(allDoorsOpen());
      const m = motor(sw, findPlace(start).position);
      const rand = mulberry(1000 + i);
      let yaw = rand() * Math.PI * 2;
      let run = false;
      let nextTurn = 0;
      let lowest = Infinity;
      const steps = Math.round((MINUTES * 60) / DT);
      for (let s = 0; s < steps; s++) {
        if (s >= nextTurn) {
          yaw = rand() * Math.PI * 2;
          run = rand() < 0.4;
          nextTurn = s + Math.round((0.5 + rand() * 3) / DT);
        }
        const jump = rand() < 0.01;
        m.step({ forward: 1, right: rand() < 0.1 ? 1 : 0, run, jump, yaw }, DT);
        lowest = Math.min(lowest, m.state.position[1]);
      }
      // The lowest walkable surface is the swim platform at +1.2 m; the sea is below +1.
      expect(lowest).toBeGreaterThan(1);
      const [x, , z] = m.state.position;
      expect(Math.abs(x)).toBeLessThan(60);
      expect(Math.abs(z)).toBeLessThan(30);
    });
  }
});
