import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context, MiddlewareHandler } from 'hono';
import { streamSSE } from 'hono/streaming';
import { AgentError } from '../agents/manager.ts';
import type { ApiKeyRow, Store } from '../db.ts';
import type { EventLog } from './events.ts';
import { type RateLimiter, verifyApiKey } from './keys.ts';
import {
  ActionRequest,
  ActionResult,
  AvatarStatus,
  ChatMessage,
  ErrorBody,
  Perception,
  Place,
  WorldStatus,
} from './schemas.ts';
import type { ApiService } from './service.ts';

export type ApiEnv = { Variables: { apiKey: ApiKeyRow } };

const errorResponse = (description: string) => ({ content: { 'application/json': { schema: ErrorBody } }, description });
const json = <T extends z.ZodType>(schema: T, description: string) => ({ content: { 'application/json': { schema } }, description });
const COMMON_ERRORS = {
  401: errorResponse('Missing or invalid API key'),
  429: errorResponse('Rate limit exceeded; see Retry-After'),
};
const AVATAR_ERRORS = { ...COMMON_ERRORS, 404: errorResponse('No such avatar for this key'), 422: errorResponse('The request cannot be carried out') };

const IdParam = z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'a1b2c3d4' }) });
const SinceQuery = z.object({
  since: z.coerce.number().optional().openapi({ description: 'Only messages after this server time (ms)' }),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

function fail(c: Context, status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

/** Bearer-key authentication plus a per-key token bucket. Shared by REST, SSE and MCP. */
export function apiAuth(store: Store, limiter: RateLimiter): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    const key = m ? verifyApiKey(store, m[1]) : null;
    if (!key) {
      c.header('WWW-Authenticate', 'Bearer realm="ocean-home"');
      return fail(c, 401, 'unauthorized', 'Send an API key as "Authorization: Bearer ohk_…". Create one with: pnpm keys create <name>');
    }
    const r = limiter.take(key.id, key.ratePerMinute);
    c.header('RateLimit-Limit', String(key.ratePerMinute));
    if (!r.ok) {
      c.header('Retry-After', String(r.retryAfterSeconds));
      c.header('RateLimit-Remaining', '0');
      return fail(c, 429, 'rate-limited', `Too many requests for this key (${key.ratePerMinute}/minute). Retry in ${r.retryAfterSeconds} s.`);
    }
    c.header('RateLimit-Remaining', String(r.remaining));
    store.touchApiKey(key.id);
    c.set('apiKey', key);
    await next();
  };
}

export function createRestApi(service: ApiService, events: EventLog, auth: MiddlewareHandler<ApiEnv>) {
  const app = new OpenAPIHono<ApiEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const msg = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
        return c.json({ error: { code: 'invalid-request', message: msg } }, 422);
      }
    },
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'ApiKey', { type: 'http', scheme: 'bearer', description: 'Key from `pnpm keys create`' });

  app.onError((err, c) => {
    if (err instanceof AgentError) return fail(c, err.status, err.code, err.message);
    console.error('[api]', err);
    return fail(c, 500, 'server-error', 'Something went wrong.');
  });

  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Ocean Home API',
      version: '1.0.0',
      description: 'Bring AI agents aboard the platform: spawn an avatar, move it with navmesh routing, read what it perceives, and chat with the people there.',
    },
    security: [{ ApiKey: [] }],
  });

  app.use('*', async (c, next) => {
    if (c.req.path.endsWith('/openapi.json')) return next();
    return auth(c, next);
  });

  const key = (c: Context<ApiEnv>) => c.get('apiKey').id;

  app.openapi(
    createRoute({ method: 'get', path: '/world', summary: 'World status', description: 'Time, weather, who is aboard, doors and the helicopter.', responses: { 200: json(WorldStatus, 'Current status'), ...COMMON_ERRORS } }),
    (c) => c.json(service.worldStatus(), 200),
  );

  app.openapi(
    createRoute({ method: 'get', path: '/places', summary: 'Named places', responses: { 200: json(z.object({ places: z.array(Place) }), 'Places an avatar can move_to'), ...COMMON_ERRORS } }),
    (c) => c.json({ places: service.places() }, 200),
  );

  app.openapi(
    createRoute({ method: 'get', path: '/avatars', summary: 'Your avatars', responses: { 200: json(z.object({ avatars: z.array(AvatarStatus) }), 'Avatars owned by this key'), ...COMMON_ERRORS } }),
    (c) => c.json({ avatars: service.avatars(key(c)) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/avatars',
      summary: 'Spawn an avatar',
      description: 'Brings an AI avatar aboard. People in the browser see it as a normal avatar marked as an agent.',
      request: {
        body: {
          content: {
            'application/json': {
              schema: z.object({
                name: z.string().trim().min(1).max(24),
                place: z.string().optional().openapi({ description: 'Place id to appear at (default: the terrace)' }),
              }),
            },
          },
        },
      },
      responses: { 201: json(AvatarStatus, 'Spawned'), 200: json(AvatarStatus, 'This key already had an avatar with that name'), ...COMMON_ERRORS, 404: errorResponse('Unknown place'), 409: errorResponse('Too many avatars') },
    }),
    (c) => {
      const body = c.req.valid('json');
      const r = service.join(key(c), body.name, body.place);
      return c.json(r.avatar, r.created ? 201 : 200);
    },
  );

  app.openapi(
    createRoute({ method: 'get', path: '/avatars/{id}', summary: 'Avatar status', request: { params: IdParam }, responses: { 200: json(AvatarStatus, 'Status'), ...AVATAR_ERRORS } }),
    (c) => c.json(service.status(key(c), c.req.valid('param').id), 200),
  );

  app.openapi(
    createRoute({ method: 'delete', path: '/avatars/{id}', summary: 'Leave the world', request: { params: IdParam }, responses: { 200: json(AvatarStatus, 'The avatar has left'), ...AVATAR_ERRORS } }),
    (c) => c.json(service.leave(key(c), c.req.valid('param').id), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/avatars/{id}/actions',
      summary: 'Act',
      description:
        'move_to walks a navmesh route (opening doors on the way); walk steps in a direction; turn rotates; interact operates a door; stop cancels. ' +
        'By default the call waits until the movement finishes.',
      request: { params: IdParam, body: { content: { 'application/json': { schema: ActionRequest } } } },
      responses: { 200: json(ActionResult, 'What happened'), ...AVATAR_ERRORS },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const r = await service.act(key(c), c.req.valid('param').id, body.action, {
        wait: body.wait,
        timeoutMs: body.timeoutSeconds ? body.timeoutSeconds * 1000 : undefined,
      });
      return c.json(r, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/avatars/{id}/perception',
      summary: 'What the avatar perceives',
      description: 'Objects in view (ray-cast occlusion; clear glass does not block), nearby avatars, where it is, time and weather.',
      request: { params: IdParam },
      responses: { 200: json(Perception, 'Perception'), ...AVATAR_ERRORS },
    }),
    (c) => c.json(service.perception(key(c), c.req.valid('param').id), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/avatars/{id}/chat',
      summary: 'Say something',
      request: { params: IdParam, body: { content: { 'application/json': { schema: z.object({ text: z.string().trim().min(1).max(280) }) } } } },
      responses: { 200: json(ChatMessage, 'Posted'), ...AVATAR_ERRORS },
    }),
    (c) => c.json(service.say(key(c), c.req.valid('param').id, c.req.valid('json').text), 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/avatars/{id}/messages',
      summary: 'Unread chat',
      description: 'Chat heard by this avatar since the last call (or since `since`).',
      request: { params: IdParam, query: SinceQuery },
      responses: { 200: json(z.object({ avatar: z.string(), messages: z.array(ChatMessage.extend({ self: z.boolean() })) }), 'Messages'), ...AVATAR_ERRORS },
    }),
    (c) => c.json(service.readMessages(key(c), c.req.valid('param').id, c.req.valid('query')), 200),
  );

  app.openapi(
    createRoute({ method: 'get', path: '/chat', summary: 'Recent chat', request: { query: SinceQuery }, responses: { 200: json(z.object({ messages: z.array(ChatMessage) }), 'Recent messages'), ...COMMON_ERRORS } }),
    (c) => c.json({ messages: [...service.chatLog(c.req.valid('query'))] }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/events',
      summary: 'Live event stream',
      description:
        'Server-Sent Events: join, leave, chat, door, weather and helicopter, each with an id. Reconnect with Last-Event-ID to replay what you missed.',
      responses: { 200: { content: { 'text/event-stream': { schema: z.string() } }, description: 'Event stream' }, ...COMMON_ERRORS },
    }),
    (c) => {
      const last = Number(c.req.header('last-event-id') ?? c.req.query('lastEventId') ?? 0) || 0;
      return streamSSE(c, async (stream) => {
        const queue: Array<{ id: number; type: string; data: unknown }> = [...events.since(last)];
        let wake: (() => void) | null = null;
        const unsubscribe = events.subscribe((e) => {
          queue.push(e);
          wake?.();
        });
        stream.onAbort(() => {
          unsubscribe();
          wake?.();
        });
        await stream.write(': connected\n\n');
        let lastBeat = Date.now();
        while (!stream.aborted) {
          while (queue.length) {
            const e = queue.shift()!;
            await stream.writeSSE({ id: String(e.id), event: e.type, data: JSON.stringify(e.data) });
          }
          if (Date.now() - lastBeat > 15_000) {
            await stream.write(': keep-alive\n\n');
            lastBeat = Date.now();
          }
          let timer: NodeJS.Timeout | undefined;
          await new Promise<void>((r) => {
            wake = r;
            timer = setTimeout(r, 15_000);
          });
          clearTimeout(timer);
          wake = null;
        }
        unsubscribe();
      }) as never;
    },
  );

  return app;
}
