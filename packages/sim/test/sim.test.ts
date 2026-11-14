import { describe, expect, it } from 'vitest';
import {
  ParseError,
  PLANE_H,
  PLANE_W,
  Rng,
  Terrain,
  chooseMove,
  compile,
  createMatch,
  eloDelta,
  levelFromXp,
  removePlayer,
  simulateShot,
  validate,
  ACHIEVEMENTS,
  COSMETICS,
  DEFAULT_ROOM_SETTINGS,
  PALETTE,
  allLocked,
  applyAction,
  assignColors,
  decodeReplay,
  encodeReplay,
  lastShotOf,
  makeReplay,
  matchRecordFor,
  replayIsOld,
  replayStart,
  resolveRound,
  roundMoment,
  roundsOf,
  setLocked,
  shotsOf,
  waitingOn,
  energyGain,
  historyOf,
  BLAST_R,
  HEAVY_BLAST_MULT,
  MAX_ENERGY,
  START_ENERGY,
  RANKS,
  START_RATING,
  PLACEMENT_MATCHES,
  ROCK_SHAPES,
  rankFor,
  rankProgress,
  eloK,
  seasonReset,
  rockContains,
  rockTouches,
  generateCircles,
  cleanMap,
  cleanLoadout,
  terrainOf,
  NEAR_MISS_ENERGY,
  type MatchConfig,
  type PlayerSetup,
} from '../src';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const ev = (s: string, x = 0, y = 0, d = 0) => compile(s)(x, y, d);

describe('parser', () => {
  it('follows normal math precedence', () => {
    expect(ev('1+2*3')).toBe(7);
    expect(ev('2^3^2')).toBe(512);
    expect(ev('-2^2')).toBe(-4);
    expect(ev('1/2+2')).toBe(2.5);
    expect(ev('1/(2+2)')).toBe(0.25);
    expect(ev('2^-1')).toBe(0.5);
  });
  it('handles functions and constants', () => {
    expect(near(ev('sin(pi/2)'), 1)).toBe(true);
    expect(near(ev('ln(e)'), 1)).toBe(true);
    expect(near(ev('log(100)'), 2)).toBe(true);
    expect(near(ev('exp(0)'), 1)).toBe(true);
    expect(ev('abs(-3)')).toBe(3);
    expect(ev('sqrt(9)')).toBe(3);
  });
  it('reads variables and implicit multiplication', () => {
    expect(ev('2x', 3)).toBe(6);
    expect(ev('(x+1)(x-1)', 3)).toBe(8);
    expect(ev('3sin(0)+x', 1)).toBe(1);
    expect(ev("y'+y+x", 1, 2, 3)).toBe(6);
  });
  it('gives readable errors', () => {
    expect(() => compile('sin(x')).toThrow(/Missing \)/);
    expect(() => compile('x)')).toThrow(/Extra \)/);
    expect(() => compile('')).toThrow(/Type a function/);
    expect(() => compile('sin x')).toThrow(/parentheses/);
    expect(() => compile('foo')).toThrow(ParseError);
    expect(() => compile('x'.repeat(300))).toThrow(/Too long/);
    expect(validate('y+1', 'fn')?.message).toMatch(/can't be used/);
    expect(validate('y+1', 'ode1')).toBeNull();
  });
  it('never executes code', () => {
    for (const bad of ['constructor', 'alert(1)', 'process.exit()', '__proto__', '1;2', 'x=1']) {
      expect(() => compile(bad)).toThrow(ParseError);
    }
  });
});

const empty = () => new Terrain([]);
const from = { x: 200, y: 225 };

describe('shots', () => {
  it('y=f(x) passes through the shooter', () => {
    const r = simulateShot({ mode: 'fn', expr: '0', from, terrain: empty(), targets: [] });
    expect(near(r.ys[50]!, 225, 1e-6)).toBe(true);
    expect(r.xs[1]!).toBeGreaterThan(r.xs[0]!);
    expect(r.reason).toBe('edge');
  });
  it('adds a constant so any shift of the function is the same shot', () => {
    const a = simulateShot({ mode: 'fn', expr: 'x/3', from, terrain: empty(), targets: [] });
    const b = simulateShot({ mode: 'fn', expr: 'x/3+100', from, terrain: empty(), targets: [] });
    expect(a.steps).toBe(b.steps);
    expect(near(a.end.y, b.end.y, 1e-6)).toBe(true);
  });
  it('stops at obstacles and ends at the point before impact', () => {
    const t = new Terrain([{ x: 300, y: 225, r: 20 }]);
    const r = simulateShot({ mode: 'fn', expr: '0', from, terrain: t, targets: [] });
    expect(r.reason).toBe('obstacle');
    expect(Math.round(r.end.x)).toBeLessThanOrEqual(280);
    expect(r.end.x).toBeGreaterThan(275);
  });
  it('flies through a carved hole', () => {
    const t = new Terrain([{ x: 300, y: 225, r: 20 }]);
    t.carve(300, 225, 30);
    const r = simulateShot({ mode: 'fn', expr: '0', from, terrain: t, targets: [] });
    expect(r.reason).toBe('edge');
  });
  it('passes through soldiers and hits each once', () => {
    const r = simulateShot({
      mode: 'fn', expr: '0', from, terrain: empty(),
      targets: [{ id: 1, x: 300, y: 225 }, { id: 2, x: 500, y: 225 }, { id: 3, x: 500, y: 300 }],
    });
    expect(r.hits.map((h) => h.id).sort()).toEqual([1, 2]);
    expect(r.hits[0]!.step).toBeLessThan(r.hits[1]!.step);
    expect(r.reason).toBe('edge');
  });
  it('explodes on invalid values', () => {
    const r = simulateShot({ mode: 'fn', expr: 'sqrt(x)', from, terrain: empty(), targets: [] });
    expect(r.reason).toBe('invalid');
    const ok = simulateShot({ mode: 'fn', expr: 'sqrt(abs(x))', from, terrain: empty(), targets: [] });
    expect(ok.reason).not.toBe('invalid');
  });
  it('ends on a true jump', () => {
    const r = simulateShot({ mode: 'fn', expr: '2*abs(x+5)/(x+5)', from, terrain: empty(), targets: [] });
    expect(r.reason).toBe('steep');
    expect(r.end.x).toBeLessThan(toPxApprox(-5) + 2);
  });
  it('survives a steep continuous curve', () => {
    const r = simulateShot({ mode: 'fn', expr: '3/(1+exp(-20*(x+5)))', from, terrain: empty(), targets: [] });
    expect(r.reason).toBe('edge');
  });
  it('dies on the step cap for very wavy functions', () => {
    const r = simulateShot({ mode: 'fn', expr: 'sin(100*x)', from, terrain: empty(), targets: [] });
    expect(r.reason).toBe('too-long');
    expect(r.steps).toBe(20000);
  });
  it("y' is the solved equation from the shooter's position", () => {
    const r = simulateShot({ mode: 'ode1', expr: '0', from, terrain: empty(), targets: [] });
    expect(near(r.ys[100]!, 225, 1e-6)).toBe(true);
    const up = simulateShot({ mode: 'ode1', expr: '1', from, terrain: empty(), targets: [] });
    const i = 200;
    const slopePx = (up.ys[0]! - up.ys[i]!) / (up.xs[i]! - up.xs[0]!);
    expect(near(slopePx, 1, 1e-6)).toBe(true);
  });
  it("y'' uses the angle and matches the exact parabola", () => {
    const a = simulateShot({ mode: 'ode2', expr: '0', from, angle: 0, terrain: empty(), targets: [] });
    const b = simulateShot({ mode: 'ode2', expr: '0', from, angle: 0.5, terrain: empty(), targets: [] });
    expect(near(a.ys[100]!, 225, 1e-6)).toBe(true);
    expect(b.ys[100]!).toBeLessThan(225);
    const g = simulateShot({ mode: 'ode2', expr: '-0.2', from, angle: 0, terrain: empty(), targets: [] });
    const i = 300;
    const dx = (g.xs[i]! - g.xs[0]!) / 15.4;
    const expected = 225 + 0.5 * 0.2 * dx * dx * 15.4;
    expect(near(g.ys[i]!, expected, 1e-3)).toBe(true);
  });
  it('mirroring reflects the shot across the field center', () => {
    const r = simulateShot({
      mode: 'fn', expr: 'x/5', from: { x: PLANE_W - from.x, y: from.y }, mirrored: true, terrain: empty(), targets: [],
    });
    const plain = simulateShot({ mode: 'fn', expr: 'x/5', from, terrain: empty(), targets: [] });
    expect(near(r.xs[100]!, PLANE_W - plain.xs[100]!, 1e-6)).toBe(true);
    expect(near(r.ys[100]!, plain.ys[100]!, 1e-6)).toBe(true);
    expect(r.xs[100]!).toBeLessThan(r.xs[0]!);
  });
  it('dir -1 travels toward -x along the true graph', () => {
    const r = simulateShot({ mode: 'fn', expr: 'x/2', from: { x: 500, y: 225 }, dir: -1, terrain: empty(), targets: [] });
    expect(r.xs[100]!).toBeLessThan(r.xs[0]!);
    expect(r.ys[100]!).toBeGreaterThan(225); // going left on a rising line goes down the screen
  });
  it('fuzz: hostile functions always finish', () => {
    const rng = new Rng(7);
    const parts = ['x', '1/x', 'sin(', 'exp(', '^', '/', '0', '*', '-', '(', ')', 'tan(', 'ln(', 'abs(', '99999', 'pi', 'e', 'sqrt('];
    for (let i = 0; i < 300; i++) {
      let s = '';
      const len = 1 + rng.int(10);
      for (let j = 0; j < len; j++) s += rng.pick(parts);
      for (const mode of ['fn', 'ode1'] as const) {
        try {
          const r = simulateShot({ mode, expr: s.replaceAll('y', 'x'), from, terrain: empty(), targets: [] }, { collect: false });
          expect(r.steps).toBeLessThanOrEqual(20000);
        } catch (e) {
          expect(e).toBeInstanceOf(ParseError);
        }
      }
    }
  });
});

function toPxApprox(gx: number) {
  return gx * 15.4 + 385;
}

const cfg = (o: Partial<MatchConfig> = {}): MatchConfig => ({
  kind: 'teams', mode: 'fn', seed: 42, ...o,
});
const duel: PlayerSetup[] = [
  { id: 'a', name: 'A', team: 1 },
  { id: 'b', name: 'B', team: 2 },
];

/** An empty board with soldiers where a test wants them. */
function board(m: ReturnType<typeof createMatch>, spots: Record<string, [number, number]>) {
  m.circles.length = 0;
  for (const p of m.players) {
    const at = spots[p.id];
    if (at) {
      m.soldiers[p.soldierId]!.x = at[0];
      m.soldiers[p.soldierId]!.y = at[1];
    }
  }
  return m;
}

describe('match rules', () => {
  it('builds the same map from the same seed', () => {
    const a = createMatch(cfg(), duel);
    const b = createMatch(cfg(), duel);
    expect(a.circles).toEqual(b.circles);
    expect(a.soldiers).toEqual(b.soldiers);
    expect(createMatch(cfg({ seed: 43 }), duel).circles).not.toEqual(a.circles);
  });
  it('gives every player exactly one soldier, on their own half, clear of obstacles', () => {
    for (let seed = 0; seed < 60; seed++) {
      const m = createMatch(cfg({ seed }), [
        { id: 'a', name: 'A', team: 1 }, { id: 'c', name: 'C', team: 1 },
        { id: 'b', name: 'B', team: 2 }, { id: 'd', name: 'D', team: 2 },
      ]);
      expect(m.soldiers.length).toBe(4);
      for (const s of m.soldiers) {
        const team = m.players.find((p) => p.id === s.playerId)!.team;
        expect(team === 1 ? s.x < PLANE_W / 2 : s.x >= PLANE_W / 2).toBe(true);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeLessThan(PLANE_H);
        for (const c of m.circles) expect(Math.hypot(c.x - s.x, c.y - s.y)).toBeGreaterThanOrEqual(c.r + 15);
      }
    }
  });
  it('colours go Blue, Red, Green, Yellow, then distinct random colours', () => {
    const setups = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, team: 1 as const }));
    const m = createMatch(cfg({ kind: 'ffa', seed: 7 }), setups);
    const colorOf = (id: string) => m.players.find((p) => p.id === id)!.color;
    expect(PALETTE.map((p) => p.hex)).toEqual([colorOf('p0'), colorOf('p1'), colorOf('p2'), colorOf('p3')]);
    expect(new Set(m.players.map((p) => p.color)).size).toBe(7);
    // A colour someone picked is kept when it's free.
    expect(assignColors(['#8a3ff0', undefined, '#8a3ff0'], 1)).toEqual(['#8a3ff0', PALETTE[0].hex, PALETTE[1].hex]);
  });
  it('waits for every living player to lock, and unlocking puts them back on the list', () => {
    const m = createMatch(cfg(), duel);
    expect(waitingOn(m).map((p) => p.id).sort()).toEqual(['a', 'b']);
    setLocked(m, 'a', true);
    expect(allLocked(m)).toBe(false);
    setLocked(m, 'b', true);
    expect(allLocked(m)).toBe(true);
    setLocked(m, 'a', false);
    expect(waitingOn(m).map((p) => p.id)).toEqual(['a']);
  });
  it('fires every shot together, ends the round, and clears the locks', () => {
    const m = board(createMatch(cfg(), duel), { a: [100, 100], b: [670, 350] });
    setLocked(m, 'a', true);
    const round = resolveRound(m, [{ playerId: 'a', expr: '0' }, { playerId: 'b', expr: '0' }]);
    expect(round.n).toBe(1);
    expect(round.shots.length).toBe(2);
    expect(m.round).toBe(2);
    expect(m.players.every((p) => !p.locked)).toBe(true);
    expect(m.holes.length).toBe(2);
    expect(m.over).toBe(false);
  });
  it('skips a broken function, so the timeout fires only valid ones', () => {
    const m = board(createMatch(cfg(), duel), { a: [100, 100], b: [670, 350] });
    const round = resolveRound(m, [{ playerId: 'a', expr: 'x/3' }, { playerId: 'b', expr: 'sin(' }]);
    expect(round.shots.map((s) => s.playerId)).toEqual(['a']);
  });
  it('kills, including friendly fire, and ends the match', () => {
    const m = board(createMatch(cfg(), duel), { a: [100, 225], b: [400, 225] });
    const round = resolveRound(m, [{ playerId: 'a', expr: '0' }]);
    expect(round.kills.map((k) => k.id)).toEqual([m.players.find((p) => p.id === 'b')!.soldierId]);
    expect(m.over).toBe(true);
    expect(m.winner).toBe(1);
    expect(m.players.find((p) => p.id === 'a')!.kills).toBe(1);
  });
  it('a shot that kills only a teammate gives no kill credit', () => {
    const setups: PlayerSetup[] = [{ id: 'a', name: 'A', team: 1 }, { id: 'c', name: 'C', team: 1 }, { id: 'b', name: 'B', team: 2 }];
    const m = board(createMatch(cfg(), setups), { a: [60, 225], c: [140, 225], b: [700, 40] });
    resolveRound(m, [{ playerId: 'a', expr: '0' }]);
    expect(m.soldiers[m.players.find((p) => p.id === 'c')!.soldierId]!.alive).toBe(false);
    expect(m.players.find((p) => p.id === 'a')!.kills).toBe(0);
  });
  it('the earlier of two mutual hits wins, and the loser’s shot stops where it was', () => {
    // A fires straight at B. B arcs high over to A: its steep ends take extra steps, so A lands first.
    const m = board(createMatch(cfg({ kind: 'ffa' }), duel), { a: [323.4, 225], b: [446.6, 225] });
    const round = resolveRound(m, [
      { playerId: 'a', expr: '0', dir: 1 },
      { playerId: 'b', expr: '(16-x^2)/1.5', dir: -1 },
    ]);
    const aSoldier = m.players.find((p) => p.id === 'a')!.soldierId;
    const bSoldier = m.players.find((p) => p.id === 'b')!.soldierId;
    expect(round.beams.length).toBe(0);
    expect(round.kills.map((k) => k.id)).toEqual([bSoldier]);
    expect(m.soldiers[aSoldier]!.alive).toBe(true);
    expect(round.shots.find((s) => s.playerId === 'b')!.reason).toBe('killed');
    expect(round.luck).toEqual([]);
  });
  it('an exact tie is settled by a seeded coin, and the survivor is marked lucky', () => {
    // Point-symmetric arcs, one over and one under: each reaches the other soldier on the same step.
    const winners = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const play = () => {
        const m = board(createMatch(cfg({ kind: 'ffa', seed }), duel), { a: [231, 225], b: [539, 225] });
        return resolveRound(m, [
          { playerId: 'a', expr: '10-x^2/10', dir: 1 },
          { playerId: 'b', expr: 'x^2/10-10', dir: -1 },
        ]);
      };
      const round = play();
      expect(round.beams.length).toBe(0);
      expect(round.kills.length).toBe(1);
      expect(round.luck.length).toBe(1);
      winners.add(round.luck[0]!);
      // The same match and round always flip the same way.
      expect(play().luck).toEqual(round.luck);
    }
    expect(winners.size).toBe(2);
  });
  it('shot tips meeting head on make a beam that shoots up and down', () => {
    const m = board(createMatch(cfg({ kind: 'ffa', seed: 3 }), [
      { id: 'a', name: 'A', team: 1 }, { id: 'b', name: 'B', team: 1 }, { id: 'c', name: 'C', team: 1 }, { id: 'd', name: 'D', team: 1 },
    ]), { a: [185, 225], b: [585, 225], c: [385, 40], d: [700, 420] });
    const round = resolveRound(m, [
      { playerId: 'a', expr: '0', dir: 1 },
      { playerId: 'b', expr: '0', dir: -1 },
    ]);
    expect(round.beams.length).toBe(1);
    const beam = round.beams[0]!;
    expect(beam.dirs.length).toBe(2);
    // Straight up and straight down.
    expect(Math.abs(beam.dirs[0]!.x)).toBeLessThan(0.01);
    expect(Math.abs(beam.dirs[0]!.y)).toBeCloseTo(1, 2);
    expect(beam.dirs[0]!.y).toBeCloseTo(-beam.dirs[1]!.y, 5);
    // C stands right above the meeting point, so the beam gets them.
    const c = m.players.find((p) => p.id === 'c')!;
    expect(m.soldiers[c.soldierId]!.alive).toBe(false);
    expect(round.kills.find((k) => k.id === c.soldierId)?.beam).toBe(true);
    expect(round.shots.every((s) => s.reason === 'collision')).toBe(true);
  });
  it('an angled meeting sends the beam along the two directions combined', () => {
    // Two shots crossing at right angles, timed to meet: the beam goes along their sum.
    const m = board(createMatch(cfg({ kind: 'ffa', seed: 5 }), duel), { a: [185, 425], b: [585, 425] });
    const round = resolveRound(m, [
      { playerId: 'a', expr: 'x', dir: 1 },
      { playerId: 'b', expr: '-x', dir: -1 },
    ]);
    expect(round.beams.length).toBe(1);
    const d = round.beams[0]!.dirs;
    expect(d.length).toBe(1);
    // Both shots climb, so the combined direction points straight up the screen.
    expect(d[0]!.y).toBeLessThan(-0.99);
  });
  it('a beam tears through rock and kills teammates', () => {
    const setups: PlayerSetup[] = [{ id: 'a', name: 'A', team: 1 }, { id: 'b', name: 'B', team: 2 }, { id: 'c', name: 'C', team: 1 }, { id: 'd', name: 'D', team: 2 }];
    const m = board(createMatch(cfg({ kind: 'teams', seed: 9 }), setups), { a: [185, 225], b: [585, 225], c: [385, 60], d: [720, 420] });
    m.circles.push({ x: 385, y: 140, r: 30 });
    const before = m.holes.length;
    const round = resolveRound(m, [
      { playerId: 'a', expr: '0' },
      { playerId: 'b', expr: '0' },
    ]);
    expect(round.beams.length).toBe(1);
    // C, A's own teammate, is behind the rock above the meeting point and still dies.
    expect(m.soldiers[m.players.find((p) => p.id === 'c')!.soldierId]!.alive).toBe(false);
    // The beam carved a channel through the rock.
    expect(m.holes.length - before).toBeGreaterThan(10);
    expect(new Terrain(m.circles, m.holes).solidAt(385, 140)).toBe(false);
  });
  it('a player leaving removes their soldier and can end the match', () => {
    const m = createMatch(cfg(), duel);
    removePlayer(m, 'a');
    expect(m.over).toBe(true);
    expect(m.winner).toBe(2);
  });
  it('free-for-all ends with the last player standing', () => {
    const m = createMatch(cfg({ kind: 'ffa' }), [
      { id: 'a', name: 'A', team: 1 }, { id: 'b', name: 'B', team: 1 }, { id: 'c', name: 'C', team: 1 },
    ]);
    expect(m.over).toBe(false);
    removePlayer(m, m.players[0]!.id);
    expect(m.over).toBe(false);
    const survivor = m.players[2]!.id;
    removePlayer(m, m.players[1]!.id);
    expect(m.over).toBe(true);
    expect(m.winner).toBe(survivor);
  });
  it('remembers each player’s last function', () => {
    const m = board(createMatch(cfg(), duel), { a: [100, 100], b: [670, 350] });
    resolveRound(m, [{ playerId: 'a', expr: 'x/7' }]);
    resolveRound(m, [{ playerId: 'b', expr: '0' }]);
    expect(lastShotOf(m, 'a')?.expr).toBe('x/7');
    expect(lastShotOf(m, 'b')?.expr).toBe('0');
  });
});

describe('bots', () => {
  it('a strong bot usually finds a kill on open maps', () => {
    let hits = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const m = createMatch(cfg({ seed }), duel);
      m.circles.length = 0;
      const move = chooseMove(m, { playerId: 'a', generations: 40, seed, budgetMs: 1500 });
      const round = resolveRound(m, [{ playerId: 'a', expr: move.expr, angle: move.angle, dir: move.dir }]);
      if (round.kills.length) hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(4);
  });
  it('produces valid moves in every mode, for every bot at once', () => {
    for (const mode of ['fn', 'ode1', 'ode2'] as const) {
      const m = createMatch(cfg({ mode, seed: 9 }), duel);
      const a = chooseMove(m, { playerId: 'a', generations: 3, seed: 1 });
      const b = chooseMove(m, { playerId: 'b', generations: 3, seed: 2 });
      expect(() => resolveRound(m, [{ playerId: 'a', ...a }, { playerId: 'b', ...b }])).not.toThrow();
    }
  });
});

describe('rewinding', () => {
  it('rebuilds the board at any round without changing the match', () => {
    const m = board(createMatch(cfg({ seed: 8 }), [...duel, { id: 'c', name: 'C', team: 2 }]), { a: [100, 225], b: [250, 225], c: [700, 30] });
    m.circles = [{ x: 385, y: 40, r: 20 }];
    const bSoldier = m.players.find((p) => p.id === 'b')!.soldierId;
    resolveRound(m, [{ playerId: 'a', expr: '0' }]);
    expect(m.soldiers[bSoldier]!.alive).toBe(false);
    resolveRound(m, [{ playerId: 'a', expr: 'x/9' }]);
    const snapshot = JSON.stringify(m);

    expect(roundsOf(m).length).toBe(2);
    expect(shotsOf(m).length).toBe(2);
    const first = roundMoment(m, 0)!;
    expect(first.round.shots[0]!.expr).toBe('0');
    expect(first.before.holes.length).toBe(0);
    expect(first.after.holes.length).toBe(1);
    expect(first.before.soldiers[bSoldier]!.alive).toBe(true);
    expect(first.after.soldiers[bSoldier]!.alive).toBe(false);
    const second = roundMoment(m, 1)!;
    expect(second.round.shots[0]!.expr).toBe('x/9');
    expect(second.before.holes.length).toBe(1);
    expect(second.after.holes.length).toBe(2);
    expect(roundMoment(m, 5)).toBeNull();
    expect(JSON.stringify(m)).toBe(snapshot);
  });
  it('undoes players leaving', () => {
    const setups: PlayerSetup[] = [{ id: 'a', name: 'A', team: 1 }, { id: 'b', name: 'B', team: 2 }, { id: 'c', name: 'C', team: 2 }];
    const m = board(createMatch(cfg({ seed: 21 }), setups), { a: [100, 100], b: [600, 400], c: [700, 300] });
    resolveRound(m, [{ playerId: 'a', expr: 'x/20' }]);
    const stays = m.players.find((p) => p.id === 'c')!;
    removePlayer(m, stays.id);
    const moment = roundMoment(m, 0)!;
    expect(moment.after.soldiers[stays.soldierId]!.alive).toBe(true);
  });
});

describe('replays', () => {
  it('round-trips a version 3 replay and rebuilds the same match', () => {
    const setups: PlayerSetup[] = [{ id: 'a', name: 'Ann', team: 1 }, { id: 'b', name: 'Bo', team: 2, isBot: true, botLevel: 'hard' }];
    const m = createMatch(cfg({ seed: 77 }), setups);
    resolveRound(m, [{ playerId: 'a', expr: 'x/4' }, { playerId: 'b', expr: 'sin(x)' }]);
    removePlayer(m, 'b');
    const code = encodeReplay(makeReplay(m, setups));
    const back = decodeReplay(code)!;
    expect(back.v).toBe(6);
    const again = replayStart(back);
    for (const a of back.actions) if (!again.over) applyAction(again, a);
    expect(again.soldiers.map((s) => s.alive)).toEqual(m.soldiers.map((s) => s.alive));
    expect(again.holes).toEqual(m.holes);
    expect(again.players.map((p) => p.color)).toEqual(m.players.map((p) => p.color));
  });
  it('older replay links are recognised and refused', () => {
    const oldV1 = btoa(JSON.stringify({ v: 1, config: { kind: 'teams', mode: 'fn', soldiers: 1, seed: 1 }, setups: [], actions: [] }));
    expect(decodeReplay(oldV1)).toBeNull();
    expect(replayIsOld(oldV1)).toBe(true);
    expect(replayIsOld('AgAA')).toBe(true);
    expect(replayIsOld('not-a-replay')).toBe(false);
  });
});

describe('match records', () => {
  it('describes a match from each side, and can be watched', () => {
    const m = createMatch(cfg({ seed: 4 }), duel);
    removePlayer(m, 'b');
    const a = matchRecordFor(m, duel, 'a', { id: 'x', at: 5, kind: 'bots' });
    const b = matchRecordFor(m, duel, 'b', { id: 'x', at: 5, kind: 'bots', ratingDelta: -3 });
    expect(a.result).toBe('win');
    expect(a.opponents).toEqual(['B']);
    expect(b.result).toBe('loss');
    expect(b.ratingDelta).toBe(-3);
    expect(decodeReplay(a.replay!)).not.toBeNull();
    const short = matchRecordFor(m, duel, 'a', { id: 'x', at: 5, kind: 'bots', replayId: 'Ab3dEf9h' });
    expect(short.replayId).toBe('Ab3dEf9h');
    expect(short.replay).toBeUndefined();
    const nobody = matchRecordFor(m, duel, null, { id: 'y', at: 5, kind: 'shared' });
    expect(nobody.result).toBe('none');
    expect([...nobody.opponents].sort()).toEqual(['A', 'B']);
  });
});

describe('defaults and shop items', () => {
  it('room settings have no soldiers option', () => {
    expect('soldiers' in DEFAULT_ROOM_SETTINGS).toBe(false);
    expect(createMatch(cfg(), duel).soldiers.length).toBe(2);
  });
  it('every item has a unique id, and obstacles include a free default', () => {
    expect(new Set(COSMETICS.map((c) => c.id)).size).toBe(COSMETICS.length);
    expect(COSMETICS.filter((c) => c.kind === 'obstacle').length).toBeGreaterThanOrEqual(8);
    expect(COSMETICS.find((c) => c.id === 'obstacle-candy')!.cost).toBe(0);
  });
  it('the Survivor title comes from On The Brink of Death', () => {
    expect(ACHIEVEMENTS.some((a) => a.id === 'brink-of-death' && a.name === 'On The Brink of Death')).toBe(true);
    expect(COSMETICS.find((c) => c.id === 'title-survivor')?.earn).toBe('brink-of-death');
  });
});

describe('big matches', () => {
  it('always places a full free-for-all', () => {
    const setups = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, team: 1 as const }));
    for (let seed = 0; seed < 40; seed++) {
      const m = createMatch(cfg({ kind: 'ffa', seed }), setups);
      expect(m.soldiers.length).toBe(10);
    }
  });
});

describe('bot work limit', () => {
  it('stops at its limit even if the clock never moves', () => {
    const m = createMatch(cfg({ seed: 3 }), duel);
    const t0 = Date.now();
    chooseMove(m, { playerId: 'a', generations: 400, seed: 1, maxEvals: 120, budgetMs: 1, now: () => 0 });
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe('bot speed', () => {
  it('respects its time budget', () => {
    const m = createMatch(cfg({ seed: 5 }), duel);
    const t0 = Date.now();
    chooseMove(m, { playerId: 'a', generations: 400, seed: 1, budgetMs: 500 });
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe('energy', () => {
  it('follows floor(10 + 1.6 x 1.15^n), always a whole number', () => {
    expect(energyGain(1)).toBe(11);
    expect(energyGain(10)).toBe(16);
    expect(energyGain(20)).toBe(36);
    for (let n = 0; n < 60; n++) expect(Number.isInteger(energyGain(n))).toBe(true);
  });
  it('starts at 50, grows for each line fired, caps at 100, and fills on a kill', () => {
    const m = board(createMatch(cfg(), [...duel, { id: 'c', name: 'C', team: 2 }]), { a: [100, 225], b: [400, 225], c: [700, 40] });
    expect(m.players.every((p) => p.energy === START_ENERGY)).toBe(true);
    resolveRound(m, [{ playerId: 'c', expr: 'x/50' }]);
    expect(m.players.find((p) => p.id === 'c')!.energy).toBe(START_ENERGY + energyGain(1));
    expect(m.players.find((p) => p.id === 'a')!.energy).toBe(START_ENERGY);
    resolveRound(m, [{ playerId: 'a', expr: '0' }]);
    expect(m.players.find((p) => p.id === 'a')!.energy).toBe(MAX_ENERGY);
    const c = m.players.find((p) => p.id === 'c')!;
    c.energy = 95;
    resolveRound(m, [{ playerId: 'c', expr: 'x/50' }]);
    expect(c.energy).toBe(MAX_ENERGY);
  });
  it('an ability you can’t afford, or don’t own, fires as a plain shot', () => {
    const m = board(createMatch(cfg(), duel), { a: [100, 300], b: [700, 40] });
    m.circles.push({ x: 400, y: 300, r: 40 });
    const a = m.players.find((p) => p.id === 'a')!;
    a.energy = 10;
    const r1 = resolveRound(m, [{ playerId: 'a', expr: '0', ability: 'hop' }]);
    expect(r1.shots[0]!.ability).toBeUndefined();
    a.energy = 100;
    const r2 = resolveRound(m, [{ playerId: 'a', expr: '0', ability: 'heavy' }]);
    expect(r2.shots[0]!.ability).toBeUndefined();
  });
});

describe('Hop', () => {
  it('rides the line, jumps the rock, and lands just behind it', () => {
    const m = board(createMatch(cfg(), duel), { a: [100, 300], b: [700, 40] });
    m.circles.push({ x: 400, y: 300, r: 40 });
    const round = resolveRound(m, [{ playerId: 'a', expr: '0', ability: 'hop' }]);
    const hop = round.hops[0]!;
    expect(hop.outcome).toBe('land');
    const a = m.soldiers[m.players.find((p) => p.id === 'a')!.soldierId]!;
    expect(a.alive).toBe(true);
    expect(a.x).toBeGreaterThan(440);
    expect(a.x).toBeLessThan(480);
    expect(round.moves.length).toBe(1);
    // The line itself is only a path: no blast hole where it stopped.
    expect(round.holes).toBe(0);
    expect(m.players.find((p) => p.id === 'a')!.energy).toBe(START_ENERGY - 50 + energyGain(1));
  });
  it('the line kills nobody, but riding into someone is a Hop Kill', () => {
    const m = board(createMatch(cfg(), [...duel, { id: 'c', name: 'C', team: 2 }]), { a: [100, 300], b: [300, 300], c: [700, 40] });
    m.circles.push({ x: 500, y: 300, r: 40 });
    const round = resolveRound(m, [{ playerId: 'a', expr: '0', ability: 'hop' }]);
    const bSoldier = m.players.find((p) => p.id === 'b')!.soldierId;
    const kill = round.kills.find((k) => k.id === bSoldier)!;
    expect(kill.kind).toBe('hop');
    expect(kill.by).toEqual(['a']);
    // The kill happens while riding, after the line has finished drawing.
    expect(kill.step).toBeGreaterThan(round.shots[0]!.steps);
  });
  it('riding off the edge of the field knocks you out, with no credit', () => {
    const m = board(createMatch(cfg(), [...duel, { id: 'c', name: 'C', team: 2 }]), { a: [100, 300], b: [700, 40], c: [650, 420] });
    const round = resolveRound(m, [{ playerId: 'a', expr: '0', ability: 'hop' }]);
    expect(round.hops[0]!.outcome).toBe('out');
    const aSoldier = m.players.find((p) => p.id === 'a')!.soldierId;
    expect(m.soldiers[aSoldier]!.alive).toBe(false);
    const k = round.kills.find((x) => x.id === aSoldier)!;
    expect(k.kind).toBe('out');
    expect(k.by).toEqual([]);
  });
  it('crossing another player’s line hops over it', () => {
    const m = board(createMatch(cfg({ kind: 'ffa' }), [
      { id: 'a', name: 'A', team: 1 }, { id: 'b', name: 'B', team: 1 }, { id: 'c', name: 'C', team: 1 },
    ]), { a: [100, 300], b: [300, 60], c: [700, 40] });
    m.circles.push({ x: 560, y: 300, r: 40 });
    // B's line goes straight down across A's path; A rides across it later.
    const round = resolveRound(m, [
      { playerId: 'a', expr: '0', dir: 1, ability: 'hop' },
      { playerId: 'b', expr: '-x*40', dir: 1 },
    ]);
    expect(round.hops[0]!.overs.length).toBeGreaterThanOrEqual(1);
    expect(round.hops[0]!.outcome).toBe('land');
  });
  it('a beam wipes a rider out: no hopping over beams', () => {
    const m = board(createMatch(cfg({ kind: 'ffa', seed: 4 }), [
      { id: 'a', name: 'A', team: 1 }, { id: 'c', name: 'C', team: 1 }, { id: 'd', name: 'D', team: 1 }, { id: 'e', name: 'E', team: 1 },
    ]), { a: [100, 400], c: [185, 225], d: [585, 225], e: [700, 40] });
    const round = resolveRound(m, [
      { playerId: 'a', expr: '0', dir: 1, ability: 'hop' },
      { playerId: 'c', expr: '0', dir: 1 },
      { playerId: 'd', expr: '0', dir: -1 },
    ]);
    expect(round.beams.length).toBe(1);
    const aSoldier = m.players.find((p) => p.id === 'a')!.soldierId;
    expect(m.soldiers[aSoldier]!.alive).toBe(false);
    expect(round.kills.find((k) => k.id === aSoldier)!.kind).toBe('beam');
  });
});

describe('Ricochet and Heavy Shot', () => {
  it('Ricochet bounces off the first rock like a mirror', () => {
    const m = board(createMatch(cfg({ kind: 'ffa' }), [
      { id: 'a', name: 'A', team: 1 }, { id: 'b', name: 'B', team: 1 }, { id: 'c', name: 'C', team: 1 },
    ]), { a: [120, 300], b: [40, 300], c: [700, 40] });
    m.circles.push({ x: 320, y: 300, r: 40 });
    m.players.forEach((p) => (p.abilities = ['hop', 'ricochet', 'heavy']));
    const round = resolveRound(m, [{ playerId: 'a', expr: '0', dir: 1, ability: 'ricochet' }]);
    const shot = round.shots[0]!;
    expect(shot.ability).toBe('ricochet');
    expect(shot.bounce).toBeDefined();
    expect(shot.bounce!.x).toBeGreaterThan(275);
    expect(shot.bounce!.x).toBeLessThan(285);
    // Straight back the way it came, past its own shooter, into B.
    const bSoldier = m.players.find((p) => p.id === 'b')!.soldierId;
    expect(round.kills.some((k) => k.id === bSoldier)).toBe(true);
  });
  it('Heavy Shot knocks out soldiers inside its wide blast and carves a big crater', () => {
    const m = board(createMatch(cfg(), [...duel, { id: 'c', name: 'C', team: 2 }]), { a: [100, 300], b: [352, 330], c: [700, 40] });
    m.circles.push({ x: 400, y: 300, r: 40 });
    m.players.forEach((p) => (p.abilities = ['hop', 'ricochet', 'heavy']));
    const round = resolveRound(m, [{ playerId: 'a', expr: '0', ability: 'heavy' }]);
    const bSoldier = m.players.find((p) => p.id === 'b')!.soldierId;
    const k = round.kills.find((x) => x.id === bSoldier)!;
    expect(k.kind).toBe('heavy');
    expect(m.holes.at(-1)!.r).toBe(BLAST_R * HEAVY_BLAST_MULT);
  });
});

describe('beams', () => {
  it('are three times as wide, and cut off any shot that touches them', () => {
    const m = board(createMatch(cfg({ kind: 'ffa', seed: 6 }), [
      { id: 'c', name: 'C', team: 1 }, { id: 'd', name: 'D', team: 1 }, { id: 'e', name: 'E', team: 1 }, { id: 'f', name: 'F', team: 1 },
    ]), { c: [185, 225], d: [585, 225], e: [100, 120], f: [640, 120] });
    const round = resolveRound(m, [
      { playerId: 'c', expr: '0', dir: 1 },
      { playerId: 'd', expr: '0', dir: -1 },
      { playerId: 'e', expr: '0', dir: 1 },
    ]);
    expect(round.beams.length).toBe(1);
    const e = round.shots.find((s) => s.playerId === 'e')!;
    expect(e.reason).toBe('beamcut');
    expect(Math.abs(e.end.x - 385)).toBeLessThan(20);
    // F stood on E's line past the beam, so the cut saved them.
    expect(m.soldiers[m.players.find((p) => p.id === 'f')!.soldierId]!.alive).toBe(true);
  });
});

describe('history', () => {
  it('lists past functions newest first, without repeats', () => {
    const m = board(createMatch(cfg(), duel), { a: [100, 100], b: [670, 350] });
    resolveRound(m, [{ playerId: 'a', expr: 'x/3' }]);
    resolveRound(m, [{ playerId: 'a', expr: 'x/4' }]);
    resolveRound(m, [{ playerId: 'a', expr: 'x/3' }]);
    expect(historyOf(m, 'a').map((s) => s.expr)).toEqual(['x/3', 'x/4']);
  });
});

describe('bots and abilities', () => {
  it('a bot can plan with abilities and returns a move that fires', () => {
    const m = createMatch(cfg({ seed: 12 }), [{ id: 'a', name: 'A', team: 1, abilities: ['hop', 'ricochet', 'heavy'] }, { id: 'b', name: 'B', team: 2 }]);
    m.players[0]!.energy = 100;
    const move = chooseMove(m, { playerId: 'a', generations: 6, seed: 3, useAbilities: true });
    expect(() => resolveRound(m, [{ playerId: 'a', expr: move.expr, angle: move.angle, dir: move.dir, ability: move.ability }])).not.toThrow();
  });
});

describe('replays with abilities', () => {
  it('round-trip the ability of every shot', () => {
    const setups: PlayerSetup[] = [{ id: 'a', name: 'A', team: 1, abilities: ['hop', 'heavy'] }, { id: 'b', name: 'B', team: 2 }];
    const m = createMatch(cfg({ seed: 31 }), setups);
    m.players.find((p) => p.id === 'a')!.energy = 100;
    resolveRound(m, [{ playerId: 'a', expr: 'x/5', ability: 'heavy' }, { playerId: 'b', expr: 'x/7' }]);
    const back = decodeReplay(encodeReplay(makeReplay(m, setups)))!;
    const action = back.actions[0]!;
    expect(action.a === 'r' && action.shots.find((s) => s.p === back.setups[0]!.id || s.a)?.a).toBe('heavy');
  });
});

describe('rock shapes', () => {
  it('every shape contains its centre and nothing outside its outer size', () => {
    for (const shape of ROCK_SHAPES) {
      const rock = { x: 200, y: 200, r: 40, shape };
      expect(rockContains(rock, 200, 200)).toBe(true);
      expect(rockContains(rock, 241, 200)).toBe(false);
      expect(rockContains(rock, 200, 159)).toBe(false);
    }
  });
  it('rotation turns the outline: a flat rectangle stood on end', () => {
    const flat = { x: 0, y: 0, r: 40, shape: 'rect' as const };
    expect(rockContains(flat, 0, 30)).toBe(false);
    expect(rockContains(flat, 30, 0)).toBe(true);
    const upright = { ...flat, rot: Math.PI / 2 };
    expect(rockContains(upright, 0, 30)).toBe(true);
    expect(rockContains(upright, 30, 0)).toBe(false);
  });
  it('a star is solid at its points and empty between them', () => {
    const star = { x: 0, y: 0, r: 40, shape: 'star' as const };
    expect(rockContains(star, 0, -36)).toBe(true);
    const between = -Math.PI / 2 + Math.PI / 5;
    expect(rockContains(star, Math.cos(between) * 34, Math.sin(between) * 34)).toBe(false);
  });
  it('the terrain grid matches the shape', () => {
    const t = new Terrain([{ x: 200, y: 200, r: 40, shape: 'rect' }]);
    expect(t.solidAt(230, 200)).toBe(true);
    expect(t.solidAt(200, 230)).toBe(false);
  });
  it('spawn checks see the real outline', () => {
    const rock = { x: 0, y: 0, r: 40, shape: 'rect' as const };
    expect(rockTouches(rock, 0, 34, 8)).toBe(false);
    expect(rockTouches(rock, 0, 26, 8)).toBe(true);
  });
  it('circle-only maps are the same as before, and mixed maps use other shapes', () => {
    const a = generateCircles(new Rng(9), 'circles', 9);
    expect(a.every((c) => !c.shape || c.shape === 'circle')).toBe(true);
    expect(a).toEqual(generateCircles(new Rng(9)));
    const mixed = generateCircles(new Rng(9), 'mixed', 9);
    expect(mixed.map((c) => [c.x, c.y, c.r])).toEqual(a.map((c) => [c.x, c.y, c.r]));
    const many = Array.from({ length: 8 }, (_, i) => generateCircles(new Rng(i), 'mixed', i)).flat();
    expect(many.some((c) => c.shape && c.shape !== 'circle')).toBe(true);
  });
  it('Ricochet bounces straight back off a flat side', () => {
    const m = board(createMatch(cfg({ kind: 'ffa' }), [
      { id: 'a', name: 'A', team: 1 }, { id: 'b', name: 'B', team: 1 }, { id: 'c', name: 'C', team: 1 },
    ]), { a: [120, 300], b: [40, 300], c: [700, 40] });
    m.circles.push({ x: 320, y: 300, r: 40, shape: 'rect' });
    m.players.forEach((p) => (p.abilities = ['hop', 'ricochet', 'heavy']));
    const round = resolveRound(m, [{ playerId: 'a', expr: '0', dir: 1, ability: 'ricochet' }]);
    const shot = round.shots[0]!;
    expect(shot.bounce).toBeDefined();
    // The rectangle's left side is at 320 - 0.88 * 40.
    expect(Math.abs(shot.bounce!.x - (320 - 35.2))).toBeLessThan(6);
    const bSoldier = m.players.find((p) => p.id === 'b')!.soldierId;
    expect(round.kills.some((k) => k.id === bSoldier)).toBe(true);
  });
  it('custom maps keep shape and rotation, rounded to replay precision', () => {
    const map = cleanMap({ name: 'Shapes', circles: [{ x: 300, y: 200, r: 40, shape: 'star', rot: 1 }], spawns: [{ x: 100, y: 100, team: 1 }, { x: 680, y: 380, team: 2 }] });
    expect(map).not.toBeNull();
    const rock = map!.circles[0]!;
    expect(rock.shape).toBe('star');
    expect(Math.abs((rock.rot ?? 0) - 1)).toBeLessThan((Math.PI * 2) / 256);
  });
});

describe('replays with rock shapes', () => {
  it('a mixed-shape match rebuilds the same rocks from a version 5 replay', () => {
    const setups: PlayerSetup[] = [{ id: 'a', name: 'A', team: 1 }, { id: 'b', name: 'B', team: 2 }];
    const m = createMatch(cfg({ seed: 19, rockShapes: 'mixed' }), setups);
    resolveRound(m, [{ playerId: 'a', expr: 'x/4' }, { playerId: 'b', expr: 'x/6' }]);
    const back = decodeReplay(encodeReplay(makeReplay(m, setups)))!;
    expect(back.v).toBe(6);
    expect(back.config.rockShapes).toBe('mixed');
    expect(replayStart(back).circles).toEqual(createMatch(cfg({ seed: 19, rockShapes: 'mixed' }), setups).circles);
  });
  it('a custom map with shapes round-trips its shapes', () => {
    const map = cleanMap({ name: 'S', circles: [{ x: 390, y: 220, r: 50, shape: 'hexagon', rot: 0.5 }], spawns: [{ x: 100, y: 100, team: 1 }, { x: 680, y: 380, team: 2 }] })!;
    const setups: PlayerSetup[] = [{ id: 'a', name: 'A', team: 1 }, { id: 'b', name: 'B', team: 2 }];
    const m = createMatch(cfg({ seed: 3, map }), setups);
    const back = decodeReplay(encodeReplay(makeReplay(m, setups)))!;
    expect(back.config.map!.circles[0]!.shape).toBe('hexagon');
    expect(back.config.map!.circles[0]!.rot).toBeCloseTo(map.circles[0]!.rot!, 6);
  });
  it('version 4 replays still decode, as circles', () => {
    const setups: PlayerSetup[] = [{ id: 'a', name: 'A', team: 1 }, { id: 'b', name: 'B', team: 2 }];
    const m = createMatch(cfg({ seed: 8 }), setups);
    resolveRound(m, [{ playerId: 'a', expr: 'x/4' }]);
    const code = encodeReplay(makeReplay(m, setups));
    const v6 = Uint8Array.from(atob(code.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
    // Version 6 added a rules byte after the seed (seed 8 is one byte), so drop it to get version 4's layout.
    const bytes = Uint8Array.from([4, v6[1]!, v6[2]!, ...v6.slice(4)]);
    let bin = '';
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    const old = btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    const back = decodeReplay(old)!;
    expect(back.v).toBe(4);
    expect(back.config.rockShapes).toBeUndefined();
    // Matches from before solid lines replay without them.
    expect(back.config.solidLines).toBe(false);
    expect(replayStart(back).circles).toEqual(createMatch(cfg({ seed: 8 }), setups).circles);
  });
});

describe('ranks', () => {
  it('six tiers from Arithmetic to Medalist at the set ratings', () => {
    expect(RANKS.map((r) => [r.name, r.min])).toEqual([
      ['Arithmetic', 0], ['Algebra', 150], ['Geometry', 200], ['Calculus', 300], ['Analysis', 400], ['Medalist', 500],
    ]);
    expect(rankFor(START_RATING)).toBe('Arithmetic');
    expect(rankFor(149)).toBe('Arithmetic');
    expect(rankFor(150)).toBe('Algebra');
    expect(rankFor(299)).toBe('Geometry');
    expect(rankFor(400)).toBe('Analysis');
    expect(rankFor(2000)).toBe('Medalist');
  });
  it('everyone starts at 100, and soft resets pull toward 100', () => {
    expect(START_RATING).toBe(100);
    expect(seasonReset(300)).toBe(200);
    expect(seasonReset(100)).toBe(100);
  });
  it('progress shows the way to the next tier', () => {
    expect(rankProgress(175)).toEqual({ rank: 'Algebra', next: 'Geometry', into: 25, need: 50 });
    expect(rankProgress(600).next).toBeNull();
  });
  it('equal players move 16, and placement matches move twice as fast', () => {
    expect(eloDelta(100, 100)).toBe(16);
    expect(PLACEMENT_MATCHES).toBe(3);
    expect(eloK(0)).toBe(64);
    expect(eloK(2)).toBe(64);
    expect(eloK(3)).toBe(32);
    expect(eloDelta(100, 100, eloK(0))).toBe(32);
  });
});

describe('solid lines', () => {
  const trio = () => board(createMatch(cfg({ kind: 'ffa' }), [
    { id: 'a', name: 'A', team: 1 }, { id: 'b', name: 'B', team: 1 }, { id: 'c', name: 'C', team: 1 },
  ]), { a: [100, 200], b: [300, 100], c: [700, 420] });
  it('a tip that runs into a line already drawn explodes there, and that line flies on', () => {
    const m = trio();
    // B's steep line crosses y = 200 near x = 333 early; A's flat line gets there later.
    const round = resolveRound(m, [{ playerId: 'a', expr: '0', dir: 1 }, { playerId: 'b', expr: '-3*x', dir: 1 }]);
    const a = round.shots.find((s) => s.playerId === 'a')!;
    const b = round.shots.find((s) => s.playerId === 'b')!;
    expect(a.reason).toBe('line');
    expect(Math.abs(a.end.x - 333)).toBeLessThan(10);
    expect(b.reason).not.toBe('line');
  });
  it('replays from before the rule keep lines see-through', () => {
    const m = board(createMatch(cfg({ kind: 'ffa', solidLines: false }), [
      { id: 'a', name: 'A', team: 1 }, { id: 'b', name: 'B', team: 1 }, { id: 'c', name: 'C', team: 1 },
    ]), { a: [100, 200], b: [300, 100], c: [700, 420] });
    const round = resolveRound(m, [{ playerId: 'a', expr: '0', dir: 1 }, { playerId: 'b', expr: '-3*x', dir: 1 }]);
    expect(round.shots.find((s) => s.playerId === 'a')!.reason).not.toBe('line');
  });
  it('tips meeting head on still make a beam', () => {
    const m = board(createMatch(cfg({ kind: 'ffa' }), [
      { id: 'c', name: 'C', team: 1 }, { id: 'd', name: 'D', team: 1 }, { id: 'e', name: 'E', team: 1 },
    ]), { c: [185, 225], d: [585, 225], e: [100, 60] });
    const round = resolveRound(m, [{ playerId: 'c', expr: '0', dir: 1 }, { playerId: 'd', expr: '0', dir: -1 }]);
    expect(round.beams.length).toBe(1);
  });
});

describe('new abilities', () => {
  const pair = (kind: 'ffa' | 'teams' = 'ffa') => createMatch(cfg({ kind }), [
    { id: 'a', name: 'A', team: 1 }, { id: 'b', name: 'B', team: kind === 'ffa' ? 1 : 2 }, { id: 'c', name: 'C', team: kind === 'ffa' ? 1 : 2 },
  ]);
  const owns = (m: ReturnType<typeof createMatch>) => m.players.forEach((p) => {
    p.abilities = ['hop', 'pierce', 'wall', 'fill', 'shield'];
    p.energy = 100;
  });
  it('Piercing Shot passes through the first rock and hits who hides behind it, then stops at the next rock', () => {
    const m = board(pair(), { a: [100, 300], b: [440, 300], c: [700, 40] });
    m.circles.push({ x: 320, y: 300, r: 40 }, { x: 620, y: 300, r: 40 });
    owns(m);
    const round = resolveRound(m, [{ playerId: 'a', expr: '0', dir: 1, ability: 'pierce' }]);
    const shot = round.shots[0]!;
    expect(shot.pierced).toBeDefined();
    expect(shot.reason).toBe('obstacle');
    expect(Math.abs(shot.end.x - 580)).toBeLessThan(6);
    const bSoldier = m.players.find((p) => p.id === 'b')!.soldierId;
    expect(round.kills.some((k) => k.id === bSoldier)).toBe(true);
  });
  it('Rock Wall hurts nobody and leaves new rock where it stops', () => {
    const m = board(pair(), { a: [100, 300], b: [352, 300], c: [700, 40] });
    m.circles.push({ x: 440, y: 300, r: 40 });
    owns(m);
    const round = resolveRound(m, [{ playerId: 'a', expr: '0', dir: 1, ability: 'wall' }]);
    expect(round.kills.length).toBe(0);
    const rock = m.holes.at(-1)!;
    expect(rock.kind).toBe('rock');
    expect(terrainOf(m).solidAt(Math.round(rock.x), Math.round(rock.y))).toBe(true);
  });
  it('Rock Wall never rises on top of a soldier', () => {
    const m = board(pair(), { a: [100, 300], b: [395, 300], c: [700, 40] });
    m.circles.push({ x: 440, y: 300, r: 40 });
    owns(m);
    // B stands right where the line stops; it can't be buried.
    resolveRound(m, [{ playerId: 'a', expr: '0', dir: 1, ability: 'wall' }]);
    expect(m.holes.some((h) => h.kind === 'rock')).toBe(false);
  });
  it('Fill pours rock back into a crater', () => {
    const m = board(pair(), { a: [100, 300], b: [700, 420], c: [700, 40] });
    m.circles.push({ x: 420, y: 300, r: 70 });
    m.holes.push({ x: 360, y: 300, r: 22 });
    owns(m);
    expect(terrainOf(m).solidAt(360, 300)).toBe(false);
    resolveRound(m, [{ playerId: 'a', expr: '0', dir: 1, ability: 'fill' }]);
    expect(m.holes.at(-1)!.kind).toBe('fill');
    expect(terrainOf(m).solidAt(360, 300)).toBe(true);
    // Fill only restores rock the map had: open air stays open.
    expect(terrainOf(m).solidAt(330, 260)).toBe(false);
  });
  it('Shield uses the turn and stops the first hit', () => {
    const m = board(pair(), { a: [150, 300], b: [600, 300], c: [700, 40] });
    owns(m);
    const round = resolveRound(m, [{ playerId: 'a', expr: '', ability: 'shield' }, { playerId: 'b', expr: '0', dir: -1 }]);
    const aSoldier = m.soldiers[m.players.find((p) => p.id === 'a')!.soldierId]!;
    expect(aSoldier.alive).toBe(true);
    expect(round.shots.some((s) => s.playerId === 'a')).toBe(false);
    expect(round.shields?.[0]?.blocked?.by).toEqual(['b']);
    expect(m.players.find((p) => p.id === 'a')!.energy).toBe(100 - 60);
  });
  it('a near miss earns a little energy, once', () => {
    const m = board(pair(), { a: [100, 300], b: [400, 325], c: [700, 40] });
    m.players.forEach((p) => (p.energy = 0));
    const round = resolveRound(m, [{ playerId: 'a', expr: '0', dir: 1 }]);
    expect(round.kills.length).toBe(0);
    expect(round.nearMiss).toEqual(['a']);
    expect(m.players.find((p) => p.id === 'a')!.energy).toBe(energyGain(1) + NEAR_MISS_ENERGY);
  });
  it('admin energy costs stored in the match are what abilities cost', () => {
    const m = board(createMatch(cfg({ kind: 'ffa', energyCosts: { shield: 10 } }), [
      { id: 'a', name: 'A', team: 1 }, { id: 'b', name: 'B', team: 1 },
    ]), { a: [150, 300], b: [600, 100] });
    owns(m);
    resolveRound(m, [{ playerId: 'a', expr: '', ability: 'shield' }]);
    expect(m.players.find((p) => p.id === 'a')!.energy).toBe(90);
  });
});

describe('loadouts', () => {
  it('Hop always comes, plus up to three others', () => {
    expect(cleanLoadout(['ricochet', 'heavy', 'pierce', 'wall'])).toEqual(['hop', 'ricochet', 'heavy', 'pierce']);
    expect(cleanLoadout([])).toEqual(['hop']);
    expect(cleanLoadout(['nope', 'shield', 'shield'])).toEqual(['hop', 'shield']);
  });
});

describe('replay version 6', () => {
  it('keeps the solid-lines rule and admin energy costs', () => {
    const setups: PlayerSetup[] = [{ id: 'a', name: 'A', team: 1, abilities: ['hop', 'shield'] }, { id: 'b', name: 'B', team: 2 }];
    const m = createMatch(cfg({ seed: 5, energyCosts: { shield: 20 } }), setups);
    resolveRound(m, [{ playerId: 'a', expr: '', ability: 'shield' }, { playerId: 'b', expr: 'x/3' }]);
    const back = decodeReplay(encodeReplay(makeReplay(m, setups)))!;
    expect(back.v).toBe(6);
    expect(back.config.energyCosts).toEqual({ shield: 20 });
    expect(back.config.solidLines).toBeUndefined();
    const again = replayStart(back);
    for (const a of back.actions) if (!again.over) applyAction(again, a);
    expect(again.players.map((p) => p.energy)).toEqual(m.players.map((p) => p.energy));
    const off = createMatch(cfg({ seed: 5, solidLines: false }), setups);
    expect(decodeReplay(encodeReplay(makeReplay(off, setups)))!.config.solidLines).toBe(false);
  });
});
