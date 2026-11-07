/** Combines two copies of the same player's progress without losing anything from either. */

export interface Mergeable {
  xp: number;
  sparks: number;
  matches: number;
  wins: number;
  kills: number;
  bestCombo: number;
  dailiesDone: number;
  lastWinDay: number;
  questDay: number;
  questWeek: number;
  owned: string[];
  achievements: string[];
  questsPaid: string[];
  learnDone: string[];
  seasonXp: number;
  seasonPaid: number[];
  stars: Record<string, number>;
  mastery: Record<string, number>;
  questProgress: Record<string, number>;
  daily: Record<string, { score: number; shots: number; chars: number }>;
  updatedAt: number;
}

const NUMBERS = ['xp', 'sparks', 'matches', 'wins', 'kills', 'bestCombo', 'dailiesDone', 'lastWinDay', 'questDay', 'questWeek', 'seasonXp'] as const;
const LISTS = ['owned', 'achievements', 'questsPaid', 'learnDone'] as const;
const NUMBER_LISTS = ['seasonPaid'] as const;
const HIGHEST = ['stars', 'mastery', 'questProgress'] as const;

/**
 * Everything earned is kept: the higher number, every list item, the best score.
 * Choices such as equipped items and settings come from whichever copy is newer.
 */
export function mergeProgress<T extends Mergeable>(a: T, b: Partial<T>): T {
  const bNewer = (b.updatedAt ?? 0) > a.updatedAt;
  const out: T = bNewer ? { ...a, ...b } : { ...b, ...a };
  for (const k of NUMBERS) (out as Mergeable)[k] = Math.max(num(a[k]), num(b[k]));
  for (const k of LISTS) (out as Mergeable)[k] = [...new Set([...(a[k] ?? []), ...((b[k] as string[] | undefined) ?? [])])];
  for (const k of NUMBER_LISTS) (out as Mergeable)[k] = [...new Set([...(a[k] ?? []), ...((b[k] as number[] | undefined) ?? [])])];
  for (const k of HIGHEST) {
    const merged: Record<string, number> = { ...(a[k] ?? {}) };
    for (const [key, v] of Object.entries((b[k] as Record<string, number> | undefined) ?? {})) merged[key] = Math.max(num(merged[key]), num(v));
    (out as Mergeable)[k] = merged;
  }
  const daily = { ...(a.daily ?? {}) };
  for (const [day, score] of Object.entries(b.daily ?? {})) {
    const mine = daily[day];
    if (!mine || score.score < mine.score) daily[day] = score;
  }
  out.daily = daily;
  out.updatedAt = Math.max(a.updatedAt, num(b.updatedAt));
  return out;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
