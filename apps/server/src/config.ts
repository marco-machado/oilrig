import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface ServerConfig {
  port: number;
  host: string;
  joinPassword: string | null;
  dayLengthMinutes: number;
  realTime: boolean;
  timeOffsetHours: number;
  weatherSeed: number;
  dbPath: string;
  staticDir: string | null;
}

function num(v: string | undefined, fallback: number) {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dataDir = env.DATA_DIR ?? path.resolve(here, '../data');
  return {
    port: num(env.PORT, 8787),
    host: env.HOST ?? '0.0.0.0',
    joinPassword: env.JOIN_PASSWORD ? env.JOIN_PASSWORD : null,
    dayLengthMinutes: Math.max(1, num(env.DAY_LENGTH_MINUTES, 120)),
    realTime: env.REAL_TIME === 'true' || env.REAL_TIME === '1',
    timeOffsetHours: num(env.TIME_OFFSET_HOURS, 0),
    weatherSeed: Math.trunc(num(env.WEATHER_SEED, 1337)),
    dbPath: env.DB_PATH ?? path.join(dataDir, 'ocean-home.db'),
    staticDir: env.STATIC_DIR ?? path.resolve(here, '../../client/dist'),
  };
}
