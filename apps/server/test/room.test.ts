import { describe, expect, it } from 'vitest';
import { RECONNECT_GRACE_MS, ROUND_MS, type ClientMsg, type ServerMsg } from '@mathbattles/sim';
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
    h.room.handle('w', { t: 'lock', expr: 'x/3' });
    h.room.handle('w', { t: 'chat', text: 'hello' });
    h.room.handle('w', { t: 'start' });
    expect(JSON.stringify(h.room.state)).toBe(before);
    // Watchers get each round like players do.
    h.room.handle('a', { t: 'lock', expr: 'x/7' });
    h.room.handle('b', { t: 'lock', expr: 'x/9' });
    expect(h.last('w', 'round')).toBeTruthy();
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
    h.room.handle('a', { t: 'settings', settings: { kind: 'ffa', soldiers: 99 } as never });
    expect(h.room.settings.kind).toBe('ffa');
    expect('soldiers' in h.room.settings).toBe(false);
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
  it('fires only when everyone has locked, and unlocking takes you back off the list', () => {
    const h = startDuel();
    const state = h.room.state!;
    h.room.handle('a', { t: 'lock', expr: 'x/3' });
    expect(state.round).toBe(1);
    expect(state.players.find((p) => p.id === h.room.seats[0]!.id)!.locked).toBe(true);
    h.room.handle('a', { t: 'unlock' });
    expect(state.players.find((p) => p.id === h.room.seats[0]!.id)!.locked).toBe(false);
    h.room.handle('a', { t: 'lock', expr: 'x/3' });
    h.room.handle('b', { t: 'lock', expr: 'x/5' });
    expect(state.round).toBe(2);
    const round = h.last('a', 'round') as { round: { shots: unknown[] } };
    expect(round.round.shots.length).toBe(2);
  });
  it('never sends anyone else’s function before the round fires', () => {
    const h = startDuel();
    h.room.handle('a', { t: 'draft', expr: 'secretcurve*0' });
    h.room.handle('a', { t: 'lock', expr: 'secretcurve*0+x/4' });
    expect(JSON.stringify(h.sent.b ?? [])).not.toContain('secretcurve');
  });
  it("ignores any result a client claims: only the server's simulation counts", () => {
    const h = startDuel();
    const state = h.room.state!;
    const forged = { t: 'lock', expr: '0', hits: [{ id: 0, step: 1 }, { id: 1, step: 1 }], kills: 99 } as unknown as ClientMsg;
    state.circles.length = 0;
    state.soldiers.forEach((s, i) => { s.x = i === 0 ? 100 : 600; s.y = 40 + i * 300; });
    h.room.handle('a', forged);
    h.room.handle('b', forged);
    expect(state.soldiers.filter((s) => s.alive).length).toBe(2);
    const round = h.last('a', 'round') as { round: { kills: unknown[] } };
    expect(round.round.kills).toEqual([]);
  });
  it('makes everyone wait for the last round to land before locking again', () => {
    const h = startDuel();
    h.room.handle('a', { t: 'lock', expr: '0' });
    h.room.handle('b', { t: 'lock', expr: '0' });
    h.room.handle('a', { t: 'lock', expr: '0' });
    expect((h.last('a', 'error') as { message: string }).message).toMatch(/last round/);
    const round = h.last('a', 'round') as { deadline: number };
    h.clock.t = round.deadline - ROUND_MS + 1;
    h.room.handle('a', { t: 'lock', expr: '0' });
    expect(h.room.state!.players.find((p) => p.id === h.room.seats[0]!.id)!.locked).toBe(true);
  });
  it('when time runs out, a valid draft fires and a broken one is no shot', () => {
    const h = startDuel();
    h.room.handle('a', { t: 'draft', expr: 'x/6' });
    h.room.handle('b', { t: 'draft', expr: 'sin(' });
    h.advance(ROUND_MS + 10);
    const round = h.last('a', 'round') as { round: { shots: { playerId: string; expr: string }[] } };
    expect(round.round.shots.map((s) => s.expr)).toEqual(['x/6']);
  });
  it('a round with no shots still moves on when the clock runs out', () => {
    const h = startDuel();
    h.advance(ROUND_MS + 10);
    expect(h.room.state!.round).toBe(2);
  });
  it('gives a reconnecting player their draft back', () => {
    const h = startDuel();
    h.room.handle('b', { t: 'draft', expr: 'x/11' });
    h.room.disconnect('b');
    h.join('b2', 'tokB');
    expect(h.last('b2', 'match')).toMatchObject({ draft: { expr: 'x/11' } });
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
  it('bots lock in by themselves, at the same time as everyone else', () => {
    const h = harness();
    h.join('a', '1');
    h.room.handle('a', { t: 'addBot', level: 'easy' });
    h.room.handle('a', { t: 'addBot', level: 'normal' });
    h.room.handle('a', { t: 'start' });
    const state = h.room.state!;
    h.advance(5001 + 20_000);
    const bots = state.players.filter((p) => p.isBot);
    expect(bots.length).toBe(2);
    expect(bots.every((p) => p.locked)).toBe(true);
    h.room.handle('a', { t: 'lock', expr: '0' });
    const round = state.log.find((e) => e.type === 'round');
    expect(round && round.type === 'round' && round.round.shots.filter((s) => bots.some((b) => b.id === s.playerId)).length).toBe(2);
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
    h.join('b', '2');
    expect(h.room.state).not.toBeNull();
    expect(h.room.state!.soldiers.length).toBe(2);
    expect(h.room.seats.map((s) => s.team)).toEqual([1, 2]);
    // Ranked matches always mix rock shapes in.
    expect(h.room.state!.config.rockShapes).toBe('mixed');
  });
});

describe('rock shapes setting', () => {
  it('defaults to mixed, only the host can change it, and bad values are ignored', () => {
    const h = harness();
    h.join('a', 'tokA');
    h.join('b', 'tokB');
    expect(h.room.settings.rockShapes).toBe('mixed');
    h.room.handle('b', { t: 'settings', settings: { rockShapes: 'circles' } });
    expect(h.room.settings.rockShapes).toBe('mixed');
    h.room.handle('a', { t: 'settings', settings: { rockShapes: 'squares' } as never });
    expect(h.room.settings.rockShapes).toBe('mixed');
    h.room.handle('a', { t: 'settings', settings: { rockShapes: 'circles' } });
    expect(h.room.settings.rockShapes).toBe('circles');
    h.room.handle('b', { t: 'ready', ready: true });
    h.room.handle('a', { t: 'start' });
    h.advance(5001);
    // Circles are the default, so the match config leaves the setting out.
    expect(h.room.state!.config.rockShapes).not.toBe('mixed');
    expect(h.room.state!.circles.every((c) => !c.shape || c.shape === 'circle')).toBe(true);
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
    const conn = 'a';
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
    h.room.handle('a', { t: 'settings', settings: { kind: 'ffa' } });
    for (let i = 0; i < 9; i++) h.room.handle('a', { t: 'addBot', level: 'easy' });
    expect(h.room.seats.length).toBe(10);
    h.room.handle('a', { t: 'start' });
    expect(h.room.state).not.toBeNull();
    expect(h.room.state!.soldiers.length).toBe(10);
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
    // Stretched spellings are caught, and everyday words aren't.
    expect(cleanChat('fuuuuck that')).toBe('####### that');
    expect(cleanChat('as far as i know, pass the class')).toBe('as far as i know, pass the class');
    expect(cleanChat('sussex essex assess')).toBe('sussex essex assess');
    expect(cleanChat('a'.repeat(500), 300).length).toBe(300);
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

describe('loadouts and admin energy costs', () => {
  it('a player brings Hop plus at most three abilities, and admin costs go into the match', () => {
    const h = harness();
    h.room.join('a', 'g:tokA', { t: 'join', name: 'a', token: 'tokA', abilities: ['ricochet', 'heavy', 'pierce', 'wall', 'shield'] });
    h.join('b', 'tokB');
    expect(h.room.seats[0]!.abilities).toEqual(['hop', 'ricochet', 'heavy', 'pierce']);
    h.room.setEnergyCosts({ heavy: 30 });
    h.room.handle('b', { t: 'ready', ready: true });
    h.room.handle('a', { t: 'start' });
    h.advance(5001);
    expect(h.room.state!.config.energyCosts).toEqual({ heavy: 30 });
    expect(h.room.state!.players.find((p) => p.id === h.room.seats[0]!.id)!.abilities).toEqual(['hop', 'ricochet', 'heavy', 'pierce']);
  });
  it('easy bots bring no abilities; hard ones bring all of them', () => {
    const h = harness();
    h.join('a', 'tokA');
    h.room.handle('a', { t: 'addBot', level: 'easy' });
    h.room.handle('a', { t: 'addBot', level: 'hard' });
    const bots = h.room.seats.filter((s) => s.isBot);
    expect(bots[0]!.abilities).toEqual([]);
    expect(bots[1]!.abilities.length).toBeGreaterThan(3);
  });
});
