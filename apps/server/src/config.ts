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
  helicopter?: Partial<{ intervalMs: number; stayMs: number; firstArrivalMs: number; seed: number }>;
  agents?: Partial<{ perKey: number; total: number; idleMs: number }>;
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
    helicopter: {
      intervalMs: Math.max(3, num(env.HELI_INTERVAL_MINUTES, 15)) * 60_000,
      stayMs: Math.max(0.5, num(env.HELI_STAY_MINUTES, 4)) * 60_000,
      firstArrivalMs: Math.max(0, num(env.HELI_FIRST_ARRIVAL_MINUTES, 1)) * 60_000,
    },
    agents: {
      perKey: Math.max(1, Math.trunc(num(env.AGENTS_PER_KEY, 3))),
      total: Math.max(1, Math.trunc(num(env.MAX_AGENTS, 24))),
      idleMs: Math.max(1, num(env.AGENT_IDLE_MINUTES, 30)) * 60_000,
    },
  };
}
