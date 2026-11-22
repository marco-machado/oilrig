import { Hono } from 'hono';
import { CLOSE } from '@oilrig/shared';
import { type AuthEnv, authRoutes, currentSession, sameOrigin } from './auth/routes.ts';
import { IDENTITY_HEADER } from './do/world.ts';

export { DirectoryDO } from './do/directory.ts';
export { UserDO } from './do/user.ts';
export { WorldDO } from './do/world.ts';

// The Worker in front: static files are served before it runs (see wrangler.jsonc); it
// handles sign-in, checks who opens a game socket, and passes the rest to the World DO.

const app = new Hono<AuthEnv>();
const world = (env: Env) => env.WORLD.getByName('world');

/** The World DO trusts IDENTITY_HEADER, so nobody else gets to set it. */
function forwarded(req: Request, identity?: { userId: string; name: string }) {
  const headers = new Headers(req.headers);
  headers.delete(IDENTITY_HEADER);
  if (identity) headers.set(IDENTITY_HEADER, encodeURIComponent(JSON.stringify(identity)));
  return new Request(req, { headers });
}

/** Browsers cannot read an HTTP error on a WebSocket upgrade, so a refusal is a socket that says why and closes. */
function refuseSocket(code: number, reason: string, message: string) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.send(JSON.stringify({ type: 'error', code: 'signed-out', message }));
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}

app.get('/healthz', async (c) => c.json(await world(c.env).health()));

app.route('/auth', authRoutes());

app.get('/ws', async (c) => {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return c.text('Expected a WebSocket upgrade.', 426);
  if (!sameOrigin(c.req.raw)) return c.text('Cross-site socket refused.', 403);
  const s = await currentSession(c);
  if (!s) return refuseSocket(CLOSE.unauthorized, 'signed out', 'Sign in to come aboard.');
  return world(c.env).fetch(forwarded(c.req.raw, { userId: s.account.id, name: s.account.displayName }));
});

app.all('/api/*', (c) => world(c.env).fetch(forwarded(c.req.raw)));
app.all('/mcp', (c) => world(c.env).fetch(forwarded(c.req.raw)));

export default app satisfies ExportedHandler<Env>;
