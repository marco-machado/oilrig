import type { DroneScheduleOptions } from '@ocean-home/shared';
import type { AgentLimits } from './agents/manager.ts';

/** World settings, from the Worker's environment variables (wrangler.jsonc `vars`). */
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
