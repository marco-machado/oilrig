import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { findPlace } from '@oilrig/shared';
import { Player, createKey, member, request, server } from './helpers.ts';

// MCP tool calls over Streamable HTTP, the way Claude or any other MCP client drives an
// avatar with a user's key, while a browser-like player watches.

let key: string;

beforeAll(async () => {
  key = (await createKey(await member('Mcp'), 'mcp-tests')).key;
});

async function connect(k = key) {
  const client = new Client({ name: 'oilrig-tests', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${k}` } } }),
  );
  return client;
}

/** A browser-like player with a fresh account; `name` is its display name. */
async function watcher(display: string) {
  const m = await member(display);
  const [p] = await Player.join(m);
  return { p, name: m.account.displayName };
}

type Result = Awaited<ReturnType<Client['callTool']>>;
const text = (r: Result) => (r.content as Array<{ type: string; text: string }>).map((c) => c.text).join('\n');
/** The JSON payload that follows the one-line summary. */
const data = (r: Result) => JSON.parse(text(r).slice(text(r).indexOf('\n') + 1));

describe('MCP server', () => {
  it('refuses clients without an API key', async () => {
    const res = await request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(401);
  });

  it('offers the eleven world tools', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['get_world_status', 'interact', 'join_world', 'leave_world', 'list_places', 'look', 'move_to', 'read_messages', 'say', 'turn', 'walk'].sort(),
    );
    const move = tools.find((t) => t.name === 'move_to')!;
    expect(Object.keys((move.inputSchema as { properties: object }).properties)).toEqual(expect.arrayContaining(['place', 'object', 'position', 'run']));
    await client.close();
  });

  it('join → move_to the helipad → say hello, while a browser player watches it happen', async () => {
    const { p: person, name: helena } = await watcher('Helena');
    const client = await connect();

    const joined = data(await client.callTool({ name: 'join_world', arguments: { name: 'Claude' } }));
    const seenJoin = await person.next('join', (m) => m.player.id === joined.id);
    expect(seenJoin.player).toMatchObject({ name: 'Claude', kind: 'agent' });

    const pad = findPlace('helipad').position;
    const moved = await client.callTool({ name: 'move_to', arguments: { place: 'helipad' } });
    expect(moved.isError).toBeFalsy();
    expect(data(moved).status).toBe('arrived');
    const snap = await person.next('snapshot', (m) => m.players.some((p) => p.id === joined.id && Math.hypot(p.p[0] - pad[0], p.p[2] - pad[2]) < 0.7));
    expect(snap.players.find((p) => p.id === joined.id)!.p[1]).toBeCloseTo(pad[1], 0);

    await client.callTool({ name: 'say', arguments: { text: 'Hello from the helipad!' } });
    const chat = await person.next('chat', (m) => m.entry.from === joined.id);
    expect(chat.entry).toMatchObject({ name: 'Claude', text: 'Hello from the helipad!' });

    // look: it stands on the helipad and can see the person if they are in view.
    const seen = data(await client.callTool({ name: 'look', arguments: {} }));
    expect(seen.self.zone).toBe('helipad');
    expect(seen.avatars.map((a: { name: string }) => a.name)).toContain(helena);

    // read_messages: hears what the person says, once.
    person.send({ type: 'chat', text: 'Welcome aboard, Claude.' });
    await person.next('chat', (m) => m.entry.text === 'Welcome aboard, Claude.');
    const first = data(await client.callTool({ name: 'read_messages', arguments: {} }));
    expect(first.map((m: { text: string }) => m.text)).toContain('Welcome aboard, Claude.');
    expect(text(await client.callTool({ name: 'read_messages', arguments: {} }))).toMatch(/No new messages/);

    // leave_world: the person sees the agent go.
    await client.callTool({ name: 'leave_world', arguments: {} });
    expect((await person.next('leave', (m) => m.id === joined.id)).id).toBe(joined.id);
    person.close();
    await client.close();
  });

  it('turn, walk and interact behave like a person would: doors open only within reach', async () => {
    const { p: person, name: tomas } = await watcher('Tomás');
    const client = await connect();
    await client.callTool({ name: 'join_world', arguments: { name: 'Doorman', place: 'terrace' } });

    const far = await client.callTool({ name: 'interact', arguments: { target: 'door-east' } });
    expect(far.isError).toBe(true);
    expect(text(far)).toMatch(/too far/i);

    await client.callTool({ name: 'move_to', arguments: { object: 'door-south-2' } });
    const turned = data(await client.callTool({ name: 'turn', arguments: { heading: 0 } }));
    expect(turned.avatar.heading).toBe(0);
    const opened = await client.callTool({ name: 'interact', arguments: { target: 'door-south-2', action: 'open' } });
    expect(opened.isError).toBeFalsy();
    expect(await person.next('door', (m) => m.id === 'door-south-2')).toMatchObject({ open: true });

    const before = data(await client.callTool({ name: 'look', arguments: {} })).self.position;
    const walked = data(await client.callTool({ name: 'walk', arguments: { direction: 'forward', distance: 2 } }));
    expect(walked.status).toBe('done');
    // Facing north, walking forward goes toward -z.
    expect(before[2] - walked.avatar.position[2]).toBeGreaterThan(1.7);

    const unknown = await client.callTool({ name: 'move_to', arguments: { place: 'the-moon' } });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toMatch(/No place or object/);

    const status = data(await client.callTool({ name: 'get_world_status', arguments: {} }));
    expect(status.doors['door-south-2']).toBe('open');
    expect(status.avatars.map((a: { name: string }) => a.name)).toEqual(expect.arrayContaining([tomas, 'Doorman']));
    person.close();
    await client.close();
  });
});
