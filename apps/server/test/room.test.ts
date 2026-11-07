import { describe, expect, it } from 'vitest';
import { RECONNECT_GRACE_MS, TURN_MS, currentPlayer, type ClientMsg, type ServerMsg } from '@mathbattles/sim';
import { cleanChat, cleanName, isBlockedName } from '../src/moderation';
import { MessageBucket } from '../src/limits';
import { RoomCore, type RoomIO } from '../src/roomCore';

function harness(opts: { ranked?: boolean; rankedPair?: [string, string] } = {}) {
  const sent: Record<string, ServerMsg[]> = {};
  const clock = { t: 1_000_000, wake: null as number | null };
  let seed = 0.37;
  const io: RoomIO = {
    send: (id, msg) => void (sent[id] ??= []).push(JSON.parse(JSON.stringify(msg)) as ServerMsg),
    now: () => clock.t,
    wake: (at) => void (clock.wake = at),
    random: () => (seed = (seed * 9301 + 0.49297) % 1),
    botMaxEvals: 200,
  };
  const room = new RoomCore('TEST', io, opts);
  const join = (conn: string, token: string, name = conn) => room.join(conn, `g:${token}`, { t: 'join', name, token });
  const last = (conn: string, t: ServerMsg['t']) => [...(sent[conn] ?? [])].reverse().find((m) => m.t === t);
  const advance = (ms: number) => {
    const end = clock.t + ms;
    for (let i = 0; i < 2000 && clock.wake !== null && clock.wake <= end; i++) {
      clock.t = Math.max(clock.t, clock.wake);
      room.tick();
    }
    clock.t = end;
  };
  return { room, sent, clock, join, last, advance };
}

function startDuel() {
  const h = harness();
  h.join('a', 'tokA');
  h.join('b', 'tokB');
  const msg = (c: string, m: ClientMsg) => h.room.handle(c, m);
  msg('b', { t: 'ready', ready: true });
  msg('a', { t: 'start' });
  h.advance(5001);
  return { ...h, msg };
}

const connFor = (seatId: string, h: ReturnType<typeof harness>) =>
  [...h.room.seats.find((s) => s.id === seatId)!.conns][0]!;

describe('watching and custom maps', () => {
  it('lets people watch a match without a seat, and nothing they send changes it', () => {
    const h = startDuel();
    h.room.join('w', 'g:watcher', { t: 'join', name: 'Watcher', token: 'watcher', spectate: true });
    expect(h.room.seats.some((s) => s.name === 'Watcher')).toBe(false);
    expect(h.last('w', 'welcome')).toMatchObject({ you: '' });
    expect(h.last('w', 'match')).toBeTruthy();
    expect(h.last('a', 'lobby')).toMatchObject({ spectators: 1 });
    const before = JSON.stringify(h.room.state);
    h.room.handle('w', { t: 'fire', expr: 'x/3' });
    h.room.handle('w', { t: 'chat', text: 'hello' });
    h.room.handle('w', { t: 'start' });
    expect(JSON.stringify(h.room.state)).toBe(before);
    // Watchers get each shot like players do.
    const cur = currentPlayer(h.room.state!);
    h.room.handle(connFor(cur.id, h), { t: 'fire', expr: 'x/7' });
    expect(h.last('w', 'shot')).toBeTruthy();
    h.room.disconnect('w');
    expect(h.last('a', 'lobby')).toMatchObject({ spectators: 0 });
  });
  it('plays the host’s custom map, and only offers y = f(x)', () => {
    const h = harness();
    h.join('a', '1');
    h.join('b', '2');
    const map = { name: 'Wall', circles: [{ x: 385, y: 225, r: 60 }], spawns: [{ x: 80, y: 225, team: 1 as const }, { x: 690, y: 225, team: 2 as const }] };
    h.room.handle('a', { t: 'settings', settings: { map, mode: 'ode2' } });
    expect(h.room.settings.mode).toBe('fn');
    expect(h.room.settings.map).toEqual(map);
    h.room.handle('b', { t: 'ready', ready: true });
    h.room.handle('a', { t: 'start' });
    expect(h.room.state!.circles).toEqual(map.circles);
    expect(h.room.state!.soldiers.map((s) => [s.x, s.y]).sort()).toEqual([[690, 225], [80, 225]]);
  });
});

describe('room lobby', () => {
  it('assigns host, balances teams, and hides tokens', () => {
    const h = harness();
    h.join('a', 'secretA');
    h.join('b', 'secretB');
    expect(h.room.host).toBe(h.room.seats[0]!.id);
    expect(h.room.seats.map((s) => s.team)).toEqual([1, 2]);
    expect(JSON.stringify(h.sent)).not.toContain('secret');
  });
  it('only the host can change rules or start', () => {
    const h = harness();
    h.join('a', '1');
    h.join('b', '2');
    h.room.handle('b', { t: 'settings', settings: { kind: 'ffa' } });
    expect(h.room.settings.kind).toBe('teams');
    h.room.handle('b', { t: 'start' });
    expect(h.room.state).toBeNull();
    h.room.handle('a', { t: 'settings', settings: { kind: 'ffa', soldiers: 99 } });
    expect(h.room.settings.kind).toBe('ffa');
    expect(h.room.settings.soldiers).toBe(4);
  });
  it('requires everyone ready and valid teams', () => {
    const h = harness();
    h.join('a', '1');
    h.room.handle('a', { t: 'start' });
    expect((h.last('a', 'error') as { message: string }).message).toMatch(/at least 2/);
    h.join('b', '2');
    h.room.handle('a', { t: 'start' });
    expect((h.last('a', 'error') as { message: string }).message).toMatch(/ready/);
  });
});

describe('match on the server', () => {
  it('rejects a shot out of turn and bad math, without ending the turn', () => {
    const h = startDuel();
    const state = h.room.state!;
    const cur = currentPlayer(state).id;
    const other = h.room.seats.find((s) => s.id !== cur)!;
    h.room.handle(connFor(other.id, h), { t: 'fire', expr: '0' });
    expect((h.last(connFor(other.id, h), 'error') as { message: string }).message).toMatch(/your turn/);
    expect(state.turnNumber).toBe(1);
    h.room.handle(connFor(cur, h), { t: 'fire', expr: 'sin(x' });
    expect((h.last(connFor(cur, h), 'error') as { message: string }).message).toMatch(/Missing/);
    expect(state.turnNumber).toBe(1);
  });
  it("ignores any result a client claims: only the server's simulation counts", () => {
    const h = startDuel();
    const state = h.room.state!;
    const cur = currentPlayer(state).id;
    const forged = { t: 'fire', expr: '0', hits: [{ id: 0, step: 1 }, { id: 1, step: 1 }, { id: 2, step: 1 }, { id: 3, step: 1 }], kills: 99 } as unknown as ClientMsg;
    const aliveBefore = state.soldiers.filter((s) => s.alive).length;
    state.circles.length = 0;
    state.soldiers.forEach((s, i) => { s.x = i < 2 ? 100 : 600; s.y = 40 + i * 90; });
    h.room.handle(connFor(cur, h), forged);
    expect(state.soldiers.filter((s) => s.alive).length).toBe(aliveBefore);
    const shot = h.last(connFor(cur, h), 'shot') as { shot: { hits: unknown[] } };
    expect(shot.shot.hits).toEqual([]);
  });
  it('makes the next player wait for the shot to land', () => {
    const h = startDuel();
    const state = h.room.state!;
    const first = currentPlayer(state).id;
    h.room.handle(connFor(first, h), { t: 'fire', expr: '0' });
    const next = currentPlayer(state).id;
    expect(next).not.toBe(first);
    h.room.handle(connFor(next, h), { t: 'fire', expr: '0' });
    expect((h.last(connFor(next, h), 'error') as { message: string }).message).toMatch(/land/);
    const shot = h.last(connFor(next, h), 'shot') as { deadline: number };
    h.clock.t = shot.deadline - TURN_MS + 1;
    h.room.handle(connFor(next, h), { t: 'fire', expr: '0' });
    expect(state.turnNumber).toBe(3);
  });
  it('skips a player who runs out of time', () => {
    const h = startDuel();
    const first = currentPlayer(h.room.state!).id;
    h.advance(TURN_MS + 10);
    expect(currentPlayer(h.room.state!).id).not.toBe(first);
  });
  it('lets a disconnected player rejoin the same seat within the grace period', () => {
    const h = startDuel();
    const seatB = h.room.seats[1]!.id;
    h.room.disconnect('b');
    h.advance(RECONNECT_GRACE_MS - 5000);
    expect(h.room.seats.find((s) => s.id === seatB)?.connected).toBe(false);
    h.join('b2', 'tokB');
    const seat = h.room.seats.find((s) => s.id === seatB)!;
    expect(seat.connected).toBe(true);
    expect((h.last('b2', 'match') as { t: string }).t).toBe('match');
    h.advance(RECONNECT_GRACE_MS);
    expect(h.room.state?.players.find((p) => p.id === seatB)?.connected).toBe(true);
  });
  it('removes a player after the grace period and ends the match', () => {
    const h = startDuel();
    const a = h.room.seats[0]!.id;
    h.room.disconnect('b');
    h.advance(RECONNECT_GRACE_MS + 10);
    expect(h.room.state!.over).toBe(true);
    expect(h.room.state!.players.find((p) => p.id === a)).toBeTruthy();
    expect((h.last('a', 'over') as { t: string }).t).toBe('over');
  });
  it('blocks strangers from joining mid-match', () => {
    const h = startDuel();
    h.join('c', 'tokC');
    expect((h.last('c', 'error') as { message: string }).message).toMatch(/in progress/);
    expect(h.room.seats.length).toBe(2);
  });
  it('bots take their turns', () => {
    const h = harness();
    h.join('a', '1');
    h.room.handle('a', { t: 'addBot', level: 'easy' });
    h.room.handle('a', { t: 'start' });
    const state = h.room.state!;
    expect(state.players.some((p) => p.isBot)).toBe(true);
    for (let i = 0; i < 4 && !state.over; i++) {
      const cur = currentPlayer(state);
      if (!cur.isBot) h.room.handle('a', { t: 'fire', expr: '0' });
      h.advance(30_000);
    }
    expect(state.log.some((e) => e.type === 'shot' && state.players.find((p) => p.id === e.shot.playerId)?.isBot)).toBe(true);
  });
  it('a unanimous -skip makes a new map', () => {
    const h = startDuel();
    const seed = h.room.state!.config.seed;
    h.room.handle('a', { t: 'chat', text: '-skip' });
    expect(h.room.state!.config.seed).toBe(seed);
    h.room.handle('b', { t: 'chat', text: '-SKIP' });
    expect(h.room.state!.config.seed).not.toBe(seed);
  });
  it('returns to the lobby after a match', () => {
    const h = startDuel();
    h.room.disconnect('b');
    h.advance(RECONNECT_GRACE_MS + 20_000);
    expect(h.room.state).toBeNull();
  });
  it('ranked rooms use fixed rules and start automatically', () => {
    const h = harness({ ranked: true, rankedPair: ['g:1', 'g:2'] });
    h.join('a', '1');
    expect(h.room.state).toBeNull();
    h.room.handle('a', { t: 'settings', settings: { soldiers: 4 } });
    h.join('b', '2');
    expect(h.room.state).not.toBeNull();
    expect(h.room.state!.config.soldiers).toBe(1);
    expect(h.room.seats.map((s) => s.team)).toEqual([1, 2]);
  });
});

describe('review fixes', () => {
  it('a connection cannot take a second seat, so it cannot leave ghosts', () => {
    const h = harness();
    h.join('a', 'one');
    h.room.join('a', 'g:two', { t: 'join', name: 'ghost', token: 'two' });
    h.room.join('a', 'g:three', { t: 'join', name: 'ghost', token: 'three' });
    expect(h.room.seats.length).toBe(1);
    h.room.disconnect('a');
    expect(h.room.seats[0]!.connected).toBe(false);
  });
  it('ranked rooms admit only the matched pair', () => {
    const noPair = harness({ ranked: true });
    noPair.join('x', 'farmer');
    expect((noPair.last('x', 'closed') as { message: string }).message).toMatch(/two other players/);
    expect(noPair.room.seats.length).toBe(0);
    const h = harness({ ranked: true, rankedPair: ['g:1', 'g:2'] });
    h.join('x', 'stranger');
    expect(h.last('x', 'closed')).toBeTruthy();
    expect(h.room.seats.length).toBe(0);
  });
  it('a finished ranked room cannot start another match', () => {
    const h = harness({ ranked: true, rankedPair: ['g:1', 'g:2'] });
    h.join('a', '1');
    h.join('b', '2');
    const first = h.room.state!;
    h.room.handle('b', { t: 'leave' });
    expect(first.over).toBe(true);
    h.advance(60_000);
    h.join('a2', '1');
    expect(h.room.state).toBe(first);
    expect(h.last('a2', 'over')).toBeTruthy();
  });
  it('a ranked no-show cancels the match with no rating change', () => {
    const h = harness({ ranked: true, rankedPair: ['g:1', 'g:2'] });
    h.join('a', '1');
    h.advance(31_000);
    expect(h.room.state).toBeNull();
    expect((h.last('a', 'closed') as { message: string }).message).toMatch(/didn't connect/);
    h.join('b', '2');
    expect(h.room.state).toBeNull();
  });
  it('ignores messages for abilities, which no longer exist', () => {
    const h = harness();
    h.join('a', '1');
    h.join('b', '2');
    h.room.handle('b', { t: 'ready', ready: true });
    h.room.handle('a', { t: 'start' });
    h.advance(5001);
    const state = h.room.state!;
    const cur = currentPlayer(state);
    const conn = connFor(cur.id, h);
    const before = JSON.stringify(state);
    h.room.handle(conn, { t: 'teleport', x: 50, y: 50 } as unknown as ClientMsg);
    h.room.handle(conn, { t: 'missile' } as unknown as ClientMsg);
    expect(JSON.stringify(state)).toBe(before);
  });
  it('a room gets a new host when the old one is gone', () => {
    const h = harness();
    h.join('a', '1');
    h.join('b', '2');
    h.room.disconnect('a');
    h.room.disconnect('b');
    h.clock.t += 1000;
    h.advance(RECONNECT_GRACE_MS - 500);
    expect(h.room.host).toBe('');
    h.join('b2', '2');
    expect(h.room.host).toBe(h.room.seats.find((s) => s.conns.has('b2'))!.id);
  });
  it('leaving frees the seat at once', () => {
    const h = startDuel();
    const a = h.room.seats[0]!.id;
    h.room.handle('b', { t: 'leave' });
    expect(h.room.seats.length).toBe(1);
    expect(h.room.state!.over).toBe(true);
    expect(h.room.host).toBe(a);
  });
  it('a too-big match gives a message instead of failing silently', () => {
    const h = harness();
    h.join('a', '1');
    h.room.handle('a', { t: 'settings', settings: { kind: 'ffa', soldiers: 4 } });
    for (let i = 0; i < 9; i++) h.room.handle('a', { t: 'addBot', level: 'easy' });
    expect(h.room.seats.length).toBe(10);
    h.room.handle('a', { t: 'start' });
    expect(h.room.state).not.toBeNull();
    expect(h.room.state!.soldiers.length).toBe(40);
  });
  it('sends the exact setups used, so replays match', () => {
    const h = startDuel();
    const m = h.last('a', 'match') as { setups: { id: string }[]; state: { players: { id: string }[] } };
    expect(m.setups.map((s) => s.id).sort()).toEqual(m.state.players.map((p) => p.id).sort());
  });
  it('names in a room stay unique, chat carries the seat id, and unknown hats are dropped', () => {
    const h = harness();
    h.room.join('a', 'g:1', { t: 'join', name: 'Sam', token: '1', hat: 'not-a-hat' });
    h.room.join('b', 'g:2', { t: 'join', name: 'sam', token: '2', hat: 'cone' });
    expect(h.room.seats.map((s) => s.name)).toEqual(['Sam', 'sam 2']);
    expect(h.room.seats.map((s) => s.hat)).toEqual([undefined, 'cone']);
    h.room.handle('a', { t: 'chat', text: 'hello' });
    const chat = h.last('b', 'chat') as { line: { fromId?: string } };
    expect(chat.line.fromId).toBe(h.room.seats[0]!.id);
  });
  it('-skip is throttled like other chat', () => {
    const h = startDuel();
    h.room.handle('a', { t: 'chat', text: '-skip' });
    h.room.handle('a', { t: 'chat', text: '-skip' });
    expect((h.last('a', 'error') as { message: string }).message).toMatch(/too quickly/);
  });
});

describe('moderation', () => {
  it('filters chat and names', () => {
    expect(cleanChat('nice shot')).toBe('nice shot');
    expect(cleanChat('you sh1t')).toBe('you ####');
    expect(cleanChat('class assignment')).toBe('class assignment');
    expect(cleanChat('a'.repeat(500)).length).toBe(140);
    expect(cleanName('fuck')).toMatch(/^Player\d+$/);
    expect(cleanName('Ana')).toBe('Ana');
    expect(cleanChat('hi‮evil')).toBe('hievil');
    expect(cleanName('fuckface')).toMatch(/^Player\d+$/);
    expect(cleanName('Skysurfer')).toBe('Skysurfer');
    expect(cleanName('Slutsky')).toBe('Slutsky');
    expect(cleanName('\u3164\u2800')).toMatch(/^Player\d+$/);
    expect(isBlockedName('kys')).toBe(true);
    expect(isBlockedName('Skysurfer')).toBe(false);
  });
});

describe('message limits', () => {
  it('allows bursts, then refuses, then refills', () => {
    const b = new MessageBucket(3, 1, 0);
    expect([b.take(0), b.take(0), b.take(0), b.take(0)]).toEqual([true, true, true, false]);
    expect(b.take(1500)).toBe(true);
    expect(b.take(1500)).toBe(false);
  });
});
