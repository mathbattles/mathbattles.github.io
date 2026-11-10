import type { Dir, ShotMode } from './constants';
import type { MapDef } from './maps';
import type { MatchKind, MatchState, PlayerSetup, RoundRecord } from './rules';

export interface RoomSettings {
  kind: MatchKind;
  mode: ShotMode;
  showFunctions: boolean;
  /** A player-made map for the next match, or none for a random one. */
  map?: MapDef | null;
}

export interface Seat {
  id: string;
  name: string;
  team: 1 | 2;
  ready: boolean;
  isBot: boolean;
  connected: boolean;
  hat?: string;
}

export interface ChatLine {
  /** Seat id, so muting hides one person even if names match. */
  fromId?: string;
  from: string;
  text: string;
  system?: boolean;
}

export type ClientMsg =
  | { t: 'join'; name: string; token: string; idToken?: string | null; hat?: string; spectate?: boolean }
  | { t: 'leave' }
  | { t: 'settings'; settings: Partial<RoomSettings> }
  | { t: 'team'; team: 1 | 2 }
  | { t: 'ready'; ready: boolean }
  | { t: 'addBot'; level: string }
  | { t: 'removeSeat'; id: string }
  | { t: 'start' }
  /** What you've typed so far. Kept secret, and fired if the round ends before you lock in. */
  | { t: 'draft'; expr: string; angle?: number; dir?: Dir }
  | { t: 'lock'; expr: string; angle?: number; dir?: Dir }
  | { t: 'unlock' }
  | { t: 'skipVote' }
  | { t: 'chat'; text: string }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'welcome'; you: string; code: string }
  | { t: 'lobby'; host: string; seats: Seat[]; settings: RoomSettings; ranked: boolean; inMatch: boolean; spectators: number }
  /** A match started, or you rejoined one. Your own draft comes back so a reconnect keeps it. */
  | { t: 'match'; state: MatchState; setups: PlayerSetup[]; deadline: number; serverNow: number; draft?: Draft | null }
  /** Every shot of a round fired. The deadline is when the next round ends. */
  | { t: 'round'; round: RoundRecord; state: MatchState; deadline: number; serverNow: number }
  /** Someone locked, unlocked, left, or reconnected. */
  | { t: 'update'; state: MatchState; deadline: number; serverNow: number }
  | { t: 'over'; state: MatchState; setups: PlayerSetup[]; ratingDelta?: number; replayId?: string }
  /** The room can't be used. Clients should stop reconnecting and show this. */
  | { t: 'closed'; message: string }
  | { t: 'chat'; line: ChatLine }
  | { t: 'error'; message: string }
  | { t: 'pong' };

export interface Draft {
  expr: string;
  angle?: number;
  dir?: Dir;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  kind: 'teams',
  mode: 'fn',
  showFunctions: false,
};
