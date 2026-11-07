import { authState, subscribeAuth } from './auth';
import { pingSocial, type SocialState } from './net/api';

/**
 * Keeps friends, party and invites up to date while the game is open, and tells the server
 * which room this player is in so friends can join or watch.
 */
export const social: { state: SocialState | null; error: string } = { state: null, error: '' };
const listeners = new Set<() => void>();
let timer = 0;
let lastRoom: string | null | undefined;

export function subscribeSocial(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The room in the address bar, if this player is sitting in one. Watching doesn't count. */
export function currentRoom(): string | null {
  const m = location.hash.match(/^#\/(?:room|ranked)\/([A-Za-z0-9-]{4,24})/);
  return m ? m[1]!.toUpperCase() : null;
}

export async function refreshSocial(): Promise<void> {
  if (!authState.user || !authState.username || !authState.token) {
    if (social.state) {
      social.state = null;
      listeners.forEach((l) => l());
    }
    return;
  }
  const room = currentRoom();
  lastRoom = room;
  const r = await pingSocial(room);
  if (r.data) {
    social.state = r.data;
    social.error = '';
  } else {
    social.error = r.error ?? '';
  }
  listeners.forEach((l) => l());
}

const POLL_MS = 15_000;

export function initSocial(): void {
  const tick = () => {
    if (!document.hidden) void refreshSocial();
  };
  clearInterval(timer);
  timer = window.setInterval(tick, POLL_MS);
  // Moving into or out of a room tells friends right away.
  window.addEventListener('hashchange', () => {
    if (currentRoom() !== lastRoom) void refreshSocial();
  });
  document.addEventListener('visibilitychange', tick);
  // Only a change of account needs a fresh check; token refreshes don't.
  let who = '';
  subscribeAuth(() => {
    const next = `${authState.user?.uid ?? ''}|${authState.username ?? ''}|${authState.token ? 1 : 0}`;
    if (next === who) return;
    who = next;
    void refreshSocial();
  });
  void refreshSocial();
}
