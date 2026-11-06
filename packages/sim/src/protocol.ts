import type { Dir, ShotMode } from './constants';
import type { AbilityId, MatchKind, MatchState, ShotRecord } from './rules';

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
  from: string;
  text: string;
  system?: boolean;
}

export type ClientMsg =
  | { t: 'join'; name: string; token: string; ability?: AbilityId; hat?: string }
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
  | { t: 'lobby'; host: string; seats: Seat[]; settings: RoomSettings; ranked: boolean }
  | { t: 'match'; state: MatchState; deadline: number; serverNow: number }
  | { t: 'shot'; shot: ShotRecord; state: MatchState; deadline: number; serverNow: number }
  | { t: 'update'; state: MatchState; deadline: number; serverNow: number }
  | { t: 'over'; state: MatchState; ratingDelta?: number }
  | { t: 'chat'; line: ChatLine }
  | { t: 'error'; message: string }
  | { t: 'pong' };

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  kind: 'teams',
  mode: 'fn',
  abilities: false,
  soldiers: 2,
  showFunctions: false,
};
