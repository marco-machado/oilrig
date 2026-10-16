import { describe, expect, it } from 'vitest';
import { sunPosition } from '@ocean-home/shared';

// References are physical facts and published almanac values, not this code:
//  - the sun's declination at the June solstice is +23.44°, at the March equinox ~0°;
//  - NOAA solar-noon times at Greenwich: 2024-11-03 11:43:35 UTC, 2024-02-11 12:14:13 UTC.

function maxElevation(dayStartUtc: number, lat: number, lon: number) {
  let best = { elevation: -90, azimuth: 0, t: 0 };
  for (let m = 0; m < 24 * 60; m += 0.25) {
    const t = dayStartUtc + m * 60_000;
    const p = sunPosition(t, lat, lon);
    if (p.elevation > best.elevation) best = { ...p, t };
  }
  return best;
}

describe('sun position', () => {
  it('passes through the zenith on the Tropic of Cancer at the June solstice', () => {
    const best = maxElevation(Date.UTC(2024, 5, 20), 23.44, 0);
    expect(best.elevation).toBeGreaterThan(89.5);
  });

  it('peaks at 90° − 23.6° = 66.4° due north at our latitude on the March equinox', () => {
    const best = maxElevation(Date.UTC(2024, 2, 20), -23.6, -42.4);
    expect(best.elevation).toBeCloseTo(66.4, 0);
    const az = best.azimuth > 180 ? best.azimuth - 360 : best.azimuth;
    expect(Math.abs(az)).toBeLessThan(2);
  });

  it('reaches solar noon at Greenwich at the NOAA-published times', () => {
    const nov = maxElevation(Date.UTC(2024, 10, 3), 51.48, 0).t;
    expect(Math.abs(nov - Date.UTC(2024, 10, 3, 11, 43, 35))).toBeLessThan(60_000);
    const feb = maxElevation(Date.UTC(2024, 1, 11), 51.48, 0).t;
    expect(Math.abs(feb - Date.UTC(2024, 1, 11, 12, 14, 13))).toBeLessThan(60_000);
  });

  it('rises due east and sets due west on the equator at the equinox', () => {
    let rise = 0;
    let set = 0;
    let prev = sunPosition(Date.UTC(2024, 2, 20), 0, 0).elevation;
    for (let m = 1; m < 24 * 60; m++) {
      const t = Date.UTC(2024, 2, 20) + m * 60_000;
      const p = sunPosition(t, 0, 0);
      if (prev < 0 && p.elevation >= 0) rise = p.azimuth;
      if (prev >= 0 && p.elevation < 0) set = p.azimuth;
      prev = p.elevation;
    }
    expect(Math.abs(rise - 90)).toBeLessThan(1);
    expect(Math.abs(set - 270)).toBeLessThan(1);
  });
});
