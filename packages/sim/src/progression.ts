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

export type CosmeticKind = 'hat' | 'trail' | 'title' | 'blast' | 'obstacle';

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
  { id: 'hat-leaf', kind: 'hat', name: 'Sprout', cost: 100, value: 'leaf' },
  { id: 'hat-bow', kind: 'hat', name: 'Bow', cost: 120, value: 'bow' },
  { id: 'hat-propeller', kind: 'hat', name: 'Propeller cap', cost: 250, value: 'propeller' },
  { id: 'hat-headphones', kind: 'hat', name: 'Headphones', cost: 300, value: 'headphones' },
  { id: 'hat-santa', kind: 'hat', name: 'Winter hat', cost: 300, value: 'santa' },
  { id: 'hat-top', kind: 'hat', name: 'Top hat', cost: 350, value: 'top' },
  { id: 'hat-pirate', kind: 'hat', name: 'Pirate hat', cost: 450, value: 'pirate' },
  { id: 'hat-viking', kind: 'hat', name: 'Horned helmet', cost: 500, value: 'viking' },
  { id: 'trail-ink', kind: 'trail', name: 'Ink', cost: 0, value: 'ink' },
  { id: 'trail-dash', kind: 'trail', name: 'Dashed', cost: 100, value: 'dash' },
  { id: 'trail-thick', kind: 'trail', name: 'Marker', cost: 200, value: 'thick' },
  { id: 'trail-rainbow', kind: 'trail', name: 'Spectrum', cost: 700, value: 'rainbow' },
  { id: 'trail-ghost', kind: 'trail', name: 'Ghost', cost: 300, value: 'ghost' },
  { id: 'trail-dots', kind: 'trail', name: 'Dotted', cost: 150, value: 'dots' },
  { id: 'trail-double', kind: 'trail', name: 'Racing stripe', cost: 350, value: 'double' },
  { id: 'trail-neon', kind: 'trail', name: 'Neon', cost: 500, value: 'neon' },
  { id: 'title-none', kind: 'title', name: 'No title', cost: 0, value: '' },
  { id: 'title-student', kind: 'title', name: 'The Student', cost: 50, value: 'The Student' },
  { id: 'title-tangent', kind: 'title', name: 'Off on a Tangent', cost: 250, value: 'Off on a Tangent' },
  { id: 'title-asymptote', kind: 'title', name: 'The Asymptote', cost: 400, value: 'The Asymptote' },
  { id: 'title-qed', kind: 'title', name: 'Q.E.D.', cost: 0, earn: 'campaign-complete', value: 'Q.E.D.' },
  { id: 'title-triple', kind: 'title', name: 'Triple Integral', cost: 0, earn: 'triple-kill', value: 'Triple Integral' },
  { id: 'title-sincity', kind: 'title', name: 'Sin City', cost: 200, value: 'Sin City' },
  { id: 'title-integrator', kind: 'title', name: 'The Integrator', cost: 300, value: 'The Integrator' },
  { id: 'title-prime', kind: 'title', name: 'Prime Suspect', cost: 350, value: 'Prime Suspect' },
  { id: 'title-limit', kind: 'title', name: 'Knows No Limit', cost: 450, value: 'Knows No Limit' },
  { id: 'blast-ring', kind: 'blast', name: 'Ring', cost: 0, value: 'ring' },
  { id: 'blast-star', kind: 'blast', name: 'Star burst', cost: 250, value: 'star' },
  { id: 'blast-sum', kind: 'blast', name: 'Sigma pop', cost: 500, value: 'sigma' },
  { id: 'blast-heart', kind: 'blast', name: 'Heart pop', cost: 300, value: 'heart' },
  { id: 'blast-shock', kind: 'blast', name: 'Shockwave', cost: 350, value: 'shock' },
  { id: 'blast-pi', kind: 'blast', name: 'Pi pop', cost: 400, value: 'pi' },
  { id: 'obstacle-candy', kind: 'obstacle', name: 'Candy', cost: 0, value: 'candy' },
  { id: 'obstacle-moon', kind: 'obstacle', name: 'Moons', cost: 250, value: 'moon' },
  { id: 'obstacle-bw', kind: 'obstacle', name: 'Black and white', cost: 300, value: 'bw' },
  { id: 'obstacle-cookies', kind: 'obstacle', name: 'Cookies', cost: 350, value: 'cookies' },
  { id: 'obstacle-fruit', kind: 'obstacle', name: 'Fruit slices', cost: 400, value: 'fruit' },
  { id: 'obstacle-pool', kind: 'obstacle', name: 'Pool balls', cost: 450, value: 'pool' },
  { id: 'obstacle-planets', kind: 'obstacle', name: 'Planets', cost: 600, value: 'planets' },
  { id: 'obstacle-neon', kind: 'obstacle', name: 'Neon', cost: 650, value: 'neon' },
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

/** Returns what's wrong with a username, or null if it's fine. */
export function usernameProblem(name: string): string | null {
  if (name.length < 3) return 'Usernames need at least 3 characters';
  if (name.length > 16) return 'Usernames can have at most 16 characters';
  if (!/^[A-Za-z0-9_]+$/.test(name)) return 'Use only letters, numbers, and underscores';
  return null;
}

export const MIN_PASSWORD = 8;

/** The private login address behind a username. It never receives mail. */
export function loginEmailFor(username: string): string {
  return `${username.toLowerCase()}@users.mathbattles.invalid`;
}
