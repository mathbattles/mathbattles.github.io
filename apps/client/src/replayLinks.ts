import { encodeReplay, makeReplay, type MatchState, type PlayerSetup } from '@mathbattles/sim';
import { saveReplay } from './net/api';

const base = () => `${location.origin}${location.pathname}`;

/** A short replay link, optionally opening at a round. */
export function shortReplayUrl(id: string, round?: number): string {
  return `${base()}#/r/${id}${round ? `?r=${round}` : ''}`;
}

/** The long link that carries the whole replay, used when the server can't be reached. */
export function longReplayUrl(code: string, round?: number): string {
  return `${base()}#/replay/${code}${round ? `?r=${round}` : ''}`;
}

const ids = new Map<string, string>();

/** Saves a replay (once) and gives back its short id, or null when the server can't be reached. */
export async function replayId(code: string): Promise<string | null> {
  const known = ids.get(code);
  if (known) return known;
  const r = await saveReplay(code);
  if (!r?.id) return null;
  ids.set(code, r.id);
  return r.id;
}

export function replayCode(state: MatchState, setups: PlayerSetup[]): string {
  return encodeReplay(makeReplay(state, setups));
}

/** The best link for a replay: short if possible, otherwise the long one. */
export async function bestReplayLink(code: string, round?: number): Promise<{ url: string; short: boolean }> {
  const id = await replayId(code);
  return id ? { url: shortReplayUrl(id, round), short: true } : { url: longReplayUrl(code, round), short: false };
}

/** Copies text, falling back to a hidden text box where the clipboard API isn't allowed. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
