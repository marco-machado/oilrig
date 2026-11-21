import { WORLD } from '@ocean-home/shared';

function coordinate(v: number, pos: string, neg: string) {
  const a = Math.abs(v);
  const d = Math.floor(a);
  return `${d}°${String(Math.round((a - d) * 60)).padStart(2, '0')}′${v < 0 ? neg : pos}`;
}

/** Where the platform is, for the brand line. */
export const COORDS = `${coordinate(WORLD.latitude, 'N', 'S')} · ${coordinate(WORLD.longitude, 'E', 'W')}`;
