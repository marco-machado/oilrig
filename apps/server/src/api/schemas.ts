import { z } from '@hono/zod-openapi';

// Request/response schemas shared by the REST API (OpenAPI) and the MCP tools.

const num = z.number().finite();
export const Vec3 = z.tuple([num, num, num]).readonly().describe('x (east), y (up), z (south) in metres').openapi({ example: [42, 20, 0] });

export const ErrorBody = z
  .object({ error: z.object({ code: z.string(), message: z.string() }) })
  .openapi('Error');

export const TaskResult = z
  .object({
    task: z.enum(['move_to', 'walk', 'turn']),
    status: z.enum(['arrived', 'nearest', 'blocked', 'unreachable', 'done', 'interrupted', 'timeout']),
    message: z.string(),
    position: Vec3,
    heading: z.number().describe('Compass degrees, 0 = north, 90 = east'),
    travelled: z.number(),
    doorsOpened: z.array(z.string()),
  })
  .openapi('TaskResult');

export const AvatarStatus = z
  .object({
    id: z.string(),
    name: z.string(),
    position: Vec3,
    heading: z.number(),
    task: z.string().nullable().describe('What the avatar is doing now, if anything'),
    lastResult: TaskResult.nullable(),
    joinedAt: z.number(),
  })
  .openapi('AvatarStatus');

export const Place = z.object({ id: z.string(), name: z.string(), position: Vec3 }).openapi('Place');

export const ChatMessage = z
  .object({ id: z.string(), from: z.string(), name: z.string(), text: z.string(), t: z.number().describe('Server time, ms since epoch') })
  .openapi('ChatMessage');

const Time = z.object({ local: z.string(), hour: z.number(), daylight: z.enum(['day', 'twilight', 'night']), sunElevation: z.number() });
const Weather = z.object({
  kind: z.string(),
  windSpeedMs: z.number(),
  windFrom: z.string(),
  windFromDeg: z.number(),
  waveHeightM: z.number(),
  rain: z.number(),
  fog: z.number(),
  cloudCover: z.number(),
});

export const WorldStatus = z
  .object({
    time: Time,
    weather: Weather,
    avatars: z.array(
      z.object({ id: z.string(), name: z.string(), kind: z.enum(['human', 'agent']), position: Vec3, area: z.string().nullable() }),
    ),
    doors: z.record(z.string(), z.enum(['open', 'closed'])),
    helicopter: z.object({
      phase: z.enum(['away', 'approach', 'hold', 'descend', 'landed', 'depart']),
      position: Vec3.nullable(),
      nextArrival: z.string().nullable().describe('ISO time of the next scheduled arrival, while away'),
      departs: z.string().nullable().describe('ISO time of lift-off, while landed'),
    }),
  })
  .openapi('WorldStatus');

const Seen = z.object({
  id: z.string(),
  kind: z.string(),
  name: z.string(),
  distance: z.number(),
  bearing: z.number().describe('Degrees from straight ahead, positive to the right'),
  direction: z.string(),
  heightDelta: z.number(),
  state: z.string().optional(),
});

export const Perception = z
  .object({
    self: z.object({
      id: z.string(),
      name: z.string(),
      position: Vec3,
      heading: z.number(),
      facing: z.string(),
      zone: z.string().nullable(),
      area: z.object({ id: z.string(), name: z.string(), distance: z.number() }).nullable(),
      surface: z.string().nullable(),
      task: z.string().nullable(),
    }),
    time: Time,
    weather: Weather,
    visible: z.array(Seen),
    avatars: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        kind: z.enum(['human', 'agent']),
        distance: z.number(),
        bearing: z.number(),
        direction: z.string(),
        visible: z.boolean(),
        moving: z.boolean(),
      }),
    ),
    helicopter: z
      .object({ phase: z.string(), visible: z.boolean(), distance: z.number(), bearing: z.number(), direction: z.string() })
      .nullable(),
  })
  .openapi('Perception');

// ---------- actions ----------

export const MoveToFields = {
  place: z.string().optional().describe('A place id from /places (e.g. "helipad"), or an object id such as "living-sofa"'),
  object: z.string().optional().describe('Walk up to an object seen in perception (furniture, door, landmark)'),
  avatar: z.string().optional().describe('Walk up to another avatar (id or name)'),
  position: Vec3.optional(),
  run: z.boolean().optional(),
};
export const WalkFields = {
  direction: z.enum(['forward', 'backward', 'left', 'right']).optional().describe('Relative to where the avatar faces; default forward'),
  distance: z.number().min(0.1).max(30).optional().describe('Metres; give this or seconds'),
  seconds: z.number().min(0.1).max(20).optional(),
  run: z.boolean().optional(),
};
export const TurnFields = {
  degrees: z.number().min(-360).max(360).optional().describe('Turn by this much; positive is clockwise (to the right)'),
  heading: z.number().min(0).max(360).optional().describe('Face this compass heading (0 = north, 90 = east)'),
  face: z.string().optional().describe('Face an object, avatar or place by id'),
};
export const InteractFields = {
  target: z.string().describe('Door id, e.g. "door-south-1"'),
  action: z.enum(['open', 'close', 'toggle']).optional(),
};

export const Action = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('move_to'), ...MoveToFields }),
    z.object({ type: z.literal('walk'), ...WalkFields }),
    z.object({ type: z.literal('turn'), ...TurnFields }),
    z.object({ type: z.literal('interact'), ...InteractFields }),
    z.object({ type: z.literal('stop') }),
  ])
  .openapi('Action');
export type Action = z.infer<typeof Action>;

export const ActionRequest = z
  .object({
    action: Action,
    wait: z.boolean().optional().describe('Wait for the movement to finish (default true)'),
    timeoutSeconds: z.number().min(1).max(120).optional().describe('How long to wait (default 90)'),
  })
  .openapi('ActionRequest');

export const ActionResult = z
  .object({
    status: z.string().describe('arrived, nearest, blocked, unreachable, done, interrupted, moving (still going), opened, closed'),
    message: z.string(),
    result: TaskResult.nullable(),
    avatar: AvatarStatus,
  })
  .openapi('ActionResult');
