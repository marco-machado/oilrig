import { describe, expect, it } from 'vitest';
import { DisplayName, Password, Username, displayKey } from '@ocean-home/shared';
import { base64url } from '../../apps/server/src/api/keys.ts';
import { hashPassword, verifyPassword } from '../../apps/server/src/auth/password.ts';

describe('account rules', () => {
  it('usernames: 3-24 of a-z, 0-9, _ and -, any case in, lower-case out', () => {
    expect(Username.parse('  Ana_Maria-2 ')).toBe('ana_maria-2');
    for (const bad of ['ab', 'a'.repeat(25), 'has space', 'ação', 'dot.ted', '']) expect(Username.safeParse(bad).success, bad).toBe(false);
  });

  it('display names: normalised, single-spaced, no control characters, at most 24 characters', () => {
    expect(DisplayName.parse('  Ana   Maria ')).toBe('Ana Maria');
    expect(DisplayName.parse('José')).toBe('José'); // NFC
    expect(DisplayName.parse('🌊 Marina')).toBe('🌊 Marina');
    for (const bad of ['', '   ', '​', 'bell\u0007', 'x'.repeat(25)]) expect(DisplayName.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it('display keys treat case, width, invisible characters and spacing as the same name', () => {
    const k = displayKey('Ana Maria');
    for (const same of ['ana maria', 'ANA MARIA', 'Ana​Maria', 'ＡＮＡ ＭＡＲＩＡ', 'AnaMaria']) expect(displayKey(same), same).toBe(k);
    expect(displayKey('Ana Marta')).not.toBe(k);
  });

  it('passwords: 8 to 256 characters', () => {
    expect(Password.safeParse('1234567').success).toBe(false);
    expect(Password.safeParse('12345678').success).toBe(true);
    expect(Password.safeParse('x'.repeat(257)).success).toBe(false);
  });
});

describe('password hashing', () => {
  it('round-trips, salts every hash and records its parameters', async () => {
    const a = await hashPassword('sea breeze 42', 1000);
    const b = await hashPassword('sea breeze 42', 1000);
    expect(a).toMatch(/^pbkdf2-sha256\$1000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword('sea breeze 42', a)).toBe(true);
    expect(await verifyPassword('sea breeze 43', a)).toBe(false);
    expect(await verifyPassword('sea breeze 42', 'md5$whatever')).toBe(false);
  });

  it('treats canonically equal passwords as the same', async () => {
    const h = await hashPassword('José', 1000);
    expect(await verifyPassword('José', h)).toBe(true);
  });

  it('base64url has no padding or URL-unsafe characters', () => {
    expect(base64url(new Uint8Array([251, 255, 254]))).toBe('-__-');
    expect(base64url(new Uint8Array([1]))).toBe('AQ');
  });
});
