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
  { name: 'Algebra', min: 150 },
  { name: 'Geometry', min: 200 },
  { name: 'Calculus', min: 300 },
  { name: 'Analysis', min: 400 },
  { name: 'Medalist', min: 500 },
] as const;

/** Everyone starts here, in Arithmetic. */
export const START_RATING = 100;
/** The first few ranked matches move a rating twice as fast, so players find their level quickly. */
export const PLACEMENT_MATCHES = 3;

/** The next tier up from a rating, and how far along the way there you are (0 to 1). */
export function rankProgress(rating: number): { rank: string; next: string | null; into: number; need: number } {
  let i = 0;
  RANKS.forEach((r, k) => {
    if (rating >= r.min) i = k;
  });
  const cur = RANKS[i]!;
  const next = RANKS[i + 1];
  return { rank: cur.name, next: next?.name ?? null, into: Math.max(0, rating - cur.min), need: next ? next.min - cur.min : 0 };
}

export function rankFor(rating: number): string {
  let name: string = RANKS[0].name;
  for (const r of RANKS) if (rating >= r.min) name = r.name;
  return name;
}

/** How much a match counts: double during placement matches. */
export function eloK(gamesPlayed: number): number {
  return gamesPlayed < PLACEMENT_MATCHES ? 64 : 32;
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
  /** Unlocked by reaching this level of a season pass, never sold. */
  season?: { id: number; level: number };
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
  { id: 'title-survivor', kind: 'title', name: 'Survivor', cost: 0, earn: 'brink-of-death', value: 'Survivor' },
  { id: 'title-hopper', kind: 'title', name: 'Hopper', cost: 0, earn: 'leap-of-faith', value: 'Hopper' },
  { id: 'title-trickshot', kind: 'title', name: 'Trick Shot', cost: 0, earn: 'bank-shot', value: 'Trick Shot' },
  { id: 'trail-magma', kind: 'trail', name: 'Magma', cost: 0, earn: 'crater-maker', value: 'magma' },
  { id: 'title-untouchable', kind: 'title', name: 'Untouchable', cost: 0, earn: 'clean-cut', value: 'Untouchable' },
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
  // Season 0 pass rewards.
  { id: 'title-season0', kind: 'title', name: 'Season Zero', cost: 0, season: { id: 0, level: 1 }, value: 'Season Zero' },
  { id: 'obstacle-snowballs', kind: 'obstacle', name: 'Snowballs', cost: 0, season: { id: 0, level: 2 }, value: 'snowballs' },
  { id: 'trail-candycane', kind: 'trail', name: 'Candy cane', cost: 0, season: { id: 0, level: 4 }, value: 'candycane' },
  { id: 'title-snowplotter', kind: 'title', name: 'Snow Plotter', cost: 0, season: { id: 0, level: 5 }, value: 'Snow Plotter' },
  { id: 'hat-beanie', kind: 'hat', name: 'Knit beanie', cost: 0, season: { id: 0, level: 7 }, value: 'beanie' },
  { id: 'blast-snowflake', kind: 'blast', name: 'Snowflake', cost: 0, season: { id: 0, level: 8 }, value: 'snowflake' },
  { id: 'title-rootfinder', kind: 'title', name: 'Root Finder', cost: 0, season: { id: 0, level: 10 }, value: 'Root Finder' },
  { id: 'hat-earmuffs', kind: 'hat', name: 'Earmuffs', cost: 0, season: { id: 0, level: 11 }, value: 'earmuffs' },
  { id: 'trail-frost', kind: 'trail', name: 'Frost', cost: 0, season: { id: 0, level: 13 }, value: 'frost' },
  { id: 'title-derivative', kind: 'title', name: 'The Derivative', cost: 0, season: { id: 0, level: 14 }, value: 'The Derivative' },
  { id: 'obstacle-ornaments', kind: 'obstacle', name: 'Ornaments', cost: 0, season: { id: 0, level: 16 }, value: 'ornaments' },
  { id: 'blast-confetti', kind: 'blast', name: 'Confetti', cost: 0, season: { id: 0, level: 17 }, value: 'confetti' },
  { id: 'title-wavemaker', kind: 'title', name: 'Wave Maker', cost: 0, season: { id: 0, level: 19 }, value: 'Wave Maker' },
  { id: 'hat-elf', kind: 'hat', name: 'Elf hat', cost: 0, season: { id: 0, level: 20 }, value: 'elf' },
  { id: 'trail-lights', kind: 'trail', name: 'String lights', cost: 0, season: { id: 0, level: 22 }, value: 'lights' },
  { id: 'title-parabolapro', kind: 'title', name: 'Parabola Pro', cost: 0, season: { id: 0, level: 23 }, value: 'Parabola Pro' },
  { id: 'blast-sqrt', kind: 'blast', name: 'Root pop', cost: 0, season: { id: 0, level: 25 }, value: 'sqrt' },
  { id: 'obstacle-gifts', kind: 'obstacle', name: 'Gift boxes', cost: 0, season: { id: 0, level: 26 }, value: 'gifts' },
  { id: 'title-graphgoblin', kind: 'title', name: 'Graph Goblin', cost: 0, season: { id: 0, level: 28 }, value: 'Graph Goblin' },
  { id: 'hat-chef', kind: 'hat', name: 'Chef hat', cost: 0, season: { id: 0, level: 29 }, value: 'chef' },
  { id: 'trail-sparkle', kind: 'trail', name: 'Sparkle', cost: 0, season: { id: 0, level: 31 }, value: 'sparkle' },
  { id: 'title-constant', kind: 'title', name: 'The Constant', cost: 0, season: { id: 0, level: 32 }, value: 'The Constant' },
  { id: 'blast-gift', kind: 'blast', name: 'Gift burst', cost: 0, season: { id: 0, level: 34 }, value: 'gift' },
  { id: 'title-curvecrusher', kind: 'title', name: 'Curve Crusher', cost: 0, season: { id: 0, level: 35 }, value: 'Curve Crusher' },
  { id: 'hat-reindeer', kind: 'hat', name: 'Antlers', cost: 0, season: { id: 0, level: 37 }, value: 'reindeer' },
  { id: 'obstacle-donuts', kind: 'obstacle', name: 'Donuts', cost: 0, season: { id: 0, level: 38 }, value: 'donuts' },
  { id: 'title-axis', kind: 'title', name: 'Axis of Awesome', cost: 0, season: { id: 0, level: 40 }, value: 'Axis of Awesome' },
  { id: 'blast-infinity', kind: 'blast', name: 'Infinity pop', cost: 0, season: { id: 0, level: 41 }, value: 'infinity' },
  { id: 'trail-gold', kind: 'trail', name: 'Gold leaf', cost: 0, season: { id: 0, level: 43 }, value: 'gold' },
  { id: 'title-series', kind: 'title', name: 'Infinite Series', cost: 0, season: { id: 0, level: 44 }, value: 'Infinite Series' },
  { id: 'hat-astronaut', kind: 'hat', name: 'Space helmet', cost: 0, season: { id: 0, level: 46 }, value: 'astronaut' },
  { id: 'blast-lightning', kind: 'blast', name: 'Lightning', cost: 0, season: { id: 0, level: 47 }, value: 'lightning' },
  { id: 'title-hyperbola', kind: 'title', name: 'Holiday Hyperbola', cost: 0, season: { id: 0, level: 49 }, value: 'Holiday Hyperbola' },
  { id: 'blast-smite', kind: 'blast', name: 'Smite', cost: 0, season: { id: 0, level: 50 }, value: 'smite' },
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
  { id: 'brink-of-death', name: 'On The Brink of Death', detail: 'Survive an exact tie on a coin flip', reward: 75 },
  { id: 'leap-of-faith', name: 'Leap of Faith', detail: 'Get a Hop Kill', reward: 75 },
  { id: 'bank-shot', name: 'Bank Shot', detail: 'Knock someone out with a Ricochet after it bounces', reward: 100 },
  { id: 'crater-maker', name: 'Crater Maker', detail: 'Knock out 2 or more with one Heavy Shot', reward: 150 },
  { id: 'clean-cut', name: 'Clean Cut', detail: 'Survive when a beam cuts off a shot coming your way', reward: 100 },
  { id: 'sine-only', name: 'Wave Rider', detail: 'Land a kill using only sin', reward: 40 },
  { id: 'genius-win', name: 'Beyond Genius', detail: 'Beat a Genius bot', reward: 150 },
  { id: 'campaign-complete', name: 'Q.E.D.', detail: 'Finish the campaign', reward: 200 },
];

export type QuestMetric = 'kills' | 'wins' | 'matches' | 'stars' | 'multi' | 'online' | 'learn';

export interface QuestDef {
  id: string;
  text: string;
  goal: number;
  /** Sparks paid when finished. */
  reward: number;
  /** Season pass XP paid when finished. */
  seasonXp: number;
  weekly?: boolean;
  metric: QuestMetric;
}

const DAILY_POOL: QuestDef[] = [
  { id: 'd-kills', text: 'Hit 5 enemies', goal: 5, reward: 30, seasonXp: 80, metric: 'kills' },
  { id: 'd-wins', text: 'Win 2 matches', goal: 2, reward: 40, seasonXp: 100, metric: 'wins' },
  { id: 'd-matches', text: 'Play 3 matches', goal: 3, reward: 25, seasonXp: 70, metric: 'matches' },
  { id: 'd-stars', text: 'Earn 3 campaign stars', goal: 3, reward: 30, seasonXp: 70, metric: 'stars' },
  { id: 'd-multi', text: 'Hit 2 enemies with one shot', goal: 1, reward: 50, seasonXp: 100, metric: 'multi' },
  { id: 'd-online', text: 'Play an online match', goal: 1, reward: 35, seasonXp: 90, metric: 'online' },
  { id: 'd-learn', text: 'Finish 2 Learn exercises', goal: 2, reward: 25, seasonXp: 60, metric: 'learn' },
  { id: 'd-kills2', text: 'Hit 10 enemies', goal: 10, reward: 45, seasonXp: 110, metric: 'kills' },
];

const WEEKLY_POOL: QuestDef[] = [
  { id: 'w-wins', text: 'Win 10 matches', goal: 10, reward: 200, seasonXp: 400, weekly: true, metric: 'wins' },
  { id: 'w-kills', text: 'Hit 40 enemies', goal: 40, reward: 180, seasonXp: 350, weekly: true, metric: 'kills' },
  { id: 'w-matches', text: 'Play 15 matches', goal: 15, reward: 150, seasonXp: 300, weekly: true, metric: 'matches' },
  { id: 'w-multi', text: 'Hit 2 or more enemies with one shot, 5 times', goal: 5, reward: 220, seasonXp: 400, weekly: true, metric: 'multi' },
  { id: 'w-online', text: 'Play 5 online matches', goal: 5, reward: 200, seasonXp: 380, weekly: true, metric: 'online' },
  { id: 'w-stars', text: 'Earn 12 campaign stars', goal: 12, reward: 160, seasonXp: 320, weekly: true, metric: 'stars' },
];

/** Three daily quests chosen from the UTC date. They change every day. */
export function dailyQuests(dayNumber: number): QuestDef[] {
  const start = (dayNumber * 3) % DAILY_POOL.length;
  return [0, 1, 2].map((i) => DAILY_POOL[(start + i) % DAILY_POOL.length]!);
}

/** Three weekly quests, which change every Monday (UTC). */
export function weeklyQuests(dayNumber: number): QuestDef[] {
  const week = weekNumber(dayNumber);
  return [0, 1, 2].map((i) => WEEKLY_POOL[(week * 2 + i) % WEEKLY_POOL.length]!);
}

/** Weeks counted from a Monday, so the weekly quests reset at the start of each week. */
export function weekNumber(dayNumber: number): number {
  // Day 0 (1 January 1970) was a Thursday, so shift by 3 to make weeks start on Monday.
  return Math.floor((dayNumber + 3) / 7);
}

export function questsFor(dayNumber: number): QuestDef[] {
  return [...dailyQuests(dayNumber), ...weeklyQuests(dayNumber)];
}

/** A season pass: levels earned with season XP from matches and quests. */
export interface Season {
  id: number;
  name: string;
  /** When it ends, in ms. Season XP stops counting after this. */
  ends: number;
  levels: number;
  xpPerLevel: number;
}

export const SEASON: Season = {
  id: 0,
  name: 'Season 0',
  // Through Christmas Day, everywhere in the world.
  ends: Date.UTC(2026, 11, 26, 12, 0, 0),
  levels: 50,
  xpPerLevel: 200,
};

export type SeasonReward = { level: number; sparks: number } | { level: number; cosmetic: string };

/** Every third level pays Sparks. Every other level unlocks a cosmetic, ending with Smite at 50. */
export const SEASON_REWARDS: SeasonReward[] = Array.from({ length: SEASON.levels }, (_, i) => {
  const level = i + 1;
  if (level % 3 === 0) return { level, sparks: 50 + level * 5 };
  const item = COSMETICS.find((c) => c.season?.id === SEASON.id && c.season.level === level);
  return { level, cosmetic: item!.id };
});

export const SEASON_XP = { win: 60, loss: 25, kill: 5 } as const;

export function seasonXpForMatch(won: boolean, kills: number): number {
  return (won ? SEASON_XP.win : SEASON_XP.loss) + kills * SEASON_XP.kill;
}

export function seasonLevel(xp: number): { level: number; into: number; need: number; maxed: boolean } {
  const level = Math.min(SEASON.levels, Math.floor(Math.max(0, xp) / SEASON.xpPerLevel));
  const maxed = level >= SEASON.levels;
  return { level, into: maxed ? SEASON.xpPerLevel : Math.max(0, xp) - level * SEASON.xpPerLevel, need: SEASON.xpPerLevel, maxed };
}

export function seasonActive(now: number): boolean {
  return now < SEASON.ends;
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
