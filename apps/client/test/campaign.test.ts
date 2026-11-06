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
} from '@mathbattles/sim';
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

describe('formula preview', () => {
  it('produces TeX without passing through commands', () => {
    expect(exprToTex('x^2+sin(x)')).toBe('x^{2}+\\sin (x)');
    expect(exprToTex('2*x^(x+1)')).toBe('2\\cdot x^{(x+1)}');
    expect(exprToTex('\\href{evil}')).not.toContain('\\href');
  });
});

void soloNext;
