import type { MatchConfig, MatchEvent, MatchState, PlayerSetup } from './rules';
import { armMissile, createMatch, fire, removePlayer, skipTurn, useTeleport } from './rules';

/**
 * A replay is the match's seed, setup, and actions. It's small enough to fit in a
 * link and rebuilds the whole match through the normal rules.
 */
export interface Replay {
  v: 1;
  config: MatchConfig;
  setups: PlayerSetup[];
  actions: ReplayAction[];
}

export type ReplayAction =
  | { a: 'f'; p: string; e: string; g?: number; d?: 1 | -1 }
  | { a: 't'; p: string; x: number; y: number }
  | { a: 'm'; p: string }
  | { a: 's' }
  | { a: 'l'; p: string };

export function makeReplay(state: MatchState, setups: PlayerSetup[]): Replay {
  return { v: 1, config: state.config, setups, actions: state.log.map(toAction) };
}

function toAction(e: MatchEvent): ReplayAction {
  switch (e.type) {
    case 'shot':
      return {
        a: 'f',
        p: e.shot.playerId,
        e: e.shot.expr,
        ...(e.shot.mode === 'ode2' ? { g: e.shot.angle } : {}),
        ...(e.shot.dir === -1 ? { d: -1 as const } : {}),
      };
    case 'teleport':
      return { a: 't', p: e.playerId, x: e.x, y: e.y };
    case 'missile':
      return { a: 'm', p: e.playerId };
    case 'timeout':
      return { a: 's' };
    case 'leave':
      return { a: 'l', p: e.playerId };
  }
}

export function applyAction(state: MatchState, action: ReplayAction): void {
  switch (action.a) {
    case 'f':
      fire(state, action.p, { expr: action.e, angle: action.g, dir: action.d });
      return;
    case 't':
      useTeleport(state, action.p, action.x, action.y);
      return;
    case 'm':
      armMissile(state, action.p);
      return;
    case 's':
      skipTurn(state);
      return;
    case 'l':
      removePlayer(state, action.p);
  }
}

export function replayStart(replay: Replay): MatchState {
  return createMatch(replay.config, replay.setups);
}

export function encodeReplay(replay: Replay): string {
  const bytes = new TextEncoder().encode(JSON.stringify(replay));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeReplay(text: string): Replay | null {
  try {
    const bin = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const r = JSON.parse(new TextDecoder().decode(bytes)) as Replay;
    if (r.v !== 1 || !r.config || !Array.isArray(r.setups) || !Array.isArray(r.actions)) return null;
    return r;
  } catch {
    return null;
  }
}
