import {
  CIRCLE_COUNT_MEAN,
  CIRCLE_COUNT_SD,
  CIRCLE_R_MEAN,
  CIRCLE_R_SD,
  PLANE_H,
  PLANE_W,
  SOLDIER_R,
  SPAWN_CLEARANCE,
  SPAWN_SEPARATION,
} from './constants';
import type { Rng } from './rng';
import type { Circle } from './terrain';

export function generateCircles(rng: Rng): Circle[] {
  let count = Math.trunc(rng.gaussian() * CIRCLE_COUNT_SD + CIRCLE_COUNT_MEAN);
  while (count < 0) count = Math.trunc(rng.gaussian() * CIRCLE_COUNT_SD + CIRCLE_COUNT_MEAN);
  const out: Circle[] = [];
  for (let i = 0; i < count; i++) {
    let r = Math.trunc(rng.gaussian() * CIRCLE_R_SD + CIRCLE_R_MEAN);
    while (r <= 0) r = Math.trunc(rng.gaussian() * CIRCLE_R_SD + CIRCLE_R_MEAN);
    out.push({ x: rng.int(PLANE_W), y: rng.int(PLANE_H), r });
  }
  return out;
}

export interface SpawnSlot {
  /** 0 = left half, 1 = right half, null = anywhere (free-for-all). */
  side: 0 | 1 | null;
}

// Free-for-all spreads soldiers out, and packs them closer only when the match is too big for that.
const FFA_SEPARATIONS = [110, 80, 55, 35, 22];
const MAX_TRIES = 600;

/**
 * Places soldiers clear of obstacles and each other. Crowded maps lose their
 * largest obstacle and retry, so a match can always start.
 */
export function placeSoldiers(
  rng: Rng,
  circles: Circle[],
  slots: SpawnSlot[],
): { circles: Circle[]; spots: { x: number; y: number }[] } {
  let current = [...circles];
  const ffa = slots.some((s) => s.side === null);
  for (;;) {
    for (const gap of ffa ? FFA_SEPARATIONS : [SPAWN_SEPARATION]) {
      const spots = tryPlace(rng, current, slots, gap);
      if (spots) return { circles: current, spots };
    }
    if (current.length === 0) throw new Error('Too many soldiers to place');
    let big = 0;
    current.forEach((c, i) => {
      if (c.r > current[big]!.r) big = i;
    });
    current.splice(big, 1);
  }
}

function tryPlace(rng: Rng, circles: Circle[], slots: SpawnSlot[], gap: number): { x: number; y: number }[] | null {
  const spots: { x: number; y: number }[] = [];
  for (const slot of slots) {
    let placed = false;
    for (let t = 0; t < MAX_TRIES && !placed; t++) {
      const halfW = slot.side === null ? PLANE_W : PLANE_W / 2;
      let x = rng.int(halfW - 2 * SOLDIER_R) + SOLDIER_R;
      const y = rng.int(PLANE_H - 2 * SOLDIER_R) + SOLDIER_R;
      if (slot.side === 1) x += PLANE_W / 2;
      if (clear(x, y, spots, circles, slot.side === null, gap)) {
        spots.push({ x, y });
        placed = true;
      }
    }
    if (!placed) return null;
  }
  return spots;
}

function clear(
  x: number,
  y: number,
  spots: { x: number; y: number }[],
  circles: Circle[],
  ffa: boolean,
  gap: number,
): boolean {
  for (const s of spots) {
    if (ffa) {
      if (Math.hypot(s.x - x, s.y - y) < gap) return false;
    } else if (Math.abs(s.x - x) < SPAWN_SEPARATION && Math.abs(s.y - y) < SPAWN_SEPARATION) {
      return false;
    }
  }
  for (const c of circles) {
    if (Math.hypot(c.x - x, c.y - y) < c.r + SPAWN_CLEARANCE) return false;
  }
  return true;
}

/** True when a soldier could stand at this point. Used by teleport. */
export function spotIsClear(x: number, y: number, isSolid: (x: number, y: number) => boolean): boolean {
  for (let a = 0; a < 16; a++) {
    const t = (a / 16) * Math.PI * 2;
    const px = Math.trunc(x + Math.cos(t) * SOLDIER_R);
    const py = Math.trunc(y + Math.sin(t) * SOLDIER_R);
    if (isSolid(px, py)) return false;
  }
  return !isSolid(Math.trunc(x), Math.trunc(y));
}
