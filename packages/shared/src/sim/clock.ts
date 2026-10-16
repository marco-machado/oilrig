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
