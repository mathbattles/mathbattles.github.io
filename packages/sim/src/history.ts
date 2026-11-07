import { encodeReplay, makeReplay } from './replay';
import type { MatchState, PlayerSetup, ShotRecord, Soldier } from './rules';
import type { Circle } from './terrain';

/** All shots so far, in order. */
export function shotsOf(state: MatchState): ShotRecord[] {
  const out: ShotRecord[] = [];
  for (const e of state.log) if (e.type === 'shot') out.push(e.shot);
  return out;
}

export interface BoardMoment {
  soldiers: Soldier[];
  holes: Circle[];
}

export interface ShotMoment {
  shot: ShotRecord;
  /** The board as this shot was fired. */
  before: BoardMoment;
  /** The board once it landed. */
  after: BoardMoment;
}

/**
 * Rewinds a match to one shot by undoing everything after it, working backward through the
 * log. Reads the match but never changes it, so looking back can't affect play.
 */
export function shotMoment(state: MatchState, shotIndex: number): ShotMoment | null {
  const soldiers = state.soldiers.map((s) => ({ ...s }));
  const holes = [...state.holes];
  let index = shotsOf(state).length;
  for (let i = state.log.length - 1; i >= 0; i--) {
    const e = state.log[i]!;
    if (e.type === 'leave') {
      for (const id of e.removed ?? []) if (soldiers[id]) soldiers[id]!.alive = true;
    } else if (e.type === 'shot') {
      index--;
      const after: BoardMoment | null = index === shotIndex ? { soldiers: soldiers.map((s) => ({ ...s })), holes: [...holes] } : null;
      holes.pop();
      for (const h of e.shot.hits) if (soldiers[h.id]) soldiers[h.id]!.alive = true;
      if (after) return { shot: e.shot, before: { soldiers, holes }, after };
    }
  }
  return null;
}

export type MatchKindLabel = 'bots' | 'online' | 'ranked' | 'shared';
export type MatchResult = 'win' | 'loss' | 'draw' | 'none';

/** One row of a player's match history. */
export interface MatchRecord {
  id: string;
  at: number;
  kind: MatchKindLabel;
  mode: string;
  result: MatchResult;
  opponents: string[];
  kills: number;
  shots: number;
  ratingDelta?: number;
  /** A replay link's data, used to watch the match. Very long matches may not keep one. */
  replay?: string;
}

/** Replays longer than this aren't stored, to keep history small. */
export const MAX_STORED_REPLAY = 32_000;

/** Describes a finished match from one player's side. */
export function matchRecordFor(
  state: MatchState,
  setups: PlayerSetup[],
  playerId: string | null,
  meta: { id: string; at: number; kind: MatchKindLabel; ratingDelta?: number },
): MatchRecord {
  const me = playerId ? state.players.find((p) => p.id === playerId) : undefined;
  const teams = state.config.kind === 'teams';
  let result: MatchResult = 'none';
  if (me) {
    if (state.winner === null) result = 'draw';
    else result = (teams ? me.team === state.winner : me.id === state.winner) ? 'win' : 'loss';
  }
  const opponents = state.players
    .filter((p) => (me ? (teams ? p.team !== me.team : p.id !== me.id) : true))
    .map((p) => p.name);
  const replay = encodeReplay(makeReplay(state, setups));
  return {
    id: meta.id,
    at: meta.at,
    kind: meta.kind,
    mode: state.config.mode,
    result,
    opponents,
    kills: me?.kills ?? 0,
    shots: shotsOf(state).length,
    ...(meta.ratingDelta !== undefined ? { ratingDelta: meta.ratingDelta } : {}),
    ...(replay.length <= MAX_STORED_REPLAY ? { replay } : {}),
  };
}
