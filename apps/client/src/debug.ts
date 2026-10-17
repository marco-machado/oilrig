import { DIMS, type DronePhase, type DroneState, type Vec3, type WeatherState, droneFarPoint, droneHoverPoint, yawFacing } from '@ocean-home/shared';
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
  deck: { position: [4, 21.7, 12], target: [4, 21, -5] },
  helipad: { position: [55, 26, 22], target: [40, 20, 0] },
  swim: { position: [-5, 2.85, 21.2], target: [-12, -6, 6] },
  interior: { position: [3, 21.8, -1], target: [-12, 21.2, -8] },
  walkway: { position: [-24.5, 17.65, 8], target: [-24.5, 17.2, -8] },
  living: { position: [-5.2, 21.55, -11.3], target: [-9.4, 20.5, -7.6] },
  kitchen: { position: [0.5, 21.7, -4.2], target: [5.5, 20.6, -9.6] },
  bedroom: { position: [-16.6, 21.6, -4.6], target: [-12.6, 20.4, -10.8] },
  lounge: { position: [-3.6, 22.2, 16.5], target: [-9, 20.3, 11.6] },
  hammocks: { position: [-9.5, 17.7, -15.2], target: [-16.5, 16.4, -18] },
  tender: { position: [-7.5, 6.5, 34], target: [-15.5, 0.6, 25] },
  pad: { position: [27.5, 23.5, 17], target: [42, 21, 0] },
  drone: { position: [31.5, 22.4, 10.5], target: [42, 21.6, 0] },
  drone3q: { position: [30, 26.5, -13], target: [42, 21.4, 0] },
  elevator: { position: [-6, 21.8, 14], target: [-12.3, 18, 21.4] },
  lift: { position: [-4, 6.5, 14], target: [-12.3, 9, 21.4] },
  doors: { position: [-14, 21.7, 8], target: [-6, 21.2, 2] },
};

const DRONE_PHASES: DronePhase[] = ['approach', 'hold', 'descend', 'landed', 'depart'];

/** A fixed drone phase for captures, e.g. ?drone=landed or ?drone=descend&droneT=20. */
function fixedDrone(phase: DronePhase) {
  return (now: number): DroneState => {
    const bearing = 95;
    const r = (bearing * Math.PI) / 180;
    const yaw = yawFacing(-Math.sin(r), Math.cos(r));
    const pad = [...DIMS.DRONE.pad] as Vec3;
    const from = phase === 'approach' ? droneFarPoint(bearing) : phase === 'depart' || phase === 'landed' ? pad : droneHoverPoint(bearing);
    const route = phase === 'depart' ? [pad, [pad[0], 34, pad[2]] as Vec3, droneFarPoint(bearing)] : undefined;
    return { phase, t0: now, until: now + 10 * 60_000, bearing, from, fromYaw: yaw, padYaw: yaw, ...(route ? { route } : {}) };
  };
}

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
  drone?: (now: number) => DroneState;
  /** Seconds into the fixed drone phase. */
  droneT?: number;
  /** Features switched off to measure what they cost, e.g. ?off=ao,bloom,shadows. */
  off: Set<string>;
}

/** Features ?off= can switch off (for measuring their cost with the performance overlay). */
export const FEATURES = ['ao', 'bloom', 'traa', 'ssr', 'shadows', 'ocean', 'grass', 'rain', 'labels', 'probes'] as const;

/** URL overrides for visual verification, e.g. ?hour=18&weather=storm&cam=ref. */
export function debugParams(): DebugParams {
  const p = new URLSearchParams(location.search);
  const out: DebugParams = {
    timeScale: Number(p.get('ts') ?? 0),
    offline: p.has('offline'),
    off: new Set((p.get('off') ?? '').split(',').filter((f) => (FEATURES as readonly string[]).includes(f))),
  };
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
  const drone = p.get('drone') as DronePhase | null;
  if (drone && DRONE_PHASES.includes(drone)) out.drone = fixedDrone(drone);
  const droneT = Number(p.get('droneT'));
  if (p.has('droneT') && Number.isFinite(droneT)) out.droneT = droneT;
  return out;
}
