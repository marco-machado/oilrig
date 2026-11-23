import { fileURLToPath } from 'node:url';
import type { DroneScheduleOptions } from '@oilrig/shared';
import type { AgentLimits } from './agents/manager.ts';

/** World settings, from environment variables. */
export interface WorldConfig {
  dayLengthMinutes: number;
  realTime: boolean;
  timeOffsetHours: number;
  weatherSeed: number;
  drone: Partial<DroneScheduleOptions>;
  agents: Partial<AgentLimits>;
}

type VarName =
  | 'ALLOW_SIGNUPS'
  | 'DAY_LENGTH_MINUTES'
  | 'REAL_TIME'
  | 'TIME_OFFSET_HOURS'
  | 'WEATHER_SEED'
  | 'DRONE_AWAY_MINUTES'
  | 'DRONE_STAY_MINUTES'
  | 'DRONE_FIRST_ARRIVAL_MINUTES'
  | 'DRONE_START_AWAY'
  | 'AGENTS_PER_KEY'
  | 'MAX_AGENTS'
  | 'AGENT_IDLE_MINUTES';

type Vars = Partial<Record<VarName, string>>;

function num(v: string | undefined, fallback: number) {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
}

const flag = (v: string | undefined) => v === 'true' || v === '1';

export function worldConfig(env: Vars): WorldConfig {
  return {
    dayLengthMinutes: Math.max(1, num(env.DAY_LENGTH_MINUTES, 120)),
    realTime: flag(env.REAL_TIME),
    timeOffsetHours: num(env.TIME_OFFSET_HOURS, 0),
    weatherSeed: Math.trunc(num(env.WEATHER_SEED, 1337)),
    drone: {
      intervalMs: Math.max(0.5, num(env.DRONE_AWAY_MINUTES, 3)) * 60_000,
      stayMs: Math.max(0.5, num(env.DRONE_STAY_MINUTES, 12)) * 60_000,
      firstArrivalMs: Math.max(0, num(env.DRONE_FIRST_ARRIVAL_MINUTES, 1)) * 60_000,
      startLanded: !flag(env.DRONE_START_AWAY),
    },
    agents: {
      perKey: Math.max(1, Math.trunc(num(env.AGENTS_PER_KEY, 3))),
      total: Math.max(1, Math.trunc(num(env.MAX_AGENTS, 24))),
      idleMs: Math.max(1, num(env.AGENT_IDLE_MINUTES, 30)) * 60_000,
    },
  };
}

/** Sign-ups are open only when ALLOW_SIGNUPS is exactly "true". */
export const signupsOpen = (env: Vars) => env.ALLOW_SIGNUPS === 'true';

/** Where the server listens and keeps its files, from environment variables. */
export interface ServerConfig {
  port: number;
  host: string;
  /** Directory of the SQLite file, or `:memory:`. */
  dataDir: string;
  /** The built client; nothing static is served when it does not exist. */
  staticDir: string;
  /** The origin people open in their browser (`https://rig.example.com`) when a proxy in front
   * terminates TLS; null to go by each request's Host header. */
  publicOrigin: string | null;
  signupsOpen: boolean;
  world: WorldConfig;
}

export type ServerVars = Vars & Partial<Record<'PORT' | 'HOST' | 'DATA_DIR' | 'STATIC_DIR' | 'PUBLIC_ORIGIN', string>>;

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

function publicOrigin(v: string | undefined) {
  if (!v) return null;
  const url = new URL(v);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`PUBLIC_ORIGIN must be an http(s) origin, got ${v}`);
  return url.origin;
}

export function serverConfig(env: ServerVars = process.env): ServerConfig {
  return {
    port: Math.trunc(num(env.PORT, 8787)),
    host: env.HOST || 'localhost',
    dataDir: env.DATA_DIR || here('../data'),
    staticDir: env.STATIC_DIR || here('../../client/dist/client'),
    publicOrigin: publicOrigin(env.PUBLIC_ORIGIN),
    signupsOpen: signupsOpen(env),
    world: worldConfig(env),
  };
}
