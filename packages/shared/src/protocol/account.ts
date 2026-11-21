import { z } from 'zod';
import { NET } from '../config.ts';

// Accounts: shared by the sign-up page, the Account panel and the Worker, so all three
// accept and refuse the same things.

/** 3-24 of a-z, 0-9, _ and -. Typed in any case; stored lower-case. */
export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_-]{3,24}$/, 'Usernames are 3 to 24 letters, digits, _ or -.');

/** NFC, single spaces, no control characters, 1-24 characters. Shown above the avatar. */
export const DisplayName = z
  .string()
  .transform((s) => s.normalize('NFC').replace(/\s+/gu, ' ').trim())
  .refine((s) => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(s), 'Display names cannot contain control characters.')
  .refine((s) => displayKey(s).length > 0, 'Pick a display name.')
  .refine((s) => [...s].length <= NET.nameMaxLength, `Display names are at most ${NET.nameMaxLength} characters.`);

export const Password = z.string().min(8, 'Passwords are at least 8 characters.').max(256, 'Passwords are at most 256 characters.');

/** What makes two display names "the same": case, compatibility forms, invisible characters and spacing are ignored. */
export function displayKey(name: string) {
  return name.normalize('NFKC').toLowerCase().replace(/[\p{Cf}\s]+/gu, '');
}

export const SignUpRequest = z.object({ username: Username, displayName: DisplayName, password: Password });
export const SignInRequest = z.object({ username: z.string().trim().toLowerCase().max(64), password: z.string().max(256) });
export const RenameRequest = z.object({ displayName: DisplayName });
export const PasswordChangeRequest = z.object({ current: z.string().max(256), password: Password });
export const KeyCreateRequest = z.object({ name: z.string().trim().min(1, 'Name the key.').max(40, 'Key names are at most 40 characters.') });

export const Account = z.object({ id: z.string(), username: z.string(), displayName: z.string(), color: z.string() });
export type Account = z.infer<typeof Account>;

/** GET /auth/me: who is signed in (if anyone) and whether sign-ups are open. */
export const MeResponse = z.object({ user: Account.nullable(), signups: z.boolean() });
export type MeResponse = z.infer<typeof MeResponse>;

export const ApiKeyInfo = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  ratePerMinute: z.number(),
  created: z.number(),
  lastUsed: z.number().nullable(),
});
export type ApiKeyInfo = z.infer<typeof ApiKeyInfo>;

/** Errors from /auth/*: `{ error: { code, message } }`, like the REST API. */
export const AuthError = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** Most API keys one user can have at a time. */
export const MAX_KEYS_PER_USER = 5;

/** WebSocket close codes the client reacts to. */
export const CLOSE = {
  /** The same account joined from somewhere else. */
  replaced: 4001,
  /** Not signed in (or the session ended). */
  unauthorized: 4401,
} as const;
