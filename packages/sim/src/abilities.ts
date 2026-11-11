/** Abilities change how one shot behaves. They cost energy, which builds up as a match goes on. */

export type AbilityId = 'hop' | 'ricochet' | 'heavy';

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
];

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
