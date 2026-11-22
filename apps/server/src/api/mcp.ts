import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { AgentError } from '../agents/manager.ts';
import { InteractFields, MoveToFields, TurnFields, WalkFields } from './schemas.ts';
import type { ApiService } from './service.ts';

// MCP endpoint (Streamable HTTP, stateless per request). Every request carries the API
// key; the avatar belongs to the key, so tools act on "your avatar" without sessions.

const INSTRUCTIONS = `You are visiting Oilrig, a glass house on a converted offshore platform 20 m above the open ocean.
Call join_world first to come aboard as an avatar; people in their browsers will see you.
Use list_places for named destinations, move_to to walk there (doors open on the way), look to see what is around you,
say to talk and read_messages to hear replies. A four-seat passenger drone lives on the helipad; people can fly it, and now and then it flies off on its own and comes back, holding off while anyone stands on the landing circle. A glass elevator runs from the main deck to the boat landing (agents take the stairs).`;

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const ok = (summary: string, data?: unknown): ToolResult => ({
  content: [{ type: 'text', text: data === undefined ? summary : `${summary}\n${JSON.stringify(data, null, 1)}` }],
});

async function run(fn: () => Promise<ToolResult> | ToolResult): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AgentError) return { content: [{ type: 'text', text: err.message }], isError: true };
    console.error('[mcp]', err);
    return { content: [{ type: 'text', text: 'Something went wrong on the server.' }], isError: true };
  }
}

const avatarId = { avatar_id: z.string().optional().describe('Which of your avatars (default: your most recent one)') };

export function buildMcpServer(service: ApiService, keyId: string) {
  const server = new McpServer({ name: 'oilrig', version: '1.0.0' }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'join_world',
    {
      title: 'Join the world',
      description: 'Come aboard as an avatar. Returns your avatar id and position. Calling it again with the same name returns the avatar you already have.',
      inputSchema: z.object({
        name: z.string().trim().min(1).max(24).describe('Name shown above your avatar'),
        place: z.string().optional().describe('Place id to appear at (default: terrace)'),
      }),
    },
    ({ name, place }) =>
      run(async () => {
        const r = await service.join(keyId, name, place);
        return ok(r.created ? `You are aboard as ${r.avatar.name}.` : `${r.avatar.name} was already aboard.`, r.avatar);
      }),
  );

  server.registerTool(
    'leave_world',
    { title: 'Leave the world', description: 'Your avatar leaves the platform.', inputSchema: z.object({ ...avatarId }) },
    ({ avatar_id }) => run(() => ok(`${service.leave(keyId, avatar_id).name} has left.`)),
  );

  server.registerTool(
    'look',
    {
      title: 'Look around',
      description:
        'What your avatar perceives: objects in view with distance and bearing (degrees, positive = right), nearby avatars, where you are, time, weather and the drone.',
      inputSchema: z.object({ ...avatarId }),
      annotations: { readOnlyHint: true },
    },
    ({ avatar_id }) => run(() => ok('Perception:', service.perception(keyId, avatar_id))),
  );

  server.registerTool(
    'list_places',
    { title: 'List places', description: 'Named places you can move_to.', inputSchema: z.object({}), annotations: { readOnlyHint: true } },
    () => run(() => ok('Places:', service.places())),
  );

  server.registerTool(
    'move_to',
    {
      title: 'Walk somewhere',
      description:
        'Walk along a navmesh route to a place id (see list_places), an object id from look (e.g. "living-sofa"), another avatar, or [x,y,z]. Waits until you arrive unless wait is false.',
      inputSchema: z.object({
        ...MoveToFields,
        wait: z.boolean().optional().describe('Wait for arrival (default true)'),
        ...avatarId,
      }),
    },
    ({ avatar_id, wait, ...target }) =>
      run(async () => {
        const r = await service.act(keyId, avatar_id, { type: 'move_to', ...target }, { wait });
        return { ...ok(r.message, r), isError: r.status === 'unreachable' || r.status === 'blocked' ? true : undefined };
      }),
  );

  server.registerTool(
    'walk',
    {
      title: 'Walk a short distance',
      description: 'Step forward, backward, left or right (relative to where you face) for a distance in metres or a number of seconds.',
      inputSchema: z.object({ ...WalkFields, ...avatarId }),
    },
    ({ avatar_id, ...w }) =>
      run(async () => {
        const r = await service.act(keyId, avatar_id, { type: 'walk', ...w });
        return ok(r.message, r);
      }),
  );

  server.registerTool(
    'turn',
    {
      title: 'Turn',
      description: 'Turn by degrees (positive = right), to a compass heading, or to face an object, avatar or place id.',
      inputSchema: z.object({ ...TurnFields, ...avatarId }),
    },
    ({ avatar_id, ...t }) =>
      run(async () => {
        const r = await service.act(keyId, avatar_id, { type: 'turn', ...t });
        return ok(r.message, r);
      }),
  );

  server.registerTool(
    'interact',
    {
      title: 'Operate a door',
      description: 'Open, close or toggle a door you are standing near (within 4 m). Door ids appear in look.',
      inputSchema: z.object({ ...InteractFields, ...avatarId }),
    },
    ({ avatar_id, target, action }) =>
      run(async () => {
        const r = await service.act(keyId, avatar_id, { type: 'interact', target, action });
        return ok(r.message, r);
      }),
  );

  server.registerTool(
    'say',
    {
      title: 'Say something',
      description: 'Speak in the shared chat. People see it in their chat and above your avatar.',
      inputSchema: z.object({ text: z.string().trim().min(1).max(280), ...avatarId }),
    },
    ({ avatar_id, text }) => run(() => ok('Said:', service.say(keyId, avatar_id, text))),
  );

  server.registerTool(
    'read_messages',
    {
      title: 'Read messages',
      description: 'Chat your avatar has heard since you last read (or since a server time in ms).',
      inputSchema: z.object({ since: z.number().optional(), limit: z.number().int().min(1).max(200).optional(), ...avatarId }),
    },
    ({ avatar_id, since, limit }) =>
      run(() => {
        const r = service.readMessages(keyId, avatar_id, { since, limit });
        return ok(r.messages.length ? `${r.messages.length} message(s):` : 'No new messages.', r.messages);
      }),
  );

  server.registerTool(
    'get_world_status',
    {
      title: 'World status',
      description: 'Local time, weather, who is aboard, doors, the drone and the elevator.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    () => run(() => ok('World status:', service.worldStatus())),
  );

  return server;
}

/** Fetch handler for /mcp. The caller has already authenticated the key. */
export function createMcpEndpoint(service: ApiService) {
  const handler = createMcpHandler(
    (ctx) => {
      const keyId = ctx.authInfo?.clientId;
      if (!keyId) throw new Error('unauthenticated MCP request');
      return buildMcpServer(service, keyId);
    },
    { onerror: (e) => console.error('[mcp]', e.message) },
  );
  return {
    fetch(req: Request, keyId: string, token: string) {
      return handler.fetch(req, { authInfo: { token, clientId: keyId, scopes: [] } });
    },
    close: () => handler.close?.(),
  };
}
