import { ABILITY_IDS, MAX_ENERGY, START_RATING, isAbilityId, type AbilityId } from '@mathbattles/sim';

/**
 * Admin tools: player lookup and edits, bans and mutes, the live room list, and game settings.
 * Every route here runs only after the owner check and a two-step session (see social.ts).
 */

export interface GameSettings {
  /** Ability energy cost overrides. */
  energyCosts: Partial<Record<AbilityId, number>>;
  /** Ability Spark price overrides. */
  prices: Partial<Record<AbilityId, number>>;
  /** A short message shown across the top of the site, or empty. */
  announcement: string;
}

const EMPTY: GameSettings = { energyCosts: {}, prices: {}, announcement: '' };

function cleanCosts(v: unknown, max: number): Partial<Record<AbilityId, number>> {
  const out: Partial<Record<AbilityId, number>> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (isAbilityId(k) && typeof n === 'number' && Number.isFinite(n)) out[k] = Math.max(0, Math.min(max, Math.round(n)));
  }
  return out;
}

export function cleanSettings(v: unknown): GameSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<GameSettings>;
  return {
    energyCosts: cleanCosts(o.energyCosts, MAX_ENERGY),
    prices: cleanCosts(o.prices, 100_000),
    announcement: typeof o.announcement === 'string' ? o.announcement.trim().slice(0, 200) : '',
  };
}

/** The current game settings. A small cache keeps this cheap; changes show within a minute. */
let cache: { at: number; value: GameSettings } | null = null;
export async function readSettings(db: D1Database, fresh = false): Promise<GameSettings> {
  const now = Date.now();
  if (!fresh && cache && now - cache.at < 60_000) return cache.value;
  try {
    const row = await db.prepare("SELECT value FROM settings WHERE key = 'game'").first<{ value: string }>();
    const value = row ? cleanSettings(JSON.parse(row.value)) : EMPTY;
    cache = { at: now, value };
    return value;
  } catch {
    return EMPTY;
  }
}

export interface Sanction {
  kind: 'ban' | 'mute';
  reason: string;
  until: number;
}

/** An active ban or mute on an account, if there is one. */
export async function activeSanction(db: D1Database, uid: string | null, kind: Sanction['kind'], now = Date.now()): Promise<Sanction | null> {
  if (!uid) return null;
  try {
    const row = await db.prepare('SELECT kind, reason, until FROM sanctions WHERE uid = ? AND kind = ? AND until > ?').bind(uid, kind, now).first<Sanction>();
    return row ?? null;
  } catch {
    return null;
  }
}

/** Plain words for a sanction, shown to the player. */
export function sanctionText(s: Sanction): string {
  const when = new Date(s.until).toISOString().slice(0, 16).replace('T', ' ');
  const what = s.kind === 'ban' ? 'You are banned from matches' : 'Your chat is muted';
  return `${what} until ${when} UTC. Reason: ${s.reason}`;
}

type Json = (data: unknown, status?: number) => Response;

interface AdminContext {
  db: D1Database;
  req: Request;
  parts: string[];
  json: Json;
  closeRoom: (code: string) => Promise<boolean>;
}

async function readBody<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

function log(db: D1Database, action: string, target: string, detail: unknown): D1PreparedStatement {
  return db.prepare('INSERT INTO admin_log (at, action, target, detail) VALUES (?, ?, ?, ?)').bind(Date.now(), action, target, JSON.stringify(detail).slice(0, 500));
}

interface ProfileBits {
  sparks?: number;
  xp?: number;
  owned?: string[];
  abilitiesOwned?: string[];
  updatedAt?: number;
}

/** Handles /api/admin/players, /sanctions, /live, /rooms, /settings and /log. Returns null for other paths. */
export async function handleAdminTools(ctx: AdminContext): Promise<Response | null> {
  const { db, req, parts, json } = ctx;
  const now = Date.now();
  const section = parts[2];

  if (section === 'players') {
    if (req.method === 'GET' && !parts[3]) {
      const q = (new URL(req.url).searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 32);
      if (!q) return json({ players: [] });
      const rows = (await db.prepare(
        `SELECT u.uid AS uid, u.display AS name, u.created_at AS created, p.rating AS rating, p.games AS games, p.profile AS profile
         FROM usernames u LEFT JOIN players p ON p.uid = u.uid
         WHERE u.username_lc LIKE ? ORDER BY u.username_lc LIMIT 20`,
      ).bind(`%${q.replace(/[%_]/g, '')}%`).all<{ uid: string; name: string; created: number; rating: number | null; games: number | null; profile: string | null }>()).results;
      const sanctions = rows.length
        ? (await db.prepare(`SELECT uid, kind, reason, until FROM sanctions WHERE until > ? AND uid IN (${rows.map(() => '?').join(',')})`).bind(now, ...rows.map((r) => r.uid)).all<{ uid: string } & Sanction>()).results
        : [];
      return json({
        players: rows.map((r) => {
          let p: ProfileBits = {};
          try {
            p = r.profile ? (JSON.parse(r.profile) as ProfileBits) : {};
          } catch {
            /* A broken profile shows as empty. */
          }
          return {
            uid: r.uid,
            name: r.name,
            created: r.created,
            rating: r.rating ?? START_RATING,
            games: r.games ?? 0,
            sparks: p.sparks ?? 0,
            xp: p.xp ?? 0,
            items: (p.owned ?? []).length,
            abilities: p.abilitiesOwned ?? [],
            sanctions: sanctions.filter((s) => s.uid === r.uid).map(({ kind, reason, until }) => ({ kind, reason, until })),
          };
        }),
      });
    }
    if (req.method === 'POST' && parts[3]) {
      const uid = decodeURIComponent(parts[3]).slice(0, 128);
      const b = await readBody<{ action?: string; rating?: number; sparks?: number }>(req);
      const exists = await db.prepare('SELECT display FROM usernames WHERE uid = ?').bind(uid).first<{ display: string }>();
      if (!exists) return json({ error: 'No such player.' }, 404);
      if (b?.action === 'setRating' && typeof b.rating === 'number' && Number.isFinite(b.rating)) {
        const rating = Math.max(0, Math.min(5000, Math.round(b.rating)));
        await db.batch([
          db.prepare('INSERT INTO players (uid, name, rating, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (uid) DO UPDATE SET rating = excluded.rating').bind(uid, exists.display, rating, now),
          log(db, 'setRating', uid, { rating }),
        ]);
        return json({ ok: true });
      }
      if (b?.action === 'resetRank') {
        await db.batch([
          db.prepare('UPDATE players SET rating = ?, games = 0 WHERE uid = ?').bind(START_RATING, uid),
          log(db, 'resetRank', uid, {}),
        ]);
        return json({ ok: true });
      }
      if (b?.action === 'addSparks' && typeof b.sparks === 'number' && Number.isFinite(b.sparks)) {
        // Sparks live in the saved progress; a newer timestamp makes the player's devices take it.
        const row = await db.prepare('SELECT profile FROM players WHERE uid = ?').bind(uid).first<{ profile: string | null }>();
        if (!row?.profile) return json({ error: "This player hasn't saved any progress yet." }, 409);
        const p = JSON.parse(row.profile) as ProfileBits;
        const change = Math.max(-1_000_000, Math.min(1_000_000, Math.round(b.sparks)));
        p.sparks = Math.max(0, (p.sparks ?? 0) + change);
        p.updatedAt = now;
        await db.batch([
          db.prepare('UPDATE players SET profile = ? WHERE uid = ?').bind(JSON.stringify(p), uid),
          log(db, 'addSparks', uid, { change }),
        ]);
        return json({ ok: true, sparks: p.sparks });
      }
      return json({ error: 'Unknown action.' }, 400);
    }
  }

  if (section === 'sanctions') {
    if (req.method === 'GET') {
      const rows = (await db.prepare(
        `SELECT s.uid AS uid, u.display AS name, s.kind AS kind, s.reason AS reason, s.until AS until
         FROM sanctions s LEFT JOIN usernames u ON u.uid = s.uid WHERE s.until > ? ORDER BY s.until`,
      ).bind(now).all()).results;
      return json({ sanctions: rows });
    }
    if (req.method === 'POST') {
      const b = await readBody<{ name?: string; kind?: string; reason?: string; days?: number }>(req);
      const kind = b?.kind === 'ban' || b?.kind === 'mute' ? b.kind : null;
      const reason = String(b?.reason ?? '').trim().slice(0, 200);
      const days = Math.max(0.04, Math.min(3650, Number(b?.days) || 0));
      if (!kind || !reason || !b?.days) return json({ error: 'Pick ban or mute, a reason, and how long.' }, 400);
      const who = await db.prepare('SELECT uid, display FROM usernames WHERE username_lc = ?').bind(String(b?.name ?? '').trim().toLowerCase()).first<{ uid: string; display: string }>();
      if (!who) return json({ error: 'No player with that name.' }, 404);
      const until = now + Math.round(days * 86_400_000);
      await db.batch([
        db.prepare('INSERT INTO sanctions (uid, kind, reason, until, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (uid, kind) DO UPDATE SET reason = excluded.reason, until = excluded.until, created_at = excluded.created_at')
          .bind(who.uid, kind, reason, until, now),
        log(db, kind, who.uid, { reason, until }),
      ]);
      return json({ ok: true, name: who.display, until });
    }
    if (req.method === 'DELETE' && parts[3] && parts[4]) {
      const uid = decodeURIComponent(parts[3]);
      await db.batch([
        db.prepare('DELETE FROM sanctions WHERE uid = ? AND kind = ?').bind(uid, parts[4]),
        log(db, `lift-${parts[4]}`, uid, {}),
      ]);
      return json({ ok: true });
    }
  }

  if (section === 'live' && req.method === 'GET') {
    const rooms = (await db.prepare(
      'SELECT code, is_public AS public, players, kind, mode, in_lobby AS lobby, updated_at AS updated FROM rooms WHERE players > 0 AND updated_at > ? ORDER BY updated_at DESC LIMIT 100',
    ).bind(now - 10 * 60_000).all()).results;
    return json({ rooms });
  }

  if (section === 'rooms' && parts[3] && parts[4] === 'close' && req.method === 'POST') {
    const code = decodeURIComponent(parts[3]).toUpperCase().slice(0, 24);
    const ok = await ctx.closeRoom(code);
    await log(db, 'closeRoom', code, {}).run();
    return ok ? json({ ok: true }) : json({ error: 'That room could not be closed.' }, 502);
  }

  if (section === 'settings') {
    if (req.method === 'GET') return json({ settings: await readSettings(db, true), abilities: ABILITY_IDS });
    if (req.method === 'POST') {
      const value = cleanSettings(await readBody(req));
      await db.batch([
        db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('game', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(JSON.stringify(value), now),
        log(db, 'settings', 'game', value),
      ]);
      cache = { at: now, value };
      return json({ ok: true, settings: value });
    }
  }

  if (section === 'log' && req.method === 'GET') {
    const rows = (await db.prepare('SELECT id, at, action, target, detail FROM admin_log ORDER BY id DESC LIMIT 100').all()).results;
    return json({ log: rows });
  }

  return null;
}
