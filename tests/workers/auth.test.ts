import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../apps/server/src/worker.ts';
import type { UserDO } from '../../apps/server/src/do/user.ts';
import { cookieFrom, member, request, uniqueName } from './helpers.ts';

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
    const closedEnv = { ...env, ALLOW_SIGNUPS: 'false' };
    const res = await worker.request(
      '/auth/signup',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uniqueName('late'), displayName: 'Late', password: 'long enough' }) },
      closedEnv,
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('signups-closed');
    expect(await (await worker.request('/auth/me', {}, closedEnv)).json()).toEqual({ user: null, signups: false });
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
    await runInDurableObject(env.USERS.getByName(m.account.id), (_: UserDO, state) => {
      state.storage.sql.exec('UPDATE throttle SET locked_until = 0');
    });
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
    await runInDurableObject(env.USERS.getByName(m.account.id), (_: UserDO, state) => {
      state.storage.sql.exec('UPDATE sessions SET renewed = renewed - ?', 2 * 24 * 3600_000);
    });
    expect((await request('/auth/me', { cookie: m.cookie })).headers.get('set-cookie')).toMatch(/Max-Age=2592000/);
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
});
