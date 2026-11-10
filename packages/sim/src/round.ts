import {
  BEAM_CARVE_R,
  BEAM_HIT_R,
  BEAM_PX_PER_STEP,
  BLAST_R,
  HEAD_HIT_RADIUS,
  PLANE_H,
  PLANE_W,
  type Dir,
} from './constants';
import { ParseError } from './parser';
import { Rng } from './rng';
import {
  RuleError,
  checkOver,
  clampAngle,
  isMirrored,
  livingTargets,
  playerById,
  type BeamRecord,
  type KillRecord,
  type MatchState,
  type Player,
  type RoundRecord,
  type ShotEnd,
  type ShotRecord,
  type Soldier,
} from './rules';
import type { Terrain } from './terrain';
import { simulateShot, type ShotResult } from './trajectory';
import { terrainOf } from './rules';

/** One player's shot for a round. */
export interface RoundShot {
  playerId: string;
  expr: string;
  angle?: number;
  dir?: Dir;
}

interface Flight {
  player: Player;
  shooter: Soldier;
  expr: string;
  dir: Dir;
  mirrored: boolean;
  result: ShotResult;
  /** Last step with a valid tip position. */
  last: number;
  /** Step the shot was stopped early, if it was. */
  cut: number | null;
  cutReason: ShotEnd | null;
  hits: { id: number; step: number }[];
}

type Ev =
  | { step: number; kind: 'hit'; f: number; id: number }
  | { step: number; kind: 'meet'; a: number; b: number }
  | { step: number; kind: 'beam'; beam: number; id: number };

const HEAD_R2 = HEAD_HIT_RADIUS * HEAD_HIT_RADIUS;

/** Steps from a point to the field's edge along a unit direction. */
function distanceToEdge(x: number, y: number, dx: number, dy: number): number {
  let t = Infinity;
  if (dx > 1e-9) t = Math.min(t, (PLANE_W - x) / dx);
  if (dx < -1e-9) t = Math.min(t, -x / dx);
  if (dy > 1e-9) t = Math.min(t, (PLANE_H - y) / dy);
  if (dy < -1e-9) t = Math.min(t, -y / dy);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

function tangent(r: ShotResult, t: number): { x: number; y: number } {
  const i = Math.max(1, t);
  let dx = r.xs[i]! - r.xs[i - 1]!;
  let dy = r.ys[i]! - r.ys[i - 1]!;
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

/**
 * Fires every shot of a round at once and works out what happens, step by step:
 * the earliest hit wins, a shooter killed mid-flight has their shot explode on the spot,
 * an exact mutual kill is settled by a coin flip, and two shot tips meeting make a beam.
 * Updates the state and returns what happened, so it can be drawn.
 */
export function resolveRound(state: MatchState, inputs: RoundShot[], terrain: Terrain = terrainOf(state)): RoundRecord {
  if (state.over) throw new RuleError('The match is over');
  const flights: Flight[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const player = playerById(state, input.playerId);
    if (!player || player.passive || seen.has(player.id)) continue;
    seen.add(player.id);
    const shooter = state.soldiers[player.soldierId];
    if (!shooter?.alive) continue;
    const dir: Dir = state.config.kind === 'ffa' && input.dir === -1 ? -1 : 1;
    const mirrored = isMirrored(state, player.id);
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
        targets: livingTargets(state, shooter.id),
      });
    } catch (e) {
      // A broken function is no shot at all.
      if (e instanceof ParseError) continue;
      throw e;
    }
    flights.push({
      player, shooter, expr: input.expr, dir, mirrored, result,
      last: Math.max(0, result.steps - 1),
      cut: null, cutReason: null, hits: [],
    });
  }

  const events: Ev[] = [];
  flights.forEach((f, i) => {
    for (const h of f.result.hits) events.push({ step: h.step, kind: 'hit', f: i, id: h.id });
  });
  // Shot tips meeting: only the two moving fronts, at the same moment.
  for (let a = 0; a < flights.length; a++) {
    for (let b = a + 1; b < flights.length; b++) {
      const A = flights[a]!.result;
      const B = flights[b]!.result;
      const end = Math.min(flights[a]!.last, flights[b]!.last);
      for (let t = 1; t <= end; t++) {
        const dx = A.xs[t]! - B.xs[t]!;
        const dy = A.ys[t]! - B.ys[t]!;
        if (dx * dx + dy * dy < HEAD_R2) {
          events.push({ step: t, kind: 'meet', a, b });
          break;
        }
      }
    }
  }

  const beams: BeamRecord[] = [];
  const kills: KillRecord[] = [];
  const luck: string[] = [];
  const coin = tieCoin(state.config.seed, state.round);
  const done = new Array<boolean>(events.length).fill(false);

  for (;;) {
    let step = Infinity;
    for (let i = 0; i < events.length; i++) if (!done[i] && events[i]!.step < step) step = events[i]!.step;
    if (step === Infinity) break;
    const now: Ev[] = [];
    for (let i = 0; i < events.length; i++) {
      if (!done[i] && events[i]!.step === step) {
        done[i] = true;
        now.push(events[i]!);
      }
    }

    // Tips meeting stop both shots and start a beam.
    for (const ev of now) {
      if (ev.kind !== 'meet') continue;
      const A = flights[ev.a]!;
      const B = flights[ev.b]!;
      if (A.cut !== null || B.cut !== null) continue;
      A.cut = B.cut = step;
      A.cutReason = B.cutReason = 'collision';
      const at = {
        x: (A.result.xs[step]! + B.result.xs[step]!) / 2,
        y: (A.result.ys[step]! + B.result.ys[step]!) / 2,
      };
      const ta = tangent(A.result, step);
      const tb = tangent(B.result, step);
      const sx = ta.x + tb.x;
      const sy = ta.y + tb.y;
      const len = Math.hypot(sx, sy);
      // Head on, the directions cancel out, so the beam shoots out both sides instead.
      const dirs = len < 0.2 ? [{ x: -ta.y, y: ta.x }, { x: ta.y, y: -ta.x }] : [{ x: sx / len, y: sy / len }];
      const beam: BeamRecord = {
        at,
        step,
        dirs,
        ends: dirs.map((d) => step + Math.ceil(distanceToEdge(at.x, at.y, d.x, d.y) / BEAM_PX_PER_STEP)),
        shots: [ev.a, ev.b],
        owners: [A.player.id, B.player.id],
        hits: [],
      };
      const index = beams.push(beam) - 1;
      for (const s of state.soldiers) {
        if (!s.alive) continue;
        let first = Infinity;
        dirs.forEach((d, k) => {
          const along = (s.x - at.x) * d.x + (s.y - at.y) * d.y;
          const across = Math.abs((s.x - at.x) * d.y - (s.y - at.y) * d.x);
          if (across >= BEAM_HIT_R || along < -BEAM_HIT_R) return;
          const t = step + Math.max(1, Math.ceil(Math.max(0, along) / BEAM_PX_PER_STEP));
          if (t <= beam.ends[k]! + 1) first = Math.min(first, t);
        });
        if (first !== Infinity) {
          events.push({ step: first, kind: 'beam', beam: index, id: s.id });
          done.push(false);
        }
      }
    }

    // Who dies this step, and to whom.
    const killers = new Map<number, Set<string>>();
    const byFlight = new Map<number, number[]>();
    const beamKill = new Set<number>();
    for (const ev of now) {
      if (ev.kind === 'meet') continue;
      const victim = state.soldiers[ev.id];
      if (!victim?.alive) continue;
      if (ev.kind === 'hit') {
        const f = flights[ev.f]!;
        if (f.cut !== null && f.cut < step) continue;
        if (!killers.has(ev.id)) killers.set(ev.id, new Set());
        killers.get(ev.id)!.add(f.player.id);
        if (!byFlight.has(ev.f)) byFlight.set(ev.f, []);
        byFlight.get(ev.f)!.push(ev.id);
      } else {
        const beam = beams[ev.beam]!;
        if (!killers.has(ev.id)) killers.set(ev.id, new Set());
        for (const o of beam.owners) killers.get(ev.id)!.add(o);
        beamKill.add(ev.id);
        beam.hits.push({ id: ev.id, step });
      }
    }

    // Two players hitting each other on the very same step: a coin decides who lives.
    for (const [fa, idsA] of byFlight) {
      for (const [fb, idsB] of byFlight) {
        if (fb <= fa) continue;
        const A = flights[fa]!;
        const B = flights[fb]!;
        if (!idsA.includes(B.shooter.id) || !idsB.includes(A.shooter.id)) continue;
        const onlyA = killers.get(B.shooter.id)?.size === 1 && !beamKill.has(B.shooter.id);
        const onlyB = killers.get(A.shooter.id)?.size === 1 && !beamKill.has(A.shooter.id);
        if (!onlyA || !onlyB) continue;
        const winner = coin.next() < 0.5 ? A : B;
        const loser = winner === A ? B : A;
        killers.delete(winner.shooter.id);
        byFlight.set(winner === A ? fb : fa, (winner === A ? idsB : idsA).filter((id) => id !== winner.shooter.id));
        void loser;
        luck.push(winner.player.id);
      }
    }

    for (const [fi, ids] of byFlight) {
      for (const id of ids) if (killers.has(id)) flights[fi]!.hits.push({ id, step });
    }
    for (const [id, by] of killers) {
      const s = state.soldiers[id]!;
      s.alive = false;
      kills.push({ id, step, by: [...by], ...(beamKill.has(id) ? { beam: true } : {}) });
      // A shot whose shooter just died explodes where it is.
      for (const f of flights) {
        if (f.shooter.id === id && f.cut === null) {
          f.cut = Math.min(step, f.last);
          f.cutReason = 'killed';
        }
      }
    }
  }

  // Credit, stats and terrain.
  const holesBefore = state.holes.length;
  const enemyHits = new Map<string, number>();
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
      enemyHits.set(id, (enemyHits.get(id) ?? 0) + 1);
    }
  }
  const shots: ShotRecord[] = flights.map((f) => {
    const r = f.result;
    const steps = f.cut ?? r.steps;
    const end = f.cut !== null ? { x: r.xs[f.cut]!, y: r.ys[f.cut]! } : r.end;
    f.shooter.angle = r.angle;
    f.player.shots++;
    if (Number.isFinite(end.x) && Number.isFinite(end.y)) {
      const hole = { x: end.x, y: end.y, r: BLAST_R };
      state.holes.push(hole);
      terrain.carve(hole.x, hole.y, hole.r);
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

  let steps = 0;
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
  };
  state.log.push({ type: 'round', round: record });
  state.round++;
  for (const p of state.players) p.locked = false;
  checkOver(state);
  return record;
}
