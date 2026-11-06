/** Progression is cosmetic only: nothing here changes what a player can do in a match. */

export interface MatchSummary {
  won: boolean;
  kills: number;
  bestCombo: number;
  online: boolean;
  firstWinToday: boolean;
}

export const SPARKS = { win: 30, loss: 10, kill: 5, multiKill: 10, firstWin: 50, campaignStar: 15 } as const;
export const XP = { win: 60, loss: 25, kill: 10 } as const;

export function xpToNext(level: number): number {
  return 100 + 25 * level;
}

export function levelFromXp(totalXp: number): { level: number; into: number; need: number } {
  let level = 1;
  let left = Math.max(0, Math.floor(totalXp));
  while (left >= xpToNext(level)) {
    left -= xpToNext(level);
    level++;
  }
  return { level, into: left, need: xpToNext(level) };
}

export function rewardsFor(m: MatchSummary): { xp: number; sparks: number } {
  let sparks = m.won ? SPARKS.win : SPARKS.loss;
  sparks += m.kills * SPARKS.kill;
  if (m.bestCombo >= 2) sparks += SPARKS.multiKill;
  if (m.won && m.firstWinToday) sparks += SPARKS.firstWin;
  const xp = (m.won ? XP.win : XP.loss) + m.kills * XP.kill;
  return { xp, sparks };
}

export const RANKS = [
  { name: 'Arithmetic', min: 0 },
  { name: 'Algebra', min: 900 },
  { name: 'Geometry', min: 1050 },
  { name: 'Trigonometry', min: 1200 },
  { name: 'Precalculus', min: 1350 },
  { name: 'Calculus', min: 1500 },
  { name: 'Analysis', min: 1700 },
  { name: 'Fields Medalist', min: 1900 },
] as const;

export const RANKED_UNLOCK_LEVEL = 5;
export const START_RATING = 1000;

export function rankFor(rating: number): string {
  let name: string = RANKS[0].name;
  for (const r of RANKS) if (rating >= r.min) name = r.name;
  return name;
}

/** Elo for a 1v1 result. Returns the winner's gain, which equals the loser's loss. */
export function eloDelta(winner: number, loser: number, k = 32): number {
  const expected = 1 / (1 + 10 ** ((loser - winner) / 400));
  return Math.round(k * (1 - expected));
}

/** Soft reset between seasons pulls ratings halfway back toward the start value. */
export function seasonReset(rating: number): number {
  return Math.round((rating + START_RATING) / 2);
}

export type CosmeticKind = 'hat' | 'trail' | 'title' | 'blast';

export interface Cosmetic {
  id: string;
  kind: CosmeticKind;
  name: string;
  cost: number;
  /** Non-empty when earned rather than bought. */
  earn?: string;
  value: string;
}

export const COSMETICS: Cosmetic[] = [
  { id: 'hat-none', kind: 'hat', name: 'No hat', cost: 0, value: 'none' },
  { id: 'hat-cap', kind: 'hat', name: 'Grad cap', cost: 0, earn: 'first-bot-win', value: 'cap' },
  { id: 'hat-party', kind: 'hat', name: 'Party cone', cost: 150, value: 'cone' },
  { id: 'hat-crown', kind: 'hat', name: 'Crown', cost: 600, value: 'crown' },
  { id: 'hat-wizard', kind: 'hat', name: 'Wizard hat', cost: 400, value: 'wizard' },
  { id: 'hat-halo', kind: 'hat', name: 'Unit circle halo', cost: 900, value: 'halo' },
  { id: 'trail-ink', kind: 'trail', name: 'Ink', cost: 0, value: 'ink' },
  { id: 'trail-dash', kind: 'trail', name: 'Dashed', cost: 100, value: 'dash' },
  { id: 'trail-thick', kind: 'trail', name: 'Marker', cost: 200, value: 'thick' },
  { id: 'trail-rainbow', kind: 'trail', name: 'Spectrum', cost: 700, value: 'rainbow' },
  { id: 'trail-ghost', kind: 'trail', name: 'Ghost', cost: 300, value: 'ghost' },
  { id: 'title-none', kind: 'title', name: 'No title', cost: 0, value: '' },
  { id: 'title-student', kind: 'title', name: 'The Student', cost: 50, value: 'The Student' },
  { id: 'title-tangent', kind: 'title', name: 'Off on a Tangent', cost: 250, value: 'Off on a Tangent' },
  { id: 'title-asymptote', kind: 'title', name: 'The Asymptote', cost: 400, value: 'The Asymptote' },
  { id: 'title-qed', kind: 'title', name: 'Q.E.D.', cost: 0, earn: 'campaign-complete', value: 'Q.E.D.' },
  { id: 'title-triple', kind: 'title', name: 'Triple Integral', cost: 0, earn: 'triple-kill', value: 'Triple Integral' },
  { id: 'blast-ring', kind: 'blast', name: 'Ring', cost: 0, value: 'ring' },
  { id: 'blast-star', kind: 'blast', name: 'Star burst', cost: 250, value: 'star' },
  { id: 'blast-sum', kind: 'blast', name: 'Sigma pop', cost: 500, value: 'sigma' },
];

export interface Achievement {
  id: string;
  name: string;
  detail: string;
  reward: number;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-bot-win', name: 'Proof of Concept', detail: 'Beat a bot', reward: 25 },
  { id: 'first-online-win', name: 'Peer Reviewed', detail: 'Win an online match', reward: 50 },
  { id: 'double-kill', name: 'Two Roots', detail: 'Hit 2 enemies with one shot', reward: 40 },
  { id: 'triple-kill', name: 'Cubic', detail: 'Hit 3 enemies with one shot', reward: 100 },
  { id: 'sine-only', name: 'Wave Rider', detail: 'Land a kill using only sin', reward: 40 },
  { id: 'ode1-kill', name: 'First Order', detail: "Land a kill in y' mode", reward: 40 },
  { id: 'ode2-kill', name: 'Second Order', detail: "Land a kill in y'' mode", reward: 60 },
  { id: 'genius-win', name: 'Beyond Genius', detail: 'Beat a Genius bot', reward: 150 },
  { id: 'campaign-complete', name: 'Q.E.D.', detail: 'Finish the campaign', reward: 200 },
  { id: 'daily-3', name: 'Habit Forming', detail: 'Finish 3 Daily Challenges', reward: 60 },
];

export interface QuestDef {
  id: string;
  text: string;
  goal: number;
  reward: number;
  weekly?: boolean;
  metric: 'kills' | 'wins' | 'matches' | 'stars' | 'multi';
}

const DAILY_POOL: QuestDef[] = [
  { id: 'd-kills', text: 'Hit 5 enemies', goal: 5, reward: 30, metric: 'kills' },
  { id: 'd-wins', text: 'Win 2 matches', goal: 2, reward: 40, metric: 'wins' },
  { id: 'd-matches', text: 'Play 3 matches', goal: 3, reward: 25, metric: 'matches' },
  { id: 'd-stars', text: 'Earn 3 campaign stars', goal: 3, reward: 30, metric: 'stars' },
  { id: 'd-multi', text: 'Hit 2 enemies with one shot', goal: 1, reward: 50, metric: 'multi' },
];
const WEEKLY: QuestDef = { id: 'w-wins', text: 'Win 10 matches this week', goal: 10, reward: 200, weekly: true, metric: 'wins' };

/** Three daily quests chosen from the UTC date, and one weekly. */
export function questsFor(dayNumber: number): QuestDef[] {
  const start = dayNumber % DAILY_POOL.length;
  return [0, 1, 2].map((i) => DAILY_POOL[(start + i) % DAILY_POOL.length]!).concat(WEEKLY);
}

export function utcDayNumber(now: number): number {
  return Math.floor(now / 86_400_000);
}
