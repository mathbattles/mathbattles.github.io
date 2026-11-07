import {
  ACHIEVEMENTS,
  COSMETICS,
  levelFromXp,
  questsFor,
  rewardsFor,
  utcDayNumber,
  type AbilityId,
  type CosmeticKind,
  type ShotMode,
} from '@mathbattles/sim';
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
  lastWinDay: number;
  daily: Record<string, { score: number; shots: number; chars: number }>;
  dailiesDone: number;
  matches: number;
  wins: number;
  kills: number;
  bestCombo: number;
  ability: AbilityId;
  theme: ThemeId;
  lookVersion: number;
  /** The account this progress belongs to, or null for a guest. */
  ownerUid: string | null;
  muted: boolean;
  chatOff: boolean;
  analytics: 'unset' | 'yes' | 'no';
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
    lastWinDay: 0,
    daily: {},
    dailiesDone: 0,
    matches: 0,
    wins: 0,
    kills: 0,
    bestCombo: 0,
    ability: 'teleport',
    theme: 'paper',
    lookVersion: LOOK_VERSION,
    ownerUid: null,
    muted: false,
    chatOff: false,
    analytics: 'unset',
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
  return { guestToken: p.guestToken, theme: p.theme, lookVersion: p.lookVersion, muted: p.muted, chatOff: p.chatOff, analytics: p.analytics };
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
  saveProfile();
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
  const week = Math.floor(day / 7);
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

export function bumpQuest(metric: 'kills' | 'wins' | 'matches' | 'stars' | 'multi', by = 1): void {
  if (by <= 0) return;
  rollQuests();
  for (const q of questsFor(utcDayNumber(Date.now()))) {
    if (q.metric !== metric) continue;
    const next = (profile.questProgress[q.id] ?? 0) + by;
    profile.questProgress[q.id] = next;
    if (next >= q.goal && !profile.questsPaid.includes(q.id)) {
      profile.questsPaid.push(q.id);
      profile.sparks += q.reward;
    }
  }
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
  profile.xp += r.xp;
  profile.sparks += r.sparks;
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
  if (m.kills > 0 && m.mode === 'ode1') grantAchievement('ode1-kill');
  if (m.kills > 0 && m.mode === 'ode2') grantAchievement('ode2-kill');
  bumpQuest('matches');
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
