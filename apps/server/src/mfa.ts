/**
 * Time-based one-time codes (TOTP, the codes an authenticator app shows), for the admin page.
 * Follows RFC 6238: SHA-1, 6 digits, 30-second steps.
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | BASE32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function newSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export const STEP_SECONDS = 30;

export async function codeAt(secret: string, step: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const counter = new ArrayBuffer(8);
  const view = new DataView(counter);
  view.setUint32(0, Math.floor(step / 2 ** 32));
  view.setUint32(4, step >>> 0);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const offset = mac[mac.length - 1]! & 15;
  const number = ((mac[offset]! & 127) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(number % 1_000_000).padStart(6, '0');
}

/**
 * Checks a code, allowing one step of clock drift either way. Returns the step it matched,
 * or null. Codes for steps already used are refused, so a code can't be replayed.
 */
export async function checkCode(secret: string, code: string, now: number, lastStep: number): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 1000 / STEP_SECONDS);
  for (const s of [step, step - 1, step + 1]) {
    if (s <= lastStep) continue;
    if (timingSafeEqual(await codeAt(secret, s), code)) return s;
  }
  return null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Encrypts the secret with AES-GCM under a key that lives only in the worker's secrets. */
async function aesKey(keyB64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error('ADMIN_MFA_KEY must be 32 bytes, base64');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(secret: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyB64), new TextEncoder().encode(secret)));
  const joined = new Uint8Array(iv.length + data.length);
  joined.set(iv);
  joined.set(data, iv.length);
  return btoa(String.fromCharCode(...joined));
}

export async function decryptSecret(stored: string, keyB64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await aesKey(keyB64), bytes.slice(12));
  return new TextDecoder().decode(plain);
}

export function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
