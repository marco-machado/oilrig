import type { Account, ApiKeyInfo, MeResponse } from '@oilrig/shared';

// The Worker's /auth API: sign-up, sign-in and the Account panel. The session is an
// HttpOnly cookie, so nothing here stores a token.

export class AuthError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/auth${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new AuthError('unreachable', 'Could not reach the server.', 0);
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: { code: string; message: string } }) | null;
  if (!res.ok || !data) throw new AuthError(data?.error?.code ?? 'server-error', data?.error?.message ?? 'Something went wrong.', res.status);
  return data;
}

export const auth = {
  me: () => call<MeResponse>('GET', '/me'),
  signIn: (username: string, password: string) => call<{ user: Account }>('POST', '/signin', { username, password }),
  signUp: (username: string, displayName: string, password: string) => call<{ user: Account }>('POST', '/signup', { username, displayName, password }),
  signOut: () => call<{ ok: true }>('POST', '/signout'),
  rename: (displayName: string) => call<{ user: Account }>('PATCH', '/me', { displayName }),
  changePassword: (current: string, password: string) => call<{ ok: true }>('POST', '/password', { current, password }),
  keys: () => call<{ keys: ApiKeyInfo[] }>('GET', '/keys'),
  createKey: (name: string) => call<{ key: string; info: ApiKeyInfo }>('POST', '/keys', { name }),
  revokeKey: (id: string) => call<{ ok: true }>('DELETE', `/keys/${encodeURIComponent(id)}`),
};
