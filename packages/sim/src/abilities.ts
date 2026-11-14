/** Abilities change how one shot behaves. They cost energy, which builds up as a match goes on. */

export type AbilityId = 'hop' | 'ricochet' | 'heavy' | 'pierce' | 'wall' | 'fill' | 'shield';

export interface AbilityDef {
  id: AbilityId;
  name: string;
  /** Energy spent when the round fires. */
  energy: number;
  /** Sparks to buy it. Zero means everyone has it. */
  price: number;
}

export const ABILITIES: readonly AbilityDef[] = [
  { id: 'hop', name: 'Hop', energy: 50, price: 0 },
  { id: 'ricochet', name: 'Ricochet', energy: 40, price: 400 },
  { id: 'heavy', name: 'Heavy Shot', energy: 50, price: 600 },
  { id: 'pierce', name: 'Piercing Shot', energy: 45, price: 450 },
  { id: 'wall', name: 'Rock Wall', energy: 35, price: 350 },
  { id: 'fill', name: 'Fill', energy: 30, price: 300 },
  { id: 'shield', name: 'Shield', energy: 60, price: 600 },
];

/** How many abilities a player brings into one match. */
export const LOADOUT_SIZE = 3;
/** Rock Wall leaves a rock this big where the shot ends. */
export const WALL_R = 28;
/** Fill pours rock back into craters this far around where the shot ends. */
export const FILL_R = 34;
/** A shot passing this close to an enemy without a kill earns near-miss energy. */
export const NEAR_MISS_PX = 30;
export const NEAR_MISS_ENERGY = 8;
/** After a Shield pops, its owner can't be hit again for this many steps (so one beam can't finish them at once). */
export const SHIELD_GRACE_STEPS = 120;
/** Abilities that use the turn instead of firing a line. */
export const NO_SHOT_ABILITIES: readonly AbilityId[] = ['shield'];
/** True for an ability that uses the turn instead of a line, so no function is needed. */
export function isNoShot(a: string | null | undefined): boolean {
  return !!a && (NO_SHOT_ABILITIES as readonly string[]).includes(a);
}
/** Abilities whose line hurts nobody: it only changes the ground. */
export const HARMLESS_ABILITIES: readonly AbilityId[] = ['wall', 'fill'];

export const ABILITY_IDS: readonly AbilityId[] = ABILITIES.map((a) => a.id);
/** Hop is free for everyone. */
export const FREE_ABILITIES: readonly AbilityId[] = ['hop'];

export const START_ENERGY = 50;
export const MAX_ENERGY = 100;
/** Heavy Shot's landing blast is this many times wider than a normal one. */
export const HEAVY_BLAST_MULT = 2.5;
/** How long the jump over a rock (or out of the field) lasts, in steps. */
export const HOP_JUMP_STEPS = 600;
/** Hopping out of the field plays a short cutscene: the soldier leaps off the page and fades away. */
export const HOP_OUT_STEPS = 2400;
/** How long the little hop over another line lasts, in steps. */
export const HOP_LINE_STEPS = 200;
/** Meeting another line head on knocks you this far to the side. */
export const HOP_SIDE_PX = 14;

export function abilityDef(id: string | undefined | null): AbilityDef | undefined {
  return ABILITIES.find((a) => a.id === id);
}

export function isAbilityId(v: unknown): v is AbilityId {
  return typeof v === 'string' && (ABILITY_IDS as readonly string[]).includes(v);
}

/** The energy an ability costs in a match, after any admin override stored in the match. */
export function abilityCost(id: AbilityId, overrides?: Partial<Record<AbilityId, number>>): number {
  const o = overrides?.[id];
  if (typeof o === 'number' && Number.isFinite(o)) return Math.max(0, Math.min(MAX_ENERGY, Math.round(o)));
  return abilityDef(id)!.energy;
}

/**
 * A match loadout: the free abilities (Hop), plus up to LOADOUT_SIZE others, once each, in
 * menu order. Anything that isn't a real ability is dropped.
 */
export function cleanLoadout(list: unknown): AbilityId[] {
  const picked: AbilityId[] = [];
  if (Array.isArray(list)) {
    for (const a of list) {
      if (isAbilityId(a) && !FREE_ABILITIES.includes(a) && !picked.includes(a) && picked.length < LOADOUT_SIZE) picked.push(a);
    }
  }
  return ABILITY_IDS.filter((a) => FREE_ABILITIES.includes(a) || picked.includes(a));
}

/** Energy for firing a line on round n: it grows the longer the match goes. Always a whole number. */
export function energyGain(round: number): number {
  return Math.floor(10 + 1.6 * 1.15 ** Math.max(0, round));
}

export function clampEnergy(e: number): number {
  return Math.max(0, Math.min(MAX_ENERGY, Math.floor(e)));
}

/** Keeps only real ability ids, once each, always including the free ones. */
export function cleanAbilities(list: unknown): AbilityId[] {
  const out = new Set<AbilityId>(FREE_ABILITIES);
  if (Array.isArray(list)) for (const a of list) if (isAbilityId(a)) out.add(a);
  return ABILITY_IDS.filter((a) => out.has(a));
}
