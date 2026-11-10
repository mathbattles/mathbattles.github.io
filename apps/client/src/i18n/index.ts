import { useEffect, useState } from 'preact/hooks';
import { en, type Dict, type Key } from './en';

export type { Key };
export type Lang = 'en' | 'es' | 'fr' | 'zh' | 'ko';

/** Each language is listed in its own name. */
export const LANGS: { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'es', name: 'Español' },
  { id: 'fr', name: 'Français' },
  { id: 'zh', name: '中文 (简体)' },
  { id: 'ko', name: '한국어' },
];

const loaders: Record<Exclude<Lang, 'en'>, () => Promise<{ default: Dict }>> = {
  es: () => import('./es'),
  fr: () => import('./fr'),
  zh: () => import('./zh'),
  ko: () => import('./ko'),
};

let lang: Lang = 'en';
let dict: Partial<Record<Key, string>> = {};
const listeners = new Set<() => void>();

export function currentLang(): Lang {
  return lang;
}

/** The browser's language, if it's one we have. */
export function browserLang(): Lang {
  const list = typeof navigator !== 'undefined' ? [...(navigator.languages ?? []), navigator.language] : [];
  for (const l of list) {
    const code = (l ?? '').toLowerCase().slice(0, 2);
    if (LANGS.some((x) => x.id === code)) return code as Lang;
  }
  return 'en';
}

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && LANGS.some((x) => x.id === v);
}

/**
 * Looks up a piece of text, filling {placeholders}. A key ending in _one is used for a
 * count of 1 when there is one. Missing text falls back to English.
 */
export function t(key: Key, vars?: Record<string, string | number>): string {
  let k: Key = key;
  if (vars && vars.count === 1) {
    const one = `${key}_one` as Key;
    if (one in en) k = one;
  }
  let text: string = dict[k] ?? en[k] ?? key;
  if (vars) text = text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
  return text;
}

/** Switches language. The page updates straight away, with no reload. */
export async function setLanguage(next: Lang): Promise<void> {
  if (next === 'en') dict = {};
  else {
    try {
      dict = (await loaders[next]()).default;
    } catch {
      dict = {};
      next = 'en';
    }
  }
  lang = next;
  try {
    document.documentElement.lang = next === 'zh' ? 'zh-Hans' : next;
    document.documentElement.classList.toggle('cjk', next === 'zh' || next === 'ko');
  } catch {
    /* no page here */
  }
  listeners.forEach((l) => l());
}

export function subscribeLang(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Re-renders a component when the language changes. */
export function useLang(): Lang {
  const [, force] = useState(0);
  useEffect(() => subscribeLang(() => force((n) => n + 1)), []);
  return lang;
}

const SERVER_TEXT: Record<string, Key> = {
  'A match is in progress in this room. Try again when it ends.': 'err.inProgress',
  'This room is full.': 'err.full',
  'You need at least 2 players. Invite someone or add a bot.': 'err.needTwo',
  'Each team needs at least one player.': 'err.teamNeedsPlayer',
  'The match is over': 'err.over',
  'Wait for the last round to finish': 'err.waitRound',
  'Type a function first': 'game.typeFirst',
  "You aren't playing in this match": 'err.notPlaying',
  'You were knocked out': 'err.knockedOut',
  'You are sending messages too quickly.': 'err.tooFast',
  'The host removed you from this room.': 'err.removed',
  'This ranked match is for two other players.': 'err.rankedOthers',
  "This ranked match was cancelled because a player didn't connect.": 'err.rankedCancelled',
  "Your opponent didn't connect, so the match was cancelled. Your rating didn't change.": 'err.noShow',
  'Too many people are watching this room right now.': 'err.tooManyWatching',
  'Sign in to play ranked.': 'err.signInRanked',
  'Reload the page and try again.': 'err.reload',
  'Connection lost. Reconnecting.': 'err.reconnecting',
  "Can't reach the game server. Check your connection and rejoin.": 'err.unreachable',
  "This room isn't available.": 'err.unavailable',
};

/** Shows a message from the game server in the chosen language, when it's one we know. */
export function serverText(message: string): string {
  const key = SERVER_TEXT[message];
  if (key) return t(key);
  const waiting = /^Waiting for (.+) to be ready\.$/.exec(message);
  if (waiting) return t('err.waitingReady', { names: waiting[1]! });
  return message;
}
