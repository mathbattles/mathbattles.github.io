import { PLANE_H, PLANE_W } from './constants';

export interface Circle {
  x: number;
  y: number;
  r: number;
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
    for (const h of this.holes) paint(g, h, 0);
    this.grid = g;
    return g;
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
      if (dx * dx + dy * dy <= r2) g[row + x] = value;
    }
  }
}
