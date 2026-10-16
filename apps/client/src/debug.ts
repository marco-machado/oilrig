import type { Vec3, WeatherState } from '@ocean-home/shared';
import type { QualityName } from './render/quality.ts';

const PRESET_WEATHER: Record<string, Partial<WeatherState>> = {
  clear: { kind: 'clear', cloudCover: 0.08, cloudDensity: 0.3, rain: 0, fog: 0, windSpeed: 5, storminess: 0 },
  fair: { kind: 'fair', cloudCover: 0.4, cloudDensity: 0.45, rain: 0, fog: 0.02, windSpeed: 7, storminess: 0 },
  overcast: { kind: 'overcast', cloudCover: 0.88, cloudDensity: 0.75, rain: 0, fog: 0.12, windSpeed: 9, storminess: 0 },
  rain: { kind: 'rain', cloudCover: 0.95, cloudDensity: 0.9, rain: 0.65, fog: 0.3, windSpeed: 11, storminess: 0.1 },
  storm: { kind: 'storm', cloudCover: 1, cloudDensity: 1, rain: 1, fog: 0.4, windSpeed: 17, storminess: 1 },
  fog: { kind: 'fog', cloudCover: 0.55, cloudDensity: 0.5, rain: 0, fog: 0.9, windSpeed: 2.5, storminess: 0 },
};

const CAMERAS: Record<string, { position: Vec3; target: Vec3 }> = {
  // Matches the reference image: a cross-section-like view from the south, near the waterline.
  ref: { position: [12, 6, 66], target: [12, 9, 0] },
  // Same framing from the north, so the midday sun (north, in the southern hemisphere) is behind the camera.
  refn: { position: [6, 9, -118], target: [6, 8, 0] },
  aerial: { position: [95, 70, 95], target: [5, 10, 0] },
  deck: { position: [-6, 21.7, 12], target: [-6, 21, -5] },
  helipad: { position: [55, 26, 22], target: [40, 20, 0] },
  swim: { position: [-5, 2.85, 21.2], target: [-12, -6, 6] },
  interior: { position: [3, 21.8, -1], target: [-12, 21.2, -8] },
  walkway: { position: [-24.5, 17.65, 8], target: [-24.5, 17.2, -8] },
};

export interface DebugParams {
  quality?: QualityName;
  hour?: number;
  timeScale: number;
  weather?: Partial<WeatherState>;
  camera?: { position: Vec3; target: Vec3 };
  offline: boolean;
  name?: string;
  /** UTC midnight of a fixed date (YYYY-MM-DD) for deterministic captures. */
  date?: number;
}

/** URL overrides for visual verification, e.g. ?hour=18&weather=storm&cam=ref. */
export function debugParams(): DebugParams {
  const p = new URLSearchParams(location.search);
  const out: DebugParams = { timeScale: Number(p.get('ts') ?? 0), offline: p.has('offline') };
  const q = p.get('q');
  if (q === 'low' || q === 'medium' || q === 'high' || q === 'ultra') out.quality = q;
  const h = p.get('hour');
  if (h !== null && Number.isFinite(Number(h))) out.hour = Number(h);
  const w = p.get('weather');
  if (w && PRESET_WEATHER[w]) out.weather = PRESET_WEATHER[w];
  const wind = p.get('wind');
  if (wind && Number.isFinite(Number(wind))) out.weather = { ...(out.weather ?? {}), windSpeed: Number(wind) };
  const cam = p.get('cam');
  if (cam && CAMERAS[cam]) out.camera = CAMERAS[cam];
  const date = p.get('date');
  if (date && Number.isFinite(Date.parse(date))) out.date = Date.parse(`${date}T00:00:00Z`);
  const name = p.get('name');
  if (name) out.name = name;
  return out;
}
