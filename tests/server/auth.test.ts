import { describe, expect, it } from 'vitest';
import { Player, cookieFrom, member, request, server, startTestServer, uniqueName } from './helpers.ts';

const signUp = (json: unknown, init: RequestInit = {}) => request('/auth/signup', { method: 'POST', json, ...init });
const signIn = (username: string, password: string) => request('/auth/signin', { method: 'POST', json: { username, password } });

describe('accounts', () => {
  it('signs up, sets a session cookie, and knows who you are', async () => {
    const username = uniqueName('ana');
    const res = await signUp({ username: username.toUpperCase(), displayName: `Ana ${username}`, password: 'sea breeze 42' });
    expect(res.status).toBe(201);
    const set = res.headers.get('set-cookie')!;
    expect(set).toMatch(/oilrig_session=/);
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
    expect(set).toMatch(/Max-Age=2592000/);
    expect(set).not.toMatch(/Secure/i); // plain http in tests; https deployments get Secure
    const { user } = (await res.json()) as { user: { username: string; id: string } };
    expect(user.username).toBe(username); // stored lower-case

    const me = (await (await request('/auth/me', { cookie: cookieFrom(res) })).json()) as { user: { id: string }; signups: boolean };
    expect(me).toMatchObject({ user: { id: user.id }, signups: true });
    expect(await (await request('/auth/me')).json()).toEqual({ user: null, signups: true });
  });

  it('keeps usernames and display names unique, ignoring case and spacing', async () => {
    const a = await member('Unique');
    expect((await signUp({ username: a.username, displayName: 'Someone Else', password: 'long enough' })).status).toBe(409);
    const clash = await signUp({ username: uniqueName('b'), displayName: `  ${a.account.displayName.toUpperCase()} `, password: 'long enough' });
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { error: { code: string } }).error.code).toBe('name-taken');
  });

  it('validates sign-ups', async () => {
    for (const bad of [
      { username: 'ab', displayName: 'Short', password: 'long enough' },
      { username: 'has space', displayName: 'Space', password: 'long enough' },
      { username: uniqueName('ok'), displayName: '\u0007bell', password: 'long enough' },
      { username: uniqueName('ok'), displayName: 'x'.repeat(25), password: 'long enough' },
      { username: uniqueName('ok'), displayName: 'Fine', password: 'short' },
    ]) {
      expect((await signUp(bad)).status, JSON.stringify(bad)).toBe(422);
    }
  });

  it('refuses sign-ups when ALLOW_SIGNUPS is not "true"', async () => {
    const closed = await startTestServer({ ALLOW_SIGNUPS: 'false' });
    try {
      const res = await request('/auth/signup', { server: closed, method: 'POST', json: { username: uniqueName('late'), displayName: 'Late', password: 'long enough' } });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('signups-closed');
      expect(await (await request('/auth/me', { server: closed })).json()).toEqual({ user: null, signups: false });
    } finally {
      await closed.close();
    }
  });

  it('signs in, refuses wrong passwords alike for unknown users, and signs out server-side', async () => {
    const m = await member('Signer');
    expect((await signIn(m.username, 'nope nope')).status).toBe(401);
    expect((await signIn(uniqueName('ghost'), 'nope nope')).status).toBe(401);
    const ok = await signIn(m.username.toUpperCase(), m.password);
    expect(ok.status).toBe(200);
    const cookie = cookieFrom(ok);

    const out = await request('/auth/signout', { method: 'POST', cookie });
    expect(out.headers.get('set-cookie')).toMatch(/oilrig_session=;/);
    // The old cookie no longer works, even if a client keeps sending it.
    expect(await (await request('/auth/me', { cookie })).json()).toMatchObject({ user: null });
  });

  it('locks an account for a minute after five wrong passwords', async () => {
    const m = await member('Locked');
    for (let i = 0; i < 5; i++) expect((await signIn(m.username, `wrong ${i}`)).status).toBe(401);
    const locked = await signIn(m.username, m.password);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(50);
    // Once the minute is over, the right password works again.
    server.db.run('UPDATE users SET locked_until = 0 WHERE user_id = ?', m.account.id);
    expect((await signIn(m.username, m.password)).status).toBe(200);
  });

  it('rejects tampered cookies', async () => {
    const m = await member('Tamper');
    const [id, token] = m.cookie.replace('oilrig_session=', '').split('.');
    const other = await member('Victim');
    for (const cookie of [`oilrig_session=${other.account.id}.${token}`, `oilrig_session=${id}.${'A'.repeat(43)}`, 'oilrig_session=garbage']) {
      expect(await (await request('/auth/me', { cookie })).json(), cookie).toMatchObject({ user: null });
    }
  });

  it('renews a session at most once a day', async () => {
    const m = await member('Renew');
    expect((await request('/auth/me', { cookie: m.cookie })).headers.get('set-cookie')).toBeNull();
    const longAgo = () => server.db.run('UPDATE sessions SET renewed = renewed - ? WHERE user_id = ?', 2 * 24 * 3600_000, m.account.id);
    longAgo();
    expect((await request('/auth/me', { cookie: m.cookie })).headers.get('set-cookie')).toMatch(/Max-Age=2592000/);
    expect((await request('/auth/me', { cookie: m.cookie })).headers.get('set-cookie')).toBeNull();
    // Opening the game socket renews it too, and the cookie comes with the upgrade.
    longAgo();
    const p = await Player.connect(m.cookie);
    expect(p.setCookie).toMatch(/oilrig_session=.*Max-Age=2592000.*HttpOnly/);
    p.close();
  });

  it('changes the password with the current one and ends the other sessions', async () => {
    const m = await member('Mover');
    const elsewhere = cookieFrom(await signIn(m.username, m.password));
    expect((await request('/auth/password', { method: 'POST', cookie: m.cookie, json: { current: 'not it', password: 'brand new pass' } })).status).toBe(403);
    expect((await request('/auth/password', { method: 'POST', cookie: m.cookie, json: { current: m.password, password: 'brand new pass' } })).status).toBe(200);
    expect(await (await request('/auth/me', { cookie: m.cookie })).json()).toMatchObject({ user: { id: m.account.id } });
    expect(await (await request('/auth/me', { cookie: elsewhere })).json()).toMatchObject({ user: null });
    expect((await signIn(m.username, m.password)).status).toBe(401);
    expect((await signIn(m.username, 'brand new pass')).status).toBe(200);
  });

  it('refuses cross-site requests that change things', async () => {
    const m = await member('Origin');
    const res = await request('/auth/me', { method: 'PATCH', cookie: m.cookie, json: { displayName: 'Hijacked' }, headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect((await request('/auth/password', { method: 'POST', cookie: m.cookie, json: { current: m.password, password: 'evil evil' }, headers: { origin: 'https://evil.example' } })).status).toBe(403);
  });

  it('manages API keys: at most five, listed without secrets, revocable', async () => {
    const m = await member('Keys');
    const made: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await request('/auth/keys', { method: 'POST', cookie: m.cookie, json: { name: `key ${i}` } });
      expect(r.status).toBe(201);
      const body = (await r.json()) as { key: string; info: { id: string; ratePerMinute: number } };
      expect(body.key).toMatch(/^ork_[0-9a-f]{8}_[A-Za-z0-9_-]{32}$/);
      expect(body.info.ratePerMinute).toBe(120);
      made.push(body.info.id);
    }
    const sixth = await request('/auth/keys', { method: 'POST', cookie: m.cookie, json: { name: 'one too many' } });
    expect(sixth.status).toBe(409);
    const list = JSON.stringify(await (await request('/auth/keys', { cookie: m.cookie })).json());
    expect(list).not.toMatch(/ork_[0-9a-f]{8}_/);
    expect((await request(`/auth/keys/${made[0]}`, { method: 'DELETE', cookie: m.cookie })).status).toBe(200);
    expect((await request(`/auth/keys/${made[0]}`, { method: 'DELETE', cookie: m.cookie })).status).toBe(404);
    // Someone else's key cannot be revoked.
    const other = await member('Other');
    expect((await request(`/auth/keys/${made[1]}`, { method: 'DELETE', cookie: other.cookie })).status).toBe(404);
    expect((await request('/auth/keys', { method: 'POST', cookie: m.cookie, json: { name: 'room again' } })).status).toBe(201);
    expect((await request('/auth/keys')).status).toBe(401);
  });

  it('keeps accounts apart: a password change, a lock and a sign-out touch one account only', async () => {
    const a = await member('Apart A');
    const b = await member('Apart B');
    const bElsewhere = cookieFrom(await signIn(b.username, b.password));
    expect((await request('/auth/password', { method: 'POST', cookie: a.cookie, json: { current: a.password, password: 'another secret' } })).status).toBe(200);
    for (let i = 0; i < 5; i++) await signIn(a.username, 'wrong');
    expect((await signIn(a.username, 'another secret')).status).toBe(429);
    // B's password, both of B's sessions and B's sign-in are as they were.
    expect((await signIn(b.username, b.password)).status).toBe(200);
    for (const cookie of [b.cookie, bElsewhere]) expect(await (await request('/auth/me', { cookie })).json()).toMatchObject({ user: { id: b.account.id } });
    expect((await request('/auth/signout', { method: 'POST', cookie: bElsewhere })).status).toBe(200);
    expect(await (await request('/auth/me', { cookie: b.cookie })).json()).toMatchObject({ user: { id: b.account.id } });
    expect(await (await request('/auth/me', { cookie: a.cookie })).json()).toMatchObject({ user: { id: a.account.id } });
  });

  it('counts wrong passwords sent at the same moment, and never lets as many keys through as were asked for at once', async () => {
    const m = await member('Racer');
    const guesses = await Promise.all(Array.from({ length: 5 }, (_, i) => signIn(m.username, `wrong ${i}`)));
    expect(guesses.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
    expect((await signIn(m.username, m.password)).status).toBe(429);

    const made = await Promise.all(Array.from({ length: 8 }, (_, i) => request('/auth/keys', { method: 'POST', cookie: m.cookie, json: { name: `key ${i}` } })));
    expect(made.map((r) => r.status).sort()).toEqual([201, 201, 201, 201, 201, 409, 409, 409]);
    expect(((await (await request('/auth/keys', { cookie: m.cookie })).json()) as { keys: unknown[] }).keys).toHaveLength(5);
  });

  it('signs up one account when the same username is asked for twice at once', async () => {
    const username = uniqueName('twin');
    const both = await Promise.all([1, 2].map((i) => signUp({ username, displayName: `Twin ${username} ${i}`.slice(0, 24), password: 'long enough' })));
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('lists and revokes keys, and renames, before the world has been built', async () => {
    const cold = await startTestServer();
    try {
      const res = await request('/auth/signup', { server: cold, method: 'POST', json: { username: uniqueName('cold'), displayName: 'Cold Start', password: 'long enough' } });
      const cookie = cookieFrom(res);
      const made = (await (await request('/auth/keys', { server: cold, method: 'POST', cookie, json: { name: 'early' } })).json()) as { info: { id: string } };
      expect(((await (await request('/auth/keys', { server: cold, cookie })).json()) as { keys: unknown[] }).keys).toHaveLength(1);
      expect((await request('/auth/me', { server: cold, method: 'PATCH', cookie, json: { displayName: 'Colder Start' } })).status).toBe(200);
      expect((await request(`/auth/keys/${made.info.id}`, { server: cold, method: 'DELETE', cookie })).status).toBe(200);
      expect(cold.booted).toBe(false);
    } finally {
      await cold.close();
    }
  });
});

describe('behind a proxy that terminates TLS (PUBLIC_ORIGIN)', () => {
  it('goes by the public origin: its pages are accepted, others refused, and the cookie is Secure', async () => {
    const proxied = await startTestServer({ PUBLIC_ORIGIN: 'https://rig.example.com' });
    try {
      const json = { username: uniqueName('tls'), displayName: 'Behind Tls', password: 'long enough' };
      const own = { origin: 'https://rig.example.com' };
      // The server itself is reached over plain HTTP at another host name, as it is behind a proxy.
      expect((await request('/auth/signup', { server: proxied, method: 'POST', json, headers: { origin: proxied.url } })).status).toBe(403);
      expect((await request('/auth/signup', { server: proxied, method: 'POST', json, headers: { origin: 'http://rig.example.com' } })).status).toBe(403);
      const res = await request('/auth/signup', { server: proxied, method: 'POST', json, headers: own });
      expect(res.status).toBe(201);
      expect(res.headers.get('set-cookie')).toMatch(/; Secure/);
      const cookie = cookieFrom(res);
      expect((await request('/auth/signout', { server: proxied, method: 'POST', cookie: 'oilrig_session=x' })).headers.get('set-cookie')).toMatch(/; Secure/);

      expect(await Player.refused(cookie, { origin: proxied.url }, proxied)).toBe(403);
      const p = await Player.connect(cookie, own, proxied);
      p.send({ type: 'hello', version: 1 });
      p.close();
      // No Origin at all is not a browser page: scripts and agents are let through.
      expect((await request('/auth/keys', { server: proxied, method: 'POST', cookie, json: { name: 'script' } })).status).toBe(201);
    } finally {
      await proxied.close();
    }
  });
});
