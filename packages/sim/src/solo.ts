import type { ShotMode } from './constants';
import { PALETTE } from './colors';
import type { MatchState, Player } from './rules';
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

function makePlayer(id: string, name: string, team: 1 | 2, soldierId: number, color: string, passive: boolean): Player {
  return {
    id, name, team, soldierId, color, ...(passive ? { passive: true } : {}),
    connected: true, locked: false, kills: 0, deaths: 0, shots: 0, bestCombo: 0,
  };
}

export function createSolo(def: SoloDef): MatchState {
  const soldiers: MatchState['soldiers'] = [];
  const add = (playerId: string, p: { x: number; y: number }) => {
    soldiers.push({ id: soldiers.length, playerId, x: p.x, y: p.y, alive: true, angle: 0 });
    return soldiers.length - 1;
  };
  // Targets and friends are many soldiers that never act. Each gets a silent owner, so the
  // one-soldier-per-player rule holds while the practice board stays the same.
  const players: Player[] = [makePlayer(ME, def.name ?? 'You', 1, add(ME, def.shooter), PALETTE[0].hex, false)];
  def.enemies.forEach((e, i) => {
    const id = i === 0 ? TARGETS : `${TARGETS}-${i}`;
    players.push(makePlayer(id, 'Target', 2, add(id, e), PALETTE[1].hex, true));
  });
  (def.allies ?? []).forEach((a, i) => {
    const id = i === 0 ? ALLIES : `${ALLIES}-${i}`;
    players.push(makePlayer(id, 'Friend', 1, add(id, a), PALETTE[2].hex, true));
  });
  return {
    config: { kind: 'teams', mode: def.mode, seed: 0 },
    players,
    soldiers,
    circles: def.circles.map((c) => ({ ...c })),
    holes: [],
    round: 1,
    over: false,
    winner: null,
    log: [],
  };
}

export const isTarget = (playerId: string) => playerId === TARGETS || playerId.startsWith(`${TARGETS}-`);
export const isAlly = (playerId: string) => playerId === ALLIES || playerId.startsWith(`${ALLIES}-`);

export function soloCleared(state: MatchState): boolean {
  return state.soldiers.every((s) => !isTarget(s.playerId) || !s.alive);
}

export function soloHitFriend(state: MatchState): boolean {
  return state.soldiers.some((s) => isAlly(s.playerId) && !s.alive);
}
