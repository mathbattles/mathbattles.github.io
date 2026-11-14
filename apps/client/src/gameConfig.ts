import { abilityDef, type AbilityId } from '@mathbattles/sim';
import { SERVER_URL } from './net/api';

/**
 * Settings the admin can change without a redeploy: ability Spark prices and an announcement.
 * (Energy costs travel inside each match, set by the server.) Loaded once at startup.
 */
export const gameConfig: { prices: Partial<Record<AbilityId, number>>; announcement: string } = { prices: {}, announcement: '' };
const listeners = new Set<() => void>();

export function subscribeGameConfig(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function loadGameConfig(): Promise<void> {
  try {
    const r = await fetch(`${SERVER_URL}/api/config`);
    if (!r.ok) return;
    const data = (await r.json()) as { prices?: Partial<Record<AbilityId, number>>; announcement?: string };
    gameConfig.prices = data.prices && typeof data.prices === 'object' ? data.prices : {};
    gameConfig.announcement = typeof data.announcement === 'string' ? data.announcement : '';
    listeners.forEach((l) => l());
  } catch {
    /* Offline or the server is down: the normal prices stand. */
  }
}

/** An ability's price in Sparks, after any admin change. */
export function abilityPrice(id: AbilityId): number {
  const p = gameConfig.prices[id];
  return typeof p === 'number' && Number.isFinite(p) ? Math.max(0, Math.round(p)) : abilityDef(id)?.price ?? 0;
}
