import type { DailyShot } from '@mathbattles/sim';

/** Set after the server is first deployed. */
const PROD_SERVER = 'https://mathbattles-server.mathbattles.workers.dev';

export const SERVER_URL: string = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? PROD_SERVER;
export const WS_URL = SERVER_URL.replace(/^http/, 'ws');

export interface DailyEntry {
  name: string;
  shots: number;
  chars: number;
}
export interface LeaderRow {
  name: string;
  rating: number;
}
export interface RoomInfo {
  code: string;
  players: number;
  kind: string;
  mode: string;
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
export function fetchDaily(day: number) {
  return call<DailyEntry[]>(`/api/daily/${day}`);
}
export async function submitDaily(day: number, shots: DailyShot[]): Promise<{ board?: DailyEntry[]; error?: string }> {
  const { profile } = await import('../store');
  const { authState } = await import('../auth');
  try {
    const res = await fetch(`${SERVER_URL}/api/daily/${day}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(authState.token ? { authorization: `Bearer ${authState.token}` } : {}) },
      body: JSON.stringify({ name: profile.name, guest: profile.guestToken, shots }),
    });
    const body = (await res.json()) as { board?: DailyEntry[]; error?: string };
    return res.ok ? { board: body.board } : { error: body.error ?? "The score wasn't accepted." };
  } catch {
    return { error: 'The leaderboard is offline, so this score is saved on this device only.' };
  }
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
