import { DAILY_MAX_SHOTS, ParseError, START_RATING, eloDelta, scoreDaily, utcDayNumber, type ClientMsg, type DailyShot, type ServerMsg } from '@mathbattles/sim';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { cleanName } from './moderation';
import { RoomCore } from './roomCore';

export interface Env {
  ROOM: DurableObjectNamespace;
  MATCHMAKER: DurableObjectNamespace;
  DB: D1Database;
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS: string;
}

const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

async function verifyUser(env: Env, token: string | null | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID,
    });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

function cors(env: Env, req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').includes(origin);
  return {
    ...(allowed ? { 'access-control-allow-origin': origin, vary: 'origin' } : {}),
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  };
}

function originAllowed(env: Env, req: Request): boolean {
  const origin = req.headers.get('origin');
  return !origin || env.ALLOWED_ORIGINS.split(',').includes(origin);
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');
}

const MAX_BODY = 200_000;

async function readJson<T>(req: Request): Promise<T | null> {
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export default {
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    const now = new Date(event.scheduledTime);
    await env.DB.prepare('DELETE FROM rooms WHERE updated_at < ?').bind(now.getTime() - 86_400_000).run();
    await env.DB.prepare('DELETE FROM daily_scores WHERE day < ?').bind(utcDayNumber(now.getTime()) - 7).run();
    if (now.getUTCDate() === 1 && now.getUTCMonth() % 3 === 0) {
      // Soft reset: ratings move halfway back to the starting value (seasonReset in the shared rules).
      await env.DB.prepare('UPDATE players SET rating = ROUND((rating + ?) / 2.0), season = season + 1').bind(START_RATING).run();
    }
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const headers = cors(env, req);
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...headers, 'content-type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { headers });

    if (parts[0] === 'room' && parts[1]) {
      if (!originAllowed(env, req)) return new Response('Forbidden', { status: 403 });
      const code = parts[1].toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24);
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(new Request(`https://room/${code}`, req));
    }
    if (parts[0] === 'match') {
      if (!originAllowed(env, req)) return new Response('Forbidden', { status: 403 });
      return env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global')).fetch(req);
    }
    if (parts[0] !== 'api') return json({ error: 'Not found' }, 404);

    switch (parts[1]) {
      case 'health':
        return json({ ok: true });

      case 'rooms': {
        if (req.method === 'POST') {
          const body = await readJson<{ public?: boolean }>(req);
          const code = newCode();
          await env.DB.prepare('INSERT INTO rooms (code, is_public, updated_at) VALUES (?, ?, ?)').bind(code, body?.public ? 1 : 0, Date.now()).run();
          return json({ code });
        }
        const cutoff = Date.now() - 10 * 60_000;
        const { results } = await env.DB.prepare(
          'SELECT code, players, kind, mode FROM rooms WHERE is_public = 1 AND in_lobby = 1 AND players > 0 AND players < 10 AND updated_at > ? ORDER BY updated_at DESC LIMIT 30',
        ).bind(cutoff).all();
        return json(results);
      }

      case 'leaderboard': {
        const { results } = await env.DB.prepare('SELECT name, rating FROM players WHERE games > 0 ORDER BY rating DESC LIMIT 100').all();
        return json(results);
      }

      case 'daily': {
        const day = Number(parts[2]);
        const today = utcDayNumber(Date.now());
        if (!Number.isInteger(day) || day > today || day < today - 2) return json({ error: 'That day is not available' }, 400);
        const board = async () =>
          (await env.DB.prepare('SELECT name, shots, chars FROM daily_scores WHERE day = ? ORDER BY score ASC LIMIT 50').bind(day).all()).results;
        if (req.method === 'POST') {
          if (day !== today) return json({ error: 'Scores can only be sent for today' }, 400);
          const body = await readJson<{ name?: string; guest?: string; shots?: DailyShot[] }>(req);
          if (!body || !Array.isArray(body.shots) || body.shots.length === 0 || body.shots.length > DAILY_MAX_SHOTS) return json({ error: 'Bad score' }, 400);
          const uid = await verifyUser(env, req.headers.get('authorization')?.replace(/^Bearer /, ''));
          const who = uid ?? `g:${String(body.guest ?? '').slice(0, 64)}`;
          if (who === 'g:') return json({ error: 'Bad score' }, 400);
          let result;
          try {
            result = scoreDaily(day, body.shots.map((s) => ({ expr: String(s.expr ?? ''), angle: typeof s.angle === 'number' ? s.angle : undefined })));
          } catch (e) {
            if (e instanceof ParseError) return json({ error: 'Bad score' }, 400);
            throw e;
          }
          if (!result.cleared) return json({ error: 'That run did not clear the map' }, 400);
          await env.DB.prepare(
            `INSERT INTO daily_scores (day, who, name, score, shots, chars) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (day, who) DO UPDATE SET name = excluded.name, score = excluded.score, shots = excluded.shots, chars = excluded.chars
             WHERE excluded.score < daily_scores.score`,
          ).bind(day, who, cleanName(body.name), result.score, result.shots, result.chars).run();
          return json({ board: await board() });
        }
        return json(await board());
      }

      case 'profile': {
        const uid = await verifyUser(env, req.headers.get('authorization')?.replace(/^Bearer /, ''));
        if (!uid) return json({ error: 'Sign in first' }, 401);
        if (req.method === 'PUT') {
          const body = await readJson<Record<string, unknown>>(req);
          if (!body) return json({ error: 'Bad profile' }, 400);
          // The guest token is a local identity and stays on the device.
          delete body.guestToken;
          const name = cleanName(body.name);
          await env.DB.prepare(
            `INSERT INTO players (uid, name, profile, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (uid) DO UPDATE SET name = excluded.name, profile = excluded.profile, updated_at = excluded.updated_at`,
          ).bind(uid, name, JSON.stringify(body), Date.now()).run();
          return json({ ok: true });
        }
        const row = await env.DB.prepare('SELECT rating, profile FROM players WHERE uid = ?').bind(uid).first<{ rating: number; profile: string | null }>();
        return json({ rating: row?.rating ?? START_RATING, profile: row?.profile ? JSON.parse(row.profile) : null });
      }

      case 'report': {
        const body = await readJson<{ code?: string; reported?: string; text?: string }>(req);
        if (!body) return json({ error: 'Bad report' }, 400);
        await env.DB.prepare('INSERT INTO reports (code, reported, text, created_at) VALUES (?, ?, ?, ?)')
          .bind(String(body.code ?? '').slice(0, 24), String(body.reported ?? '').slice(0, 32), String(body.text ?? '').slice(0, 300), Date.now()).run();
        return json({ ok: true });
      }
    }
    return json({ error: 'Not found' }, 404);
  },
};

const MAX_MSG = 1024;

/** Hosts one room. The logic lives in RoomCore; this connects it to sockets and alarms. */
export class RoomObject implements DurableObject {
  private core: RoomCore | null = null;
  private sockets = new Map<string, WebSocket>();
  private nextConn = 1;

  constructor(private ctx: DurableObjectState, private env: Env) {}

  private getCore(code: string): RoomCore {
    if (this.core) return this.core;
    const rankedMatch = /^R-(.+)$/.exec(code);
    const send = (id: string, msg: ServerMsg) => {
      try {
        this.sockets.get(id)?.send(JSON.stringify(msg));
      } catch {
        /* Socket closed; its close event handles cleanup. */
      }
    };
    this.core = new RoomCore(code, {
      send,
      now: () => Date.now(),
      random: () => Math.random(),
      botBudgetMs: 400,
      wake: (at) => {
        if (at === null) void this.ctx.storage.deleteAlarm();
        else void this.ctx.storage.setAlarm(at);
      },
      onLobbyChange: (info) => {
        void this.env.DB.prepare('UPDATE rooms SET players = ?, kind = ?, mode = ?, in_lobby = ?, updated_at = ? WHERE code = ?')
          .bind(info.players, info.kind, info.mode, info.inLobby ? 1 : 0, Date.now(), code).run().catch(() => {});
      },
      onRankedOver: (winner, loser) => this.settleRanked(winner, loser),
    }, { ranked: !!rankedMatch });
    return this.core;
  }

  private seatUid = new Map<string, string>();

  private async settleRanked(winnerSeat: string, loserSeat: string): Promise<number | undefined> {
    const w = this.seatUid.get(winnerSeat);
    const l = this.seatUid.get(loserSeat);
    if (!w || !l) return undefined;
    const rate = async (uid: string) =>
      (await this.env.DB.prepare('SELECT rating FROM players WHERE uid = ?').bind(uid).first<{ rating: number }>())?.rating ?? START_RATING;
    const [rw, rl] = await Promise.all([rate(w), rate(l)]);
    const delta = eloDelta(rw, rl);
    const now = Date.now();
    await this.env.DB.batch([
      this.env.DB.prepare('INSERT INTO players (uid, name, rating, games, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT (uid) DO UPDATE SET rating = ?, games = games + 1, updated_at = ?')
        .bind(w, 'Player', rw + delta, now, rw + delta, now),
      this.env.DB.prepare('INSERT INTO players (uid, name, rating, games, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT (uid) DO UPDATE SET rating = ?, games = games + 1, updated_at = ?')
        .bind(l, 'Player', rl - delta, now, rl - delta, now),
    ]);
    return delta;
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const code = new URL(req.url).pathname.slice(1);
    const core = this.getCore(code);
    const ranked = code.startsWith('R-');
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    const connId = `c${this.nextConn++}`;
    this.sockets.set(connId, server);
    core.connect(connId);

    server.addEventListener('message', (ev) => {
      void (async () => {
        const raw = typeof ev.data === 'string' ? ev.data : '';
        if (raw.length > MAX_MSG) return;
        let msg: ClientMsg;
        try {
          msg = JSON.parse(raw) as ClientMsg;
        } catch {
          return;
        }
        if (msg?.t === 'join') {
          let identity = `g:${String(msg.token ?? '').slice(0, 64)}`;
          if (ranked) {
            const uid = await verifyUser(this.env, msg.token);
            if (!uid) {
              server.send(JSON.stringify({ t: 'error', message: 'Sign in to play ranked.' } satisfies ServerMsg));
              return;
            }
            identity = uid;
          }
          core.join(connId, identity, msg);
          if (ranked) {
            const seat = core.seats.find((s) => s.conns.has(connId));
            if (seat) this.seatUid.set(seat.id, identity);
          }
          return;
        }
        core.handle(connId, msg);
      })();
    });
    const closed = () => {
      this.sockets.delete(connId);
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
    server.addEventListener('message', (ev) => {
      void (async () => {
        let msg: { token?: string; name?: string };
        try {
          msg = JSON.parse(String(ev.data)) as { token?: string; name?: string };
        } catch {
          return;
        }
        const uid = await verifyUser(this.env, msg.token);
        if (!uid) {
          server.send(JSON.stringify({ t: 'error', message: 'Sign in to play ranked.' }));
          return;
        }
        const row = await this.env.DB.prepare('SELECT rating FROM players WHERE uid = ?').bind(uid).first<{ rating: number }>();
        this.queue = this.queue.filter((q) => q.uid !== uid);
        this.queue.push({ ws: server, uid, rating: row?.rating ?? START_RATING, joined: Date.now() });
        this.pairUp();
        void this.ctx.storage.setAlarm(Date.now() + 5000);
      })();
    });
    const closed = () => {
      this.queue = this.queue.filter((q) => q.ws !== server);
    };
    server.addEventListener('close', closed);
    server.addEventListener('error', closed);
    return new Response(null, { status: 101, webSocket: client });
  }

  private pairUp(): void {
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
      if (best) {
        used.add(a);
        used.add(best);
        const code = `R-${newCode()}`;
        const msg = JSON.stringify({ t: 'matched', code });
        a.ws.send(msg);
        best.ws.send(msg);
      }
    }
    this.queue = this.queue.filter((w) => !used.has(w));
  }

  async alarm(): Promise<void> {
    this.pairUp();
    if (this.queue.length) await this.ctx.storage.setAlarm(Date.now() + 5000);
  }
}
