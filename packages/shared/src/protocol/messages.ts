import { z } from 'zod';
import { NET } from '../config.ts';
import { WEATHER_KINDS } from '../sim/weather.ts';

const finite = z.number().finite();
const vec3 = z.tuple([finite, finite, finite]).readonly();

export const PROTOCOL_VERSION = 3;

// ---------- client -> server ----------

/** First message on a socket. Who it is comes from the sign-in cookie, not from here. */
export const HelloMsg = z.object({
  type: z.literal('hello'),
  version: z.literal(PROTOCOL_VERSION),
});

export const PoseMsg = z.object({
  type: z.literal('pose'),
  seq: z.number().int().nonnegative(),
  p: vec3,
  v: vec3,
  yaw: finite,
  pitch: finite,
  grounded: z.boolean(),
});

export const ChatMsg = z.object({
  type: z.literal('chat'),
  text: z.string().trim().min(1).max(NET.chatMaxLength),
});

export const DoorMsg = z.object({
  type: z.literal('door'),
  id: z.string().max(64),
  open: z.boolean(),
});

export const RespawnMsg = z.object({ type: z.literal('respawn') });
export const PingMsg = z.object({ type: z.literal('ping'), t: finite });

/** Take a seat in the drone (the pilot's if it is free). */
export const BoardMsg = z.object({ type: z.literal('board') });
/** Climb out of the drone at `p` (feet), next to it. */
export const UnboardMsg = z.object({ type: z.literal('unboard'), p: vec3 });

export const DronePoseSchema = z.object({
  p: vec3,
  v: vec3,
  yaw: finite,
  pitch: finite,
  roll: finite,
  rotor: finite,
  grounded: z.boolean(),
});
export type DronePoseMsg = z.infer<typeof DronePoseSchema>;

/** The pilot's drone pose, streamed while flying. */
export const DroneFlyMsg = DronePoseSchema.extend({ type: z.literal('drone') });

/** Press an elevator button: call the car to `stop` (or send it there from inside). */
export const ElevatorCallMsg = z.object({ type: z.literal('elevator'), stop: z.number().int().min(0).max(1) });

/** Change the time of day, the speed of the day or the weather for everyone. */
export const SetEnvMsg = z.object({
  type: z.literal('setenv'),
  /** Local hour 0..24 to jump to (same day). */
  hour: finite.min(0).max(24).optional(),
  /** Game seconds per real second (0 pauses the sun). */
  rate: finite.min(0).max(3600).optional(),
  weather: z.enum(['auto', ...(WEATHER_KINDS as [string, ...string[]])]).optional(),
});

export const ClientMessage = z.discriminatedUnion('type', [
  HelloMsg,
  PoseMsg,
  ChatMsg,
  DoorMsg,
  RespawnMsg,
  PingMsg,
  BoardMsg,
  UnboardMsg,
  DroneFlyMsg,
  ElevatorCallMsg,
  SetEnvMsg,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ---------- server -> client ----------

export const PlayerInfo = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  /** AI agents driven through the API are flagged so people can tell them apart. */
  kind: z.enum(['human', 'agent']).optional(),
});
export type PlayerInfo = z.infer<typeof PlayerInfo>;

export const PlayerPose = z.object({
  id: z.string(),
  p: vec3,
  yaw: finite,
  pitch: finite,
  speed: finite,
  grounded: z.boolean(),
});
export type PlayerPose = z.infer<typeof PlayerPose>;

export const WeatherStateSchema = z.object({
  kind: z.enum(WEATHER_KINDS as [string, ...string[]]),
  cloudCover: finite,
  cloudDensity: finite,
  rain: finite,
  fog: finite,
  windSpeed: finite,
  windDirection: finite,
  waveHeight: finite,
  storminess: finite,
});

export const ClockSchema = z.object({ anchorRealMs: finite, anchorGameMs: finite, rate: finite });

export const DroneStateSchema = z.object({
  phase: z.enum(['away', 'approach', 'hold', 'descend', 'landed', 'depart', 'return', 'piloted']),
  t0: finite,
  // Infinity while piloted does not survive JSON; null stands for "no planned end".
  until: z.number().nullable().transform((v) => v ?? Infinity),
  bearing: finite,
  from: vec3,
  fromYaw: finite,
  padYaw: finite,
  route: z.array(vec3).optional(),
});

/** Who sits in which drone seat (seat 0 is the pilot's). */
export const CrewSchema = z.array(z.string().nullable()).length(4);

export const ElevatorStateSchema = z.object({ from: z.number().int(), to: z.number().int(), t0: finite });

export const WeatherModeSchema = z.enum(['auto', ...(WEATHER_KINDS as [string, ...string[]])]);

export const ChatEntry = z.object({ id: z.string(), from: z.string(), name: z.string(), text: z.string(), t: finite });
export type ChatEntry = z.infer<typeof ChatEntry>;

export const WelcomeMsg = z.object({
  type: z.literal('welcome'),
  you: PlayerInfo,
  pose: z.object({ p: vec3, yaw: finite }),
  serverTime: finite,
  clock: ClockSchema,
  weather: WeatherStateSchema,
  players: z.array(PlayerInfo),
  doors: z.record(z.string(), z.boolean()),
  chat: z.array(ChatEntry),
  drone: DroneStateSchema,
  crew: CrewSchema,
  elevator: ElevatorStateSchema,
  weatherMode: WeatherModeSchema,
});

export const SnapshotMsg = z.object({
  type: z.literal('snapshot'),
  t: finite,
  players: z.array(PlayerPose),
  /** The drone's live pose while someone flies it. */
  drone: DronePoseSchema.optional(),
});
export const JoinMsg = z.object({ type: z.literal('join'), player: PlayerInfo });
export const LeaveMsg = z.object({ type: z.literal('leave'), id: z.string() });
/** Someone's details changed (a new display name). */
export const PlayerMsg = z.object({ type: z.literal('player'), player: PlayerInfo });
export const EnvMsg = z.object({ type: z.literal('env'), t: finite, weather: WeatherStateSchema });
export const ChatOutMsg = z.object({ type: z.literal('chat'), entry: ChatEntry });
export const DoorOutMsg = z.object({ type: z.literal('door'), id: z.string(), open: z.boolean(), by: z.string() });
export const CorrectMsg = z.object({ type: z.literal('correct'), seq: z.number().int(), p: vec3, reason: z.string() });
export const DroneMsg = z.object({ type: z.literal('drone'), state: DroneStateSchema, crew: CrewSchema });
export const ElevatorMsg = z.object({ type: z.literal('elevator'), state: ElevatorStateSchema });
/** The clock or the weather mode changed (someone used the environment controls). */
export const EnvControlMsg = z.object({ type: z.literal('envctl'), clock: ClockSchema, weatherMode: WeatherModeSchema, by: z.string().optional() });
export const PongMsg = z.object({ type: z.literal('pong'), t: finite, serverTime: finite });
export const ErrorMsg = z.object({ type: z.literal('error'), code: z.string(), message: z.string() });

export const ServerMessage = z.discriminatedUnion('type', [
  WelcomeMsg,
  SnapshotMsg,
  JoinMsg,
  LeaveMsg,
  PlayerMsg,
  EnvMsg,
  ChatOutMsg,
  DoorOutMsg,
  CorrectMsg,
  DroneMsg,
  ElevatorMsg,
  EnvControlMsg,
  PongMsg,
  ErrorMsg,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
export type WelcomeMessage = z.infer<typeof WelcomeMsg>;
