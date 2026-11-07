import { cleanMap, type MapDef } from '@mathbattles/sim';

/** Maps saved on this device. Shared ones also remember their public code. */
export interface SavedMap {
  id: string;
  map: MapDef;
  code?: string;
  updatedAt: number;
}

const KEY = 'mathbattles.maps.v1';

export function savedMaps(): SavedMap[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as SavedMap[];
    return Array.isArray(raw)
      ? raw.flatMap((m) => {
          const map = cleanMap(m?.map);
          return map && typeof m.id === 'string' ? [{ ...m, map }] : [];
        }).sort((a, b) => b.updatedAt - a.updatedAt)
      : [];
  } catch {
    return [];
  }
}

function write(list: SavedMap[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* Storage is full or unavailable. */
  }
}

export function saveMap(entry: SavedMap): void {
  write([{ ...entry, updatedAt: Date.now() }, ...savedMaps().filter((m) => m.id !== entry.id)]);
}

export function deleteMap(id: string): void {
  write(savedMaps().filter((m) => m.id !== id));
}

export function getMap(id: string): SavedMap | undefined {
  return savedMaps().find((m) => m.id === id);
}

export function newMapId(): string {
  return `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * A map waiting to be played. Set it, then open the local match screen, which picks it up.
 */
let pending: MapDef | null = null;
export function playMapNext(map: MapDef): void {
  pending = map;
}
export function takePendingMap(): MapDef | null {
  const m = pending;
  pending = null;
  return m;
}
