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
  currentPlayer,
  currentSoldier,
  eloDelta,
  fire,
  levelFromXp,
  removePlayer,
  simulateShot,
  skipTurn,
  validate,
  COSMETICS,
  DEFAULT_ROOM_SETTINGS,
  DEFAULT_SOLDIERS,
  decodeReplay,
  matchRecordFor,
  shotMoment,
  shotsOf,
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
  kind: 'teams', mode: 'fn', soldiers: 2, seed: 42, ...o,
});
const duel: PlayerSetup[] = [
  { id: 'a', name: 'A', team: 1 },
  { id: 'b', name: 'B', team: 2 },
];

describe('match rules', () => {
  it('builds the same map from the same seed', () => {
    const a = createMatch(cfg(), duel);
    const b = createMatch(cfg(), duel);
    expect(a.circles).toEqual(b.circles);
    expect(a.soldiers).toEqual(b.soldiers);
    expect(createMatch(cfg({ seed: 43 }), duel).circles).not.toEqual(a.circles);
  });
  it('spawns teams on their own half, clear of obstacles', () => {
    for (let seed = 0; seed < 60; seed++) {
      const m = createMatch(cfg({ seed, soldiers: 4 }), [
        { id: 'a', name: 'A', team: 1 }, { id: 'c', name: 'C', team: 1 },
        { id: 'b', name: 'B', team: 2 }, { id: 'd', name: 'D', team: 2 },
      ]);
      expect(m.soldiers.length).toBe(16);
      for (const s of m.soldiers) {
        const team = m.players.find((p) => p.id === s.playerId)!.team;
        expect(team === 1 ? s.x < PLANE_W / 2 : s.x >= PLANE_W / 2).toBe(true);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeLessThan(PLANE_H);
        for (const c of m.circles) expect(Math.hypot(c.x - s.x, c.y - s.y)).toBeGreaterThanOrEqual(c.r + 15);
      }
    }
  });
  it('alternates teams and rotates soldiers', () => {
    const m = createMatch(cfg(), duel);
    const first = currentPlayer(m).id;
    const firstSoldier = currentSoldier(m)!.id;
    skipTurn(m);
    expect(currentPlayer(m).id).not.toBe(first);
    skipTurn(m);
    expect(currentPlayer(m).id).toBe(first);
    expect(currentSoldier(m)!.id).not.toBe(firstSoldier);
  });
  it('rejects shots out of turn', () => {
    const m = createMatch(cfg(), duel);
    const other = m.players.find((p) => p.id !== currentPlayer(m).id)!.id;
    expect(() => fire(m, other, { expr: '0' })).toThrow(/your turn/);
  });
  it('kills, including friendly fire, and ends the match', () => {
    const m = createMatch(cfg({ soldiers: 1 }), duel);
    m.circles.length = 0;
    const me = currentPlayer(m);
    const enemy = m.players.find((p) => p.id !== me.id)!;
    const shooter = currentSoldier(m)!;
    const target = m.soldiers[enemy.soldierIds[0]!]!;
    target.x = me.team === 1 ? shooter.x + 200 : shooter.x - 200;
    target.y = shooter.y;
    const { record } = fire(m, me.id, { expr: '0' });
    expect(record.hits.map((h) => h.id)).toEqual([target.id]);
    expect(target.alive).toBe(false);
    expect(m.over).toBe(true);
    expect(m.winner).toBe(me.team);
    expect(me.kills).toBe(1);
  });
  it('a shot that kills only a teammate gives no kill credit', () => {
    const m = createMatch(cfg({ soldiers: 2 }), duel);
    m.circles.length = 0;
    const me = currentPlayer(m);
    const shooter = currentSoldier(m)!;
    const mate = m.soldiers[me.soldierIds.find((id) => id !== shooter.id)!]!;
    mate.x = me.team === 1 ? shooter.x + 40 : shooter.x - 40;
    mate.y = shooter.y;
    for (const s of m.soldiers) {
      if (s.playerId !== me.id) s.y = shooter.y > 225 ? 20 : 430;
    }
    fire(m, me.id, { expr: '0' });
    expect(mate.alive).toBe(false);
    expect(me.kills).toBe(0);
  });
  it('carves terrain at the end of a shot', () => {
    const m = createMatch(cfg(), duel);
    const before = m.holes.length;
    fire(m, currentPlayer(m).id, { expr: '0' });
    expect(m.holes.length).toBe(before + 1);
    expect(m.holes.at(-1)!.r).toBe(12);
  });
  it('a player leaving removes their soldiers and can end the match', () => {
    const m = createMatch(cfg(), duel);
    removePlayer(m, 'a');
    expect(m.over).toBe(true);
    expect(m.winner).toBe(2);
  });
  it('free-for-all ends with the last player standing and allows -x', () => {
    const m = createMatch(cfg({ kind: 'ffa', soldiers: 1 }), [
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
});

describe('bots', () => {
  it('a strong bot usually finds a kill on open maps', () => {
    let hits = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const m = createMatch(cfg({ seed, soldiers: 1 }), [
        { id: 'a', name: 'A', team: 1 }, { id: 'b', name: 'B', team: 2 },
      ]);
      m.circles.length = 0;
      const move = chooseMove(m, { generations: 40, seed, budgetMs: 1500 });
      const r = fire(m, currentPlayer(m).id, { expr: move.expr, angle: move.angle, dir: move.dir });
      if (r.record.hits.length) hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(4);
  });
  it('produces valid moves in every mode', () => {
    for (const mode of ['fn', 'ode1', 'ode2'] as const) {
      const m = createMatch(cfg({ mode, seed: 9 }), duel);
      const move = chooseMove(m, { generations: 3, seed: 1 });
      expect(() => fire(m, currentPlayer(m).id, move)).not.toThrow();
    }
  });
});

describe('rewinding', () => {
  it('rebuilds the board at any shot without changing the match', () => {
    const m = createMatch(cfg({ soldiers: 2, seed: 8 }), duel);
    m.circles = [{ x: 385, y: 40, r: 20 }];
    const start = m.soldiers.map((s) => ({ ...s }));
    const me = currentPlayer(m);
    const shooter = currentSoldier(m)!;
    const enemy = m.players.find((p) => p.id !== me.id)!;
    const target = m.soldiers[enemy.soldierIds[0]!]!;
    target.x = me.team === 1 ? shooter.x + 150 : shooter.x - 150;
    target.y = shooter.y;
    fire(m, me.id, { expr: '0' });
    expect(target.alive).toBe(false);
    fire(m, currentPlayer(m).id, { expr: 'x/9' });
    const snapshot = JSON.stringify(m);

    expect(shotsOf(m).length).toBe(2);
    const first = shotMoment(m, 0)!;
    expect(first.shot.expr).toBe('0');
    expect(first.before.holes.length).toBe(0);
    expect(first.after.holes.length).toBe(1);
    expect(first.before.soldiers[target.id]!.alive).toBe(true);
    expect(first.after.soldiers[target.id]!.alive).toBe(false);
    const second = shotMoment(m, 1)!;
    expect(second.shot.expr).toBe('x/9');
    expect(second.before.holes.length).toBe(1);
    expect(second.after.holes.length).toBe(2);
    expect(shotMoment(m, 5)).toBeNull();
    expect(JSON.stringify(m)).toBe(snapshot);
    void start;
  });
  it('undoes players leaving', () => {
    const setups: PlayerSetup[] = [{ id: 'a', name: 'A', team: 1 }, { id: 'b', name: 'B', team: 2 }, { id: 'c', name: 'C', team: 2 }];
    const m = createMatch(cfg({ soldiers: 1, seed: 21 }), setups);
    m.circles.length = 0;
    fire(m, currentPlayer(m).id, { expr: 'x/20' });
    const stays = m.players.find((p) => p.id !== currentPlayer(m).id && p.soldierIds.every((id) => m.soldiers[id]!.alive))!;
    removePlayer(m, stays.id);
    const moment = shotMoment(m, 0)!;
    expect(moment.after.soldiers[stays.soldierIds[0]!]!.alive).toBe(true);
  });
});

describe('match records', () => {
  it('describes a match from each side, and can be watched', () => {
    const m = createMatch(cfg({ soldiers: 1, seed: 4 }), duel);
    removePlayer(m, 'b');
    const a = matchRecordFor(m, duel, 'a', { id: 'x', at: 5, kind: 'bots' });
    const b = matchRecordFor(m, duel, 'b', { id: 'x', at: 5, kind: 'bots', ratingDelta: -3 });
    expect(a.result).toBe('win');
    expect(a.opponents).toEqual(['B']);
    expect(b.result).toBe('loss');
    expect(b.ratingDelta).toBe(-3);
    expect(decodeReplay(a.replay!)).not.toBeNull();
    const nobody = matchRecordFor(m, duel, null, { id: 'y', at: 5, kind: 'shared' });
    expect(nobody.result).toBe('none');
    expect([...nobody.opponents].sort()).toEqual(['A', 'B']);
  });
});

describe('defaults and shop items', () => {
  it('matches default to one soldier each', () => {
    expect(DEFAULT_SOLDIERS).toBe(1);
    expect(DEFAULT_ROOM_SETTINGS.soldiers).toBe(1);
    expect(createMatch({ ...cfg(), soldiers: 0 }, duel).soldiers.length).toBe(2);
  });
  it('every item has a unique id, and obstacles include a free default', () => {
    expect(new Set(COSMETICS.map((c) => c.id)).size).toBe(COSMETICS.length);
    expect(COSMETICS.filter((c) => c.kind === 'obstacle').length).toBeGreaterThanOrEqual(8);
    expect(COSMETICS.find((c) => c.id === 'obstacle-candy')!.cost).toBe(0);
  });
});

describe('big matches', () => {
  it('always places a full free-for-all', () => {
    const setups = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, team: 1 as const }));
    for (let seed = 0; seed < 40; seed++) {
      const m = createMatch(cfg({ kind: 'ffa', soldiers: 4, seed }), setups);
      expect(m.soldiers.length).toBe(40);
    }
  });
});

describe('bot work limit', () => {
  it('stops at its limit even if the clock never moves', () => {
    const m = createMatch(cfg({ seed: 3 }), duel);
    let simulated = 0;
    const realNow = () => {
      simulated++;
      return 0;
    };
    const t0 = Date.now();
    chooseMove(m, { generations: 400, seed: 1, maxEvals: 120, budgetMs: 1, now: realNow });
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe('bot speed', () => {
  it('respects its time budget', () => {
    const m = createMatch(cfg({ seed: 5 }), duel);
    const t0 = Date.now();
    chooseMove(m, { generations: 400, seed: 1, budgetMs: 500 });
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe('progression', () => {
  it('computes levels and elo', () => {
    expect(levelFromXp(0).level).toBe(1);
    expect(levelFromXp(125).level).toBe(2);
    expect(eloDelta(1000, 1000)).toBe(16);
    expect(eloDelta(1400, 1000)).toBeLessThan(5);
  });
});
