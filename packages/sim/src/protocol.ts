import type { Dir, ShotMode } from './constants';
import type { AbilityId, MatchKind, MatchState, PlayerSetup, ShotRecord } from './rules';

export interface RoomSettings {
  kind: MatchKind;
  mode: ShotMode;
  abilities: boolean;
  soldiers: number;
  showFunctions: boolean;
}

export interface Seat {
  id: string;
  name: string;
  team: 1 | 2;
  ready: boolean;
  isBot: boolean;
  connected: boolean;
  ability?: AbilityId;
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
  | { t: 'join'; name: string; token: string; idToken?: string | null; ability?: AbilityId; hat?: string }
  | { t: 'leave' }
  | { t: 'settings'; settings: Partial<RoomSettings> }
  | { t: 'team'; team: 1 | 2 }
  | { t: 'ready'; ready: boolean }
  | { t: 'addBot'; level: string }
  | { t: 'removeSeat'; id: string }
  | { t: 'start' }
  | { t: 'fire'; expr: string; angle?: number; dir?: Dir }
  | { t: 'teleport'; x: number; y: number }
  | { t: 'missile' }
  | { t: 'skipVote' }
  | { t: 'chat'; text: string }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'welcome'; you: string; code: string }
  | { t: 'lobby'; host: string; seats: Seat[]; settings: RoomSettings; ranked: boolean; inMatch: boolean }
  | { t: 'match'; state: MatchState; setups: PlayerSetup[]; deadline: number; serverNow: number }
  | { t: 'shot'; shot: ShotRecord; state: MatchState; deadline: number; serverNow: number }
  | { t: 'update'; state: MatchState; deadline: number; serverNow: number }
  | { t: 'over'; state: MatchState; setups: PlayerSetup[]; ratingDelta?: number }
  /** The room can't be used. Clients should stop reconnecting and show this. */
  | { t: 'closed'; message: string }
  | { t: 'chat'; line: ChatLine }
  | { t: 'error'; message: string }
  | { t: 'pong' };

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  kind: 'teams',
  mode: 'fn',
  abilities: false,
  soldiers: 1,
  showFunctions: false,
};
