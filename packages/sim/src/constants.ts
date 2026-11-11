/** Rule values. Field units: 770 x 450 px, 50 game units wide. */
export const PLANE_W = 770;
export const PLANE_H = 450;
export const GAME_W = 50;
export const PX_PER_UNIT = PLANE_W / GAME_W;

/** Everyone aims at once during a round, then all shots fire together. */
export const ROUND_MS = 45_000;
export const START_DELAY_MS = 5_000;
/** Pause after a round's shots finish drawing, before the next round starts. */
export const NEXT_ROUND_DELAY_MS = 3_000;
export const RECONNECT_GRACE_MS = 30_000;

export const MAX_PLAYERS = 10;

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

/** Two moving shot tips closer than this, on the same step, collide and make a beam. */
export const HEAD_HIT_RADIUS = 4;
/** A beam is three times as wide as a shot and moves 1.5 times as fast. */
export const BEAM_WIDTH_MULT = 3;
export const BEAM_SPEED_MULT = 1.5;
/** A typical shot covers about this many pixels per step (a 45 degree line). */
export const SHOT_PX_PER_STEP = STEP * PX_PER_UNIT * Math.SQRT2;
export const BEAM_PX_PER_STEP = SHOT_PX_PER_STEP * BEAM_SPEED_MULT;
/** Soldiers this close to a beam's centre line die. */
export const BEAM_HIT_R = SOLDIER_R + 4.5;
/** Radius of the channel a beam tears through rock. */
export const BEAM_CARVE_R = 9;
/** A shot tip this close to a beam's centre line is cut off. */
export const BEAM_CUT_R = 5.5;

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
