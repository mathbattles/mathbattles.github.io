import {
  ParseError,
  RuleError,
  START_RATING,
  MAX_STORED_REPLAY,
  eloDelta,
  matchRecordFor,
  seasonReset,
  usernameProblem,
  utcDayNumber,
  type ClientMsg,
  type MatchRecord,
  type MatchState,
  type PlayerSetup,
  type ServerMsg,
} from '@mathbattles/sim';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { MessageBucket, callerIp, overLimit } from './limits';
import { cleanName, isBlockedName } from './moderation';
import { RoomCore } from './roomCore';
import { handleSocial, socialCleanup } from './social';
import { SECURITY_HEADERS, allowedOrigins, logError, originOk } from './security';

export interface Env {
  ROOM: DurableObjectNamespace;
  MATCHMAKER: DurableObjectNamespace;
  DB: D1Database;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_API_KEY: string;
  ALLOWED_ORIGINS: string;
  /** Encrypts the admin's two-step secret. Set with `wrangler secret put ADMIN_MFA_KEY`. */
  ADMIN_MFA_KEY?: string;
}

const PRIVATE_DOMAIN = '@users.mathbattles.invalid';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

interface Claims {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  /** When the player last actually signed in (seconds), not just refreshed a token. */
  authTime: number;
}

async function verifyClaims(env: Env, token: string | null | undefined): Promise<Claims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID,
    });
    if (!payload.sub) return null;
    return {
      uid: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      emailVerified: payload.email_verified === true,
      authTime: typeof payload.auth_time === 'number' ? payload.auth_time : 0,
    };
  } catch {
    return null;
  }
}

function bearer(req: Request): string | undefined {
  const value = req.headers.get('authorization') ?? '';
  const m = value.match(/^Bearer ([\w.-]{20,4096})$/);
  return m ? m[1] : undefined;
}

function cors(env: Env, req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = allowedOrigins(env.ALLOWED_ORIGINS, req.url).includes(origin);
  return {
    ...SECURITY_HEADERS,
    vary: 'origin',
    ...(allowed ? { 'access-control-allow-origin': origin } : {}),
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-admin-session',
    'access-control-max-age': '600',
  };
}

function originAllowed(env: Env, req: Request): boolean {
  return originOk(allowedOrigins(env.ALLOWED_ORIGINS, req.url), req);
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');
}

const MAX_BODY = 50_000;

async function readJson<T>(req: Request): Promise<T | null> {
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try {
    const value = JSON.parse(text) as T;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/** Names on public lists can't copy someone else's registered username. */
async function publicName(env: Env, uid: string | null, wanted: unknown): Promise<string> {
  if (uid) {
    const mine = await env.DB.prepare('SELECT display FROM usernames WHERE uid = ?').bind(uid).first<{ display: string }>();
    if (mine) return mine.display;
  }
  const name = cleanName(wanted);
  const taken = await env.DB.prepare('SELECT 1 AS x FROM usernames WHERE username_lc = ?').bind(name.toLowerCase()).first();
  return taken ? `Guest ${name}`.slice(0, 16) : name;
}

const HISTORY_KEEP = 100;

/** Saves one match to a player's history and drops their oldest beyond the limit. */
function historyStatements(env: Env, uid: string, record: MatchRecord, source: 'server' | 'device') {
  return [
    env.DB.prepare('INSERT INTO match_history (uid, id, at, source, record) VALUES (?, ?, ?, ?, ?) ON CONFLICT (uid, id) DO NOTHING')
      .bind(uid, record.id, record.at, source, JSON.stringify(record)),
    env.DB.prepare(
      'DELETE FROM match_history WHERE uid = ? AND id NOT IN (SELECT id FROM match_history WHERE uid = ? ORDER BY at DESC LIMIT ?)',
    ).bind(uid, uid, HISTORY_KEEP),
  ];
}

/** Matches reported by a device are checked for shape. They can't claim to be ranked or change a rating. */
function cleanDeviceRecord(b: Partial<MatchRecord> | null): MatchRecord | null {
  if (!b || typeof b.id !== 'string' || !/^[\w-]{1,64}$/.test(b.id)) return null;
  if (b.kind !== 'bots' && b.kind !== 'online' && b.kind !== 'shared') return null;
  if (b.mode !== 'fn' && b.mode !== 'ode1' && b.mode !== 'ode2') return null;
  if (b.result !== 'win' && b.result !== 'loss' && b.result !== 'draw' && b.result !== 'none') return null;
  if (!Array.isArray(b.opponents) || b.opponents.length > 12) return null;
  if (b.replay !== undefined && (typeof b.replay !== 'string' || b.replay.length > MAX_STORED_REPLAY || !/^[\w-]*$/.test(b.replay))) return null;
  const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(100_000, Math.floor(n))) : 0);
  return {
    id: b.id,
    // A device's clock can be wrong, but not in the future.
    at: Math.min(Date.now(), count(b.at) || Date.now()),
    kind: b.kind,
    mode: b.mode,
    result: b.result,
    opponents: b.opponents.map((o) => cleanName(o)),
    kills: count(b.kills),
    shots: count(b.shots),
    ...(b.replay ? { replay: b.replay } : {}),
  };
}

async function historyRows(env: Env, uid: string, limit: number): Promise<MatchRecord[]> {
  const { results } = await env.DB.prepare('SELECT record FROM match_history WHERE uid = ? ORDER BY at DESC LIMIT ?').bind(uid, limit).all<{ record: string }>();
  return results.map((r) => JSON.parse(r.record) as MatchRecord);
}

async function handleApi(req: Request, env: Env, parts: string[], json: (data: unknown, status?: number) => Response): Promise<Response> {
  const ip = callerIp(req);
  const tooMany = () => json({ error: 'Too many requests. Wait a few minutes and try again.' }, 429);
  const limitIp = async (name: string, max: number, windowMs: number) => !!ip && overLimit(env.DB, `${name}:${ip}`, max, windowMs);

  if (['social', 'friends', 'invites', 'party', 'maps', 'cosmetics', 'ranked', 'admin'].includes(parts[1] ?? '')) {
    const claims = await verifyClaims(env, bearer(req));
    const handled = await handleSocial({ db: env.DB, req, parts, json, uid: claims?.uid ?? null, authTime: claims?.authTime ?? 0, mfaKey: env.ADMIN_MFA_KEY, newCode, ip });
    if (handled) return handled;
  }
  switch (parts[1]) {
    case 'health':
      return json({ ok: true });

    case 'rooms': {
      if (req.method === 'POST') {
        if (await limitIp('rooms', 20, 10 * MINUTE)) return tooMany();
        const body = await readJson<{ public?: boolean }>(req);
        const code = newCode();
        await env.DB.prepare('INSERT INTO rooms (code, is_public, updated_at) VALUES (?, ?, ?)').bind(code, body?.public ? 1 : 0, Date.now()).run();
        return json({ code });
      }
      const cutoff = Date.now() - 10 * MINUTE;
      const { results } = await env.DB.prepare(
        'SELECT code, players, kind, mode, in_lobby AS inLobby FROM rooms WHERE is_public = 1 AND players > 0 AND updated_at > ? ORDER BY in_lobby DESC, updated_at DESC LIMIT 40',
      ).bind(cutoff).all();
      return json(results);
    }

    case 'leaderboard': {
      const { results } = await env.DB.prepare('SELECT name, rating FROM players WHERE games > 0 ORDER BY rating DESC LIMIT 100').all();
      return json(results);
    }

    case 'profile': {
      const claims = await verifyClaims(env, bearer(req));
      if (!claims) return json({ error: 'Sign in first' }, 401);
      const uid = claims.uid;
      if (req.method === 'PUT') {
        if (await overLimit(env.DB, `profile:${uid}`, 120, HOUR)) return tooMany();
        const body = await readJson<Record<string, unknown>>(req);
        if (!body || typeof body.updatedAt !== 'number') return json({ error: 'Bad profile' }, 400);
        // These only mean something on the device that wrote them.
        delete body.guestToken;
        delete body.ownerUid;
        const name = await publicName(env, uid, body.name);
        // An older copy from another device must not replace a newer one.
        await env.DB.prepare(
          `INSERT INTO players (uid, name, profile, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (uid) DO UPDATE SET name = excluded.name, profile = excluded.profile, updated_at = excluded.updated_at
           WHERE players.profile IS NULL
              OR json_extract(excluded.profile, '$.updatedAt') >= COALESCE(json_extract(players.profile, '$.updatedAt'), 0)`,
        ).bind(uid, name, JSON.stringify(body), Date.now()).run();
        return json({ ok: true });
      }
      const row = await env.DB.prepare('SELECT rating, profile FROM players WHERE uid = ?').bind(uid).first<{ rating: number; profile: string | null }>();
      const user = await env.DB.prepare('SELECT display FROM usernames WHERE uid = ?').bind(uid).first<{ display: string }>();
      return json({ rating: row?.rating ?? START_RATING, profile: row?.profile ? JSON.parse(row.profile) : null, username: user?.display ?? null });
    }

    case 'history': {
      const claims = await verifyClaims(env, bearer(req));
      if (!claims) return json({ error: 'Sign in first' }, 401);
      if (req.method === 'POST') {
        if (await overLimit(env.DB, `history:${claims.uid}`, 120, HOUR)) return tooMany();
        const record = cleanDeviceRecord(await readJson<Partial<MatchRecord>>(req));
        if (!record) return json({ error: 'Bad match' }, 400);
        await env.DB.batch(historyStatements(env, claims.uid, record, 'device'));
        return json({ ok: true });
      }
      return json(await historyRows(env, claims.uid, HISTORY_KEEP));
    }

    case 'player': {
      let name: string;
      try {
        name = decodeURIComponent(parts[2] ?? '').toLowerCase();
      } catch {
        return json({ error: 'No such player' }, 404);
      }
      const user = await env.DB.prepare('SELECT uid, display FROM usernames WHERE username_lc = ?').bind(name).first<{ uid: string; display: string }>();
      if (!user) return json({ error: 'No such player' }, 404);
      const row = await env.DB.prepare('SELECT rating, games FROM players WHERE uid = ?').bind(user.uid).first<{ rating: number; games: number }>();
      return json({ name: user.display, rating: row?.rating ?? START_RATING, games: row?.games ?? 0, matches: await historyRows(env, user.uid, 30) });
    }

    case 'account': {
      const action = parts[2];
      if (action === 'available' && req.method === 'GET') {
        let name: string;
        try {
          name = decodeURIComponent(parts[3] ?? '');
        } catch {
          return json({ available: false, problem: 'Use only letters, numbers, and underscores' });
        }
        const problem = usernameProblem(name) ?? (isBlockedName(name) ? 'Choose a different username' : null);
        if (problem) return json({ available: false, problem });
        const row = await env.DB.prepare('SELECT 1 AS x FROM usernames WHERE username_lc = ?').bind(name.toLowerCase()).first();
        return json({ available: !row, problem: row ? 'That username is taken' : null });
      }
      const claims = await verifyClaims(env, bearer(req));
      if (!claims) return json({ error: 'Sign in first' }, 401);
      const uid = claims.uid;
      if (action === 'claim' && req.method === 'POST') {
        if (await overLimit(env.DB, `claim:${uid}`, 20, HOUR)) return tooMany();
        // One device can't make an endless stream of accounts.
        if (await limitIp('claim-ip', 10, 24 * HOUR)) return tooMany();
        const body = await readJson<{ username?: string }>(req);
        const name = String(body?.username ?? '');
        const problem = usernameProblem(name) ?? (isBlockedName(name) ? 'Choose a different username' : null);
        if (problem) return json({ error: problem }, 400);
        const mine = await env.DB.prepare('SELECT display FROM usernames WHERE uid = ?').bind(uid).first<{ display: string }>();
        // Claiming your own name again is fine, so a half-finished signup can be retried.
        if (mine) {
          return mine.display.toLowerCase() === name.toLowerCase()
            ? json({ username: mine.display })
            : json({ error: 'This account already has a username' }, 409);
        }
        try {
          // A verified real email (from Google, say) becomes the login address right away, so a
          // password added later works with the username even if a later sync step fails.
          const loginEmail = claims.email && claims.emailVerified && !claims.email.endsWith(PRIVATE_DOMAIN) ? claims.email : null;
          await env.DB.prepare('INSERT INTO usernames (username_lc, uid, display, login_email, created_at) VALUES (?, ?, ?, ?, ?)')
            .bind(name.toLowerCase(), uid, name, loginEmail, Date.now()).run();
        } catch {
          return json({ error: 'That username is taken' }, 409);
        }
        return json({ username: name });
      }
      if (action === 'sync-email' && req.method === 'POST') {
        // The address comes only from the signed login token, and only once it's verified, so
        // nobody can point their username at someone else's email.
        if (!claims.email || !claims.emailVerified || claims.email.endsWith(PRIVATE_DOMAIN)) return json({ ok: false });
        await env.DB.prepare('UPDATE usernames SET login_email = ? WHERE uid = ?').bind(claims.email, uid).run();
        return json({ ok: true });
      }
      if (req.method === 'DELETE' && !action) {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM usernames WHERE uid = ?').bind(uid),
          env.DB.prepare('DELETE FROM players WHERE uid = ?').bind(uid),
          env.DB.prepare('DELETE FROM match_history WHERE uid = ?').bind(uid),
          // Friends, presence, invites, party places and shared maps go too.
          env.DB.prepare('DELETE FROM friends WHERE uid = ? OR friend_uid = ?').bind(uid, uid),
          env.DB.prepare('DELETE FROM presence WHERE uid = ?').bind(uid),
          env.DB.prepare('DELETE FROM invites WHERE from_uid = ? OR to_uid = ?').bind(uid, uid),
          env.DB.prepare('DELETE FROM party_members WHERE uid = ?').bind(uid),
          env.DB.prepare('DELETE FROM parties WHERE leader = ? AND id NOT IN (SELECT party_id FROM party_members)').bind(uid),
          env.DB.prepare('DELETE FROM maps WHERE uid = ?').bind(uid),
        ]);
        return json({ ok: true });
      }
      return json({ error: 'Not found' }, 404);
    }

    case 'auth': {
      // Players who added a real email log in with it, but can keep typing their username. The
      // email is only handed back after Firebase confirms the password is correct.
      if (parts[2] !== 'resolve' || req.method !== 'POST') return json({ error: 'Not found' }, 404);
      const body = await readJson<{ username?: string; password?: string }>(req);
      const name = String(body?.username ?? '').toLowerCase().slice(0, 32);
      const password = String(body?.password ?? '').slice(0, 256);
      const fail = () => json({ error: 'Wrong username or password' }, 401);
      if (!name || !password) return fail();
      if (await limitIp('resolve', 30, 15 * MINUTE)) return tooMany();
      if (await overLimit(env.DB, `resolve-name:${name}`, 10, 15 * MINUTE)) return tooMany();
      const row = await env.DB.prepare('SELECT login_email FROM usernames WHERE username_lc = ?').bind(name).first<{ login_email: string | null }>();
      if (!row?.login_email) {
        // Accounts without a real email have nothing to check here. Wait about as long as a real
        // check takes, so response time doesn't reveal which usernames have an email.
        await new Promise((r) => setTimeout(r, 150 + Math.random() * 250));
        return fail();
      }
      const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.FIREBASE_API_KEY}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: row.login_email, password, returnSecureToken: false }),
      });
      if (res.status === 429) return tooMany();
      if (!res.ok) {
        const detail = await res.json<{ error?: { message?: string } }>().catch(() => null);
        if (detail?.error?.message?.startsWith('TOO_MANY_ATTEMPTS')) return tooMany();
        return fail();
      }
      return json({ email: row.login_email });
    }

    case 'report': {
      if (await limitIp('report', 10, HOUR)) return tooMany();
      const body = await readJson<{ code?: string; reported?: string; text?: string }>(req);
      if (!body) return json({ error: 'Bad report' }, 400);
      await env.DB.prepare('INSERT INTO reports (code, reported, text, created_at) VALUES (?, ?, ?, ?)')
        .bind(String(body.code ?? '').slice(0, 24), String(body.reported ?? '').slice(0, 32), String(body.text ?? '').slice(0, 300), Date.now()).run();
      return json({ ok: true });
    }
  }
  return json({ error: 'Not found' }, 404);
}

/** Runs a job at most once per period, so a retry on the same day can't repeat it. */
async function runOnce(env: Env, job: string, period: string, work: () => Promise<void>): Promise<void> {
  const row = await env.DB.prepare('SELECT last_period FROM job_runs WHERE job = ?').bind(job).first<{ last_period: string }>();
  if (row?.last_period === period) return;
  await work();
  await env.DB.prepare('INSERT INTO job_runs (job, last_period) VALUES (?, ?) ON CONFLICT (job) DO UPDATE SET last_period = excluded.last_period').bind(job, period).run();
}

export default {
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    const now = new Date(event.scheduledTime);
    // Each job stands alone, so one failing can't stop the others.
    const jobs: Promise<unknown>[] = [
      env.DB.prepare('DELETE FROM rooms WHERE updated_at < ?').bind(now.getTime() - 86_400_000).run(),
      env.DB.prepare('DELETE FROM reports WHERE created_at < ?').bind(now.getTime() - 90 * 86_400_000).run(),
      env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now.getTime() - 86_400_000).run(),
      ...socialCleanup(env.DB, now.getTime()),
    ];
    if (now.getUTCDate() === 1 && now.getUTCMonth() % 3 === 0) {
      const period = `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`;
      jobs.push(runOnce(env, 'season-reset', period, async () => {
        const { results } = await env.DB.prepare('SELECT uid, rating FROM players').all<{ uid: string; rating: number }>();
        const statements = results.map((r) => env.DB.prepare('UPDATE players SET rating = ?, season = season + 1 WHERE uid = ?').bind(seasonReset(r.rating), r.uid));
        for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
      }));
    }
    const results = await Promise.allSettled(jobs);
    for (const r of results) if (r.status === 'rejected') logError('Scheduled job failed', r.reason);
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const headers = cors(env, req);
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...headers, 'content-type': 'application/json' } });

    try {
      if (req.method === 'OPTIONS') return new Response(null, { headers });

      if (parts[0] === 'room' && parts[1]) {
        if (!originAllowed(env, req)) return new Response('Forbidden', { status: 403 });
        const code = parts[1].toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24);
        return await env.ROOM.get(env.ROOM.idFromName(code)).fetch(new Request(`https://room/${code}`, req));
      }
      if (parts[0] === 'match') {
        if (!originAllowed(env, req)) return new Response('Forbidden', { status: 403 });
        return await env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global')).fetch(req);
      }
      if (parts[0] !== 'api') return json({ error: 'Not found' }, 404);
      // Pages on other sites can't use the API from someone's browser.
      if (!originAllowed(env, req)) return json({ error: 'Not allowed from this site' }, 403);
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) return json({ error: 'Not allowed' }, 405);
      // Writes must be JSON, which also keeps plain HTML forms on other sites from posting here.
      if (req.method !== 'GET' && req.method !== 'DELETE' && req.headers.get('content-length') !== '0') {
        const type = req.headers.get('content-type') ?? '';
        if (!type.startsWith('application/json')) return json({ error: 'Send JSON' }, 415);
      }
      return await handleApi(req, env, parts, json);
    } catch (e) {
      logError('Request failed', e);
      return json({ error: 'Something went wrong on the server' }, 500);
    }
  },
};

// Large enough for a Firebase login token inside the join message.
const MAX_MSG = 4096;
const MAX_SOCKETS_PER_ROOM = 30;
const JOIN_TIMEOUT_MS = 15_000;
const LOBBY_WRITE_GAP_MS = 5_000;
const MIN_GUEST_TOKEN = 8;

/** Hosts one room. The logic lives in RoomCore; this connects it to sockets and alarms. */
export class RoomObject implements DurableObject {
  private core: RoomCore | null = null;
  private sockets = new Map<string, WebSocket>();
  private buckets = new Map<string, MessageBucket>();
  private joined = new Set<string>();
  private nextConn = 1;
  private seatUid = new Map<string, string>();
  private lobbyPending: string | null = null;
  private lobbyWritten = '';
  private lobbyWrittenAt = 0;
  private lobbyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private ctx: DurableObjectState, private env: Env) {}

  private async getCore(code: string): Promise<RoomCore> {
    if (this.core) return this.core;
    const ranked = code.startsWith('R-');
    const pair = ranked ? await this.ctx.storage.get<[string, string]>('pair') : undefined;
    if (this.core) return this.core;
    this.core = new RoomCore(code, {
      send: (id, msg) => this.sendTo(id, msg),
      now: () => Date.now(),
      random: () => Math.random(),
      // Time can stand still during computation here, so bots are limited by work done, not a clock.
      botMaxEvals: 4000,
      wake: (at) => {
        if (at === null) void this.ctx.storage.deleteAlarm();
        else void this.ctx.storage.setAlarm(at);
      },
      onLobbyChange: (info) => this.saveLobby(code, info),
      onRankedOver: (winner, loser) => this.settleRanked(winner, loser),
      onMatchOver: (state, setups, delta) => this.saveHistory(code, state, setups, delta),
    }, { ranked, rankedPair: pair });
    return this.core;
  }

  private sendTo(id: string, msg: ServerMsg): void {
    try {
      this.sockets.get(id)?.send(JSON.stringify(msg));
    } catch {
      /* Socket closed; its close event handles cleanup. */
    }
  }

  /** Lobby lists update at most every few seconds, however often seats change. */
  private saveLobby(code: string, info: { players: number; kind: string; mode: string; inLobby: boolean }): void {
    this.lobbyPending = JSON.stringify(info);
    if (this.lobbyTimer) return;
    const wait = Math.max(0, this.lobbyWrittenAt + LOBBY_WRITE_GAP_MS - Date.now());
    this.lobbyTimer = setTimeout(() => {
      this.lobbyTimer = null;
      const pending = this.lobbyPending;
      if (!pending || pending === this.lobbyWritten) return;
      this.lobbyWritten = pending;
      this.lobbyWrittenAt = Date.now();
      const latest = JSON.parse(pending) as typeof info;
      void this.env.DB.prepare('UPDATE rooms SET players = ?, kind = ?, mode = ?, in_lobby = ?, updated_at = ? WHERE code = ?')
        .bind(latest.players, latest.kind, latest.mode, latest.inLobby ? 1 : 0, Date.now(), code).run().catch(() => {});
    }, wait);
  }

  /** Records the match for every signed-in player in it. Guests' devices keep their own copy. */
  private saveHistory(code: string, state: MatchState, setups: PlayerSetup[], ratingDelta: number | undefined): void {
    const statements: D1PreparedStatement[] = [];
    const at = Date.now();
    for (const [seat, uid] of this.seatUid) {
      if (!state.players.some((p) => p.id === seat)) continue;
      const base = matchRecordFor(state, setups, seat, { id: `${code}-${state.config.seed}`, at, kind: code.startsWith('R-') ? 'ranked' : 'online' });
      const record = ratingDelta === undefined ? base : { ...base, ratingDelta: base.result === 'win' ? ratingDelta : -ratingDelta };
      statements.push(...historyStatements(this.env, uid, record, 'server'));
    }
    if (statements.length) void this.env.DB.batch(statements).catch((e) => logError('Saving match history failed', e));
  }

  private async settleRanked(winnerSeat: string, loserSeat: string): Promise<number | undefined> {
    const w = this.seatUid.get(winnerSeat);
    const l = this.seatUid.get(loserSeat);
    if (!w || !l) return undefined;
    const db = this.env.DB;
    const rate = async (uid: string) =>
      (await db.prepare('SELECT rating FROM players WHERE uid = ?').bind(uid).first<{ rating: number }>())?.rating ?? START_RATING;
    const [rw, rl] = await Promise.all([rate(w), rate(l)]);
    const delta = eloDelta(rw, rl);
    const now = Date.now();
    const nameOf = (seat: string) => this.core?.state?.players.find((p) => p.id === seat)?.name ?? 'Player';
    // Adds to the stored value, so two matches ending together can't lose a change.
    const update = (uid: string, name: string, change: number) =>
      db.prepare(
        `INSERT INTO players (uid, name, rating, games, updated_at) VALUES (?, ?, ?, 1, ?)
         ON CONFLICT (uid) DO UPDATE SET rating = rating + ?, games = games + 1, updated_at = ?`,
      ).bind(uid, name, START_RATING + change, now, change, now);
    await db.batch([update(w, nameOf(winnerSeat), delta), update(l, nameOf(loserSeat), -delta)]);
    return delta;
  }

  /** Works out who is joining, and the name others should see. Returns null if they can't join. */
  private async identify(code: string, msg: Extract<ClientMsg, { t: 'join' }>): Promise<{ identity: string; name: string; uid: string | null } | { error: string }> {
    const claims = await verifyClaims(this.env, msg.idToken);
    if (code.startsWith('R-')) {
      if (!claims) return { error: 'Sign in to play ranked.' };
      return { identity: claims.uid, uid: claims.uid, name: await publicName(this.env, claims.uid, msg.name) };
    }
    const guest = String(msg.token ?? '').slice(0, 64);
    if (guest.length < MIN_GUEST_TOKEN) return { error: 'Reload the page and try again.' };
    return { identity: `g:${guest}`, uid: claims?.uid ?? null, name: await publicName(this.env, claims?.uid ?? null, msg.name) };
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // Reachable only from the matchmaker: public routes always use the host name "room".
    if (url.hostname === 'internal') {
      const pair = (await req.json()) as [string, string];
      await this.ctx.storage.put('pair', pair);
      if (this.core) this.core.setRankedPair(pair);
      return new Response('ok');
    }
    if (req.headers.get('upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const code = url.pathname.slice(1);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const refuse = (message: string) => {
      server.send(JSON.stringify({ t: 'closed', message } satisfies ServerMsg));
      server.close(4404, 'closed');
      return new Response(null, { status: 101, webSocket: client });
    };
    if (this.sockets.size >= MAX_SOCKETS_PER_ROOM) return refuse('This room is full.');
    if (!code.startsWith('R-') && !this.core) {
      // Only rooms the server made can be joined, so a mistyped code doesn't start a new room.
      const known = await this.env.DB.prepare('SELECT 1 AS x FROM rooms WHERE code = ?').bind(code).first();
      if (!known) return refuse(`There's no room with the code ${code}. Check the code and try again.`);
    }
    const core = await this.getCore(code);
    if (code.startsWith('R-') && !core.hasRankedPair()) return refuse("This ranked match doesn't exist. Queue again from the Ranked page.");

    const connId = `c${this.nextConn++}`;
    this.sockets.set(connId, server);
    this.buckets.set(connId, new MessageBucket(30, 6, Date.now()));
    core.connect(connId);
    // A connection that never joins shouldn't hold a place in the room.
    setTimeout(() => {
      if (this.sockets.has(connId) && !this.joined.has(connId)) server.close(4408, 'join timeout');
    }, JOIN_TIMEOUT_MS);

    server.addEventListener('message', (ev) => {
      void (async () => {
        const raw = typeof ev.data === 'string' ? ev.data : '';
        if (raw.length > MAX_MSG) return;
        if (!this.buckets.get(connId)?.take(Date.now())) return;
        let msg: ClientMsg;
        try {
          msg = JSON.parse(raw) as ClientMsg;
        } catch {
          return;
        }
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'join') {
          if (this.joined.has(connId)) return;
          this.joined.add(connId);
          const who = await this.identify(code, msg);
          // The socket may have closed while the login was being checked.
          if (!this.sockets.has(connId)) return;
          if ('error' in who) {
            this.sendTo(connId, { t: 'closed', message: who.error });
            server.close(4401, 'not allowed');
            return;
          }
          core.join(connId, who.identity, { ...msg, name: who.name });
          if (who.uid) {
            const seat = core.seats.find((s) => s.conns.has(connId));
            if (seat) this.seatUid.set(seat.id, who.uid);
          }
          return;
        }
        core.handle(connId, msg);
      })().catch((e) => logError('Room message failed', e));
    });
    const closed = () => {
      if (!this.sockets.delete(connId)) return;
      this.buckets.delete(connId);
      this.joined.delete(connId);
      core.disconnect(connId);
    };
    server.addEventListener('close', closed);
    server.addEventListener('error', closed);
    return new Response(null, { status: 101, webSocket: client });
  }

  async alarm(): Promise<void> {
    this.core?.tick();
  }
}

interface Waiting {
  ws: WebSocket;
  uid: string;
  rating: number;
  joined: number;
}

function sendOk(ws: WebSocket, msg: unknown): boolean {
  try {
    ws.send(JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}

/** Pairs ranked players by closest rating, widening the allowed gap as they wait. */
export class MatchmakerObject implements DurableObject {
  private queue: Waiting[] = [];

  constructor(private ctx: DurableObjectState, private env: Env) {}

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    let open = true;
    server.addEventListener('message', (ev) => {
      void (async () => {
        const raw = String(ev.data);
        if (raw.length > MAX_MSG) return;
        let msg: { token?: string; name?: string };
        try {
          msg = JSON.parse(raw) as { token?: string; name?: string };
        } catch {
          return;
        }
        const claims = await verifyClaims(this.env, msg?.token);
        if (!claims) {
          sendOk(server, { t: 'error', message: 'Sign in to play ranked.' });
          return;
        }
        if (!open) return;
        const row = await this.env.DB.prepare('SELECT rating FROM players WHERE uid = ?').bind(claims.uid).first<{ rating: number }>();
        if (!open) return;
        this.queue = this.queue.filter((q) => q.uid !== claims.uid);
        this.queue.push({ ws: server, uid: claims.uid, rating: row?.rating ?? START_RATING, joined: Date.now() });
        await this.pairUp();
        void this.ctx.storage.setAlarm(Date.now() + 5000);
      })().catch((e) => logError('Matchmaking failed', e));
    });
    const closed = () => {
      open = false;
      this.queue = this.queue.filter((q) => q.ws !== server);
    };
    server.addEventListener('close', closed);
    server.addEventListener('error', closed);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async pairUp(): Promise<void> {
    const now = Date.now();
    const q = [...this.queue].sort((a, b) => a.joined - b.joined);
    const used = new Set<Waiting>();
    for (const a of q) {
      if (used.has(a)) continue;
      const gap = 100 + ((now - a.joined) / 1000) * 20;
      let best: Waiting | null = null;
      for (const b of q) {
        if (b === a || used.has(b)) continue;
        const d = Math.abs(a.rating - b.rating);
        if (d <= gap && (!best || d < Math.abs(a.rating - best.rating))) best = b;
      }
      if (!best) continue;
      used.add(a);
      used.add(best);
      const code = `R-${newCode()}`;
      // The room learns who may join before either player hears about it.
      await this.env.ROOM.get(this.env.ROOM.idFromName(code)).fetch(new Request('https://internal/pair', {
        method: 'POST',
        body: JSON.stringify([a.uid, best.uid]),
      }));
      const msg = { t: 'matched', code };
      const aOk = sendOk(a.ws, msg);
      const bOk = sendOk(best.ws, msg);
      // Keep waiting if the other side turned out to be gone. The room cancels no-shows.
      if (!aOk) used.delete(best);
      if (!bOk) used.delete(a);
    }
    this.queue = this.queue.filter((w) => !used.has(w));
  }

  async alarm(): Promise<void> {
    await this.pairUp();
    if (this.queue.length) await this.ctx.storage.setAlarm(Date.now() + 5000);
  }
}
