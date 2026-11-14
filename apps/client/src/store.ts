import { abilityPrice } from './gameConfig';
import {
  ACHIEVEMENTS,
  COSMETICS,
  levelFromXp,
  SEASON,
  SEASON_REWARDS,
  questsFor,
  rewardsFor,
  seasonActive,
  seasonLevel,
  seasonXpForMatch,
  weekNumber,
  type QuestMetric,
  utcDayNumber,
  type CosmeticKind,
  type ShotMode,
  ABILITIES,
  cleanAbilities,
  type AbilityId, FREE_ABILITIES, LOADOUT_SIZE, cleanLoadout } from '@mathbattles/sim';
import { mergeProgress } from './profileMerge';
import type { ThemeId } from './render/stage';

export interface Profile {
  name: string;
  guestToken: string;
  xp: number;
  sparks: number;
  owned: string[];
  equipped: Record<CosmeticKind, string>;
  stars: Record<string, number>;
  achievements: string[];
  mastery: Record<ShotMode, number>;
  questDay: number;
  questWeek: number;
  questProgress: Record<string, number>;
  questsPaid: string[];
  /** Course exercises finished. */
  learnDone: string[];
  /** Abilities bought. Hop is always there. */
  abilitiesOwned: AbilityId[];
  /** Abilities marked as favourites, listed first in a match. */
  abilityFavs: AbilityId[];
  /** The abilities taken into matches (Hop always comes too). Empty means pick automatically. */
  loadout: AbilityId[];
  /** How often each ability was used, and the knockouts it got. */
  abilityStats: Record<string, { uses: number; kills: number }>;
  /** The season these numbers belong to. A new season starts them again. */
  seasonId: number;
  seasonXp: number;
  /** Season levels whose rewards were already given. */
  seasonPaid: number[];
  lastWinDay: number;
  daily: Record<string, { score: number; shots: number; chars: number }>;
  dailiesDone: number;
  matches: number;
  wins: number;
  kills: number;
  bestCombo: number;
  theme: ThemeId;
  lookVersion: number;
  /** The account this progress belongs to, or null for a guest. */
  ownerUid: string | null;
  /** Sound effects off. */
  muted: boolean;
  sfxVolume: number;
  music: boolean;
  musicVolume: number;
  /** Which music track repeats, or -1 to play all of them in order. */
  musicTrack: number;
  /** On-screen math keys: automatic on touch screens, always, or never. */
  mathKeys: 'auto' | 'on' | 'off';
  chatOff: boolean;
  analytics: 'unset' | 'yes' | 'no';
  /** Interface size, from 0.6 to 1.5. */
  uiScale: number;
  /** Names and arrows on the battlefield. */
  gameText: 'small' | 'normal' | 'large';
  /** Interface language, or '' to follow the browser. Saved with the account, so it follows you. */
  language: string;
  /** Set by the age check before making an account. Only the band is kept, never the birth year. */
  ageBand?: 'adult' | 'child';
  updatedAt: number;
}

const KEY = 'mathbattles.profile.v1';

function randomToken(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

const FREE_ITEMS = ['hat-none', 'trail-ink', 'title-none', 'blast-ring', 'obstacle-candy'];
const LOOK_VERSION = 3;
const DESIGNS: readonly ThemeId[] = ['paper', 'chalk', 'blueprint'];

/** Old saves, local or from the cloud, can name a design that's gone. */
function normalizeLook(p: Profile): void {
  // Saves from before a shop section existed need its free item.
  for (const id of FREE_ITEMS) if (!p.owned.includes(id)) p.owned.push(id);
  p.equipped.obstacle ??= 'obstacle-candy';
  if (p.lookVersion !== LOOK_VERSION) {
    if (p.lookVersion === 2 || !DESIGNS.includes(p.theme)) p.theme = 'paper';
    p.lookVersion = LOOK_VERSION;
  }
  if (!DESIGNS.includes(p.theme)) p.theme = 'paper';
}

function fresh(): Profile {
  return {
    name: `Player${Math.floor(Math.random() * 9000 + 1000)}`,
    guestToken: randomToken(),
    xp: 0,
    sparks: 0,
    owned: [...FREE_ITEMS],
    equipped: { hat: 'hat-none', trail: 'trail-ink', title: 'title-none', blast: 'blast-ring', obstacle: 'obstacle-candy' },
    stars: {},
    achievements: [],
    mastery: { fn: 0, ode1: 0, ode2: 0 },
    questDay: 0,
    questWeek: 0,
    questProgress: {},
    questsPaid: [],
    learnDone: [],
    abilitiesOwned: ['hop'],
    abilityFavs: [],
    loadout: [],
    abilityStats: {},
    seasonId: SEASON.id,
    seasonXp: 0,
    seasonPaid: [],
    lastWinDay: 0,
    daily: {},
    dailiesDone: 0,
    matches: 0,
    wins: 0,
    kills: 0,
    bestCombo: 0,
    theme: 'paper',
    lookVersion: LOOK_VERSION,
    ownerUid: null,
    muted: false,
    sfxVolume: 0.8,
    music: true,
    musicVolume: 0.45,
    musicTrack: -1,
    mathKeys: 'auto',
    chatOff: false,
    analytics: 'unset',
    // Narrow screens start a little smaller, so more of the game fits.
    uiScale: typeof window !== 'undefined' && window.innerWidth < 520 ? 0.9 : 1,
    gameText: 'normal',
    language: '',
    updatedAt: 0,
  };
}

function load(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fresh(), lookVersion: 1, ...(JSON.parse(raw) as Partial<Profile>) };
  } catch {
    /* private mode or corrupt data: start fresh */
  }
  return fresh();
}

export const profile: Profile = load();
normalizeLook(profile);
// Save right away: the guest token must stay the same across reloads, or a player loses their seat.
try {
  localStorage.setItem(KEY, JSON.stringify(profile));
} catch {
  /* storage unavailable */
}
const listeners = new Set<() => void>();

export function subscribeProfile(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let syncHook: ((p: Profile) => void) | null = null;
export function setSyncHook(fn: ((p: Profile) => void) | null): void {
  syncHook = fn;
}

export function saveProfile(): void {
  profile.updatedAt = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    /* storage unavailable: the session still works */
  }
  listeners.forEach((l) => l());
  syncHook?.(profile);
}

/** Settings that belong to this device, not to whoever is signed in. */
function deviceSettings(p: Profile) {
  return { guestToken: p.guestToken, theme: p.theme, lookVersion: p.lookVersion, muted: p.muted, sfxVolume: p.sfxVolume, music: p.music, musicVolume: p.musicVolume, musicTrack: p.musicTrack, mathKeys: p.mathKeys, chatOff: p.chatOff, analytics: p.analytics, ageBand: p.ageBand, uiScale: p.uiScale, gameText: p.gameText };
}

/**
 * Brings an account's cloud progress onto this device.
 * - Guest progress, or an older copy of this account: both are combined, losing nothing.
 * - Another account's progress on a shared device: it's replaced, never mixed in.
 */
export function mergeCloud(uid: string, cloud: Partial<Profile> | null): void {
  const device = deviceSettings(profile);
  const base = profile.ownerUid && profile.ownerUid !== uid ? { ...fresh(), updatedAt: 0 } : { ...profile };
  const merged = cloud ? mergeProgress(base, cloud) : base;
  Object.assign(profile, merged, device, { ownerUid: uid });
  normalizeLook(profile);
  addSeasonXp(0);
  saveProfile();
}

/** After signing out, this device goes back to a clean guest. The account's progress is in the cloud. */
export function resetToGuest(): void {
  const device = deviceSettings(profile);
  Object.assign(profile, fresh(), device, { ownerUid: null });
  saveProfile();
}

/** The account no longer exists, so what's here becomes this device's guest progress. */
export function releaseOwner(): void {
  profile.ownerUid = null;
  saveProfile();
}

// Another tab saved: take its copy, so this tab's next save can't undo that tab's progress.
try {
  globalThis.addEventListener?.('storage', (e: StorageEvent) => {
    if (e.key !== KEY || !e.newValue) return;
    try {
      Object.assign(profile, JSON.parse(e.newValue) as Partial<Profile>);
      normalizeLook(profile);
      listeners.forEach((l) => l());
    } catch {
      /* ignore a damaged copy */
    }
  });
} catch {
  /* no window here */
}

export function markLearned(id: string): void {
  if (profile.learnDone.includes(id)) return;
  profile.learnDone.push(id);
  bumpQuest('learn');
  saveProfile();
}

export const UI_SCALE_MIN = 0.6;
export const UI_SCALE_MAX = 1.5;

/** Applies the interface size to the page. Everything sized in rem follows it. */
export function applyUiScale(scale = profile.uiScale): void {
  const v = Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, Number.isFinite(scale) ? scale : 1));
  try {
    document.documentElement.style.setProperty('--ui-scale', String(v));
  } catch {
    /* no page here */
  }
}

export function setUiScale(scale: number): void {
  profile.uiScale = Math.round(Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, scale)) * 100) / 100;
  applyUiScale();
  saveProfile();
}

/** How big names and arrows are drawn on the battlefield. */
export function gameTextScale(): number {
  return profile.gameText === 'small' ? 0.85 : profile.gameText === 'large' ? 1.3 : 1;
}

export function cosmeticValue(kind: CosmeticKind): string {
  return COSMETICS.find((c) => c.id === profile.equipped[kind])?.value ?? '';
}

export function look() {
  return { hat: cosmeticValue('hat'), trail: cosmeticValue('trail'), blast: cosmeticValue('blast') };
}

export function buy(id: string): string | null {
  const c = COSMETICS.find((x) => x.id === id);
  if (!c) return 'That item no longer exists';
  if (profile.owned.includes(id)) return null;
  if (c.earn) return 'Earned through an achievement';
  if (profile.sparks < c.cost) return `You need ${c.cost - profile.sparks} more Sparks`;
  profile.sparks -= c.cost;
  profile.owned.push(id);
  saveProfile();
  return null;
}

/** Abilities this player owns, always including the free ones. */
export function ownedAbilities(): AbilityId[] {
  return cleanAbilities(profile.abilitiesOwned);
}

export function buyAbility(id: AbilityId): string | null {
  const a = ABILITIES.find((x) => x.id === id);
  if (!a) return 'That ability no longer exists';
  if (ownedAbilities().includes(id)) return null;
  const price = abilityPrice(id);
  if (profile.sparks < price) return `You need ${price - profile.sparks} more Sparks`;
  profile.sparks -= price;
  profile.abilitiesOwned = cleanAbilities([...profile.abilitiesOwned, id]);
  // A new ability goes straight into the loadout when there's room.
  const picks = loadoutPicks();
  if (picks.length < LOADOUT_SIZE && !picks.includes(id)) profile.loadout = [...picks, id];
  saveProfile();
  return null;
}

/** The chosen abilities (not counting free Hop), only ones still owned; filled in automatically when empty. */
export function loadoutPicks(): AbilityId[] {
  const owned = ownedAbilities().filter((a) => !FREE_ABILITIES.includes(a));
  const chosen = (profile.loadout ?? []).filter((a) => owned.includes(a)).slice(0, LOADOUT_SIZE);
  return chosen.length || (profile.loadout ?? []).length ? chosen : owned.slice(0, LOADOUT_SIZE);
}

/** What a player takes into a match: Hop plus up to three chosen abilities. */
export function matchLoadout(): AbilityId[] {
  return cleanLoadout(loadoutPicks());
}

/** Adds or removes an ability from the loadout. Returns false when the loadout is already full. */
export function toggleLoadout(id: AbilityId): boolean {
  const picks = loadoutPicks();
  if (picks.includes(id)) profile.loadout = picks.filter((a) => a !== id);
  else if (picks.length >= LOADOUT_SIZE) return false;
  else profile.loadout = [...picks, id];
  saveProfile();
  return true;
}

export function toggleAbilityFav(id: AbilityId): void {
  profile.abilityFavs = profile.abilityFavs.includes(id) ? profile.abilityFavs.filter((x) => x !== id) : [...profile.abilityFavs, id];
  saveProfile();
}

/** Owned abilities, favourites first. */
export function abilityMenu(): AbilityId[] {
  const owned = ownedAbilities();
  return [...owned.filter((a) => profile.abilityFavs.includes(a)), ...owned.filter((a) => !profile.abilityFavs.includes(a))];
}

export function noteAbilityUse(id: AbilityId, kills: number): void {
  const s = (profile.abilityStats[id] ??= { uses: 0, kills: 0 });
  s.uses++;
  s.kills += kills;
  saveProfile();
}

export function equip(id: string): void {
  const c = COSMETICS.find((x) => x.id === id);
  if (!c || !profile.owned.includes(id)) return;
  profile.equipped[c.kind] = id;
  saveProfile();
}

export function grantAchievement(id: string): boolean {
  if (profile.achievements.includes(id)) return false;
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a) return false;
  profile.achievements.push(id);
  profile.sparks += a.reward;
  for (const c of COSMETICS) {
    if (c.earn === id && !profile.owned.includes(c.id)) profile.owned.push(c.id);
  }
  saveProfile();
  return true;
}

function rollQuests(): void {
  const day = utcDayNumber(Date.now());
  const week = weekNumber(day);
  if (profile.questDay !== day) {
    for (const k of Object.keys(profile.questProgress)) {
      if (k.startsWith('d-')) delete profile.questProgress[k];
    }
    profile.questsPaid = profile.questsPaid.filter((k) => !k.startsWith('d-'));
    profile.questDay = day;
  }
  if (profile.questWeek !== week) {
    for (const k of Object.keys(profile.questProgress)) {
      if (k.startsWith('w-')) delete profile.questProgress[k];
    }
    profile.questsPaid = profile.questsPaid.filter((k) => !k.startsWith('w-'));
    profile.questWeek = week;
  }
}

export function currentQuests() {
  rollQuests();
  return questsFor(utcDayNumber(Date.now())).map((q) => ({
    ...q,
    progress: Math.min(q.goal, profile.questProgress[q.id] ?? 0),
    paid: profile.questsPaid.includes(q.id),
  }));
}

export function bumpQuest(metric: QuestMetric, by = 1): void {
  if (by <= 0) return;
  rollQuests();
  for (const q of questsFor(utcDayNumber(Date.now()))) {
    if (q.metric !== metric) continue;
    const next = (profile.questProgress[q.id] ?? 0) + by;
    profile.questProgress[q.id] = next;
    if (next >= q.goal && !profile.questsPaid.includes(q.id)) {
      profile.questsPaid.push(q.id);
      profile.sparks += q.reward;
      addSeasonXp(q.seasonXp);
    }
  }
}

/** A new season starts everyone's pass again. Items already earned are kept. */
function rollSeason(): void {
  if (profile.seasonId === SEASON.id) return;
  profile.seasonId = SEASON.id;
  profile.seasonXp = 0;
  profile.seasonPaid = [];
}

/**
 * Adds season pass XP and hands out the rewards of every level reached.
 * Rewards are given once, so a level's Sparks can't be paid twice.
 */
export function addSeasonXp(amount: number): void {
  rollSeason();
  if (amount > 0 && seasonActive(Date.now())) profile.seasonXp += Math.round(amount);
}

/** Season levels reached whose rewards haven't been claimed yet. */
export function seasonClaimable(): number[] {
  rollSeason();
  const { level } = seasonLevel(profile.seasonXp);
  return SEASON_REWARDS.filter((r) => r.level <= level && !profile.seasonPaid.includes(r.level)).map((r) => r.level);
}

/** Claims one reached level's reward, or every waiting one. Each is paid once. */
export function claimSeason(only?: number): number {
  let n = 0;
  for (const lv of seasonClaimable()) {
    if (only !== undefined && lv !== only) continue;
    const r = SEASON_REWARDS.find((x) => x.level === lv)!;
    profile.seasonPaid.push(lv);
    if ('sparks' in r) profile.sparks += r.sparks;
    else if (!profile.owned.includes(r.cosmetic)) profile.owned.push(r.cosmetic);
    n++;
  }
  if (n) saveProfile();
  return n;
}

export interface MatchRewardInput {
  won: boolean;
  kills: number;
  bestCombo: number;
  online: boolean;
  mode: ShotMode;
  beatBotLevel?: string;
}

export function recordMatch(m: MatchRewardInput): { xp: number; sparks: number; levelUp: boolean } {
  const today = utcDayNumber(Date.now());
  const before = levelFromXp(profile.xp).level;
  const r = rewardsFor({
    won: m.won,
    kills: m.kills,
    bestCombo: m.bestCombo,
    online: m.online,
    firstWinToday: profile.lastWinDay !== today,
  });
  // Player XP comes only from playing. The season pass gets XP from matches and quests.
  profile.xp += r.xp;
  profile.sparks += r.sparks;
  addSeasonXp(seasonXpForMatch(m.won, m.kills));
  profile.matches++;
  profile.kills += m.kills;
  profile.bestCombo = Math.max(profile.bestCombo, m.bestCombo);
  profile.mastery[m.mode] += m.kills;
  if (m.won) {
    profile.wins++;
    profile.lastWinDay = today;
    if (m.online) grantAchievement('first-online-win');
    else if (m.beatBotLevel) grantAchievement('first-bot-win');
    if (m.beatBotLevel === 'genius') grantAchievement('genius-win');
  }
  if (m.bestCombo >= 2) grantAchievement('double-kill');
  if (m.bestCombo >= 3) grantAchievement('triple-kill');
  bumpQuest('matches');
  if (m.online) bumpQuest('online');
  bumpQuest('kills', m.kills);
  if (m.won) bumpQuest('wins');
  if (m.bestCombo >= 2) bumpQuest('multi');
  saveProfile();
  return { ...r, levelUp: levelFromXp(profile.xp).level > before };
}

/** Called on any kill: rewards a shot that used only sin as its function. */
export function noteKillExpression(expr: string): void {
  const names = expr.toLowerCase().match(/[a-z]{2,}/g) ?? [];
  if (names.length > 0 && names.every((n) => n === 'sin')) grantAchievement('sine-only');
}

export function setStars(levelId: string, stars: number): number {
  const prev = profile.stars[levelId] ?? 0;
  const gained = Math.max(0, stars - prev);
  if (gained > 0) {
    profile.stars[levelId] = stars;
    profile.sparks += gained * 15;
    bumpQuest('stars', gained);
    saveProfile();
  }
  return gained;
}
