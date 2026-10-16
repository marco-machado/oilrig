// Seeded, deterministic weather. A Markov chain of weather "segments" is generated
// forward from an epoch; any game time maps to a smoothly blended state, so the
// server and tests can sample it at arbitrary times and it never jumps.

export type WeatherKind = 'clear' | 'fair' | 'overcast' | 'rain' | 'storm' | 'fog';

export const WEATHER_KINDS: WeatherKind[] = ['clear', 'fair', 'overcast', 'rain', 'storm', 'fog'];

export interface WeatherState {
  kind: WeatherKind;
  cloudCover: number;
  cloudDensity: number;
  rain: number;
  fog: number;
  /** Mean wind at 10 m, m/s. */
  windSpeed: number;
  /** Direction the wind blows toward, degrees clockwise from north. */
  windDirection: number;
  /** Significant wave height, metres. */
  waveHeight: number;
  /** 0..1, drives lightning. */
  storminess: number;
}

interface Params {
  cloudCover: number;
  cloudDensity: number;
  rain: number;
  fog: number;
  windSpeed: number;
  storminess: number;
}

const TARGETS: Record<WeatherKind, Params> = {
  clear: { cloudCover: 0.08, cloudDensity: 0.3, rain: 0, fog: 0, windSpeed: 4.5, storminess: 0 },
  fair: { cloudCover: 0.38, cloudDensity: 0.45, rain: 0, fog: 0.02, windSpeed: 7, storminess: 0 },
  overcast: { cloudCover: 0.85, cloudDensity: 0.75, rain: 0, fog: 0.12, windSpeed: 9, storminess: 0 },
  rain: { cloudCover: 0.95, cloudDensity: 0.9, rain: 0.6, fog: 0.3, windSpeed: 11, storminess: 0.1 },
  storm: { cloudCover: 1, cloudDensity: 1, rain: 1, fog: 0.4, windSpeed: 17, storminess: 1 },
  fog: { cloudCover: 0.55, cloudDensity: 0.5, rain: 0, fog: 0.9, windSpeed: 2.5, storminess: 0 },
};

const TRANSITIONS: Record<WeatherKind, Array<[WeatherKind, number]>> = {
  clear: [
    ['fair', 0.6],
    ['clear', 0.25],
    ['fog', 0.15],
  ],
  fair: [
    ['clear', 0.35],
    ['overcast', 0.4],
    ['fair', 0.15],
    ['fog', 0.1],
  ],
  overcast: [
    ['fair', 0.35],
    ['rain', 0.4],
    ['overcast', 0.15],
    ['fog', 0.1],
  ],
  rain: [
    ['overcast', 0.45],
    ['storm', 0.25],
    ['fair', 0.2],
    ['rain', 0.1],
  ],
  storm: [
    ['rain', 0.7],
    ['overcast', 0.3],
  ],
  fog: [
    ['clear', 0.5],
    ['fair', 0.5],
  ],
};

/** Duration ranges in game hours. */
const DURATION: Record<WeatherKind, [number, number]> = {
  clear: [3, 8],
  fair: [2, 6],
  overcast: [2, 5],
  rain: [1, 3],
  storm: [0.75, 2],
  fog: [1, 3],
};

const HOUR = 3600_000;
const MAX_BLEND = 0.75 * HOUR;
const FETCH = 60_000;
const G = 9.81;

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fetch-limited JONSWAP estimate, capped by the fully developed Pierson-Moskowitz sea. */
export function significantWaveHeight(windSpeed: number): number {
  return Math.min(0.0016 * windSpeed * Math.sqrt(FETCH / G), (0.21 * windSpeed * windSpeed) / G);
}

interface Segment {
  start: number;
  end: number;
  kind: WeatherKind;
  params: Params;
  windDirection: number;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export class WeatherModel {
  private readonly segments: Segment[] = [];
  private readonly rand: () => number;
  private readonly seed: number;
  private readonly epochMs: number;

  constructor(seed: number, epochMs: number) {
    this.seed = seed;
    this.epochMs = epochMs;
    this.rand = mulberry32(seed);
    const first = this.makeSegment(epochMs, 'fair', 60);
    this.segments.push(first);
  }

  private makeSegment(start: number, kind: WeatherKind, prevDir: number): Segment {
    const [lo, hi] = DURATION[kind];
    const dur = (lo + (hi - lo) * this.rand()) * HOUR;
    const base = TARGETS[kind];
    const jitter = 0.85 + 0.3 * this.rand();
    return {
      start,
      end: start + dur,
      kind,
      params: { ...base, windSpeed: base.windSpeed * jitter },
      windDirection: (prevDir + (this.rand() - 0.5) * 80 + 360) % 360,
    };
  }

  private next(prev: Segment): Segment {
    const r = this.rand();
    let acc = 0;
    let kind: WeatherKind = prev.kind;
    for (const [k, p] of TRANSITIONS[prev.kind]) {
      acc += p;
      if (r <= acc) {
        kind = k;
        break;
      }
    }
    return this.makeSegment(prev.end, kind, prev.windDirection);
  }

  private segmentIndex(t: number): number {
    while (this.segments[this.segments.length - 1].end <= t) {
      this.segments.push(this.next(this.segments[this.segments.length - 1]));
    }
    // binary search
    let lo = 0;
    let hi = this.segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.segments[mid].end <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Smooth 1D value noise in [-1, 1] for gusts. */
  private gust(t: number): number {
    const period = 4 * 60_000;
    const x = t / period;
    const i = Math.floor(x);
    const f = x - i;
    const h = (n: number) => mulberry32((this.seed ^ Math.imul(n, 0x9e3779b1)) >>> 0)() * 2 - 1;
    const u = smooth(f);
    return h(i) * (1 - u) + h(i + 1) * u;
  }

  sample(gameMs: number): WeatherState {
    const t = Math.max(gameMs, this.epochMs);
    const idx = this.segmentIndex(t);
    const seg = this.segments[idx];
    const prev = idx > 0 ? this.segments[idx - 1] : seg;
    const blendDur = Math.min(MAX_BLEND, 0.4 * (seg.end - seg.start));
    const u = smooth(Math.min(1, (t - seg.start) / blendDur));
    const lerp = (a: number, b: number) => a + (b - a) * u;
    const p = seg.params;
    const q = prev.params;
    let dirDelta = seg.windDirection - prev.windDirection;
    if (dirDelta > 180) dirDelta -= 360;
    if (dirDelta < -180) dirDelta += 360;
    const windMean = lerp(q.windSpeed, p.windSpeed);
    const windSpeed = Math.max(0.5, windMean * (1 + 0.12 * this.gust(t)));
    return {
      kind: u > 0.5 ? seg.kind : prev.kind,
      cloudCover: lerp(q.cloudCover, p.cloudCover),
      cloudDensity: lerp(q.cloudDensity, p.cloudDensity),
      rain: lerp(q.rain, p.rain),
      fog: lerp(q.fog, p.fog),
      windSpeed,
      windDirection: (prev.windDirection + dirDelta * u + 360) % 360,
      waveHeight: significantWaveHeight(windMean),
      storminess: lerp(q.storminess, p.storminess),
    };
  }
}
