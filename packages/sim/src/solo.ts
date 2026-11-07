import type { ShotMode } from './constants';
import { generateCircles, placeSoldiers } from './map';
import { Rng, hashSeed } from './rng';
import { currentPlayer, fire, skipTurn, type MatchState, type Player } from './rules';
import type { Circle } from './terrain';

/** Solo play uses the normal rules with players who never act: targets and allies. */
export const ME = 'me';
export const TARGETS = 'targets';
export const ALLIES = 'allies';

export interface SoloDef {
  mode: ShotMode;
  shooter: { x: number; y: number };
  enemies: { x: number; y: number }[];
  allies?: { x: number; y: number }[];
  circles: Circle[];
  name?: string;
}

function makePlayer(id: string, name: string, team: 1 | 2, ids: number[]): Player {
  return {
    id, name, team, soldierIds: ids, nextSoldier: 0,
    connected: true, kills: 0, deaths: 0, shots: 0, bestCombo: 0,
  };
}

export function createSolo(def: SoloDef): MatchState {
  const soldiers: MatchState['soldiers'] = [];
  const add = (playerId: string, p: { x: number; y: number }) => {
    soldiers.push({ id: soldiers.length, playerId, x: p.x, y: p.y, alive: true, angle: 0 });
    return soldiers.length - 1;
  };
  const meIds = [add(ME, def.shooter)];
  const enemyIds = def.enemies.map((e) => add(TARGETS, e));
  const allyIds = (def.allies ?? []).map((a) => add(ALLIES, a));
  const players = [makePlayer(ME, def.name ?? 'You', 1, meIds), makePlayer(TARGETS, 'Targets', 2, enemyIds)];
  if (allyIds.length) players.push(makePlayer(ALLIES, 'Friends', 1, allyIds));
  return {
    config: { kind: 'teams', mode: def.mode, soldiers: 1, seed: 0 },
    players,
    soldiers,
    circles: def.circles.map((c) => ({ ...c })),
    holes: [],
    turn: 0,
    turnNumber: 1,
    over: false,
    winner: null,
    log: [],
  };
}

/** Skips the players who never act, so it's the solo player's turn again. */
export function soloNext(state: MatchState): void {
  while (!state.over && currentPlayer(state).id !== ME) skipTurn(state);
}

export function soloCleared(state: MatchState): boolean {
  return state.soldiers.every((s) => s.playerId !== TARGETS || !s.alive);
}

export function soloHitFriend(state: MatchState): boolean {
  return state.soldiers.some((s) => s.playerId === ALLIES && !s.alive);
}

const DAILY_MODES: ShotMode[] = ['fn', 'fn', 'ode1', 'fn', 'fn', 'ode2', 'fn'];
export const DAILY_MAX_SHOTS = 10;

/** The same puzzle for everyone on a given UTC day. */
export function dailyPuzzle(day: number): SoloDef {
  const rng = new Rng(hashSeed(`mathbattles-daily-${day}`));
  const placed = placeSoldiers(rng, generateCircles(rng), [
    { side: 0 },
    { side: 1 },
    { side: 1 },
    { side: 1 },
  ]);
  return {
    mode: DAILY_MODES[day % DAILY_MODES.length]!,
    shooter: placed.spots[0]!,
    enemies: placed.spots.slice(1),
    circles: placed.circles,
  };
}

export interface DailyShot {
  expr: string;
  angle?: number;
}

export interface DailyScore {
  cleared: boolean;
  shots: number;
  chars: number;
  /** Lower is better. */
  score: number;
}

/** Replays submitted shots, so a leaderboard entry can't be faked. */
export function scoreDaily(day: number, shots: DailyShot[]): DailyScore {
  const state = createSolo(dailyPuzzle(day));
  let used = 0;
  let chars = 0;
  for (const s of shots.slice(0, DAILY_MAX_SHOTS)) {
    if (state.over) break;
    fire(state, ME, s);
    used++;
    chars += s.expr.replace(/\s/g, '').length;
    soloNext(state);
  }
  const cleared = soloCleared(state);
  return { cleared, shots: used, chars, score: used * 1000 + chars };
}
