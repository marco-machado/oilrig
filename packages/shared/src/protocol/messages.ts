import { z } from 'zod';
import { NET } from '../config.ts';
import { WEATHER_KINDS } from '../sim/weather.ts';

const finite = z.number().finite();
const vec3 = z.tuple([finite, finite, finite]).readonly();

export const PROTOCOL_VERSION = 1;

// ---------- client -> server ----------

export const HelloMsg = z.object({
  type: z.literal('hello'),
  version: z.literal(PROTOCOL_VERSION),
  name: z.string().trim().min(1).max(NET.nameMaxLength),
  password: z.string().max(200).optional(),
  session: z.string().max(100).optional(),
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

export const ClientMessage = z.discriminatedUnion('type', [HelloMsg, PoseMsg, ChatMsg, DoorMsg, RespawnMsg, PingMsg]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ---------- server -> client ----------

export const PlayerInfo = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
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

export const ChatEntry = z.object({ id: z.string(), from: z.string(), name: z.string(), text: z.string(), t: finite });
export type ChatEntry = z.infer<typeof ChatEntry>;

export const WelcomeMsg = z.object({
  type: z.literal('welcome'),
  you: PlayerInfo,
  session: z.string(),
  pose: z.object({ p: vec3, yaw: finite }),
  serverTime: finite,
  clock: ClockSchema,
  weather: WeatherStateSchema,
  players: z.array(PlayerInfo),
  doors: z.record(z.string(), z.boolean()),
  chat: z.array(ChatEntry),
});

export const SnapshotMsg = z.object({ type: z.literal('snapshot'), t: finite, players: z.array(PlayerPose) });
export const JoinMsg = z.object({ type: z.literal('join'), player: PlayerInfo });
export const LeaveMsg = z.object({ type: z.literal('leave'), id: z.string() });
export const EnvMsg = z.object({ type: z.literal('env'), t: finite, weather: WeatherStateSchema });
export const ChatOutMsg = z.object({ type: z.literal('chat'), entry: ChatEntry });
export const DoorOutMsg = z.object({ type: z.literal('door'), id: z.string(), open: z.boolean(), by: z.string() });
export const CorrectMsg = z.object({ type: z.literal('correct'), seq: z.number().int(), p: vec3, reason: z.string() });
export const PongMsg = z.object({ type: z.literal('pong'), t: finite, serverTime: finite });
export const ErrorMsg = z.object({ type: z.literal('error'), code: z.string(), message: z.string() });

export const ServerMessage = z.discriminatedUnion('type', [
  WelcomeMsg,
  SnapshotMsg,
  JoinMsg,
  LeaveMsg,
  EnvMsg,
  ChatOutMsg,
  DoorOutMsg,
  CorrectMsg,
  PongMsg,
  ErrorMsg,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
export type WelcomeMessage = z.infer<typeof WelcomeMsg>;
