import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { serialize } from 'hono/utils/cookie';
import type { z } from 'zod';
import { type ApiKeyInfo, KeyCreateRequest, PasswordChangeRequest, RenameRequest, SignInRequest, SignUpRequest } from '@oilrig/shared';
import type { Accounts, SessionCheck } from '../db/accounts.ts';
import type { OriginPolicy } from './origin.ts';

export const SESSION_COOKIE = 'oilrig_session';

export type AuthEnv = { Variables: { session: NonNullable<SessionCheck> } };

/** What the account routes work with. */
export interface AuthDeps {
  accounts: Accounts;
  origin: OriginPolicy;
  signupsOpen: boolean;
  keys: {
    list(userId: string): ApiKeyInfo[];
    create(userId: string, name: string): Promise<{ ok: true; key: string; info: ApiKeyInfo } | { ok: false; code: string; message: string }>;
    /** Revokes a key; its avatars leave at once. */
    revoke(userId: string, keyId: string): boolean;
  };
  /** A display name changed: people aboard see it at once. */
  renamed(userId: string, name: string): void;
}

const fail = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500, code: string, message: string) => c.json({ error: { code, message } }, status);

const maxAge = (expires: number) => Math.max(0, Math.round((expires - Date.now()) / 1000));

/** The cookie: `<userId>.<token>`, HttpOnly, SameSite=Lax, Secure on https. */
export function sessionCookie(userId: string, token: string, expires: number, secure: boolean) {
  return serialize(SESSION_COOKIE, `${userId}.${token}`, { httpOnly: true, sameSite: 'Lax', secure, path: '/', maxAge: maxAge(expires) });
}

/** The user id and token in a session cookie's value. */
export function parseSessionCookie(raw: string | undefined) {
  const m = raw ? /^([0-9a-f]{16})\.([A-Za-z0-9_-]{43})$/.exec(raw) : null;
  return m ? { userId: m[1], token: m[2] } : null;
}

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

const requestOrigin = (c: Context) => new URL(c.req.url).origin;

/** Sign-up, sign-in and the Account panel, under /auth. Answers are JSON. */
export function authRoutes(deps: AuthDeps) {
  const { accounts, origin, keys } = deps;
  const app = new Hono<AuthEnv>();

  function writeCookie(c: Context, userId: string, token: string, expires: number) {
    setCookie(c, SESSION_COOKIE, `${userId}.${token}`, { httpOnly: true, sameSite: 'Lax', secure: origin.secure(requestOrigin(c)), path: '/', maxAge: maxAge(expires) });
  }

  function clearCookie(c: Context) {
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: origin.secure(requestOrigin(c)) });
  }

  /** Who the session cookie belongs to, renewing the cookie when the session was renewed. */
  async function currentSession(c: Context): Promise<SessionCheck> {
    const id = parseSessionCookie(getCookie(c, SESSION_COOKIE));
    if (!id) return null;
    const s = await accounts.checkSession(id.userId, id.token);
    if (!s) clearCookie(c);
    else if (s.renewed) writeCookie(c, s.account.id, s.token, s.expires);
    return s;
  }

  const requireUser: MiddlewareHandler<AuthEnv> = async (c, next) => {
    const s = await currentSession(c);
    if (!s) return fail(c, 401, 'signed-out', 'Sign in first.');
    c.set('session', s);
    await next();
  };

  app.use('*', async (c, next) => {
    if (c.req.method !== 'GET' && !origin.same(c.req.header('origin'), requestOrigin(c))) return fail(c, 403, 'bad-origin', 'Cross-site request refused.');
    await next();
  });

  app.get('/me', async (c) => {
    const s = await currentSession(c);
    return c.json({ user: s?.account ?? null, signups: deps.signupsOpen });
  });

  app.post('/signup', async (c) => {
    if (!deps.signupsOpen) return fail(c, 403, 'signups-closed', 'Sign-ups are closed.');
    const b = await body(c, SignUpRequest);
    if (!b.ok) return b.res;
    const reg = await accounts.signUp(b.data);
    if (!reg.ok) return fail(c, 409, reg.code, reg.message);
    const s = await accounts.signIn(reg.account.id, b.data.password);
    if (!s.ok) return fail(c, 500, 'server-error', 'Account created, but signing in failed. Try signing in.');
    writeCookie(c, reg.account.id, s.token, s.expires);
    return c.json({ user: s.account }, 201);
  });

  app.post('/signin', async (c) => {
    const b = await body(c, SignInRequest);
    if (!b.ok) return b.res;
    const userId = accounts.lookup(b.data.username);
    if (!userId) return fail(c, 401, 'bad-credentials', 'Wrong username or password.');
    const s = await accounts.signIn(userId, b.data.password);
    if (!s.ok) {
      if (s.code === 'locked') c.header('Retry-After', String(s.retryAfterSeconds));
      return fail(c, s.code === 'locked' ? 429 : 401, s.code, s.message);
    }
    writeCookie(c, userId, s.token, s.expires);
    return c.json({ user: s.account });
  });

  app.post('/signout', async (c) => {
    const s = await currentSession(c);
    if (s) await accounts.signOut(s.account.id, s.token);
    clearCookie(c);
    return c.json({ ok: true });
  });

  app.patch('/me', requireUser, async (c) => {
    const b = await body(c, RenameRequest);
    if (!b.ok) return b.res;
    const { account } = c.get('session');
    const r = accounts.rename(account.id, b.data.displayName);
    if (!r.ok) return fail(c, r.code === 'name-taken' ? 409 : 404, r.code, r.message);
    deps.renamed(account.id, r.account.displayName);
    return c.json({ user: r.account });
  });

  app.post('/password', requireUser, async (c) => {
    const b = await body(c, PasswordChangeRequest);
    if (!b.ok) return b.res;
    const s = c.get('session');
    const r = await accounts.changePassword(s.account.id, s.token, b.data.current, b.data.password);
    if (!r.ok) return fail(c, 403, r.code, r.message);
    return c.json({ ok: true });
  });

  app.get('/keys', requireUser, (c) => c.json({ keys: keys.list(c.get('session').account.id) }));

  app.post('/keys', requireUser, async (c) => {
    const b = await body(c, KeyCreateRequest);
    if (!b.ok) return b.res;
    const r = await keys.create(c.get('session').account.id, b.data.name);
    if (!r.ok) return fail(c, 409, r.code, r.message);
    return c.json({ key: r.key, info: r.info }, 201);
  });

  app.delete('/keys/:id', requireUser, (c) => {
    const ok = keys.revoke(c.get('session').account.id, c.req.param('id'));
    if (!ok) return fail(c, 404, 'unknown-key', 'No such key.');
    return c.json({ ok: true });
  });

  app.onError((err, c) => {
    console.error('[auth]', err);
    return fail(c, 500, 'server-error', 'Something went wrong.');
  });

  return app;
}
