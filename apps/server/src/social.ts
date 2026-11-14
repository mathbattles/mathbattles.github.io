import { START_RATING, cleanMap } from '@mathbattles/sim';
import { activeSanction, handleAdminTools, sanctionText } from './admin';
import { overLimit } from './limits';
import { checkCode, decryptSecret, encryptSecret, newSecret, newSessionToken } from './mfa';
import { newId, sha256Hex } from './security';
import { cleanChat } from './moderation';

/** What these routes need from the main worker, passed in so this file stays independent. */
export interface ApiContext {
  db: D1Database;
  req: Request;
  parts: string[];
  json: (data: unknown, status?: number) => Response;
  /** The signed-in player's id, or null for guests. */
  uid: string | null;
  /** When that player last really signed in, in seconds. */
  authTime: number;
  /** The key that encrypts the admin's two-step secret, if set. */
  mfaKey?: string;
  newCode: () => string;
  ip: string | null;
  /** Closes a live room (admin only). */
  closeRoom?: (code: string) => Promise<boolean>;
}

const ONLINE_MS = 45_000;
const MAX_FRIENDS = 100;
const MAX_PARTY = 6;
const MAX_MAPS_PER_PLAYER = 30;
const MESSAGE_MAX = 300;
const MESSAGE_KEEP_MS = 30 * 86_400_000;
export const ADMIN_USERNAME = 'bobblyionized';

interface Named {
  uid: string;
  display: string;
}

async function body<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    if (text.length > 60_000) return null;
    const v = JSON.parse(text) as T;
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

async function byName(db: D1Database, name: unknown): Promise<Named | null> {
  if (typeof name !== 'string' || !name.trim()) return null;
  return db.prepare('SELECT uid, display FROM usernames WHERE username_lc = ?').bind(name.trim().toLowerCase()).first<Named>();
}

async function nameOf(db: D1Database, uid: string): Promise<string | null> {
  return (await db.prepare('SELECT display FROM usernames WHERE uid = ?').bind(uid).first<{ display: string }>())?.display ?? null;
}

export async function isAdmin(db: D1Database, uid: string | null): Promise<boolean> {
  if (!uid) return false;
  const row = await db.prepare('SELECT username_lc FROM usernames WHERE uid = ?').bind(uid).first<{ username_lc: string }>();
  return row?.username_lc === ADMIN_USERNAME;
}

async function areFriends(db: D1Database, a: string, b: string): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 AS x FROM friends WHERE uid = ? AND friend_uid = ? AND status = 'accepted'").bind(a, b).first());
}

/** True for a room that's mid-match (ranked rooms are always a match). */
async function roomInMatch(db: D1Database, room: string | null): Promise<boolean> {
  if (!room) return false;
  if (room.startsWith('R-')) return true;
  const row = await db.prepare('SELECT in_lobby FROM rooms WHERE code = ?').bind(room).first<{ in_lobby: number }>();
  return row ? row.in_lobby === 0 : false;
}

async function socialState(db: D1Database, uid: string) {
  const now = Date.now();
  const friendRows = (await db.prepare(
    `SELECT f.friend_uid AS uid, u.display AS name, p.room AS room, p.last_seen AS seen
     FROM friends f JOIN usernames u ON u.uid = f.friend_uid LEFT JOIN presence p ON p.uid = f.friend_uid
     WHERE f.uid = ? AND f.status = 'accepted' ORDER BY u.display`,
  ).bind(uid).all<{ uid: string; name: string; room: string | null; seen: number | null }>()).results;
  const friends = await Promise.all(friendRows.map(async (f) => {
    const online = !!f.seen && now - f.seen < ONLINE_MS;
    const room = online ? f.room : null;
    return { name: f.name, online, room, inMatch: await roomInMatch(db, room) };
  }));
  const incoming = (await db.prepare(
    "SELECT u.display AS name FROM friends f JOIN usernames u ON u.uid = f.uid WHERE f.friend_uid = ? AND f.status = 'pending' ORDER BY f.created_at DESC LIMIT 50",
  ).bind(uid).all<{ name: string }>()).results.map((r) => r.name);
  const outgoing = (await db.prepare(
    "SELECT u.display AS name FROM friends f JOIN usernames u ON u.uid = f.friend_uid WHERE f.uid = ? AND f.status = 'pending' ORDER BY f.created_at DESC LIMIT 50",
  ).bind(uid).all<{ name: string }>()).results.map((r) => r.name);

  let party = null;
  const membership = await db.prepare('SELECT party_id FROM party_members WHERE uid = ?').bind(uid).first<{ party_id: string }>();
  if (membership) {
    const info = await db.prepare('SELECT leader FROM parties WHERE id = ?').bind(membership.party_id).first<{ leader: string }>();
    if (info) {
      const members = (await db.prepare(
        `SELECT m.uid AS uid, u.display AS name, p.last_seen AS seen, p.room AS room FROM party_members m
         JOIN usernames u ON u.uid = m.uid LEFT JOIN presence p ON p.uid = m.uid WHERE m.party_id = ? ORDER BY m.joined_at`,
      ).bind(membership.party_id).all<{ uid: string; name: string; seen: number | null; room: string | null }>()).results;
      const leader = members.find((m) => m.uid === info.leader);
      const leaderOnline = !!leader?.seen && now - leader.seen < ONLINE_MS;
      party = {
        id: membership.party_id,
        leader: leader?.name ?? '',
        isLeader: info.leader === uid,
        members: members.map((m) => ({ name: m.name, online: !!m.seen && now - m.seen < ONLINE_MS, leader: m.uid === info.leader })),
        room: leaderOnline ? leader?.room ?? null : null,
      };
    }
  }

  const invites = (await db.prepare(
    `SELECT i.id AS id, u.display AS "from", i.kind AS kind, i.target AS target FROM invites i
     JOIN usernames u ON u.uid = i.from_uid WHERE i.to_uid = ? AND i.created_at > ? ORDER BY i.created_at DESC LIMIT 10`,
  ).bind(uid, now - 10 * 60_000).all<{ id: string; from: string; kind: string; target: string }>()).results;

  const unreadRows = (await db.prepare('SELECT from_uid AS uid, COUNT(*) AS n FROM messages WHERE to_uid = ? AND read_at IS NULL GROUP BY from_uid')
    .bind(uid).all<{ uid: string; n: number }>()).results;
  const unread: Record<string, number> = {};
  for (const r of unreadRows) {
    const f = friendRows.find((x) => x.uid === r.uid);
    if (f) unread[f.name] = r.n;
  }

  return { me: await nameOf(db, uid), friends, incoming, outgoing, party, invites, unread };
}

async function leaveParty(db: D1Database, uid: string): Promise<void> {
  const m = await db.prepare('SELECT party_id FROM party_members WHERE uid = ?').bind(uid).first<{ party_id: string }>();
  if (!m) return;
  await db.prepare('DELETE FROM party_members WHERE uid = ?').bind(uid).run();
  const party = await db.prepare('SELECT leader FROM parties WHERE id = ?').bind(m.party_id).first<{ leader: string }>();
  const next = await db.prepare('SELECT uid FROM party_members WHERE party_id = ? ORDER BY joined_at LIMIT 1').bind(m.party_id).first<{ uid: string }>();
  if (!next) await db.prepare('DELETE FROM parties WHERE id = ?').bind(m.party_id).run();
  else if (party?.leader === uid) await db.prepare('UPDATE parties SET leader = ? WHERE id = ?').bind(next.uid, m.party_id).run();
}

let countsCache: { at: number; data: unknown } | null = null;

/** Handles the routes in this file. Returns null for anything else. */
export async function handleSocial(ctx: ApiContext): Promise<Response | null> {
  const { db, req, parts, json, uid } = ctx;
  const signIn = () => json({ error: 'Sign in to an account to use this.' }, 401);
  const tooMany = () => json({ error: 'Too many requests. Wait a few minutes and try again.' }, 429);
  const route = parts[1];

  if (route === 'social') {
    if (!uid) return signIn();
    if (!(await nameOf(db, uid))) return json({ error: 'Choose a username first.' }, 403);
    if (req.method === 'POST') {
      if (await overLimit(db, `social:${uid}`, 600, 3_600_000)) return tooMany();
      const b = await body<{ room?: unknown }>(req);
      const room = typeof b?.room === 'string' && /^[A-Z0-9-]{4,24}$/.test(b.room) ? b.room : null;
      await db.prepare('INSERT INTO presence (uid, room, last_seen) VALUES (?, ?, ?) ON CONFLICT (uid) DO UPDATE SET room = excluded.room, last_seen = excluded.last_seen')
        .bind(uid, room, Date.now()).run();
    }
    return json(await socialState(db, uid));
  }

  if (route === 'friends' && req.method === 'POST') {
    if (!uid) return signIn();
    if (await overLimit(db, `friends:${uid}`, 120, 3_600_000)) return tooMany();
    const b = await body<{ action?: string; name?: string }>(req);
    const other = await byName(db, b?.name);
    if (!other) return json({ error: 'There is no player with that username.' }, 404);
    if (other.uid === uid) return json({ error: "You can't add yourself." }, 400);
    const now = Date.now();
    switch (b?.action) {
      case 'request': {
        if (await areFriends(db, uid, other.uid)) return json({ ok: true, message: `You and ${other.display} are already friends.` });
        const theyAsked = await db.prepare("SELECT 1 AS x FROM friends WHERE uid = ? AND friend_uid = ? AND status = 'pending'").bind(other.uid, uid).first();
        const count = (await db.prepare("SELECT COUNT(*) AS n FROM friends WHERE uid = ? AND status = 'accepted'").bind(uid).first<{ n: number }>())?.n ?? 0;
        if (count >= MAX_FRIENDS) return json({ error: `You can have up to ${MAX_FRIENDS} friends.` }, 400);
        if (theyAsked) {
          await db.batch([
            db.prepare("UPDATE friends SET status = 'accepted' WHERE uid = ? AND friend_uid = ?").bind(other.uid, uid),
            db.prepare("INSERT INTO friends (uid, friend_uid, status, created_at) VALUES (?, ?, 'accepted', ?) ON CONFLICT DO UPDATE SET status = 'accepted'").bind(uid, other.uid, now),
          ]);
          return json({ ok: true, message: `You and ${other.display} are now friends.` });
        }
        await db.prepare("INSERT INTO friends (uid, friend_uid, status, created_at) VALUES (?, ?, 'pending', ?) ON CONFLICT DO NOTHING").bind(uid, other.uid, now).run();
        return json({ ok: true, message: `Friend request sent to ${other.display}.` });
      }
      case 'accept': {
        const asked = await db.prepare("SELECT 1 AS x FROM friends WHERE uid = ? AND friend_uid = ? AND status = 'pending'").bind(other.uid, uid).first();
        if (!asked) return json({ error: 'That request is no longer there.' }, 404);
        await db.batch([
          db.prepare("UPDATE friends SET status = 'accepted' WHERE uid = ? AND friend_uid = ?").bind(other.uid, uid),
          db.prepare("INSERT INTO friends (uid, friend_uid, status, created_at) VALUES (?, ?, 'accepted', ?) ON CONFLICT DO UPDATE SET status = 'accepted'").bind(uid, other.uid, now),
        ]);
        return json({ ok: true });
      }
      case 'decline':
        await db.prepare("DELETE FROM friends WHERE uid = ? AND friend_uid = ? AND status = 'pending'").bind(other.uid, uid).run();
        return json({ ok: true });
      case 'cancel':
        await db.prepare("DELETE FROM friends WHERE uid = ? AND friend_uid = ? AND status = 'pending'").bind(uid, other.uid).run();
        return json({ ok: true });
      case 'remove':
        await db.batch([
          db.prepare('DELETE FROM friends WHERE uid = ? AND friend_uid = ?').bind(uid, other.uid),
          db.prepare('DELETE FROM friends WHERE uid = ? AND friend_uid = ?').bind(other.uid, uid),
          db.prepare('DELETE FROM messages WHERE (from_uid = ? AND to_uid = ?) OR (from_uid = ? AND to_uid = ?)').bind(uid, other.uid, other.uid, uid),
        ]);
        return json({ ok: true });
    }
    return json({ error: 'Unknown action' }, 400);
  }

  if (route === 'invites' && req.method === 'POST') {
    if (!uid) return signIn();
    if (await overLimit(db, `invites:${uid}`, 120, 3_600_000)) return tooMany();
    const b = await body<{ action?: string; name?: string; room?: string; id?: string }>(req);
    if (b?.action === 'dismiss') {
      await db.prepare('DELETE FROM invites WHERE id = ? AND to_uid = ?').bind(String(b.id ?? '').slice(0, 64), uid).run();
      return json({ ok: true });
    }
    if (b?.action === 'room') {
      const other = await byName(db, b.name);
      if (!other || !(await areFriends(db, uid, other.uid))) return json({ error: 'You can only invite friends.' }, 400);
      const room = typeof b.room === 'string' && /^[A-Z0-9-]{4,24}$/.test(b.room) ? b.room : null;
      if (!room) return json({ error: 'Join a room first, then invite people to it.' }, 400);
      await db.prepare("DELETE FROM invites WHERE from_uid = ? AND to_uid = ? AND kind = 'room'").bind(uid, other.uid).run();
      await db.prepare("INSERT INTO invites (id, from_uid, to_uid, kind, target, created_at) VALUES (?, ?, ?, 'room', ?, ?)").bind(newId(), uid, other.uid, room, Date.now()).run();
      return json({ ok: true, message: `Invited ${other.display}.` });
    }
    return json({ error: 'Unknown action' }, 400);
  }

  if (route === 'messages') {
    if (!uid) return signIn();
    const me = await nameOf(db, uid);
    if (!me) return json({ error: 'Choose a username first.' }, 403);

    if (parts[2] === 'report' && req.method === 'POST') {
      if (await overLimit(db, `dm-report:${uid}`, 20, 3_600_000)) return tooMany();
      const b = await body<{ id?: string }>(req);
      // Only a message someone sent to you can be reported.
      const msg = await db.prepare('SELECT m.body AS body, u.display AS sender FROM messages m JOIN usernames u ON u.uid = m.from_uid WHERE m.id = ? AND m.to_uid = ?')
        .bind(String(b?.id ?? '').slice(0, 64), uid).first<{ body: string; sender: string }>();
      if (!msg) return json({ error: 'That message is gone.' }, 404);
      await db.prepare('INSERT INTO reports (code, reported, text, created_at) VALUES (?, ?, ?, ?)').bind('DM', msg.sender.slice(0, 32), msg.body.slice(0, 300), Date.now()).run();
      return json({ ok: true, message: 'Thanks. The message was reported.' });
    }

    if (req.method === 'POST' && !parts[2]) {
      // Short bursts are fine; floods aren't.
      if (await overLimit(db, `dm-burst:${uid}`, 15, 60_000)) return json({ error: 'Slow down a little, then try again.' }, 429);
      if (await overLimit(db, `dm-hour:${uid}`, 400, 3_600_000)) return tooMany();
      const b = await body<{ to?: string; text?: string }>(req);
      const muted = await activeSanction(db, uid, 'mute');
      if (muted) return json({ error: sanctionText(muted) }, 403);
      const other = await byName(db, b?.to);
      if (!other || !(await areFriends(db, uid, other.uid))) return json({ error: 'You can only message friends.' }, 403);
      const text = cleanChat(String(b?.text ?? ''), MESSAGE_MAX);
      if (!text) return json({ error: 'Type a message first.' }, 400);
      const msg = { id: newId(), at: Date.now() };
      await db.prepare('INSERT INTO messages (id, from_uid, to_uid, body, created_at) VALUES (?, ?, ?, ?, ?)').bind(msg.id, uid, other.uid, text, msg.at).run();
      return json({ id: msg.id, from: me, mine: true, text, at: msg.at, seen: false });
    }

    if (req.method === 'GET' && parts[2]) {
      if (await overLimit(db, `dm-read:${uid}`, 2000, 3_600_000)) return tooMany();
      let name = '';
      try {
        name = decodeURIComponent(parts[2]);
      } catch {
        return json({ error: 'No such player' }, 404);
      }
      const other = await byName(db, name);
      if (!other || !(await areFriends(db, uid, other.uid))) return json({ error: 'You can only message friends.' }, 403);
      const url = new URL(req.url);
      const before = Number(url.searchParams.get('before')) || Date.now() + 1;
      const rows = (await db.prepare(
        `SELECT id, from_uid, body, created_at, read_at FROM messages
         WHERE ((from_uid = ? AND to_uid = ?) OR (from_uid = ? AND to_uid = ?)) AND created_at < ?
         ORDER BY created_at DESC LIMIT 50`,
      ).bind(uid, other.uid, other.uid, uid, before).all<{ id: string; from_uid: string; body: string; created_at: number; read_at: number | null }>()).results;
      // Opening the conversation marks their messages as seen.
      await db.prepare('UPDATE messages SET read_at = ? WHERE to_uid = ? AND from_uid = ? AND read_at IS NULL').bind(Date.now(), uid, other.uid).run();
      return json({
        friend: other.display,
        more: rows.length === 50,
        messages: rows.reverse().map((r) => ({
          id: r.id,
          from: r.from_uid === uid ? me : other.display,
          mine: r.from_uid === uid,
          text: r.body,
          at: r.created_at,
          seen: r.from_uid === uid ? r.read_at !== null : true,
        })),
      });
    }
    return json({ error: 'Not found' }, 404);
  }

  if (route === 'party' && req.method === 'POST') {
    if (!uid) return signIn();
    if (await overLimit(db, `party:${uid}`, 120, 3_600_000)) return tooMany();
    const b = await body<{ action?: string; name?: string; id?: string }>(req);
    const now = Date.now();
    switch (b?.action) {
      case 'create': {
        await leaveParty(db, uid);
        const id = newId();
        await db.batch([
          db.prepare('INSERT INTO parties (id, leader, created_at) VALUES (?, ?, ?)').bind(id, uid, now),
          db.prepare('INSERT INTO party_members (uid, party_id, joined_at) VALUES (?, ?, ?)').bind(uid, id, now),
        ]);
        return json({ ok: true });
      }
      case 'invite': {
        const mine = await db.prepare('SELECT party_id FROM party_members WHERE uid = ?').bind(uid).first<{ party_id: string }>();
        if (!mine) return json({ error: 'Start a party first.' }, 400);
        const other = await byName(db, b.name);
        if (!other || !(await areFriends(db, uid, other.uid))) return json({ error: 'You can only invite friends.' }, 400);
        await db.prepare("DELETE FROM invites WHERE from_uid = ? AND to_uid = ? AND kind = 'party'").bind(uid, other.uid).run();
        await db.prepare("INSERT INTO invites (id, from_uid, to_uid, kind, target, created_at) VALUES (?, ?, ?, 'party', ?, ?)").bind(newId(), uid, other.uid, mine.party_id, now).run();
        return json({ ok: true, message: `Invited ${other.display} to your party.` });
      }
      case 'join': {
        const id = String(b.id ?? '').slice(0, 64);
        const invited = await db.prepare("SELECT 1 AS x FROM invites WHERE to_uid = ? AND kind = 'party' AND target = ?").bind(uid, id).first();
        if (!invited) return json({ error: 'That party invite has expired.' }, 400);
        const exists = await db.prepare('SELECT 1 AS x FROM parties WHERE id = ?').bind(id).first();
        if (!exists) return json({ error: 'That party has ended.' }, 400);
        const size = (await db.prepare('SELECT COUNT(*) AS n FROM party_members WHERE party_id = ?').bind(id).first<{ n: number }>())?.n ?? 0;
        if (size >= MAX_PARTY) return json({ error: `Parties can have up to ${MAX_PARTY} players.` }, 400);
        await leaveParty(db, uid);
        await db.batch([
          db.prepare('INSERT INTO party_members (uid, party_id, joined_at) VALUES (?, ?, ?)').bind(uid, id, now),
          db.prepare("DELETE FROM invites WHERE to_uid = ? AND kind = 'party' AND target = ?").bind(uid, id),
        ]);
        return json({ ok: true });
      }
      case 'leave':
        await leaveParty(db, uid);
        return json({ ok: true });
      case 'kick': {
        const mine = await db.prepare('SELECT p.id AS id, p.leader AS leader FROM party_members m JOIN parties p ON p.id = m.party_id WHERE m.uid = ?').bind(uid).first<{ id: string; leader: string }>();
        if (!mine || mine.leader !== uid) return json({ error: 'Only the party leader can do that.' }, 403);
        const other = await byName(db, b.name);
        if (other && other.uid !== uid) await db.prepare('DELETE FROM party_members WHERE uid = ? AND party_id = ?').bind(other.uid, mine.id).run();
        return json({ ok: true });
      }
    }
    return json({ error: 'Unknown action' }, 400);
  }

  if (route === 'maps') {
    const code = parts[2];
    if (!code) {
      if (req.method === 'POST') {
        if (!uid) return signIn();
        const author = await nameOf(db, uid);
        if (!author) return json({ error: 'Choose a username first.' }, 403);
        if (await overLimit(db, `maps:${uid}`, 30, 3_600_000)) return tooMany();
        const b = await body<{ map?: unknown }>(req);
        const map = cleanMap(b?.map);
        if (!map || map.circles.length === 0) return json({ error: 'That map has nothing on it yet.' }, 400);
        const mine = (await db.prepare('SELECT COUNT(*) AS n FROM maps WHERE uid = ?').bind(uid).first<{ n: number }>())?.n ?? 0;
        if (mine >= MAX_MAPS_PER_PLAYER) return json({ error: `You can share up to ${MAX_MAPS_PER_PLAYER} maps. Delete one first.` }, 400);
        const newCode = `M-${ctx.newCode()}`;
        await db.prepare('INSERT INTO maps (code, uid, author, name, data, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(newCode, uid, author, map.name, JSON.stringify(map), Date.now()).run();
        return json({ code: newCode });
      }
      const url = new URL(req.url);
      const mineOnly = url.searchParams.get('mine') === '1';
      if (mineOnly && !uid) return signIn();
      const sort = url.searchParams.get('sort') === 'popular' ? 'plays DESC, created_at DESC' : 'created_at DESC';
      const rows = mineOnly
        ? await db.prepare(`SELECT code, name, author, plays, created_at, data FROM maps WHERE uid = ? ORDER BY created_at DESC LIMIT 60`).bind(uid).all()
        : await db.prepare(`SELECT code, name, author, plays, created_at, data FROM maps ORDER BY ${sort} LIMIT 60`).all();
      return json((rows.results as { code: string; name: string; author: string; plays: number; created_at: number; data: string }[])
        .map((r) => ({ code: r.code, name: r.name, author: r.author, plays: r.plays, at: r.created_at, map: JSON.parse(r.data) })));
    }
    const clean = code.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16);
    if (parts[3] === 'play' && req.method === 'POST') {
      if (ctx.ip && (await overLimit(db, `mapplay:${ctx.ip}`, 120, 3_600_000))) return json({ ok: true });
      await db.prepare('UPDATE maps SET plays = plays + 1 WHERE code = ?').bind(clean).run();
      return json({ ok: true });
    }
    if (req.method === 'DELETE') {
      if (!uid) return signIn();
      const row = await db.prepare('SELECT uid FROM maps WHERE code = ?').bind(clean).first<{ uid: string }>();
      if (!row) return json({ ok: true });
      if (row.uid !== uid && !(await isAdmin(db, uid))) return json({ error: 'Only the map’s maker can delete it.' }, 403);
      await db.prepare('DELETE FROM maps WHERE code = ?').bind(clean).run();
      return json({ ok: true });
    }
    const row = await db.prepare('SELECT code, name, author, plays, data FROM maps WHERE code = ?').bind(clean).first<{ code: string; name: string; author: string; plays: number; data: string }>();
    if (!row) return json({ error: 'There is no map with that code.' }, 404);
    return json({ code: row.code, name: row.name, author: row.author, plays: row.plays, map: JSON.parse(row.data) });
  }

  if (route === 'cosmetics') {
    // Counting every account's items is heavy, so the answer is reused for a few minutes.
    if (!countsCache || Date.now() - countsCache.at > 10 * 60_000) {
      const { results } = await db.prepare(
        "SELECT j.value AS id, COUNT(*) AS n FROM players, json_each(players.profile, '$.owned') AS j WHERE players.profile IS NOT NULL GROUP BY j.value",
      ).all<{ id: string; n: number }>();
      const players = (await db.prepare('SELECT COUNT(*) AS n FROM players WHERE profile IS NOT NULL').first<{ n: number }>())?.n ?? 0;
      countsCache = { at: Date.now(), data: { players, counts: Object.fromEntries(results.map((r) => [r.id, r.n])) } };
    }
    return json(countsCache.data);
  }

  if (route === 'ranked') {
    if (!uid) return signIn();
    const me = await db.prepare('SELECT rating, games, season FROM players WHERE uid = ?').bind(uid).first<{ rating: number; games: number; season: number }>();
    const rating = me?.rating ?? START_RATING;
    const games = me?.games ?? 0;
    const above = (await db.prepare('SELECT COUNT(*) AS n FROM players WHERE games > 0 AND rating > ?').bind(rating).first<{ n: number }>())?.n ?? 0;
    const total = (await db.prepare('SELECT COUNT(*) AS n FROM players WHERE games > 0').first<{ n: number }>())?.n ?? 0;
    return json({ rating, games, place: games > 0 ? above + 1 : null, total, season: me?.season ?? 1 });
  }

  if (route === 'admin') {
    // Only the owner's account, and the server decides that, not the page.
    if (!(await isAdmin(db, uid))) return json({ error: 'Not allowed' }, 403);
    const owner = uid!;
    const now = Date.now();
    const recent = (seconds: number) => ctx.authTime > 0 && now / 1000 - ctx.authTime < seconds;
    if (!ctx.mfaKey) return json({ error: 'Two-step sign-in is not set up on the server yet.' }, 503);

    if (parts[2] === 'mfa') {
      const row = await db.prepare('SELECT secret_enc, active, last_step FROM admin_mfa WHERE uid = ?').bind(owner).first<{ secret_enc: string; active: number; last_step: number }>();
      if (req.method === 'GET') return json({ active: row?.active === 1 });
      if (parts[3] === 'setup' && req.method === 'POST') {
        // Once set up, it can't be replaced from the web, so a stolen password can't move it.
        if (row?.active === 1) return json({ error: 'Two-step sign-in is already set up.' }, 409);
        if (!recent(15 * 60)) return json({ error: 'Sign out and back in, then set this up within 15 minutes.', reauth: true }, 401);
        if (await overLimit(db, `mfa-setup:${owner}`, 5, 3_600_000)) return tooMany();
        const secret = newSecret();
        await db.prepare('INSERT INTO admin_mfa (uid, secret_enc, active, last_step, created_at) VALUES (?, ?, 0, 0, ?) ON CONFLICT (uid) DO UPDATE SET secret_enc = excluded.secret_enc, last_step = 0, created_at = excluded.created_at')
          .bind(owner, await encryptSecret(secret, ctx.mfaKey), now).run();
        const label = encodeURIComponent(`MathBattles.io:${ADMIN_USERNAME}`);
        return json({ secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=MathBattles.io&algorithm=SHA1&digits=6&period=30` });
      }
      if (parts[3] === 'verify' && req.method === 'POST') {
        if (!row) return json({ error: 'Set up two-step sign-in first.' }, 400);
        if (await overLimit(db, `mfa-verify:${owner}`, 6, 10 * 60_000)) return tooMany();
        // A sign-in more than 12 hours old has to be renewed first.
        if (!recent(12 * 3600)) return json({ error: 'Sign out and back in, then enter a code.', reauth: true }, 401);
        const b = await body<{ code?: string }>(req);
        const code = String(b?.code ?? '').replace(/\s/g, '');
        const step = await checkCode(await decryptSecret(row.secret_enc, ctx.mfaKey), code, now, row.last_step);
        if (step === null) return json({ error: 'That code is wrong or already used. Wait for the next one.' }, 401);
        const token = newSessionToken();
        const expires = now + 30 * 60_000;
        await db.batch([
          db.prepare('UPDATE admin_mfa SET active = 1, last_step = ? WHERE uid = ?').bind(step, owner),
          db.prepare('DELETE FROM admin_sessions WHERE uid = ? OR expires_at < ?').bind(owner, now),
          db.prepare('INSERT INTO admin_sessions (token_hash, uid, expires_at) VALUES (?, ?, ?)').bind(await sha256Hex(token), owner, expires),
        ]);
        return json({ session: token, expires });
      }
      return json({ error: 'Not found' }, 404);
    }

    // Everything else needs a two-step session from the last 30 minutes, tied to this account.
    const session = req.headers.get('x-admin-session') ?? '';
    const valid = session.length >= 32 && !!(await db.prepare('SELECT 1 AS x FROM admin_sessions WHERE token_hash = ? AND uid = ? AND expires_at > ?')
      .bind(await sha256Hex(session), owner, now).first());
    if (!valid) return json({ error: 'Enter a code from your authenticator app.', mfa: true }, 401);

    // Player tools, bans and mutes, the live room list, and game settings.
    const tools = await handleAdminTools({ db, req, parts, json, closeRoom: ctx.closeRoom ?? (async () => false) });
    if (tools) return tools;

    if (parts[2] === 'logout' && req.method === 'POST') {
      await db.prepare('DELETE FROM admin_sessions WHERE uid = ?').bind(owner).run();
      return json({ ok: true });
    }
    if (parts[2] === 'reports' && parts[3] && req.method === 'DELETE') {
      await db.prepare('DELETE FROM reports WHERE id = ?').bind(Number(parts[3]) || 0).run();
      return json({ ok: true });
    }
    if (req.method !== 'GET' || parts[2]) return json({ error: 'Not found' }, 404);
    const count = async (sql: string, ...args: unknown[]) => (await db.prepare(sql).bind(...args).first<{ n: number }>())?.n ?? 0;
    const stats = {
      accounts: await count('SELECT COUNT(*) AS n FROM usernames'),
      synced: await count('SELECT COUNT(*) AS n FROM players WHERE profile IS NOT NULL'),
      rankedPlayers: await count('SELECT COUNT(*) AS n FROM players WHERE games > 0'),
      online: await count('SELECT COUNT(*) AS n FROM presence WHERE last_seen > ?', now - ONLINE_MS),
      openRooms: await count('SELECT COUNT(*) AS n FROM rooms WHERE players > 0 AND updated_at > ?', now - 10 * 60_000),
      matchesToday: await count('SELECT COUNT(DISTINCT id) AS n FROM match_history WHERE at > ?', now - 86_400_000),
      maps: await count('SELECT COUNT(*) AS n FROM maps'),
      friendships: await count("SELECT COUNT(*) AS n FROM friends WHERE status = 'accepted'"),
    };
    const reports = (await db.prepare('SELECT id, code, reported, text, created_at FROM reports ORDER BY created_at DESC LIMIT 50').all()).results;
    return json({ stats, reports });
  }

  return null;
}

/** Old presence rows and invites are cleared once a day. */
export function socialCleanup(db: D1Database, now: number): Promise<unknown>[] {
  return [
    db.prepare('DELETE FROM invites WHERE created_at < ?').bind(now - 86_400_000).run(),
    db.prepare('DELETE FROM presence WHERE last_seen < ?').bind(now - 7 * 86_400_000).run(),
    db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').bind(now).run(),
    db.prepare('DELETE FROM messages WHERE created_at < ?').bind(now - MESSAGE_KEEP_MS).run(),
  ];
}
