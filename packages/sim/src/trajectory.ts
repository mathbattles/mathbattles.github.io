import {
  GAME_W,
  MAX_STEPS,
  MAX_STEP_DIST_SQ,
  MIN_X_STEP,
  PLANE_H,
  PLANE_W,
  PX_PER_UNIT,
  SHOT_PX_PER_STEP,
  SOLDIER_R,
  STEP,
  type Dir,
  type ShotMode,
} from './constants';
import { compile, varsForMode, type CompiledFn } from './parser';
import type { Terrain } from './terrain';

export interface Target {
  id: number;
  x: number;
  y: number;
}

export interface ShotRequest {
  mode: ShotMode;
  expr: string | CompiledFn;
  /** Shooter position in field pixels. */
  from: { x: number; y: number };
  /** Elevation relative to the direction of travel, radians. y'' only. */
  angle?: number;
  /** +1 travels toward +x, -1 toward -x, in the shooter's frame. */
  dir?: Dir;
  /** Team 2 in team modes: the shooter sees the field left-right flipped. */
  mirrored?: boolean;
  terrain: Terrain;
  /** Living soldiers other than the shooter. */
  targets: readonly Target[];
  /** Ricochet: bounce once off the first rock, like light off a mirror, then fly straight. */
  ricochet?: boolean;
}

export type EndReason = 'obstacle' | 'edge' | 'invalid' | 'steep' | 'too-long';

export interface ShotResult {
  /** Field-pixel path, length steps. Empty when collect is false. */
  xs: Float64Array;
  ys: Float64Array;
  steps: number;
  hits: { id: number; step: number }[];
  end: { x: number; y: number };
  reason: EndReason;
  angle: number;
  /** Where a ricochet bounced, if it did. */
  bounce?: { x: number; y: number; step: number };
}

const ANGLE_ERROR = Math.PI / 360;
const MAX_ANGLE_LOOPS = 100;

/** Advances one step and returns the next y. y'' also writes the next slope to nextDy. */
type Stepper = (x: number, y: number, dy: number, h: number) => number;

/** Simulates a shot. Pure apart from reading the terrain. Same inputs give same outputs. */
export function simulateShot(
  req: ShotRequest,
  opts: { collect?: boolean; buffers?: { xs: Float64Array; ys: Float64Array } } = {},
): ShotResult {
  const collect = opts.collect !== false;
  const f = typeof req.expr === 'string' ? compile(req.expr, { vars: varsForMode(req.mode) }) : req.expr;
  const dir: number = req.dir ?? 1;
  const mirrored = !!req.mirrored;
  const R = SOLDIER_R / PX_PER_UNIT;

  const fromPx = mirrored ? PLANE_W - req.from.x : req.from.x;
  const sx = (fromPx - PLANE_W / 2) / PX_PER_UNIT;
  const sy = (PLANE_H / 2 - req.from.y) / PX_PER_UNIT;

  let x0 = sx;
  let y0 = sy;
  let dy0 = 0;
  let angle = 0;
  let offset = 0;
  let stepper: Stepper;

  if (req.mode === 'fn') {
    angle = fnStartAngle(f, sx, dir, R);
    if (Number.isFinite(angle)) {
      x0 = sx + dir * R * Math.cos(angle);
      y0 = sy + R * Math.sin(angle);
    }
    offset = y0 - f(x0, 0, 0);
    stepper = (x, _y, _d, h) => f(x + dir * h, 0, 0) + offset;
  } else if (req.mode === 'ode1') {
    angle = ode1StartAngle(f, sx, sy, dir, R);
    if (Number.isFinite(angle)) {
      x0 = sx + dir * R * Math.cos(angle);
      y0 = sy + R * Math.sin(angle);
    }
    stepper = (x, y, _d, h) => rk4(f, x, y, dir * h);
  } else {
    angle = req.angle ?? 0;
    x0 = sx + dir * R * Math.cos(angle);
    y0 = sy + R * Math.sin(angle);
    dy0 = dir * Math.tan(angle);
    stepper = (x, y, d, h) => rk42(f, x, y, d, dir * h);
  }

  const xs = collect ? (opts.buffers?.xs ?? new Float64Array(MAX_STEPS)) : EMPTY;
  const ys = collect ? (opts.buffers?.ys ?? new Float64Array(MAX_STEPS)) : EMPTY;
  const hits: { id: number; step: number }[] = [];
  const pending = req.targets.slice() as Target[];

  let px = toPx(x0, mirrored);
  let py = (PLANE_H / 2) - y0 * PX_PER_UNIT;
  if (collect) {
    xs[0] = px;
    ys[0] = py;
  }

  let x = x0;
  let y = y0;
  let dy = dy0;
  let steps = MAX_STEPS;
  let reason: EndReason = 'too-long';
  let lastPx = px;
  let lastPy = py;
  const endsOnSteep = req.mode === 'fn';
  const R2 = SOLDIER_R * SOLDIER_R;
  // After a ricochet the shot flies straight, in field pixels.
  let straight = false;
  let sdx = 0;
  let sdy = 0;
  let bounce: ShotResult['bounce'];

  for (let i = 1; i < MAX_STEPS; i++) {
    if (straight) {
      px += sdx;
      py += sdy;
    } else {
      let h = STEP;
      let ny = stepper(x, y, dy, h);
      let nx = x + dir * h;
      let ended = false;
      while (true) {
        const ddx = nx - x;
        const ddy = ny - y;
        if (!(ddx * ddx + ddy * ddy > MAX_STEP_DIST_SQ)) break;
        if (Math.abs(nx - x) > MIN_X_STEP) {
          h /= 2;
          ny = stepper(x, y, dy, h);
          nx = x + dir * h;
        } else {
          // y = f(x) ends on a true jump. Solved equations keep going at the smallest step.
          if (endsOnSteep) ended = true;
          break;
        }
      }
      if (ended) {
        steps = i;
        reason = 'steep';
        break;
      }

      x = nx;
      y = ny;
      dy = nextDy;
      px = toPx(x, mirrored);
      py = PLANE_H / 2 - y * PX_PER_UNIT;
    }
    if (collect) {
      xs[i] = px;
      ys[i] = py;
    }

    for (let t = pending.length - 1; t >= 0; t--) {
      const s = pending[t]!;
      const dx = s.x - px;
      const dyPx = s.y - py;
      if (dx * dx + dyPx * dyPx < R2) {
        hits.push({ id: s.id, step: i });
        pending.splice(t, 1);
      }
    }

    if (!Number.isFinite(py)) {
      steps = i;
      reason = 'invalid';
      break;
    }
    const ipx = Math.trunc(px);
    const ipy = Math.trunc(py);
    if (ipx < 0 || ipx >= PLANE_W || ipy < 0 || ipy >= PLANE_H) {
      steps = i;
      reason = 'edge';
      break;
    }
    if (req.terrain.solidAt(ipx, ipy)) {
      if (req.ricochet && !bounce) {
        // Bounce off the rock's surface: reflect the direction about the surface normal.
        const n = surfaceNormal(req.terrain, px, py);
        let ddx = px - lastPx;
        let ddy = py - lastPy;
        const len = Math.hypot(ddx, ddy) || 1;
        ddx /= len;
        ddy /= len;
        const dot = ddx * n.x + ddy * n.y;
        sdx = (ddx - 2 * dot * n.x) * SHOT_PX_PER_STEP;
        sdy = (ddy - 2 * dot * n.y) * SHOT_PX_PER_STEP;
        straight = true;
        px = lastPx;
        py = lastPy;
        if (collect) {
          xs[i] = px;
          ys[i] = py;
        }
        bounce = { x: px, y: py, step: i };
        continue;
      }
      steps = i;
      reason = 'obstacle';
      break;
    }
    lastPx = px;
    lastPy = py;
  }

  return {
    xs,
    ys,
    steps,
    hits,
    end: { x: lastPx, y: lastPy },
    reason,
    angle: Number.isFinite(angle) ? angle : 0,
    ...(bounce ? { bounce } : {}),
  };
}

/**
 * The outward direction of the rock surface at a point: away from the rock pixels around it.
 * Works for circles, flat sides, corners and carved holes alike.
 */
function surfaceNormal(terrain: Terrain, x: number, y: number): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  const cx = Math.trunc(x);
  const cy = Math.trunc(y);
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      if (dx * dx + dy * dy > 16) continue;
      if (terrain.solidAt(cx + dx, cy + dy)) {
        sx -= dx;
        sy -= dy;
      }
    }
  }
  const len = Math.hypot(sx, sy);
  return len > 0 ? { x: sx / len, y: sy / len } : { x: -1, y: 0 };
}

const EMPTY = new Float64Array(0);

function toPx(gx: number, mirrored: boolean): number {
  const p = (PLANE_W * gx) / GAME_W + PLANE_W / 2;
  return mirrored ? PLANE_W - p : p;
}

/** Finds the tangent angle where the curve leaves the soldier's hitbox edge. */
function fnStartAngle(f: CompiledFn, x: number, dir: number, R: number): number {
  const slope = (at: number) => (f(at + dir * STEP, 0, 0) - f(at, 0, 0)) / STEP;
  let angle = Math.atan(slope(x));
  for (let i = 0, err = Infinity; err > ANGLE_ERROR && i < MAX_ANGLE_LOOPS; i++) {
    const next = Math.atan(slope(x + dir * R * Math.cos(angle)));
    err = Math.abs(next - angle);
    angle = next;
  }
  return angle;
}

function ode1StartAngle(f: CompiledFn, x: number, y: number, dir: number, R: number): number {
  let angle = 0;
  for (let i = 0, err = Infinity; err > ANGLE_ERROR && i < MAX_ANGLE_LOOPS; i++) {
    const ax = x + dir * R * Math.cos(angle);
    const ay = y + R * Math.sin(angle);
    const ny = rk4(f, ax, ay, dir * STEP);
    const next = Math.atan((ny - ay) / STEP);
    err = Math.abs(next - angle);
    angle = next;
  }
  return angle;
}

function rk4(f: CompiledFn, x: number, y: number, h: number): number {
  const k1 = f(x, y, 0);
  const k2 = f(x + h / 2, y + (h / 2) * k1, 0);
  const k3 = f(x + h / 2, y + (h / 2) * k2, 0);
  const k4 = f(x + h, y + h * k3, 0);
  return y + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
}

let nextDy = 0;

function rk42(f: CompiledFn, x: number, y: number, d: number, h: number): number {
  const k1y = d;
  const k1d = f(x, y, d);
  const k2y = d + (h / 2) * k1d;
  const k2d = f(x + h / 2, y + (h / 2) * k1y, k2y);
  const k3y = d + (h / 2) * k2d;
  const k3d = f(x + h / 2, y + (h / 2) * k2y, k3y);
  const k4y = d + h * k3d;
  const k4d = f(x + h, y + h * k3y, k4y);
  nextDy = d + (h / 6) * (k1d + 2 * k2d + 2 * k3d + k4d);
  return y + (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
}
