import { MAX_STEPS, type ShotMode } from './constants';
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

export const BOT_NAMES = ['Euler', 'Gauss', 'Noether', 'Ramanujan', 'Hypatia', 'Riemann', 'Lovelace', 'Turing', 'Cantor'];

const POPULATION = 50;

interface Genome {
  template: number;
  params: number[];
  angle: number;
  dir: 1 | -1;
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

function randomGenome(rng: Rng, mode: ShotMode, ffa: boolean): Genome {
  const tpl = rng.int(templatesFor(mode).length);
  const n = templatesFor(mode)[tpl]!.n;
  const params: number[] = [];
  for (let i = 0; i < n; i++) params.push(rng.gaussian() * 3);
  return {
    template: tpl,
    params,
    angle: rng.range(-1.3, 1.3),
    dir: ffa && rng.next() < 0.5 ? -1 : 1,
    score: -Infinity,
  };
}

export interface BotMove {
  expr: string;
  angle: number;
  dir: 1 | -1;
  /** True when the best shot found would hit at least one enemy. */
  expectedHit: boolean;
}

export interface ThinkOptions {
  /** The bot that is aiming. Everyone aims at once, so each bot plans from its own soldier. */
  playerId: string;
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
      targets,
    }, { buffers });
    let score = 0;
    for (const h of r.hits) score += isEnemy.get(h.id) ? 1000 : -1500;
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
    const g = randomGenome(rng, mode, ffa);
    g.score = evaluate(g);
    pop.push(g);
  }
  pop.sort((a, b) => b.score - a.score);

  for (let gen = 0; gen < opts.generations; gen++) {
    if (now() > deadline || evals >= maxEvals) break;
    const next = pop.slice(0, 5);
    while (next.length < POPULATION && evals < maxEvals) {
      if (rng.next() < 0.15) {
        const g = randomGenome(rng, mode, ffa);
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
        score: -Infinity,
      };
      g.score = evaluate(g);
      next.push(g);
    }
    next.sort((a, b) => b.score - a.score);
    pop = next;
  }

  const top = pop[0]!;
  if (opts.aimError) {
    top.params = top.params.map((p) => p * (1 + rng.gaussian() * opts.aimError!));
    top.angle += rng.gaussian() * opts.aimError * 0.5;
  }
  return { expr: exprOf(mode, top), angle: top.angle, dir: top.dir, expectedHit: top.score >= 1000 };
}
