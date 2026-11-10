import { decodeReplay } from '@mathbattles/sim';
import { sha256Hex } from './security';

/** Short ids: 8 letters and digits, about 218 trillion possibilities. */
export const REPLAY_ID_RE = /^[A-Za-z0-9]{8}$/;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** The longest replay the server keeps. Even very long matches fit well under this. */
export const MAX_REPLAY_CODE = 48_000;
/** Replays nobody has opened for this long are deleted. */
export const REPLAY_KEEP_MS = 180 * 86_400_000;

export function newReplayId(): string {
  let out = '';
  while (out.length < 8) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    // 248 is the largest multiple of 62 under 256, so every character is equally likely.
    for (const b of bytes) if (b < 248 && out.length < 8) out += ALPHABET[b % 62];
  }
  return out;
}

/** Keeps a replay and returns its short id. The same replay always gets the same id. */
export async function storeReplay(db: D1Database, code: string): Promise<string | null> {
  if (typeof code !== 'string' || !code || code.length > MAX_REPLAY_CODE || !/^[\w-]+$/.test(code)) return null;
  if (!decodeReplay(code)) return null;
  const hash = await sha256Hex(code);
  const found = await db.prepare('SELECT id FROM replays WHERE hash = ?').bind(hash).first<{ id: string }>();
  if (found) return found.id;
  const now = Date.now();
  for (let tries = 0; tries < 4; tries++) {
    const id = newReplayId();
    const row = await db
      .prepare('INSERT INTO replays (id, hash, code, created, last_viewed) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id')
      .bind(id, hash, code, now, now)
      .first<{ id: string }>();
    if (row) return row.id;
    // Either the id was taken or someone stored the same replay a moment ago.
    const again = await db.prepare('SELECT id FROM replays WHERE hash = ?').bind(hash).first<{ id: string }>();
    if (again) return again.id;
  }
  return null;
}

export async function loadReplay(db: D1Database, id: string): Promise<string | null> {
  if (!REPLAY_ID_RE.test(id)) return null;
  const row = await db
    .prepare('UPDATE replays SET last_viewed = ?, views = views + 1 WHERE id = ? RETURNING code')
    .bind(Date.now(), id)
    .first<{ code: string }>();
  return row?.code ?? null;
}

export function replayCleanup(db: D1Database, now: number): D1PreparedStatement {
  return db.prepare('DELETE FROM replays WHERE last_viewed < ?').bind(now - REPLAY_KEEP_MS);
}
