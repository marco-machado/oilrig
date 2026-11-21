import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { z } from 'zod';
import {
  type Account,
  KeyCreateRequest,
  PasswordChangeRequest,
  RenameRequest,
  SignInRequest,
  SignUpRequest,
} from '@oilrig/shared';
import { signupsOpen } from '../config.ts';
import type { SessionCheck } from '../do/user.ts';

export const SESSION_COOKIE = 'oilrig_session';

export type AuthEnv = { Bindings: Env; Variables: { session: NonNullable<SessionCheck> } };

const fail = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500, code: string, message: string) => c.json({ error: { code, message } }, status);

/** The cookie: `<userId>.<token>`, HttpOnly, SameSite=Lax, Secure on https. */
function writeCookie(c: Context, userId: string, token: string, expires: number) {
  setCookie(c, SESSION_COOKIE, `${userId}.${token}`, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: new URL(c.req.url).protocol === 'https:',
    path: '/',
    maxAge: Math.max(0, Math.round((expires - Date.now()) / 1000)),
  });
}

function clearCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: new URL(c.req.url).protocol === 'https:' });
}

const users = (env: Env, userId: string) => env.USERS.getByName(userId);
const directory = (env: Env) => env.DIRECTORY.getByName('directory');
const world = (env: Env) => env.WORLD.getByName('world');

/** Who the session cookie belongs to, renewing the cookie when the session was renewed. */
export async function currentSession(c: Context<AuthEnv>): Promise<SessionCheck> {
  const raw = getCookie(c, SESSION_COOKIE);
  const m = raw ? /^([0-9a-f]{16})\.([A-Za-z0-9_-]{43})$/.exec(raw) : null;
  if (!m) return null;
  const s = await users(c.env, m[1]).checkSession(m[2]);
  if (!s) clearCookie(c);
  else if (s.renewed) writeCookie(c, s.account.id, s.token, s.expires);
  return s;
}

/** A request from a page on another site is refused (browsers always send Origin then). */
export function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}

const requireUser: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const s = await currentSession(c);
  if (!s) return fail(c, 401, 'signed-out', 'Sign in first.');
  c.set('session', s);
  await next();
};

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<{ ok: true; data: z.output<T> } | { ok: false; res: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, res: fail(c, 400, 'invalid-request', 'Send JSON.') };
  }
  const r = schema.safeParse(raw);
  if (!r.success) return { ok: false, res: fail(c, 422, 'invalid-request', r.error.issues[0]?.message ?? 'Invalid request.') };
  return { ok: true, data: r.data };
}

/** Sign-up, sign-in and the Account panel, under /auth. Answers are JSON. */
export function authRoutes() {
  const app = new Hono<AuthEnv>();

  app.use('*', async (c, next) => {
    if (c.req.method !== 'GET' && !sameOrigin(c.req.raw)) return fail(c, 403, 'bad-origin', 'Cross-site request refused.');
    await next();
  });

  app.get('/me', async (c) => {
    const s = await currentSession(c);
    return c.json({ user: s?.account ?? null, signups: signupsOpen(c.env) });
  });

  app.post('/signup', async (c) => {
    if (!signupsOpen(c.env)) return fail(c, 403, 'signups-closed', 'Sign-ups are closed.');
    const b = await body(c, SignUpRequest);
    if (!b.ok) return b.res;
    const { username, displayName, password } = b.data;
    const reg = await directory(c.env).register(username, displayName);
    if (!reg.ok) return fail(c, 409, reg.code, reg.message);
    const user = users(c.env, reg.userId);
    try {
      await user.create({ userId: reg.userId, username, displayName, password });
    } catch (err) {
      await directory(c.env).release(reg.userId);
      throw err;
    }
    const s = await user.signIn(password);
    if (!s.ok) return fail(c, 500, 'server-error', 'Account created, but signing in failed. Try signing in.');
    writeCookie(c, reg.userId, s.token, s.expires);
    return c.json({ user: s.account }, 201);
  });

  app.post('/signin', async (c) => {
    const b = await body(c, SignInRequest);
    if (!b.ok) return b.res;
    const userId = await directory(c.env).lookup(b.data.username);
    if (!userId) return fail(c, 401, 'bad-credentials', 'Wrong username or password.');
    const s = await users(c.env, userId).signIn(b.data.password);
    if (!s.ok) {
      if (s.code === 'locked') c.header('Retry-After', String(s.retryAfterSeconds));
      return fail(c, s.code === 'locked' ? 429 : 401, s.code, s.message);
    }
    writeCookie(c, userId, s.token, s.expires);
    return c.json({ user: s.account });
  });

  app.post('/signout', async (c) => {
    const s = await currentSession(c);
    if (s) await users(c.env, s.account.id).signOut(s.token);
    clearCookie(c);
    return c.json({ ok: true });
  });

  app.patch('/me', requireUser, async (c) => {
    const b = await body(c, RenameRequest);
    if (!b.ok) return b.res;
    const { account } = c.get('session');
    const name = b.data.displayName;
    const r = await directory(c.env).rename(account.id, name);
    if (!r.ok) return fail(c, r.code === 'name-taken' ? 409 : 404, r.code, r.message);
    const updated = (await users(c.env, account.id).setDisplayName(name)) as Account;
    await world(c.env).rename(account.id, name);
    return c.json({ user: updated });
  });

  app.post('/password', requireUser, async (c) => {
    const b = await body(c, PasswordChangeRequest);
    if (!b.ok) return b.res;
    const s = c.get('session');
    const r = await users(c.env, s.account.id).changePassword(s.token, b.data.current, b.data.password);
    if (!r.ok) return fail(c, 403, r.code, r.message);
    return c.json({ ok: true });
  });

  app.get('/keys', requireUser, async (c) => c.json({ keys: await world(c.env).listKeys(c.get('session').account.id) }));

  app.post('/keys', requireUser, async (c) => {
    const b = await body(c, KeyCreateRequest);
    if (!b.ok) return b.res;
    const r = await world(c.env).createKey(c.get('session').account.id, b.data.name);
    if (!r.ok) return fail(c, 409, r.code, r.message);
    return c.json({ key: r.key, info: r.info }, 201);
  });

  app.delete('/keys/:id', requireUser, async (c) => {
    const ok = await world(c.env).revokeKey(c.get('session').account.id, c.req.param('id'));
    if (!ok) return fail(c, 404, 'unknown-key', 'No such key.');
    return c.json({ ok: true });
  });

  app.onError((err, c) => {
    console.error('[auth]', err);
    return fail(c, 500, 'server-error', 'Something went wrong.');
  });

  return app;
}
