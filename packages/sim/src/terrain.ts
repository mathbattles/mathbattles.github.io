import { PLANE_H, PLANE_W } from './constants';
import { rockContains, type RockShape } from './shapes';

/** A rock, or a carved hole. Rocks can have a shape and a rotation; holes are always round. */
export interface Circle {
  x: number;
  y: number;
  r: number;
  shape?: RockShape;
  rot?: number;
  /**
   * Only on entries in the holes list: 'rock' is new rock (Rock Wall), 'fill' pours rock back
   * where the map had rock before it was carved (Fill). Missing means a carved hole.
   */
  kind?: 'rock' | 'fill';
}

/**
 * Terrain is defined by geometry: a point is solid if it is inside an obstacle
 * and not inside a carved hole. A lazily built bitmap makes point tests O(1)
 * so bots can test thousands of shots.
 */
export class Terrain {
  readonly circles: Circle[];
  readonly holes: Circle[];
  private grid: Uint8Array | null = null;

  constructor(circles: Circle[], holes: Circle[] = []) {
    this.circles = circles;
    this.holes = [...holes];
  }

  private build(): Uint8Array {
    const g = new Uint8Array(PLANE_W * PLANE_H);
    for (const c of this.circles) paint(g, c, 1);
    for (const h of this.holes) this.apply(g, h);
    this.grid = g;
    return g;
  }

  private apply(g: Uint8Array, h: Circle): void {
    if (h.kind === 'rock') paint(g, { x: h.x, y: h.y, r: h.r }, 1);
    else if (h.kind === 'fill') paintFill(g, h, this.circles);
    else paint(g, h, 0);
  }

  /** Adds new rock or poured-back rock, in order with the carved holes. */
  patch(entry: Circle): void {
    this.holes.push(entry);
    if (this.grid) this.apply(this.grid, entry);
  }

  /** True for solid obstacles and everything outside the field. Expects whole-pixel values. */
  solidAt(x: number, y: number): boolean {
    if (x < 0 || x >= PLANE_W || y < 0 || y >= PLANE_H) return true;
    const g = this.grid ?? this.build();
    return g[y * PLANE_W + x] === 1;
  }

  carve(x: number, y: number, r: number): void {
    const hole = { x, y, r };
    this.holes.push(hole);
    if (this.grid) paint(this.grid, hole, 0);
  }

  clone(): Terrain {
    const t = new Terrain(this.circles, this.holes);
    if (this.grid) t.grid = this.grid.slice();
    return t;
  }
}

function paint(g: Uint8Array, c: Circle, value: 0 | 1): void {
  const shaped = value === 1 && !!c.shape && c.shape !== 'circle';
  const r2 = c.r * c.r;
  const y0 = Math.max(0, Math.floor(c.y - c.r));
  const y1 = Math.min(PLANE_H - 1, Math.ceil(c.y + c.r));
  const x0 = Math.max(0, Math.floor(c.x - c.r));
  const x1 = Math.min(PLANE_W - 1, Math.ceil(c.x + c.r));
  for (let y = y0; y <= y1; y++) {
    const dy = y - c.y;
    const row = y * PLANE_W;
    for (let x = x0; x <= x1; x++) {
      const dx = x - c.x;
      if (dx * dx + dy * dy <= r2 && (!shaped || rockContains(c, x, y))) g[row + x] = value;
    }
  }
}

/** Pours rock back inside the circle, only where one of the map's rocks used to be. */
function paintFill(g: Uint8Array, c: Circle, rocks: readonly Circle[]): void {
  const near = rocks.filter((o) => Math.hypot(o.x - c.x, o.y - c.y) <= o.r + c.r);
  if (!near.length) return;
  const r2 = c.r * c.r;
  const y0 = Math.max(0, Math.floor(c.y - c.r));
  const y1 = Math.min(PLANE_H - 1, Math.ceil(c.y + c.r));
  const x0 = Math.max(0, Math.floor(c.x - c.r));
  const x1 = Math.min(PLANE_W - 1, Math.ceil(c.x + c.r));
  for (let y = y0; y <= y1; y++) {
    const dy = y - c.y;
    for (let x = x0; x <= x1; x++) {
      const dx = x - c.x;
      if (dx * dx + dy * dy <= r2 && near.some((o) => rockContains(o, x, y))) g[y * PLANE_W + x] = 1;
    }
  }
}
