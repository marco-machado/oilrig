import { WORLD } from '../config.ts';
import { celestialBasis, moonPosition, skyDirection, sunPosition } from './astronomy.ts';

export interface ClockConfig {
  anchorRealMs: number;
  anchorGameMs: number;
  /** Game milliseconds per real millisecond. */
  rate: number;
}

export const DEFAULT_EPOCH = Date.UTC(2026, 0, 1);

export function makeClock(opts: { realTime: boolean; dayLengthMinutes: number; offsetHours?: number }): ClockConfig {
  const offset = (opts.offsetHours ?? 0) * 3600_000;
  if (opts.realTime) return { anchorRealMs: DEFAULT_EPOCH, anchorGameMs: DEFAULT_EPOCH + offset, rate: 1 };
  return {
    anchorRealMs: DEFAULT_EPOCH,
    anchorGameMs: DEFAULT_EPOCH + offset,
    rate: (24 * 60) / opts.dayLengthMinutes,
  };
}

export function gameTime(c: ClockConfig, realMs: number): number {
  return c.anchorGameMs + (realMs - c.anchorRealMs) * c.rate;
}

/** Speed presets offered to players: game seconds per real second. */
export const CLOCK_RATES = [0, 1, 12, 60, 240] as const;

/**
 * A clock re-anchored at `realNow`: optionally jumped to a local hour on the same day and
 * running at a new rate. Everyone sharing the result sees the same sky.
 */
export function adjustClock(c: ClockConfig, realNow: number, o: { hour?: number; rate?: number }): ClockConfig {
  let g = gameTime(c, realNow);
  if (o.hour !== undefined) g += (o.hour - celestialAt(g).localHour) * 3600_000;
  return { anchorRealMs: realNow, anchorGameMs: g, rate: o.rate ?? c.rate };
}

export interface Celestial {
  sunDirection: [number, number, number];
  sunElevation: number;
  moonDirection: [number, number, number];
  moonElevation: number;
  moonIllumination: number;
  basis: ReturnType<typeof celestialBasis>;
  /** Local mean solar hour 0..24 at the world longitude. */
  localHour: number;
}

export function celestialAt(gameMs: number): Celestial {
  const sun = sunPosition(gameMs, WORLD.latitude, WORLD.longitude);
  const moon = moonPosition(gameMs, WORLD.latitude, WORLD.longitude);
  const utcHours = (((gameMs / 3600_000) % 24) + 24) % 24;
  return {
    sunDirection: skyDirection(sun),
    sunElevation: sun.elevation,
    moonDirection: skyDirection(moon),
    moonElevation: moon.elevation,
    moonIllumination: moon.illumination,
    basis: celestialBasis(gameMs, WORLD.latitude, WORLD.longitude),
    localHour: (utcHours + WORLD.longitude / 15 + 24) % 24,
  };
}
