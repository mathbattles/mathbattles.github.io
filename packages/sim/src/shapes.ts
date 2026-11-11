/**
 * Rock shapes. A rock is still { x, y, r }: r is its outer size, so spacing rules and old maps
 * keep working. A shape and a rotation change its outline. No shape means a circle.
 */

export type RockShape = 'circle' | 'rect' | 'rounded' | 'star' | 'triangle' | 'diamond' | 'hexagon' | 'pentagon' | 'pill';

export const ROCK_SHAPES: readonly RockShape[] = ['circle', 'rect', 'rounded', 'star', 'triangle', 'diamond', 'hexagon', 'pentagon', 'pill'];

export interface ShapedRock {
  x: number;
  y: number;
  r: number;
  shape?: RockShape;
  /** Rotation in radians. */
  rot?: number;
}

export function isRockShape(v: unknown): v is RockShape {
  return typeof v === 'string' && (ROCK_SHAPES as readonly string[]).includes(v);
}

function regular(n: number, r: number, start = -Math.PI / 2): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const a = start + (i * 2 * Math.PI) / n;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
}

function rounded(hw: number, hh: number, rad: number, steps = 6): [number, number][] {
  const pts: [number, number][] = [];
  const corners: [number, number, number][] = [[hw - rad, -hh + rad, -Math.PI / 2], [hw - rad, hh - rad, 0], [-hw + rad, hh - rad, Math.PI / 2], [-hw + rad, -hh + rad, Math.PI]];
  for (const [cx, cy, a0] of corners) {
    for (let k = 0; k <= steps; k++) {
      const a = a0 + (k / steps) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
    }
  }
  return pts;
}

const cache = new Map<string, [number, number][]>();

/** The outline in local coordinates (before rotation), or null for a circle. */
export function localOutline(shape: RockShape | undefined, r: number): [number, number][] | null {
  if (!shape || shape === 'circle') return null;
  const key = `${shape}|${r}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let pts: [number, number][];
  switch (shape) {
    case 'rect':
      pts = [[-r * 0.88, -r * 0.5], [r * 0.88, -r * 0.5], [r * 0.88, r * 0.5], [-r * 0.88, r * 0.5]];
      break;
    case 'rounded':
      pts = rounded(r * 0.86, r * 0.56, r * 0.24);
      break;
    case 'star': {
      pts = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 === 0 ? r : r * 0.47;
        pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      break;
    }
    case 'triangle':
      pts = regular(3, r, -Math.PI / 2).map(([x, y]) => [x, y + r * 0.2] as [number, number]);
      break;
    case 'diamond':
      pts = [[0, -r], [r * 0.72, 0], [0, r], [-r * 0.72, 0]];
      break;
    case 'hexagon':
      pts = regular(6, r, 0);
      break;
    case 'pentagon':
      pts = regular(5, r);
      break;
    case 'pill':
      pts = rounded(r * 0.95, r * 0.42, r * 0.42, 8);
      break;
  }
  cache.set(key, pts);
  return pts;
}

/** The outline in field coordinates, rotated and placed, or null for a circle. */
export function rockOutline(c: ShapedRock): [number, number][] | null {
  const local = localOutline(c.shape, c.r);
  if (!local) return null;
  const cos = Math.cos(c.rot ?? 0);
  const sin = Math.sin(c.rot ?? 0);
  return local.map(([x, y]) => [c.x + x * cos - y * sin, c.y + x * sin + y * cos]);
}

function inPolygon(pts: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when a point is inside the rock's outline. */
export function rockContains(c: ShapedRock, x: number, y: number): boolean {
  const dx = x - c.x;
  const dy = y - c.y;
  if (dx * dx + dy * dy > c.r * c.r) return false;
  const local = localOutline(c.shape, c.r);
  if (!local) return true;
  // Turn the point into the rock's own frame instead of turning the whole outline.
  const cos = Math.cos(-(c.rot ?? 0));
  const sin = Math.sin(-(c.rot ?? 0));
  return inPolygon(local, dx * cos - dy * sin, dx * sin + dy * cos);
}

/** True when anything within pad pixels of the point is rock: used for spawns. */
export function rockTouches(c: ShapedRock, x: number, y: number, pad: number): boolean {
  if (Math.hypot(c.x - x, c.y - y) > c.r + pad) return false;
  if (!c.shape || c.shape === 'circle') return true;
  if (rockContains(c, x, y)) return true;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    if (rockContains(c, x + Math.cos(a) * pad, y + Math.sin(a) * pad)) return true;
  }
  return false;
}

/** Shapes for random maps, circles a little more often than the rest. */
export function pickShape(roll: number): RockShape {
  if (roll < 0.4) return 'circle';
  const rest = ROCK_SHAPES.slice(1);
  return rest[Math.min(rest.length - 1, Math.floor(((roll - 0.4) / 0.6) * rest.length))]!;
}
