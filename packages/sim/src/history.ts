import { encodeReplay, makeReplay } from './replay';
import type { MatchState, PlayerSetup, RoundRecord, ShotRecord, Soldier } from './rules';
import type { Circle } from './terrain';

/** All shots so far, round by round. */
export function shotsOf(state: MatchState): ShotRecord[] {
  const out: ShotRecord[] = [];
  for (const e of state.log) if (e.type === 'round') out.push(...e.round.shots);
  return out;
}

export interface BoardMoment {
  soldiers: Soldier[];
  holes: Circle[];
}

export interface RoundMoment {
  round: RoundRecord;
  /** The board as the round fired. */
  before: BoardMoment;
  /** The board once every shot landed. */
  after: BoardMoment;
}

/**
 * Rewinds a match to one round by undoing everything after it, working backward through the
 * log. Reads the match but never changes it, so looking back can't affect play.
 */
export function roundMoment(state: MatchState, roundIndex: number): RoundMoment | null {
  const soldiers = state.soldiers.map((s) => ({ ...s }));
  let holes = [...state.holes];
  let index = state.log.filter((e) => e.type === 'round').length;
  for (let i = state.log.length - 1; i >= 0; i--) {
    const e = state.log[i]!;
    if (e.type === 'leave') {
      for (const id of e.removed ?? []) if (soldiers[id]) soldiers[id]!.alive = true;
    } else {
      index--;
      const after: BoardMoment | null = index === roundIndex ? { soldiers: soldiers.map((s) => ({ ...s })), holes: [...holes] } : null;
      holes = holes.slice(0, holes.length - e.round.holes);
      for (const k of e.round.kills) if (soldiers[k.id]) soldiers[k.id]!.alive = true;
      for (const m of e.round.moves ?? []) {
        const s = soldiers[m.id];
        if (s) {
          s.x = m.from.x;
          s.y = m.from.y;
        }
      }
      if (after) return { round: e.round, before: { soldiers, holes }, after };
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
  /** A short replay id from the server, used to watch the match. */
  replayId?: string;
  /** A replay link's data, kept when there's no short id. Very long matches may not keep one. */
  replay?: string;
}

/** Replays longer than this aren't stored, to keep history small. */
export const MAX_STORED_REPLAY = 32_000;

/** Describes a finished match from one player's side. */
export function matchRecordFor(
  state: MatchState,
  setups: PlayerSetup[],
  playerId: string | null,
  meta: { id: string; at: number; kind: MatchKindLabel; ratingDelta?: number; replayId?: string },
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
  const replay = meta.replayId ? '' : encodeReplay(makeReplay(state, setups));
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
    ...(meta.replayId ? { replayId: meta.replayId } : replay.length <= MAX_STORED_REPLAY ? { replay } : {}),
  };
}
