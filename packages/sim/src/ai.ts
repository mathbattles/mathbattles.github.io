import { BLAST_R, MAX_STEPS, PLANE_H, PLANE_W, SOLDIER_R, type ShotMode } from './constants';
import { ABILITIES, HEAVY_BLAST_MULT, type AbilityId, abilityCost, isNoShot } from './abilities';
import { compile, varsForMode } from './parser';
import { Rng } from './rng';
import { isMirrored, livingTargets, playerById, terrainOf, type MatchState } from './rules';
import { simulateShot } from './trajectory';

export const BOT_LEVELS = {
  easy: { label: 'Easy', generations: 10, aimError: 0.3 },
  normal: { label: 'Normal', generations: 50, aimError: 0.12 },
  hard: { label: 'Hard', generations: 150, aimError: 0.03 },
  genius: { label: 'Genius', generations: 400, aimError: 0 },
} as const;
export type BotLevel = keyof typeof BOT_LEVELS;

/** Only the strongest bots spend energy on abilities; the others keep things simple. */
export function botUsesAbilities(level: string | undefined): boolean {
  return level === 'hard' || level === 'genius';
}

export const BOT_NAMES = ['Euler', 'Gauss', 'Noether', 'Ramanujan', 'Hypatia', 'Riemann', 'Lovelace', 'Turing', 'Cantor'];

const POPULATION = 50;

interface Genome {
  template: number;
  params: number[];
  angle: number;
  dir: 1 | -1;
  /** The ability tried with this shot, if any. */
  ability?: AbilityId;
  score: number;
}

type Template = { n: number; build: (p: string[]) => string };

const FN_TEMPLATES: Template[] = [
  { n: 1, build: ([a]) => `${a}*x` },
  { n: 2, build: ([a, b]) => `${a}*(x-${b})^2/50` },
  { n: 3, build: ([a, b, c]) => `${a}*sin(${b}*x+${c})` },
  { n: 3, build: ([a, b, c]) => `${a}*cos(${b}*x+${c})+x/${c}` },
  { n: 3, build: ([a, b, c]) => `${a}/(1+exp(-${b}*(x-${c})))` },
  { n: 3, build: ([a, b, c]) => `${a}*x+${b}/(1+exp(-3*(x-${c})))` },
  { n: 2, build: ([a, b]) => `${a}*abs(x-${b})` },
];
const ODE1_TEMPLATES: Template[] = [
  { n: 1, build: ([a]) => `${a}` },
  { n: 2, build: ([a, b]) => `${a}*y+${b}` },
  { n: 2, build: ([a, b]) => `${a}*x+${b}` },
  { n: 3, build: ([a, b, c]) => `${a}*sin(${b}*x)+${c}` },
];
const ODE2_TEMPLATES: Template[] = [
  { n: 1, build: ([a]) => `${a}` },
  { n: 2, build: ([a, b]) => `${a}*y'+${b}` },
  { n: 2, build: ([a, b]) => `${a}*y+${b}` },
  { n: 3, build: ([a, b, c]) => `${a}*sin(${b}*x)+${c}` },
];

function templatesFor(mode: ShotMode): Template[] {
  return mode === 'fn' ? FN_TEMPLATES : mode === 'ode1' ? ODE1_TEMPLATES : ODE2_TEMPLATES;
}

function fmt(n: number): string {
  const v = Number(n.toFixed(3));
  return v < 0 ? `(${v})` : String(v);
}

function exprOf(mode: ShotMode, g: Genome): string {
  const t = templatesFor(mode)[g.template]!;
  return t.build(g.params.map(fmt));
}

function randomGenome(rng: Rng, mode: ShotMode, ffa: boolean, usable: readonly AbilityId[] = []): Genome {
  const tpl = rng.int(templatesFor(mode).length);
  const n = templatesFor(mode)[tpl]!.n;
  const params: number[] = [];
  for (let i = 0; i < n; i++) params.push(rng.gaussian() * 3);
  return {
    template: tpl,
    params,
    angle: rng.range(-1.3, 1.3),
    dir: ffa && rng.next() < 0.5 ? -1 : 1,
    ...(usable.length && rng.next() < 0.35 ? { ability: usable[rng.int(usable.length)] } : {}),
    score: -Infinity,
  };
}

export interface BotMove {
  expr: string;
  angle: number;
  dir: 1 | -1;
  /** True when the best shot found would hit at least one enemy. */
  expectedHit: boolean;
  /** An ability worth spending energy on for this shot. */
  ability?: AbilityId;
}

export interface ThinkOptions {
  /** The bot that is aiming. Everyone aims at once, so each bot plans from its own soldier. */
  playerId: string;
  /** Let the bot try its abilities when it has the energy. */
  useAbilities?: boolean;
  generations: number;
  seed: number;
  /** Random change to the final numbers, so lower levels miss like people do. */
  aimError?: number;
  /** Stops after simulating this many shots. Use where clocks can't be trusted during computation. */
  maxEvals?: number;
  /** Stops evolving after this long and returns the best so far. */
  budgetMs?: number;
  now?: () => number;
}

/** Evolves candidate functions against the actual simulation and returns the best one. */
export function chooseMove(state: MatchState, opts: ThinkOptions): BotMove {
  const fallback: BotMove = { expr: '0', angle: 0, dir: 1, expectedHit: false };
  const me = playerById(state, opts.playerId);
  const shooter = me ? state.soldiers[me.soldierId] : undefined;
  if (!me || !shooter?.alive) return fallback;

  const rng = new Rng(opts.seed);
  const mode = state.config.mode;
  const ffa = state.config.kind === 'ffa';
  const mirrored = isMirrored(state, me.id);
  const terrain = terrainOf(state);
  const targets = livingTargets(state, shooter.id);
  const isEnemy = new Map<number, boolean>();
  for (const s of state.soldiers) {
    const owner = state.players.find((p) => p.id === s.playerId)!;
    isEnemy.set(s.id, ffa ? owner.id !== me.id : owner.team !== me.team);
  }
  const enemies = targets.filter((t) => isEnemy.get(t.id));
  const vars = varsForMode(mode);
  const buffers = { xs: new Float64Array(MAX_STEPS), ys: new Float64Array(MAX_STEPS) };

  let evals = 0;
  const maxEvals = opts.maxEvals ?? Infinity;
  // Abilities the bot owns and can pay for this round.
  const canPay = (id: AbilityId) => state.config.freeEnergy || me.energy >= abilityCost(id, state.config.energyCosts);
  const owns = (id: AbilityId) => (me.abilities ?? []).includes(id);
  const usable: AbilityId[] = opts.useAbilities
    ? ABILITIES.filter((a) => owns(a.id) && canPay(a.id) && !isNoShot(a.id)).map((a) => a.id)
    : [];
  const evaluate = (g: Genome): number => {
    evals++;
    let f;
    try {
      f = compile(exprOf(mode, g), { vars });
    } catch {
      return -1e9;
    }
    const r = simulateShot({
      mode,
      expr: f,
      from: { x: shooter.x, y: shooter.y },
      angle: g.angle,
      dir: g.dir,
      mirrored,
      terrain,
      targets: g.ability === 'hop' || g.ability === 'wall' || g.ability === 'fill' ? [] : targets,
      ricochet: g.ability === 'ricochet',
      pierce: g.ability === 'pierce',
    }, { buffers });
    let score = 0;
    // Spending energy should only happen when it really helps.
    if (g.ability) score -= 60;
    if (g.ability === 'wall' || g.ability === 'fill') {
      // Cover: a new rock (or patched crater) between this bot and the nearest enemy, close to itself.
      const near = enemies.reduce<typeof enemies[number] | null>((b, e) => (!b || Math.hypot(e.x - shooter.x, e.y - shooter.y) < Math.hypot(b.x - shooter.x, b.y - shooter.y) ? e : b), null);
      if (!near || r.reason === 'edge') return score - 500;
      const mid = { x: shooter.x + (near.x - shooter.x) * 0.25, y: shooter.y + (near.y - shooter.y) * 0.25 };
      const d = Math.hypot(r.end.x - mid.x, r.end.y - mid.y);
      if (Math.hypot(r.end.x - shooter.x, r.end.y - shooter.y) < 40) return score - 800;
      return score - 300 + 500 / (1 + d / 25);
    }
    if (g.ability === 'hop') {
      // Riding: touching an enemy is a Hop Kill; ending at the edge throws you out of the field.
      if (r.reason === 'edge') return score - 3000;
      const stride = Math.max(1, Math.floor(r.steps / 400));
      const touched = new Set<number>();
      for (let i = 0; i < r.steps; i += stride) {
        for (const t of targets) {
          if (touched.has(t.id)) continue;
          if (Math.hypot(r.xs[i]! - t.x, r.ys[i]! - t.y) < SOLDIER_R * 2) touched.add(t.id);
        }
      }
      for (const id of touched) score += isEnemy.get(id) ? 1000 : -1500;
      // Landing somewhere sensible matters too.
      const e = r.end;
      if (e.x < 20 || e.x > PLANE_W - 20 || e.y < 20 || e.y > PLANE_H - 20) score -= 400;
      return score;
    }
    for (const h of r.hits) score += isEnemy.get(h.id) ? 1000 : -1500;
    if (g.ability === 'heavy') {
      const hit = new Set(r.hits.map((h) => h.id));
      for (const t of targets) {
        if (hit.has(t.id)) continue;
        if (Math.hypot(r.end.x - t.x, r.end.y - t.y) < BLAST_R * HEAVY_BLAST_MULT + SOLDIER_R) score += isEnemy.get(t.id) ? 1000 : -1500;
      }
    }
    // Reward getting close to living enemies that weren't hit, so evolution has a slope to climb.
    const hitIds = new Set(r.hits.map((h) => h.id));
    let best = Infinity;
    const stride = Math.max(1, Math.floor(r.steps / 300));
    for (const e of enemies) {
      if (hitIds.has(e.id)) continue;
      for (let i = 0; i < r.steps; i += stride) {
        const d = Math.hypot(r.xs[i]! - e.x, r.ys[i]! - e.y);
        if (d < best) best = d;
      }
    }
    if (best !== Infinity) score += 200 / (1 + best / 20);
    return score;
  };

  const now = opts.now ?? (() => Date.now());
  const deadline = opts.budgetMs !== undefined ? now() + opts.budgetMs : Infinity;

  let pop: Genome[] = [];
  for (let i = 0; i < POPULATION && (i < 5 || (now() <= deadline && evals < maxEvals)); i++) {
    const g = randomGenome(rng, mode, ffa, usable);
    g.score = evaluate(g);
    pop.push(g);
  }
  pop.sort((a, b) => b.score - a.score);

  for (let gen = 0; gen < opts.generations; gen++) {
    if (now() > deadline || evals >= maxEvals) break;
    const next = pop.slice(0, 5);
    while (next.length < POPULATION && evals < maxEvals) {
      if (rng.next() < 0.15) {
        const g = randomGenome(rng, mode, ffa, usable);
        g.score = evaluate(g);
        next.push(g);
        continue;
      }
      const parent = pop[rng.int(Math.min(15, pop.length))]!;
      const scale = rng.next() < 0.5 ? 0.15 : 0.8;
      const g: Genome = {
        template: parent.template,
        params: parent.params.map((p) => p + rng.gaussian() * scale),
        angle: parent.angle + rng.gaussian() * 0.1 * scale,
        dir: parent.dir,
        ...(parent.ability ? { ability: parent.ability } : {}),
        score: -Infinity,
      };
      g.score = evaluate(g);
      next.push(g);
    }
    next.sort((a, b) => b.score - a.score);
    pop = next;
  }

  // Shield: when a strong bot is badly exposed and its own best shot can't kill, it can sit the round out safely.
  if (opts.useAbilities && owns('shield') && canPay('shield') && pop[0]!.score < 900 && enemies.some((e) => Math.hypot(e.x - shooter.x, e.y - shooter.y) < 220) && rng.next() < 0.4) {
    return { expr: '', angle: 0, dir: 1, expectedHit: false, ability: 'shield' };
  }
  const top = pop[0]!;
  if (opts.aimError) {
    top.params = top.params.map((p) => p * (1 + rng.gaussian() * opts.aimError!));
    top.angle += rng.gaussian() * opts.aimError * 0.5;
  }
  return { expr: exprOf(mode, top), angle: top.angle, dir: top.dir, expectedHit: top.score >= 900, ...(top.ability ? { ability: top.ability } : {}) };
}
