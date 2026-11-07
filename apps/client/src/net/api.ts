import type { MapDef, MatchRecord } from '@mathbattles/sim';

/** Set after the server is first deployed. */
const PROD_SERVER = 'https://mathbattles-server.mathbattles.workers.dev';

export const SERVER_URL: string = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? PROD_SERVER;
export const WS_URL = SERVER_URL.replace(/^http/, 'ws');

export interface LeaderRow {
  name: string;
  rating: number;
}
export interface RoomInfo {
  code: string;
  players: number;
  kind: string;
  mode: string;
  /** 1 while waiting in the lobby, 0 during a match. */
  inLobby: number;
}

async function call<T>(path: string, init?: RequestInit, token?: string | null): Promise<T | null> {
  try {
    const res = await fetch(`${SERVER_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function serverReachable(): Promise<boolean> {
  return (await call<{ ok: boolean }>('/api/health'))?.ok === true;
}
export function listRooms() {
  return call<RoomInfo[]>('/api/rooms');
}
export function createRoom(isPublic: boolean) {
  return call<{ code: string }>('/api/rooms', { method: 'POST', body: JSON.stringify({ public: isPublic }) });
}
export function fetchLeaderboard() {
  return call<LeaderRow[]>('/api/leaderboard');
}
export function pullProfile(token: string) {
  return call<{ profile: unknown; rating: number; username: string | null }>('/api/profile', undefined, token);
}
export function pushProfile(token: string, profile: unknown) {
  return call('/api/profile', { method: 'PUT', body: JSON.stringify(profile) }, token);
}
export function reportChat(code: string, reported: string, text: string) {
  return call('/api/report', { method: 'POST', body: JSON.stringify({ code, reported, text }) });
}

export function usernameAvailable(name: string) {
  return call<{ available: boolean; problem: string | null }>(`/api/account/available/${encodeURIComponent(name)}`);
}
export async function claimUsername(token: string, username: string): Promise<{ username?: string; error?: string }> {
  try {
    const res = await fetch(`${SERVER_URL}/api/account/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ username }),
    });
    return (await res.json()) as { username?: string; error?: string };
  } catch {
    return { error: "The game server isn't reachable. Try again soon." };
  }
}
/** Tells the server the verified email on the login token, so username sign-in keeps working. */
export function syncEmail(token: string) {
  return call<{ ok: boolean }>('/api/account/sync-email', { method: 'POST', body: '{}' }, token);
}
export async function resolveLogin(username: string, password: string): Promise<{ email?: string; error?: string }> {
  try {
    const res = await fetch(`${SERVER_URL}/api/auth/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return (await res.json()) as { email?: string; error?: string };
  } catch {
    return { error: "The game server isn't reachable. Try again soon." };
  }
}
export function deleteAccountData(token: string) {
  return call<{ ok: boolean }>('/api/account', { method: 'DELETE' }, token);
}

export interface PlayerPage {
  name: string;
  rating: number;
  games: number;
  matches: MatchRecord[];
}
export function fetchHistory(token: string) {
  return call<MatchRecord[]>('/api/history', undefined, token);
}
export function uploadHistory(token: string, record: MatchRecord) {
  return call<{ ok: boolean }>('/api/history', { method: 'POST', body: JSON.stringify(record) }, token);
}
export function fetchPlayer(name: string) {
  return call<PlayerPage>(`/api/player/${encodeURIComponent(name)}`);
}

/** Sends a request with the signed-in player's token, and returns the server's answer or its error. */
async function authed<T>(path: string, init?: RequestInit): Promise<{ data?: T; error?: string }> {
  const { authState } = await import('../auth');
  if (!authState.token) return { error: 'Sign in to an account to use this.' };
  try {
    const res = await fetch(`${SERVER_URL}${path}`, {
      ...init,
      headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), authorization: `Bearer ${authState.token}` },
    });
    const body = (await res.json()) as T & { error?: string };
    return res.ok ? { data: body } : { error: body.error ?? 'Something went wrong. Try again.' };
  } catch {
    return { error: "The game server isn't reachable. Try again soon." };
  }
}
const post = <T>(path: string, data: unknown) => authed<T>(path, { method: 'POST', body: JSON.stringify(data) });

export interface FriendInfo {
  name: string;
  online: boolean;
  room: string | null;
  inMatch: boolean;
}
export interface SocialState {
  me: string | null;
  friends: FriendInfo[];
  incoming: string[];
  outgoing: string[];
  party: { id: string; leader: string; isLeader: boolean; members: { name: string; online: boolean; leader: boolean }[]; room: string | null } | null;
  invites: { id: number; from: string; kind: 'room' | 'party'; target: string }[];
}
/** Says which room this player is in, and gets friends, party and invites back. */
export const pingSocial = (room: string | null) => post<SocialState>('/api/social', { room });
export const friendAction = (action: 'request' | 'accept' | 'decline' | 'cancel' | 'remove', name: string) => post<{ ok: boolean; message?: string }>('/api/friends', { action, name });
export const inviteToRoom = (name: string, room: string) => post<{ ok: boolean; message?: string }>('/api/invites', { action: 'room', name, room });
export const dismissInvite = (id: number) => post<{ ok: boolean }>('/api/invites', { action: 'dismiss', id });
export const partyAction = (action: 'create' | 'invite' | 'join' | 'leave' | 'kick', extra: { name?: string; id?: string } = {}) =>
  post<{ ok: boolean; message?: string }>('/api/party', { action, ...extra });

export interface SharedMap {
  code: string;
  name: string;
  author: string;
  plays: number;
  at?: number;
  map: MapDef;
}
export const listMaps = (sort: 'new' | 'popular') => call<SharedMap[]>(`/api/maps?sort=${sort}`);
export const myMaps = () => authed<SharedMap[]>('/api/maps?mine=1');
export const fetchMap = (code: string) => call<SharedMap>(`/api/maps/${encodeURIComponent(code)}`);
export const publishMap = (map: MapDef) => post<{ code: string }>('/api/maps', { map });
export const deleteSharedMap = (code: string) => authed<{ ok: boolean }>(`/api/maps/${encodeURIComponent(code)}`, { method: 'DELETE' });
export const countMapPlay = (code: string) => call(`/api/maps/${encodeURIComponent(code)}/play`, { method: 'POST', body: '{}' });

export const cosmeticCounts = () => call<{ players: number; counts: Record<string, number> }>('/api/cosmetics');
export const myRanked = () => authed<{ rating: number; games: number; place: number | null; total: number; season: number }>('/api/ranked');

export interface AdminData {
  stats: Record<string, number>;
  reports: { id: number; code: string; reported: string; text: string; created_at: number }[];
}
export const adminData = () => authed<AdminData>('/api/admin');
export const adminDeleteReport = (id: number) => authed<{ ok: boolean }>(`/api/admin/reports/${id}`, { method: 'DELETE' });
