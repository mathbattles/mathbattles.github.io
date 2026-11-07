import { describe, expect, it } from 'vitest';
import {
  ME,
  PLANE_H,
  PLANE_W,
  createSolo,
  dailyPuzzle,
  decodeReplay,
  encodeReplay,
  fire,
  createMatch,
  makeReplay,
  replayStart,
  applyAction,
  scoreDaily,
  skipTurn,
  soloCleared,
  soloHitFriend,
  soloNext,
  currentPlayer,
  currentSoldier,
  COSMETICS,
  terrainOf,
  validate,
  armMissile,
  removePlayer,
  useTeleport,
} from '@mathbattles/sim';
import { LESSONS, ME, challengeState, requiredIds, type Challenge } from '../src/content/learn';
import { mergeProgress } from '../src/profileMerge';
import { OBSTACLE_STYLES } from '../src/render/obstacles';
import { CHAPTERS, LEVELS, buildLevel, starsFor } from '../src/content/campaign';
import { exprToTex } from '../src/util';

describe('campaign', () => {
  it('has about 40 levels across every chapter', () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(LEVELS.map((l) => l.chapter)).size).toBe(CHAPTERS.length);
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
  });

  for (const level of LEVELS) {
    it(`level ${level.id} "${level.title}" is clearable with its known answer`, () => {
      const def = buildLevel(level);
      for (const e of def.enemies) {
        expect(e.y).toBeGreaterThan(0);
        expect(e.y).toBeLessThan(PLANE_H);
        expect(e.x).toBeGreaterThan(0);
        expect(e.x).toBeLessThan(PLANE_W);
      }
      for (const a of def.allies ?? []) {
        expect(a.y).toBeGreaterThan(0);
        expect(a.y).toBeLessThan(PLANE_H);
      }
      const state = createSolo(def);
      fire(state, ME, { expr: level.solution, angle: level.angle });
      expect(soloCleared(state)).toBe(true);
      expect(soloHitFriend(state)).toBe(false);
    });
  }

  it('awards stars for one shot and short functions', () => {
    const l = LEVELS[0]!;
    expect(starsFor(l, [{ expr: '0' }])).toBe(3);
    expect(starsFor(l, [{ expr: '1' }, { expr: '0' }])).toBe(2);
    expect(starsFor(l, [{ expr: 'x-x+x-x+x-x+x-x' }])).toBe(2);
  });
});

describe('daily challenge', () => {
  it('builds the same puzzle for the same day and a different one the next', () => {
    expect(dailyPuzzle(20000)).toEqual(dailyPuzzle(20000));
    expect(dailyPuzzle(20000)).not.toEqual(dailyPuzzle(20001));
  });
  it('scores by replaying the shots', () => {
    const s = scoreDaily(20000, [{ expr: '0' }, { expr: 'x/2' }]);
    expect(s.shots).toBe(2);
    expect(s.chars).toBe(4);
    expect(s.score).toBe(2004);
  });
  it('rejects bad math on submission', () => {
    expect(() => scoreDaily(20000, [{ expr: 'hack(' }])).toThrow();
  });
});

describe('replays', () => {
  it('survive the link format and rebuild the same match', () => {
    const setups = [
      { id: 'a', name: 'Ana', team: 1 as const },
      { id: 'b', name: 'Bo', team: 2 as const },
    ];
    const m = createMatch({ kind: 'teams', mode: 'fn', abilities: false, soldiers: 2, seed: 77 }, setups);
    for (let i = 0; i < 6 && !m.over; i++) {
      if (i % 3 === 2) skipTurn(m);
      else fire(m, currentPlayer(m).id, { expr: i % 2 ? 'x/4' : 'sin(x)' });
    }
    const link = encodeReplay(makeReplay(m, setups));
    expect(link).toMatch(/^[\w-]+$/);
    const back = decodeReplay(link)!;
    const again = replayStart(back);
    for (const a of back.actions) applyAction(again, a);
    expect(again.soldiers).toEqual(m.soldiers);
    expect(again.holes).toEqual(m.holes);
    expect(again.turnNumber).toBe(m.turnNumber);
    expect(decodeReplay('not-valid!!')).toBeNull();
  });
});

describe('replay contents', () => {
  it('rebuilds teleports, missiles, timeouts, and players leaving', () => {
    const setups = [
      { id: 'a', name: 'Ana', team: 1 as const, ability: 'teleport' as const },
      { id: 'b', name: 'Bo', team: 2 as const, ability: 'missile' as const },
      { id: 'c', name: 'Cy', team: 1 as const, ability: 'missile' as const },
    ];
    const m = createMatch({ kind: 'teams', mode: 'fn', abilities: true, soldiers: 1, seed: 11 }, setups);
    m.circles.length = 0;
    const play = createMatch({ kind: 'teams', mode: 'fn', abilities: true, soldiers: 1, seed: 11 }, setups);
    // Abilities need charge, so grant it the same way in both copies.
    const grant = (s: typeof m) => s.players.forEach((p) => { p.charge = 4; });
    grant(play);
    const cur = currentPlayer(play);
    const soldier = currentSoldier(play)!;
    if (cur.ability === 'missile') armMissile(play, cur.id);
    else useTeleport(play, cur.id, Math.max(30, Math.min(740, soldier.x + (soldier.x < 385 ? -5 : 5))), soldier.y);
    fire(play, currentPlayer(play).id, { expr: 'x/9' });
    skipTurn(play);
    removePlayer(play, play.players.find((p) => p.id !== currentPlayer(play).id)!.id);
    const replay = decodeReplay(encodeReplay(makeReplay(play, setups)))!;
    expect(replay.actions.map((a) => a.a)).toEqual(expect.arrayContaining(['f', 's', 'l']));
    const again = replayStart(replay);
    grant(again);
    for (const a of replay.actions) applyAction(again, a);
    expect(again.soldiers).toEqual(play.soldiers);
    expect(again.holes).toEqual(play.holes);
  });
  it('refuses links describing impossible matches', () => {
    const encode = (o: unknown) => btoa(JSON.stringify(o)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    const config = { kind: 'teams', mode: 'fn', abilities: false, soldiers: 1, seed: 1 };
    const setups = [{ id: 'a', name: 'A', team: 1 }, { id: 'b', name: 'B', team: 2 }];
    expect(decodeReplay(encode({ v: 1, config, setups, actions: [] }))).not.toBeNull();
    expect(decodeReplay(encode({ v: 1, config, setups: [], actions: [] }))).toBeNull();
    const crowd = Array.from({ length: 400 }, (_, i) => ({ id: `p${i}`, name: 'x', team: 1 }));
    expect(decodeReplay(encode({ v: 1, config, setups: crowd, actions: [] }))).toBeNull();
    expect(decodeReplay(encode({ v: 1, config: { ...config, soldiers: 99 }, setups, actions: [] }))).toBeNull();
    expect(decodeReplay(encode({ v: 1, config, setups: [setups[0], setups[0]], actions: [] }))).toBeNull();
  });
});

describe('merging progress', () => {
  const base = (o: object) => ({
    xp: 0, sparks: 0, matches: 0, wins: 0, kills: 0, bestCombo: 0, dailiesDone: 0, lastWinDay: 0, questDay: 0, questWeek: 0,
    owned: [], achievements: [], questsPaid: [], learnDone: [], stars: {}, mastery: {}, questProgress: {}, daily: {}, updatedAt: 0, name: 'x', ...o,
  });
  it('keeps everything from an account when a nearly empty, newer guest copy signs in', () => {
    const phone = base({ xp: 10, sparks: 5, stars: { '0-1': 1 }, updatedAt: 500, name: 'Phone' });
    const cloud = base({ xp: 900, sparks: 500, stars: { '0-1': 3, '1-1': 2 }, owned: ['hat-crown'], updatedAt: 100, name: 'Cloud' });
    const out = mergeProgress(phone, cloud);
    expect(out.xp).toBe(900);
    expect(out.sparks).toBe(500);
    expect(out.stars).toEqual({ '0-1': 3, '1-1': 2 });
    expect(out.owned).toContain('hat-crown');
    expect(out.name).toBe('Phone');
    expect(out.updatedAt).toBe(500);
  });
  it('takes the best score and adds items from both sides', () => {
    const a = base({ owned: ['x'], daily: { 5: { score: 2000, shots: 2, chars: 0 } }, updatedAt: 1 });
    const b = base({ owned: ['y'], daily: { 5: { score: 1000, shots: 1, chars: 0 }, 6: { score: 3000, shots: 3, chars: 0 } }, updatedAt: 2 });
    const out = mergeProgress(a, b);
    expect(out.owned.sort()).toEqual(['x', 'y']);
    expect(out.daily[5]!.score).toBe(1000);
    expect(out.daily[6]!.score).toBe(3000);
  });
  it('survives a damaged cloud copy', () => {
    const out = mergeProgress(base({ xp: 5, updatedAt: 1 }), { xp: 'lots' as unknown as number, stars: undefined, updatedAt: 0 });
    expect(out.xp).toBe(5);
    expect(out.stars).toEqual({});
  });
});

describe('the Learn course', () => {
  const challenges: Challenge[] = LESSONS.flatMap((l) => l.blocks.filter((b): b is Challenge => b.t === 'challenge'));
  it('is a full course with unique exercise ids', () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(20);
    expect(challenges.length).toBeGreaterThanOrEqual(25);
    const ids = LESSONS.flatMap((l) => requiredIds(l));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
  });

  const inField = (p: { x: number; y: number }) => p.x > 0 && p.x < PLANE_W && p.y > 0 && p.y < PLANE_H;
  for (const c of challenges) {
    it(`"${c.id}" can be cleared with its answer`, () => {
      const start = challengeState(c);
      for (const s of start.soldiers) expect(inField(s), `soldier ${s.id} in field`).toBe(true);
      const terrain = terrainOf(start);
      let shots = 0;
      while (!soloCleared(start) && shots < (c.shots ?? 1)) {
        fire(start, ME, { expr: c.solution, angle: c.angle, dir: c.dir }, terrain);
        soloNext(start);
        shots++;
      }
      expect(soloCleared(start), 'targets cleared').toBe(true);
      expect(soloHitFriend(start), 'teammate safe').toBe(false);
      if (c.requires) expect(new RegExp(c.requires.pattern).test(c.solution.replace(/\s/g, ''))).toBe(true);
      // The last hint or answer button must actually help: hints exist on everything.
      expect(c.hints.length).toBeGreaterThan(0);
    });
    if (c.blocksStraight) {
      it(`"${c.id}" really does block a straight shot`, () => {
        const state = challengeState(c);
        const me = state.soldiers[0]!;
        const t = state.soldiers.find((s) => s.playerId === 'targets')!;
        const slope = (me.y - t.y) / (t.x - me.x);
        fire(state, ME, { expr: slope < 0 ? `(${slope})*x` : `${slope}*x` }, terrainOf(state));
        expect(soloCleared(state)).toBe(false);
      });
    }
  }

  it('quizzes have a valid answer', () => {
    for (const l of LESSONS) for (const b of l.blocks) {
      if (b.t !== 'quiz') continue;
      expect(b.options[b.answer], b.id).toBeTruthy();
      expect(b.why.length).toBeGreaterThan(10);
    }
  });

  it('every example, slider start, and starter function is valid math', () => {
    for (const l of LESSONS) for (const b of l.blocks) {
      if (b.t === 'play') {
        expect(validate(b.start, b.mode), `${l.id} start ${b.start}`).toBeNull();
        for (const ex of b.examples) expect(validate(ex.expr, b.mode), `${l.id} ${ex.expr}`).toBeNull();
      }
      if (b.t === 'sliders') {
        const expr = b.template.replace(/\{(\w+)\}/g, (_, n: string) => String(Math.abs(b.params.find((p) => p.name === n)!.value)));
        expect(validate(expr, b.mode), `${l.id} ${expr}`).toBeNull();
      }
    }
  });
});

describe('obstacle designs', () => {
  it('has a design for every obstacle item in the shop', () => {
    for (const c of COSMETICS.filter((x) => x.kind === 'obstacle')) {
      expect(OBSTACLE_STYLES[c.value], c.id).toBeTruthy();
    }
  });
});

describe('formula preview', () => {
  it('produces TeX without passing through commands', () => {
    expect(exprToTex('x^2+sin(x)')).toBe('x^{2}+\\sin (x)');
    expect(exprToTex('2*x^(x+1)')).toBe('2\\cdot x^{(x+1)}');
    expect(exprToTex('\\href{evil}')).not.toContain('\\href');
  });
});

void soloNext;
void currentSoldier;
