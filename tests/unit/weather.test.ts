import { describe, expect, it } from 'vitest';
import { WEATHER_KINDS, WeatherModel, type WeatherState } from '@oilrig/shared';

const EPOCH = Date.UTC(2026, 0, 1);
const MIN = 60_000;
const DAY = 86_400_000;

describe('weather model', () => {
  const model = new WeatherModel(42, EPOCH);
  const samples: WeatherState[] = [];
  for (let t = EPOCH; t < EPOCH + 200 * DAY; t += 10 * MIN) samples.push(model.sample(t));

  it('keeps every quantity within physical bounds over 200 game days', () => {
    for (const w of samples) {
      for (const v of [w.cloudCover, w.cloudDensity, w.rain, w.fog, w.storminess]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(w.windSpeed).toBeGreaterThan(0);
      expect(w.windSpeed).toBeLessThan(26);
      expect(w.windDirection).toBeGreaterThanOrEqual(0);
      expect(w.windDirection).toBeLessThan(360);
      expect(w.waveHeight).toBeGreaterThanOrEqual(0);
      expect(w.waveHeight).toBeLessThan(5);
    }
  });

  it('reaches every weather kind', () => {
    const seen = new Set(samples.map((w) => w.kind));
    for (const k of WEATHER_KINDS) expect(seen, k).toContain(k);
  });

  it('changes continuously: no jumps between samples one game-second apart', () => {
    const m = new WeatherModel(7, EPOCH);
    let prev = m.sample(EPOCH);
    for (let t = EPOCH + 1000; t < EPOCH + 20 * DAY; t += 1000) {
      const w = m.sample(t);
      expect(Math.abs(w.cloudCover - prev.cloudCover)).toBeLessThan(0.002);
      expect(Math.abs(w.rain - prev.rain)).toBeLessThan(0.002);
      expect(Math.abs(w.fog - prev.fog)).toBeLessThan(0.002);
      expect(Math.abs(w.windSpeed - prev.windSpeed)).toBeLessThan(0.05);
      let dd = Math.abs(w.windDirection - prev.windDirection);
      if (dd > 180) dd = 360 - dd;
      expect(dd).toBeLessThan(0.1);
      prev = w;
    }
  });

  it('is a pure function of seed and time, regardless of query order', () => {
    const times = Array.from({ length: 300 }, (_, i) => EPOCH + ((i * 7919) % 300) * 3 * 3600_000 + i * 1000);
    const a = new WeatherModel(99, EPOCH);
    const forward = times.map((t) => a.sample(t));
    const b = new WeatherModel(99, EPOCH);
    const reversed = [...times].reverse().map((t) => b.sample(t)).reverse();
    expect(reversed).toEqual(forward);
    const other = new WeatherModel(100, EPOCH);
    expect(times.map((t) => other.sample(t))).not.toEqual(forward);
  });
});
