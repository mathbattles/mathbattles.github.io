import { PLANE_H, PLANE_W, SOLDIER_R } from './constants';
import type { Circle } from './terrain';

/** A player-made map: its obstacles, and optionally where soldiers start. */
export interface MapDef {
  name: string;
  circles: Circle[];
  spawns: MapSpawn[];
}

export interface MapSpawn {
  x: number;
  y: number;
  /** Which team starts here in team matches. Free-for-all uses every spawn. */
  team: 1 | 2;
}

export const MAP_LIMITS = { circles: 40, spawnsPerTeam: 10, minR: 6, maxR: 120, name: 24 } as const;

const int = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : null;

/**
 * Checks a map from anywhere (the editor, a link, the server) and returns a safe copy,
 * or null if it can't be used. Positions are whole pixels inside the field.
 */
export function cleanMap(raw: unknown): MapDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<MapDef>;
  if (!Array.isArray(m.circles) || m.circles.length > MAP_LIMITS.circles) return null;
  const circles: Circle[] = [];
  for (const c of m.circles) {
    const x = int(c?.x, 0, PLANE_W);
    const y = int(c?.y, 0, PLANE_H);
    const r = int(c?.r, MAP_LIMITS.minR, MAP_LIMITS.maxR);
    if (x === null || y === null || r === null) return null;
    circles.push({ x, y, r });
  }
  const spawns: MapSpawn[] = [];
  for (const s of Array.isArray(m.spawns) ? m.spawns : []) {
    const x = int(s?.x, SOLDIER_R, PLANE_W - SOLDIER_R);
    const y = int(s?.y, SOLDIER_R, PLANE_H - SOLDIER_R);
    if (x === null || y === null) return null;
    spawns.push({ x, y, team: s?.team === 2 ? 2 : 1 });
  }
  for (const team of [1, 2] as const) {
    if (spawns.filter((s) => s.team === team).length > MAP_LIMITS.spawnsPerTeam) return null;
  }
  const name = typeof m.name === 'string' ? m.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, MAP_LIMITS.name) : '';
  return { name: name || 'Custom map', circles, spawns };
}

/** True when a soldier standing here would be inside an obstacle. */
export function spawnBlocked(s: { x: number; y: number }, circles: Circle[]): boolean {
  return circles.some((c) => Math.hypot(c.x - s.x, c.y - s.y) < c.r + SOLDIER_R);
}
