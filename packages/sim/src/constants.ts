/** Rule values. Field units: 770 x 450 px, 50 game units wide. */
export const PLANE_W = 770;
export const PLANE_H = 450;
export const GAME_W = 50;
export const PX_PER_UNIT = PLANE_W / GAME_W;

export const TURN_MS = 60_000;
export const START_DELAY_MS = 5_000;
export const NEXT_TURN_DELAY_MS = 3_000;
export const RECONNECT_GRACE_MS = 30_000;

export const MAX_PLAYERS = 10;
export const MAX_SOLDIERS = 4;
export const DEFAULT_SOLDIERS = 1;

export const SOLDIER_R = 7;
export const SPAWN_CLEARANCE = 15;
export const SPAWN_SEPARATION = 20;
export const BLAST_R = 12;

export const CIRCLE_COUNT_MEAN = 15;
export const CIRCLE_COUNT_SD = 7;
export const CIRCLE_R_MEAN = 40;
export const CIRCLE_R_SD = 25;

export const STEP = 0.01;
export const MAX_STEPS = 20_000;
export const MAX_STEP_DIST_SQ = 0.001;
export const MIN_X_STEP = 0.00001;
export const DRAW_STEPS_PER_SEC = 1500;

export const MAX_FUNCTION_CHARS = 200;

export type ShotMode = 'fn' | 'ode1' | 'ode2';
export type Dir = 1 | -1;

export function toGameX(px: number): number {
  return (px - PLANE_W / 2) / PX_PER_UNIT;
}
export function toGameY(py: number): number {
  return (PLANE_H / 2 - py) / PX_PER_UNIT;
}
export function toPxX(gx: number): number {
  return gx * PX_PER_UNIT + PLANE_W / 2;
}
export function toPxY(gy: number): number {
  return PLANE_H / 2 - gy * PX_PER_UNIT;
}
