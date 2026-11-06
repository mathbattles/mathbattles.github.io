import { describe, expect, it } from 'vitest';
import { RECONNECT_GRACE_MS, TURN_MS, currentPlayer, type ClientMsg, type ServerMsg } from '@mathbattles/sim';
import { cleanChat, cleanName } from '../src/moderation';
import { RoomCore, type RoomIO } from '../src/roomCore';

function harness(opts: { ranked?: boolean } = {}) {
  const sent: Record<string, ServerMsg[]> = {};
  const clock = { t: 1_000_000, wake: null as number | null };
  let seed = 0.37;
  const io: RoomIO = {
    send: (id, msg) => void (sent[id] ??= []).push(JSON.parse(JSON.stringify(msg)) as ServerMsg),
    now: () => clock.t,
    wake: (at) => void (clock.wake = at),
    random: () => (seed = (seed * 9301 + 0.49297) % 1),
    botBudgetMs: 30,
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
    const h = harness({ ranked: true });
    h.join('a', '1');
    expect(h.room.state).toBeNull();
    h.room.handle('a', { t: 'settings', settings: { soldiers: 4 } });
    h.join('b', '2');
    expect(h.room.state).not.toBeNull();
    expect(h.room.state!.config.soldiers).toBe(1);
    expect(h.room.seats.map((s) => s.team)).toEqual([1, 2]);
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
  });
});
