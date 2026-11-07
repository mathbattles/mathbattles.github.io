import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, checkCode, codeAt, decryptSecret, encryptSecret, newSecret } from '../src/mfa';
import { allowedOrigins, newId, scrub } from '../src/security';

// RFC 6238's test key: the ASCII bytes of "12345678901234567890".
const RFC_SECRET = base32Encode(new TextEncoder().encode('12345678901234567890'));

describe('authenticator codes', () => {
  it('match the RFC 6238 test values', async () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    // 8-digit values from the RFC, cut to the usual 6 digits.
    expect(await codeAt(RFC_SECRET, Math.floor(59 / 30))).toBe('287082');
    expect(await codeAt(RFC_SECRET, Math.floor(1111111109 / 30))).toBe('081804');
    expect(await codeAt(RFC_SECRET, Math.floor(1234567890 / 30))).toBe('005924');
    expect(await codeAt(RFC_SECRET, Math.floor(2000000000 / 30))).toBe('279037');
  });
  it('accept a little clock drift, but never the same code twice', async () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    const code = await codeAt(RFC_SECRET, step);
    expect(await checkCode(RFC_SECRET, code, now, 0)).toBe(step);
    expect(await checkCode(RFC_SECRET, code, now + 30_000, 0)).toBe(step);
    // Once accepted, the same step can't be used again.
    expect(await checkCode(RFC_SECRET, code, now, step)).toBeNull();
    expect(await checkCode(RFC_SECRET, '000000', now, 0)).toBeNull();
    expect(await checkCode(RFC_SECRET, 'abcdef', now, 0)).toBeNull();
    expect(await checkCode(RFC_SECRET, code, now + 5 * 30_000, 0)).toBeNull();
  });
  it('keep secrets encrypted at rest', async () => {
    const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const secret = newSecret();
    expect(base32Decode(secret)).toHaveLength(20);
    const stored = await encryptSecret(secret, key);
    expect(stored).not.toContain(secret);
    expect(await decryptSecret(stored, key)).toBe(secret);
    const otherKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    await expect(decryptSecret(stored, otherKey)).rejects.toThrow();
  });
});

describe('server safety helpers', () => {
  it('scrub tokens, passwords, keys and emails from logs', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVlLWhlcmU';
    const text = scrub(`Bearer ${jwt} {"password":"hunter22","idToken":"abc"} AIzaSyAEpVeNtZMpX-mj_iVvGJ0Fmy_1XhBGCKQ ghp_abcdefghijklmnopqrstuvwxyz123456 me@example.com`);
    for (const secret of [jwt, 'hunter22', 'AIzaSyAEpVeNtZMpX', 'ghp_abcdefghijkl', 'me@example.com']) expect(text).not.toContain(secret);
    expect(scrub(new Error(`failed for ${jwt}`))).not.toContain(jwt);
  });
  it('only let local pages in when the server itself is local', () => {
    const configured = 'https://mathbattles.github.io,http://localhost:5173';
    expect(allowedOrigins(configured, 'https://mathbattles-server.mathbattles.workers.dev/api/x')).toEqual(['https://mathbattles.github.io']);
    expect(allowedOrigins(configured, 'http://localhost:8787/api/x')).toContain('http://localhost:5173');
  });
  it('make ids that are random UUIDs', () => {
    const a = newId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newId()).not.toBe(a);
  });
});
