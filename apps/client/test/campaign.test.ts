import { describe, expect, it } from 'vitest';
import {
  ME,
  PLANE_H,
  PLANE_W,
  createSolo,
  SEASON,
  SEASON_REWARDS,
  cleanMap,
  dailyQuests,
  weeklyQuests,
  seasonLevel,
  decodeReplay,
  encodeReplay,
  fire,
  createMatch,
  makeReplay,
  replayStart,
  applyAction,
  skipTurn,
  soloCleared,
  soloHitFriend,
  soloNext,
  currentPlayer,
  currentSoldier,
  COSMETICS,
  terrainOf,
  validate,
  removePlayer,
} from '@mathbattles/sim';
import { LESSONS, ME, challengeState, requiredIds, type Challenge } from '../src/content/learn';
import { mergeProgress } from '../src/profileMerge';
import { OBSTACLE_STYLES } from '../src/render/obstacles';
import { CHAPTERS, LEVELS, buildLevel, starsFor } from '../src/content/campaign';
import { exprToTex } from '../src/util';

describe('campaign', () => {
  it('has plenty of levels across every chapter', () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(28);
    expect(LEVELS.every((l) => l.mode === 'fn')).toBe(true);
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

describe('season 0 pass', () => {
  it('has 50 levels, ends after Christmas, and finishes with Smite', () => {
    expect(SEASON.name).toBe('Season 0');
    expect(SEASON_REWARDS).toHaveLength(50);
    expect(new Date(SEASON.ends).toISOString().slice(0, 10)).toBe('2026-12-26');
    const last = SEASON_REWARDS[49]!;
    expect('cosmetic' in last && last.cosmetic).toBe('blast-smite');
    expect(COSMETICS.find((c) => c.id === 'blast-smite')?.kind).toBe('blast');
  });
  it('gives one or two cosmetic levels for every Sparks level', () => {
    const kinds = SEASON_REWARDS.map((r) => ('sparks' in r ? 's' : 'c')).join('');
    expect(kinds).not.toMatch(/ss/);
    expect(kinds).not.toMatch(/ccc/);
    const sparks = SEASON_REWARDS.filter((r) => 'sparks' in r).length;
    const cosmetics = SEASON_REWARDS.length - sparks;
    expect(cosmetics).toBeGreaterThanOrEqual(sparks);
    expect(cosmetics).toBeLessThanOrEqual(sparks * 2 + 2);
  });
  it('rewards real, unique cosmetics that the shop never sells', () => {
    const ids = SEASON_REWARDS.flatMap((r) => ('cosmetic' in r ? [r.cosmetic] : []));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      const c = COSMETICS.find((x) => x.id === id);
      expect(c, id).toBeTruthy();
      expect(c!.season?.id).toBe(0);
      expect(c!.cost).toBe(0);
    }
    // Every season obstacle design has a painter.
    for (const c of COSMETICS.filter((x) => x.kind === 'obstacle')) expect(OBSTACLE_STYLES[c.value], c.id).toBeTruthy();
  });
  it('turns XP into levels', () => {
    expect(seasonLevel(0)).toMatchObject({ level: 0, into: 0 });
    expect(seasonLevel(SEASON.xpPerLevel * 3 + 10)).toMatchObject({ level: 3, into: 10 });
    expect(seasonLevel(1e9)).toMatchObject({ level: 50, maxed: true });
  });
});

describe('quests', () => {
  it('change every day, and every week on Monday', () => {
    const day = 20402; // A Monday.
    expect(new Date(day * 86_400_000).getUTCDay()).toBe(1);
    expect(dailyQuests(day).map((q) => q.id)).not.toEqual(dailyQuests(day + 1).map((q) => q.id));
    const week = weeklyQuests(day).map((q) => q.id);
    for (let d = day; d < day + 7; d++) expect(weeklyQuests(d).map((q) => q.id)).toEqual(week);
    expect(weeklyQuests(day + 7).map((q) => q.id)).not.toEqual(week);
    expect(weeklyQuests(day - 1).map((q) => q.id)).not.toEqual(week);
  });
  it('pay Sparks and season XP', () => {
    for (let d = 20000; d < 20014; d++) {
      for (const q of [...dailyQuests(d), ...weeklyQuests(d)]) {
        expect(q.reward).toBeGreaterThan(0);
        expect(q.seasonXp).toBeGreaterThan(0);
      }
      expect(dailyQuests(d)).toHaveLength(3);
      expect(weeklyQuests(d)).toHaveLength(3);
    }
  });
});

describe('custom maps', () => {
  const map = {
    name: 'Twin rocks',
    circles: [{ x: 300, y: 200, r: 40 }, { x: 470, y: 250, r: 40 }],
    spawns: [{ x: 60, y: 60, team: 1 as const }, { x: 700, y: 380, team: 2 as const }],
  };
  const setups = [{ id: 'a', name: 'Ana', team: 1 as const }, { id: 'b', name: 'Bo', team: 2 as const }];
  it('use the map’s rocks and starting spots', () => {
    const m = createMatch({ kind: 'teams', mode: 'fn', soldiers: 2, seed: 9, map }, setups);
    expect(m.circles).toEqual(map.circles);
    const a = m.players.find((p) => p.id === 'a')!;
    const b = m.players.find((p) => p.id === 'b')!;
    // Each team's first soldier stands on its spot. The rest are placed at random on their side.
    expect(a.soldierIds.map((id) => m.soldiers[id]!).some((s) => s.x === 60 && s.y === 60)).toBe(true);
    expect(b.soldierIds.map((id) => m.soldiers[id]!).some((s) => s.x === 700 && s.y === 380)).toBe(true);
    for (const id of a.soldierIds) expect(m.soldiers[id]!.x).toBeLessThan(385);
  });
  it('travel inside replay links and rebuild the same match', () => {
    const m = createMatch({ kind: 'teams', mode: 'fn', soldiers: 1, seed: 4, map }, setups);
    fire(m, currentPlayer(m).id, { expr: 'x/9' });
    fire(m, currentPlayer(m).id, { expr: '-x/5' });
    const back = decodeReplay(encodeReplay(makeReplay(m, setups)))!;
    expect(back.config.map).toEqual(map);
    const again = replayStart(back);
    for (const action of back.actions) applyAction(again, action);
    expect(again.holes).toEqual(m.holes);
    expect(again.soldiers.map((s) => [s.x, s.y, s.alive])).toEqual(m.soldiers.map((s) => [s.x, s.y, s.alive]));
  });
  it('are checked before use', () => {
    expect(cleanMap(map)).toEqual(map);
    expect(cleanMap({ ...map, circles: Array.from({ length: 41 }, () => ({ x: 1, y: 1, r: 10 })) })).toBeNull();
    expect(cleanMap({ ...map, circles: [{ x: 'a', y: 1, r: 10 }] })).toBeNull();
    expect(cleanMap(null)).toBeNull();
    // Out-of-range values are pulled back into the field instead of rejected.
    expect(cleanMap({ name: '', circles: [{ x: 9999, y: -5, r: 500 }], spawns: [] })).toEqual({ name: 'Custom map', circles: [{ x: 770, y: 0, r: 120 }], spawns: [] });
  });
});

/** Links number the players instead of storing their ids, so compare soldiers by position. */
const board = (soldiers: { x: number; y: number; alive: boolean; angle: number }[]) => soldiers.map(({ x, y, alive, angle }) => ({ x, y, alive, angle }));

describe('replays', () => {
  it('survive the link format and rebuild the same match', () => {
    const setups = [
      { id: 'a', name: 'Ana', team: 1 as const },
      { id: 'b', name: 'Bo', team: 2 as const },
    ];
    const m = createMatch({ kind: 'teams', mode: 'fn', soldiers: 2, seed: 77 }, setups);
    for (let i = 0; i < 6 && !m.over; i++) {
      if (i % 3 === 2) skipTurn(m);
      else fire(m, currentPlayer(m).id, { expr: i % 2 ? 'x/4' : 'sin(x)' });
    }
    const link = encodeReplay(makeReplay(m, setups));
    expect(link).toMatch(/^[\w-]+$/);
    const back = decodeReplay(link)!;
    const again = replayStart(back);
    for (const a of back.actions) applyAction(again, a);
    expect(board(again.soldiers)).toEqual(board(m.soldiers));
    expect(again.holes).toEqual(m.holes);
    expect(again.turnNumber).toBe(m.turnNumber);
    expect(decodeReplay('not-valid!!')).toBeNull();
  });
});

describe('replay contents', () => {
  it('rebuilds shots, timeouts, and players leaving', () => {
    const setups = [
      { id: 'a', name: 'Ana', team: 1 as const },
      { id: 'b', name: 'Bo', team: 2 as const },
      { id: 'c', name: 'Cy', team: 1 as const },
    ];
    const play = createMatch({ kind: 'teams', mode: 'fn', soldiers: 1, seed: 11 }, setups);
    fire(play, currentPlayer(play).id, { expr: 'x/9' });
    skipTurn(play);
    removePlayer(play, play.players.find((p) => p.id !== currentPlayer(play).id)!.id);
    const replay = decodeReplay(encodeReplay(makeReplay(play, setups)))!;
    expect(replay.actions.map((a) => a.a)).toEqual(['f', 's', 'l']);
    const again = replayStart(replay);
    for (const a of replay.actions) applyAction(again, a);
    expect(board(again.soldiers)).toEqual(board(play.soldiers));
    expect(again.holes).toEqual(play.holes);
  });
  it('short links rebuild every kind of match exactly, at a fraction of the old length', () => {
    const exprs = ['x/3', 'sin(x)*4', '-x^2/60+x/4', 'sqrt(abs(x))', '7/(1+exp(-2*(x-4)))', '0.5', "y'/4-y/9", '3*cos(x/2)', 'ln(abs(x)+1)'];
    let oldTotal = 0;
    let newTotal = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const kind = seed % 3 === 0 ? 'ffa' : 'teams';
      const mode = (['fn', 'ode1', 'ode2'] as const)[seed % 3];
      const setups = [
        { id: `guest-${seed}-aaaaaaaaaaaaaaaaaaaaaaaaaaaa`, name: seed % 4 === 0 ? 'Zoë ✨' : 'Ana', team: 1 as const },
        { id: `b7:hard`, name: 'Gauss', team: 2 as const, isBot: true, botLevel: 'hard' },
        ...(seed % 2 ? [{ id: `uid-${seed}-cccccccccccccccccccccccc`, name: 'Cy', team: 2 as const }] : []),
      ];
      const match = createMatch({ kind, mode, soldiers: 1 + (seed % 2), seed: seed % 5 === 0 ? -seed * 1000 : seed * 99991 }, setups);
      for (let k = 0; k < 14 && !match.over; k++) {
        const pick = exprs[(seed + k) % exprs.length]!;
        const expr = mode === 'fn' ? pick.replace("y'", 'x') : mode === 'ode1' ? pick.replace("y'", 'y') : pick;
        if (k % 5 === 4) skipTurn(match);
        else {
          try {
            fire(match, currentPlayer(match).id, { expr, angle: 0.137 * k - 0.4, dir: k % 2 ? -1 : 1 });
          } catch {
            skipTurn(match);
          }
        }
      }
      const replay = makeReplay(match, setups);
      const link = encodeReplay(replay);
      const oldLink = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(replay))));
      oldTotal += oldLink.length;
      newTotal += link.length;
      const back = decodeReplay(link)!;
      expect(back).not.toBeNull();
      expect(back.setups.map((s) => [s.name, s.team, !!s.isBot])).toEqual(setups.map((s) => [s.name, s.team, !!s.isBot]));
      const again = replayStart(back);
      for (const a of back.actions) applyAction(again, a);
      expect(again.soldiers).toEqual(match.soldiers.map((s) => ({ ...s, playerId: back.setups[setups.findIndex((x) => x.id === s.playerId)]!.id })));
      expect(again.holes).toEqual(match.holes);
      expect(again.over).toBe(match.over);
    }
    // Links are at least 3 times shorter on average.
    expect(newTotal * 3).toBeLessThan(oldTotal);
  });
  it('still opens links made before the short format', () => {
    const setups = [{ id: 'a', name: 'Ana', team: 1 as const }, { id: 'b', name: 'Bo', team: 2 as const }];
    const match = createMatch({ kind: 'teams', mode: 'fn', soldiers: 1, seed: 3 }, setups);
    fire(match, currentPlayer(match).id, { expr: 'x/4' });
    const replay = makeReplay(match, setups);
    const oldLink = btoa(JSON.stringify(replay)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    expect(decodeReplay(oldLink)).toEqual(replay);
    // Old links that used abilities can't be rebuilt any more, so they're refused cleanly.
    const withAbility = { ...replay, actions: [{ a: 'm', p: 'a' }, ...replay.actions] };
    expect(decodeReplay(btoa(JSON.stringify(withAbility)))).toBeNull();
  });
  it('refuses links describing impossible matches', () => {
    const encode = (o: unknown) => btoa(JSON.stringify(o)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    const config = { kind: 'teams', mode: 'fn', soldiers: 1, seed: 1 };
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
