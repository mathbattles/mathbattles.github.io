import {
  BEAM_CARVE_R,
  BEAM_CUT_R,
  BEAM_HIT_R,
  BEAM_PX_PER_STEP,
  BLAST_R,
  HEAD_HIT_RADIUS,
  PLANE_H,
  PLANE_W,
  SOLDIER_R,
  type Dir,
} from './constants';
import {
  HEAVY_BLAST_MULT,
  HOP_JUMP_STEPS,
  HOP_LINE_STEPS,
  HOP_OUT_STEPS,
  HOP_SIDE_PX,
  MAX_ENERGY,
  FILL_R,
  HARMLESS_ABILITIES,
  NEAR_MISS_ENERGY,
  NEAR_MISS_PX,
  NO_SHOT_ABILITIES,
  SHIELD_GRACE_STEPS,
  WALL_R,
  abilityCost,
  abilityDef,
  clampEnergy,
  energyGain,
  type AbilityId,
} from './abilities';
import { ParseError } from './parser';
import { Rng } from './rng';
import {
  RuleError,
  checkOver,
  clampAngle,
  isMirrored,
  playerById,
  type BeamRecord,
  type HopRecord,
  type KillKind,
  type KillRecord,
  type MatchState,
  type Player,
  type RoundRecord,
  type ShieldRecord,
  type ShotEnd,
  type ShotRecord,
  type Soldier,
} from './rules';
import type { Terrain } from './terrain';
import { simulateShot, type ShotResult } from './trajectory';
import { terrainOf } from './rules';

/** A tip this close to a line already drawn has run into it (solid lines). */
const LINE_HIT_R2 = 3.5 * 3.5;

/** One player's shot for a round. */
export interface RoundShot {
  playerId: string;
  expr: string;
  angle?: number;
  dir?: Dir;
  ability?: AbilityId;
}

interface Flight {
  player: Player;
  shooter: Soldier;
  expr: string;
  dir: Dir;
  mirrored: boolean;
  ability?: AbilityId;
  result: ShotResult;
  /** Last step with a valid tip position. */
  last: number;
  /** Last path index used for hits (the step that ended the shot can still hit). */
  hitIdx: number;
  /** Step the shot was stopped early, if it was. */
  cut: number | null;
  cutReason: ShotEnd | null;
  hits: { id: number; step: number }[];
  blasted: boolean;
  /** Piercing Shot: whether its one pass-through is spent, where, and a moment of grace after. */
  pierceUsed: boolean;
  piercedAt: { x: number; y: number; step: number } | null;
  lineGrace: number;
  /** A pierce spent on a line means the rock it planned to pass through now stops it here. */
  rockStop: number | null;
}

interface Rider {
  flight: number;
  soldier: Soldier;
  record: HopRecord;
  phase: 'wait' | 'ride' | 'jump' | 'done';
  pathLast: number;
  endReason: ShotEnd | null;
  offset: { x: number; y: number };
  airborneUntil: number;
  pos: { x: number; y: number };
}

const HEAD_R2 = HEAD_HIT_RADIUS * HEAD_HIT_RADIUS;
const R2 = SOLDIER_R * SOLDIER_R;
const HOP_KILL_R2 = (SOLDIER_R * 2) * (SOLDIER_R * 2);
const MAX_ROUND_STEPS = 80_000;

/** Steps from a point to the field's edge along a unit direction. */
function distanceToEdge(x: number, y: number, dx: number, dy: number): number {
  let t = Infinity;
  if (dx > 1e-9) t = Math.min(t, (PLANE_W - x) / dx);
  if (dx < -1e-9) t = Math.min(t, -x / dx);
  if (dy > 1e-9) t = Math.min(t, (PLANE_H - y) / dy);
  if (dy < -1e-9) t = Math.min(t, -y / dy);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

function tangentAt(xs: ArrayLike<number>, ys: ArrayLike<number>, t: number, last: number): { x: number; y: number } {
  const i = Math.max(1, Math.min(t, last));
  let dx = xs[i]! - xs[i - 1]!;
  let dy = ys[i]! - ys[i - 1]!;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return { x: 1, y: 0 };
  dx /= len;
  dy /= len;
  return { x: dx, y: dy };
}

/** The coin used for exact ties. Same match and round, same result, everywhere. */
export function tieCoin(seed: number, round: number): Rng {
  return new Rng((Math.trunc(seed) ^ Math.imul(round + 1, 0x9e3779b1)) >>> 0);
}

/** How far the front of each beam direction has travelled at a step, in pixels. */
function beamFront(b: BeamRecord, k: number, t: number): number {
  return Math.max(0, Math.min(t, b.ends[k]!) - b.step) * BEAM_PX_PER_STEP;
}

/** True when a point is inside the drawn part of a beam, within a radius of its centre line. */
function inBeam(b: BeamRecord, t: number, x: number, y: number, r: number): boolean {
  if (t <= b.step) return false;
  for (let k = 0; k < b.dirs.length; k++) {
    const d = b.dirs[k]!;
    const along = (x - b.at.x) * d.x + (y - b.at.y) * d.y;
    const across = Math.abs((x - b.at.x) * d.y - (y - b.at.y) * d.x);
    if (across < r && along >= -r && along <= beamFront(b, k, t) + r * 0.5) return true;
  }
  return false;
}

/**
 * Where a soldier riding a Hop stands at a step, worked out from the record and the line's path.
 * The client uses this to draw the ride, so both always agree.
 */
export function hopPosition(
  hop: HopRecord,
  path: { xs: ArrayLike<number>; ys: ArrayLike<number> },
  t: number,
): { x: number; y: number; air: number } {
  if (t <= hop.start) return { ...hop.from, air: 0 };
  if (hop.jump && t >= hop.jump.start) {
    const p = Math.min(1, (t - hop.jump.start) / hop.jump.steps);
    const j = hop.jump;
    // A jump over a rock rises and falls; one out of the field keeps climbing as it leaves.
    const air = j.out ? Math.sin(Math.min(p, 0.5) * Math.PI) * (1 + p) : Math.sin(p * Math.PI);
    return { x: j.from.x + (j.to.x - j.from.x) * p, y: j.from.y + (j.to.y - j.from.y) * p, air };
  }
  const k = Math.min(t, hop.rideEnd) - hop.start;
  const i = Math.max(0, Math.min(k, hop.pathEnd));
  let x = path.xs[i]!;
  let y = path.ys[i]!;
  for (const s of hop.sides) {
    if (s.step <= t) {
      x += s.dx;
      y += s.dy;
    }
  }
  let air = 0;
  for (const o of hop.overs) {
    if (t >= o.step && t < o.step + HOP_LINE_STEPS) air = Math.max(air, 0.35 * Math.sin(((t - o.step) / HOP_LINE_STEPS) * Math.PI));
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ...hop.at, air: 0 };
  return { x, y, air };
}

/**
 * Fires every shot of a round at once and plays it out step by step on one shared clock:
 * the earliest hit wins, a shooter knocked out mid-flight has their shot explode on the spot,
 * an exact mutual kill is settled by a coin, shot tips meeting make a beam that cuts off
 * other shots, Heavy Shots blast wide, and Hop riders follow their own lines.
 * Updates the state and returns what happened, so it can be drawn.
 */
export function resolveRound(state: MatchState, inputs: RoundShot[], terrain: Terrain = terrainOf(state)): RoundRecord {
  if (state.over) throw new RuleError('The match is over');
  const free = !!state.config.freeEnergy;
  const energyBefore = new Map(state.players.map((p) => [p.id, p.energy]));
  const flights: Flight[] = [];
  const shields: ShieldRecord[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const player = playerById(state, input.playerId);
    if (!player || player.passive || seen.has(player.id)) continue;
    seen.add(player.id);
    const shooter = state.soldiers[player.soldierId];
    if (!shooter?.alive) continue;
    const dir: Dir = state.config.kind === 'ffa' && input.dir === -1 ? -1 : 1;
    const mirrored = isMirrored(state, player.id);
    // An ability needs to be owned and paid for. Otherwise the shot fires plainly.
    const def = abilityDef(input.ability);
    const cost = def ? abilityCost(def.id, state.config.energyCosts) : 0;
    const ability = def && (player.abilities ?? []).includes(def.id) && (free || player.energy >= cost) ? def.id : undefined;
    // Shield uses the turn: no line, just a bubble that stops the first hit this round.
    if (ability && NO_SHOT_ABILITIES.includes(ability)) {
      if (!free) player.energy = clampEnergy(player.energy - cost);
      shields.push({ playerId: player.id, soldierId: shooter.id });
      continue;
    }
    let result: ShotResult;
    try {
      result = simulateShot({
        mode: state.config.mode,
        expr: input.expr,
        from: { x: shooter.x, y: shooter.y },
        angle: state.config.mode === 'ode2' ? clampAngle(input.angle ?? 0) : 0,
        dir,
        mirrored,
        terrain,
        targets: [],
        ricochet: ability === 'ricochet',
        pierce: ability === 'pierce',
      });
    } catch (e) {
      // A broken function is no shot at all.
      if (e instanceof ParseError) continue;
      throw e;
    }
    if (ability && !free) player.energy = clampEnergy(player.energy - cost);
    const written = result.reason === 'edge' || result.reason === 'obstacle';
    flights.push({
      player, shooter, expr: input.expr, dir, mirrored, ability, result,
      last: Math.max(0, result.steps - 1),
      hitIdx: written ? result.steps : Math.max(0, result.steps - 1),
      cut: null, cutReason: null, hits: [], blasted: false,
      pierceUsed: !!result.pierced, piercedAt: null, lineGrace: 0, rockStop: null,
    });
  }

  // Hop riders, and a grid of every other line's points so a rider can tell when it crosses one.
  const riders: Rider[] = [];
  flights.forEach((f, i) => {
    if (f.ability !== 'hop') return;
    const record: HopRecord = {
      playerId: f.player.id, soldierId: f.shooter.id, shot: i, from: { x: f.shooter.x, y: f.shooter.y },
      start: 0, pathEnd: 0, overs: [], sides: [], rideEnd: 0, outcome: 'stand', at: { x: f.shooter.x, y: f.shooter.y },
    };
    riders.push({
      flight: i, soldier: f.shooter, record, phase: 'wait', pathLast: 0, endReason: null,
      offset: { x: 0, y: 0 }, airborneUntil: 0, pos: { x: f.shooter.x, y: f.shooter.y },
    });
  });
  const CELL = 8;
  const grid = new Map<number, [number, number][]>();
  const solid = state.config.solidLines !== false;
  if (riders.length || solid) {
    flights.forEach((f, fi) => {
      if (f.ability === 'hop') return;
      for (let i = 0; i <= f.last; i += 2) {
        const x = f.result.xs[i]!;
        const y = f.result.ys[i]!;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const key = Math.floor(x / CELL) * 1024 + Math.floor(y / CELL);
        let list = grid.get(key);
        if (!list) grid.set(key, (list = []));
        list.push([fi, i]);
      }
    });
  }
  const riderOf = new Map(riders.map((r) => [r.soldier.id, r]));
  const airborne = (id: number, t: number) => {
    const r = riderOf.get(id);
    return !!r && (r.phase === 'jump' || t < r.airborneUntil);
  };
  const posOf = (s: Soldier) => riderOf.get(s.id)?.pos ?? s;
  const shieldOf = new Map(shields.map((sh) => [sh.soldierId, sh]));
  const graceUntil = new Map<number, number>();
  const protectedAt = (id: number, t: number) => t < (graceUntil.get(id) ?? 0);
  const endStep = (f: Flight) => f.cut ?? f.result.steps;
  const flying = (f: Flight, t: number) => (f.cut === null || f.cut === t) && t <= f.hitIdx;

  const beams: BeamRecord[] = [];
  const kills: KillRecord[] = [];
  const luck: string[] = [];
  const coin = tieCoin(state.config.seed, state.round);
  const tip = (f: Flight, t: number) => {
    const i = Math.min(t, f.hitIdx);
    return { x: f.result.xs[i]!, y: f.result.ys[i]! };
  };

  let lastActive = 0;
  for (let t = 1; t <= MAX_ROUND_STEPS; t++) {
    let active = false;

    // Riders: start riding once their line has finished, follow it, and hop at the end.
    for (const r of riders) {
      if (r.phase === 'done' || !r.soldier.alive) continue;
      active = true;
      const f = flights[r.flight]!;
      const rec = r.record;
      if (r.phase === 'wait') {
        if (f.cut === null && t <= f.result.steps) continue;
        rec.start = t - 1;
        r.pathLast = Math.max(0, Math.min(f.cut ?? f.last, f.last));
        rec.pathEnd = r.pathLast;
        r.endReason = f.cutReason ?? f.result.reason;
        r.phase = 'ride';
      }
      if (r.phase === 'ride') {
        const k = t - rec.start;
        const xs = f.result.xs;
        const ys = f.result.ys;
        const i = Math.min(k, r.pathLast);
        const px = xs[i]! + r.offset.x;
        const py = ys[i]! + r.offset.y;
        if (Number.isFinite(px) && Number.isFinite(py)) r.pos = { x: px, y: py };
        // Crossing someone else's line: hop over it, or get knocked aside meeting it head on.
        if (t >= r.airborneUntil && grid.size) {
          const cx = Math.floor(r.pos.x / CELL);
          const cy = Math.floor(r.pos.y / CELL);
          let crossed: [number, number] | null = null;
          for (let gx = cx - 1; gx <= cx + 1 && !crossed; gx++) {
            for (let gy = cy - 1; gy <= cy + 1 && !crossed; gy++) {
              for (const [fi, idx] of grid.get(gx * 1024 + gy) ?? []) {
                const other = flights[fi]!;
                if (idx > Math.min(t, endStep(other))) continue;
                const dx = other.result.xs[idx]! - r.pos.x;
                const dy = other.result.ys[idx]! - r.pos.y;
                if (dx * dx + dy * dy < 9) {
                  crossed = [fi, idx];
                  break;
                }
              }
            }
          }
          if (crossed) {
            const other = flights[crossed[0]]!;
            const mine = tangentAt(xs, ys, i, r.pathLast);
            const theirs = tangentAt(other.result.xs, other.result.ys, crossed[1], other.last);
            if (Math.abs(mine.x * theirs.x + mine.y * theirs.y) > 0.9) {
              // Head on along the line: step off to the side, away from it.
              const side = (other.result.xs[crossed[1]]! - r.pos.x) * -mine.y + (other.result.ys[crossed[1]]! - r.pos.y) * mine.x > 0 ? -1 : 1;
              const dx = -mine.y * HOP_SIDE_PX * side;
              const dy = mine.x * HOP_SIDE_PX * side;
              r.offset = { x: r.offset.x + dx, y: r.offset.y + dy };
              rec.sides.push({ step: t, dx, dy });
            } else {
              rec.overs.push({ step: t });
            }
            r.airborneUntil = t + HOP_LINE_STEPS;
          }
        }
        if (k >= r.pathLast) {
          rec.rideEnd = t;
          const d = tangentAt(xs, ys, r.pathLast, r.pathLast);
          if (r.endReason === 'obstacle') {
            const land = landingPast(terrain, r.pos, d);
            if (land) {
              rec.jump = { start: t, steps: HOP_JUMP_STEPS, from: { ...r.pos }, to: land, out: false };
              rec.outcome = 'land';
            } else {
              rec.jump = { start: t, steps: HOP_OUT_STEPS, from: { ...r.pos }, to: { x: r.pos.x + d.x * 40, y: r.pos.y + d.y * 40 }, out: true };
              rec.outcome = 'out';
            }
            r.phase = 'jump';
          } else if (r.endReason === 'edge') {
            rec.jump = { start: t, steps: HOP_OUT_STEPS, from: { ...r.pos }, to: { x: r.pos.x + d.x * 40, y: r.pos.y + d.y * 40 }, out: true };
            rec.outcome = 'out';
            r.phase = 'jump';
          } else {
            rec.outcome = 'stand';
            rec.at = { ...r.pos };
            r.phase = 'done';
          }
        }
      } else if (r.phase === 'jump') {
        const j = rec.jump!;
        const p = Math.min(1, (t - j.start) / j.steps);
        r.pos = { x: j.from.x + (j.to.x - j.from.x) * p, y: j.from.y + (j.to.y - j.from.y) * p };
        if (p >= 1) {
          r.phase = 'done';
          if (j.out) {
            // Hopped clean out of the field.
            r.soldier.alive = false;
            rec.at = { x: Math.max(0, Math.min(PLANE_W, j.from.x)), y: Math.max(0, Math.min(PLANE_H, j.from.y)) };
            kills.push({ id: r.soldier.id, step: t, by: [], kind: 'out' });
            for (const g of flights) {
              if (g.shooter.id === r.soldier.id && g.cut === null && t <= g.result.steps) {
                g.cut = Math.min(t, g.last);
                g.cutReason = 'killed';
              }
            }
          } else {
            rec.at = { ...j.to };
          }
        }
      }
    }

    // Shot tips meeting: only the two moving fronts, at the same moment. Hop lines are only paths.
    for (let a = 0; a < flights.length; a++) {
      const A = flights[a]!;
      if (A.ability === 'hop' || A.cut !== null || t > A.last) continue;
      for (let b = a + 1; b < flights.length; b++) {
        const B = flights[b]!;
        if (B.ability === 'hop' || B.cut !== null || t > B.last) continue;
        const dx = A.result.xs[t]! - B.result.xs[t]!;
        const dy = A.result.ys[t]! - B.result.ys[t]!;
        if (!(dx * dx + dy * dy < HEAD_R2)) continue;
        A.cut = B.cut = t;
        A.cutReason = B.cutReason = 'collision';
        const at = { x: (A.result.xs[t]! + B.result.xs[t]!) / 2, y: (A.result.ys[t]! + B.result.ys[t]!) / 2 };
        const ta = tangentAt(A.result.xs, A.result.ys, t, A.last);
        const tb = tangentAt(B.result.xs, B.result.ys, t, B.last);
        const sx = ta.x + tb.x;
        const sy = ta.y + tb.y;
        const len = Math.hypot(sx, sy);
        // Head on, the directions cancel out, so the beam shoots out both sides instead.
        const dirs = len < 0.2 ? [{ x: -ta.y, y: ta.x }, { x: ta.y, y: -ta.x }] : [{ x: sx / len, y: sy / len }];
        beams.push({
          at, step: t, dirs,
          ends: dirs.map((d) => t + Math.ceil(distanceToEdge(at.x, at.y, d.x, d.y) / BEAM_PX_PER_STEP)),
          shots: [a, b], owners: [A.player.id, B.player.id], hits: [],
        });
        break;
      }
    }

    // A beam cuts off any shot whose tip touches it.
    for (const b of beams) {
      // A beam keeps the round going until every front has left the field, from the step it forms.
      if (b.ends.some((e) => t <= e)) active = true;
      for (const f of flights) {
        if (f.cut !== null || t > f.last || b.shots.includes(flights.indexOf(f))) continue;
        const p = tip(f, t);
        if (inBeam(b, t, p.x, p.y, BEAM_CUT_R + 3)) {
          f.cut = t;
          f.cutReason = 'beamcut';
        }
      }
    }

    for (const f of flights) {
      if (f.rockStop !== null && f.cut === null && t === f.rockStop) {
        f.cut = t;
        f.cutReason = 'obstacle';
      }
    }

    // Solid lines: a tip running into a line already drawn explodes there. Tips meeting tip to
    // tip were handled above as beams; Hop lines are only paths and never block.
    if (solid && grid.size) {
      flights.forEach((f, fi) => {
        // A Hop line is only a path for its rider, who hops over other lines, so it is never cut.
        if (f.ability === 'hop' || f.cut !== null || t > f.last || t < 3 || t < f.lineGrace) return;
        const x = f.result.xs[t]!;
        const y = f.result.ys[t]!;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const cx = Math.floor(x / CELL);
        const cy = Math.floor(y / CELL);
        let hit = false;
        for (let gx = cx - 1; gx <= cx + 1 && !hit; gx++) {
          for (let gy = cy - 1; gy <= cy + 1 && !hit; gy++) {
            for (const [gi, idx] of grid.get(gx * 1024 + gy) ?? []) {
              if (gi === fi) continue;
              const other = flights[gi]!;
              // Only what is already drawn, before this moment, and not past where it stopped.
              if (idx >= t || idx > endStep(other)) continue;
              const dx = other.result.xs[idx]! - x;
              const dy = other.result.ys[idx]! - y;
              if (dx * dx + dy * dy < LINE_HIT_R2) {
                hit = true;
                break;
              }
            }
          }
        }
        if (!hit) return;
        if (f.ability === 'pierce' && !f.pierceUsed) {
          // Piercing passes the first line it meets; if it planned to pass a rock, it no longer can.
          f.pierceUsed = true;
          f.piercedAt = { x, y, step: t };
          f.lineGrace = t + 10;
          return;
        }
        f.cut = t;
        f.cutReason = 'line';
      });
    }

    // Who dies this step, and to whom.
    const killers = new Map<number, Set<string>>();
    const kindOf = new Map<number, KillKind>();
    const byFlight = new Map<number, number[]>();
    const mark = (id: number, who: string[], kind: KillKind) => {
      if (protectedAt(id, t)) return;
      if (!killers.has(id)) killers.set(id, new Set());
      for (const w of who) killers.get(id)!.add(w);
      // The most dramatic way wins the label.
      const order: KillKind[] = ['shot', 'heavy', 'beam', 'hop'];
      const prev = kindOf.get(id);
      if (!prev || order.indexOf(kind) > order.indexOf(prev)) kindOf.set(id, kind);
    };
    flights.forEach((f, fi) => {
      if (f.cut === null && t <= f.result.steps) active = true;
      if (f.ability === 'hop' || (f.ability && HARMLESS_ABILITIES.includes(f.ability)) || !flying(f, t)) return;
      const p = tip(f, t);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      for (const s of state.soldiers) {
        if (!s.alive || s.id === f.shooter.id || airborne(s.id, t)) continue;
        const q = posOf(s);
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        if (dx * dx + dy * dy < R2) {
          mark(s.id, [f.player.id], 'shot');
          if (!byFlight.has(fi)) byFlight.set(fi, []);
          byFlight.get(fi)!.push(s.id);
        }
      }
    });
    for (const b of beams) {
      for (const s of state.soldiers) {
        if (!s.alive || airborne(s.id, t)) continue;
        const q = posOf(s);
        if (inBeam(b, t, q.x, q.y, BEAM_HIT_R)) {
          mark(s.id, b.owners, 'beam');
          if (!b.hits.some((h) => h.id === s.id)) b.hits.push({ id: s.id, step: t });
        }
      }
    }
    for (const r of riders) {
      if (r.phase !== 'ride' || !r.soldier.alive || t < r.airborneUntil) continue;
      for (const s of state.soldiers) {
        if (!s.alive || s.id === r.soldier.id || airborne(s.id, t)) continue;
        const q = posOf(s);
        const dx = q.x - r.pos.x;
        const dy = q.y - r.pos.y;
        if (dx * dx + dy * dy < HOP_KILL_R2) mark(s.id, [r.record.playerId], 'hop');
      }
    }
    // Heavy Shots blast wide where they stop.
    for (const f of flights) {
      if (f.ability !== 'heavy' || f.blasted || endStep(f) > t) continue;
      f.blasted = true;
      const at = f.cut !== null ? { x: f.result.xs[Math.min(f.cut, f.last)]!, y: f.result.ys[Math.min(f.cut, f.last)]! } : f.result.end;
      const reach = BLAST_R * HEAVY_BLAST_MULT + SOLDIER_R;
      for (const s of state.soldiers) {
        if (!s.alive || s.id === f.shooter.id || airborne(s.id, t)) continue;
        const q = posOf(s);
        if (Math.hypot(q.x - at.x, q.y - at.y) < reach) mark(s.id, [f.player.id], 'heavy');
      }
    }

    // Two players hitting each other on the very same step: a coin decides who lives.
    for (const [fa, idsA] of byFlight) {
      for (const [fb, idsB] of byFlight) {
        if (fb <= fa) continue;
        const A = flights[fa]!;
        const B = flights[fb]!;
        if (!idsA.includes(B.shooter.id) || !idsB.includes(A.shooter.id)) continue;
        if (killers.get(B.shooter.id)?.size !== 1 || killers.get(A.shooter.id)?.size !== 1) continue;
        if (kindOf.get(A.shooter.id) !== 'shot' || kindOf.get(B.shooter.id) !== 'shot') continue;
        const winner = coin.next() < 0.5 ? A : B;
        killers.delete(winner.shooter.id);
        byFlight.set(winner === A ? fb : fa, (winner === A ? idsB : idsA).filter((id) => id !== winner.shooter.id));
        luck.push(winner.player.id);
      }
    }

    for (const [id, by] of [...killers]) {
      const sh = shieldOf.get(id);
      if (!sh || sh.blocked) continue;
      sh.blocked = { step: t, by: [...by] };
      graceUntil.set(id, t + SHIELD_GRACE_STEPS);
      killers.delete(id);
    }
    for (const [fi, ids] of byFlight) {
      for (const id of ids) if (killers.has(id)) flights[fi]!.hits.push({ id, step: t });
    }
    for (const [id, by] of killers) {
      const s = state.soldiers[id]!;
      s.alive = false;
      const kind = kindOf.get(id) ?? 'shot';
      kills.push({ id, step: t, by: [...by], kind, ...(kind === 'beam' ? { beam: true } : {}) });
      if (kind === 'heavy') {
        for (const f of flights) if (f.ability === 'heavy' && by.has(f.player.id) && !f.hits.some((h) => h.id === id)) f.hits.push({ id, step: t });
      }
      // A shot whose shooter just died explodes where it is, and a rider stops.
      for (const f of flights) {
        if (f.shooter.id === id && f.cut === null && t <= f.result.steps) {
          f.cut = Math.min(t, f.last);
          f.cutReason = 'killed';
        }
      }
      const r = riderOf.get(id);
      if (r && r.phase !== 'done') {
        r.record.outcome = 'dead';
        r.record.at = { ...r.pos };
        if (!r.record.rideEnd) r.record.rideEnd = t;
        if (r.phase === 'wait') {
          r.record.start = t;
          r.record.rideEnd = t;
        }
        r.phase = 'done';
      }
    }

    if (flights.some((f) => f.ability === 'heavy' && !f.blasted)) active = true;
    if (active) lastActive = t;
    else break;
  }

  // Credit, stats, energy and terrain.
  const holesBefore = state.holes.length;
  const enemyHits = new Map<string, number>();
  const killed = new Set<string>();
  for (const k of kills) {
    const victim = state.soldiers[k.id]!;
    const owner = playerById(state, victim.playerId)!;
    owner.deaths++;
    for (const id of k.by) {
      const shooter = playerById(state, id);
      if (!shooter || shooter.id === owner.id) continue;
      const friendly = state.config.kind === 'teams' && shooter.team === owner.team;
      if (friendly) continue;
      shooter.kills++;
      killed.add(id);
      enemyHits.set(id, (enemyHits.get(id) ?? 0) + 1);
    }
  }
  const shots: ShotRecord[] = flights.map((f) => {
    const r = f.result;
    const steps = f.cut ?? r.steps;
    const end = f.cut !== null ? { x: r.xs[Math.min(f.cut, f.last)]!, y: r.ys[Math.min(f.cut, f.last)]! } : r.end;
    f.shooter.angle = r.angle;
    f.player.shots++;
    if (f.ability !== 'hop' && Number.isFinite(end.x) && Number.isFinite(end.y)) {
      if (f.ability === 'wall') {
        // New rock, unless it would bury someone.
        const clear = state.soldiers.every((q) => !q.alive || Math.hypot(q.x - end.x, q.y - end.y) > WALL_R + SOLDIER_R);
        if (clear) {
          const rock = { x: Math.round(end.x), y: Math.round(end.y), r: WALL_R, kind: 'rock' as const };
          state.holes.push(rock);
          terrain.patch(rock);
        }
      } else if (f.ability === 'fill') {
        const fill = { x: Math.round(end.x), y: Math.round(end.y), r: FILL_R, kind: 'fill' as const };
        state.holes.push(fill);
        terrain.patch(fill);
      } else {
        const hole = { x: end.x, y: end.y, r: f.ability === 'heavy' ? BLAST_R * HEAVY_BLAST_MULT : BLAST_R };
        state.holes.push(hole);
        terrain.carve(hole.x, hole.y, hole.r);
      }
    }
    return {
      playerId: f.player.id,
      soldierId: f.shooter.id,
      expr: f.expr,
      mode: state.config.mode,
      dir: f.dir,
      angle: r.angle,
      from: { x: f.shooter.x, y: f.shooter.y },
      mirrored: f.mirrored,
      steps,
      reason: f.cutReason ?? r.reason,
      end,
      hits: f.hits,
      ...(f.ability ? { ability: f.ability } : {}),
      ...(r.bounce && r.bounce.step <= steps ? { bounce: r.bounce } : {}),
      ...(f.piercedAt ? { pierced: f.piercedAt } : r.pierced && r.pierced.in.step <= steps ? { pierced: r.pierced.in } : {}),
    };
  });
  for (const b of beams) {
    b.dirs.forEach((d) => {
      const len = distanceToEdge(b.at.x, b.at.y, d.x, d.y);
      for (let s = 0; s <= len + BEAM_CARVE_R; s += BEAM_CARVE_R * 0.75) {
        const hole = { x: Math.round(b.at.x + d.x * s), y: Math.round(b.at.y + d.y * s), r: BEAM_CARVE_R };
        state.holes.push(hole);
        terrain.carve(hole.x, hole.y, hole.r);
      }
    });
  }
  for (const [id, n] of enemyHits) {
    const p = playerById(state, id)!;
    p.bestCombo = Math.max(p.bestCombo, n);
  }

  // Riders end up where their hop left them.
  const moves: RoundRecord['moves'] = [];
  for (const r of riders) {
    const from = r.record.from;
    if (r.phase !== 'done') {
      r.record.at = { ...r.pos };
      if (!r.record.rideEnd) r.record.rideEnd = lastActive;
    }
    const to = r.record.at;
    r.soldier.x = to.x;
    r.soldier.y = to.y;
    if (to.x !== from.x || to.y !== from.y) moves.push({ id: r.soldier.id, from, to });
  }

  // Near misses: a damaging line that came close to a living enemy without a kill.
  const nearMiss: string[] = [];
  const reach2 = (SOLDIER_R + NEAR_MISS_PX) ** 2;
  for (const f of flights) {
    if (killed.has(f.player.id) || nearMiss.includes(f.player.id) || f.ability === 'hop' || (f.ability && HARMLESS_ABILITIES.includes(f.ability))) continue;
    const enemies = state.soldiers.filter((q) => {
      if (!q.alive || q.id === f.shooter.id) return false;
      const owner = playerById(state, q.playerId);
      return !!owner && (state.config.kind === 'ffa' || owner.team !== f.player.team);
    });
    if (!enemies.length) continue;
    const stop = Math.min(endStep(f), f.last);
    let close = false;
    for (let i = 0; i <= stop && !close; i += 2) {
      const x = f.result.xs[i]!;
      const y = f.result.ys[i]!;
      for (const q of enemies) {
        const dx = q.x - x;
        const dy = q.y - y;
        if (dx * dx + dy * dy < reach2) {
          close = true;
          break;
        }
      }
    }
    if (close) nearMiss.push(f.player.id);
  }

  // Energy: every line fired earns more the longer the match runs. A kill fills you up.
  const gain = energyGain(state.round);
  for (const p of state.players) {
    if (free) p.energy = MAX_ENERGY;
    else if (killed.has(p.id)) p.energy = MAX_ENERGY;
    else if (flights.some((f) => f.player.id === p.id)) p.energy = clampEnergy(p.energy + gain + (nearMiss.includes(p.id) ? NEAR_MISS_ENERGY : 0));
  }

  let steps = lastActive;
  for (const s of shots) steps = Math.max(steps, s.steps);
  for (const b of beams) for (const e of b.ends) steps = Math.max(steps, e);

  const record: RoundRecord = {
    n: state.round,
    shots,
    beams,
    kills,
    luck,
    steps,
    holes: state.holes.length - holesBefore,
    hops: riders.map((r) => r.record),
    moves,
    energy: state.players.filter((p) => !p.passive).map((p) => ({ playerId: p.id, before: energyBefore.get(p.id) ?? p.energy, after: p.energy })),
    ...(shields.length ? { shields } : {}),
    ...(nearMiss.length ? { nearMiss } : {}),
  };
  state.log.push({ type: 'round', round: record });
  state.round++;
  for (const p of state.players) p.locked = false;
  checkOver(state);
  return record;
}

/**
 * Where a Hop along this path would leave you: past the rock it ends at, out of the field,
 * or standing at its end. Used for the preview.
 */
export function hopLanding(terrain: Terrain, path: ShotResult): { x: number; y: number } | 'out' {
  const last = Math.max(0, path.steps - 1);
  const end = { x: path.xs[last]!, y: path.ys[last]! };
  if (path.reason === 'edge') return 'out';
  if (path.reason !== 'obstacle') return end;
  const d = tangentAt(path.xs, path.ys, last, last);
  return landingPast(terrain, end, d) ?? 'out';
}

/** The first clear spot past a rock along a direction, or null if the field ends first. */
function landingPast(terrain: Terrain, from: { x: number; y: number }, d: { x: number; y: number }): { x: number; y: number } | null {
  const clear = (x: number, y: number) => {
    if (x < SOLDIER_R || x > PLANE_W - SOLDIER_R || y < SOLDIER_R || y > PLANE_H - SOLDIER_R) return false;
    for (let a = 0; a < 8; a++) {
      const px = Math.trunc(x + Math.cos((a * Math.PI) / 4) * (SOLDIER_R + 1));
      const py = Math.trunc(y + Math.sin((a * Math.PI) / 4) * (SOLDIER_R + 1));
      if (terrain.solidAt(px, py)) return false;
    }
    return !terrain.solidAt(Math.trunc(x), Math.trunc(y));
  };
  let inRock = false;
  for (let s = 2; s < 520; s += 2) {
    const x = from.x + d.x * s;
    const y = from.y + d.y * s;
    if (x < 0 || x >= PLANE_W || y < 0 || y >= PLANE_H) return null;
    if (terrain.solidAt(Math.trunc(x), Math.trunc(y))) inRock = true;
    else if (inRock && clear(x, y)) return { x, y };
  }
  return null;
}
