import { PLANE_H, Terrain, simulateShot, toPxX, toPxY, type Circle, type MatchState, type ShotRecord } from '@mathbattles/sim';
import type { Stage } from './stage';

export const DEMOS = [
  { expr: '5*sin(x/3)', from: [-22, -1], label: 'y = 5 sin(x/3)' },
  { expr: 'x/4+3*sin(x/2)', from: [-22, -4], label: 'y = x/4 + 3 sin(x/2)' },
  { expr: '-x^2/60', from: [-20, 6], label: 'y = -x²/60' },
  { expr: '7/(1+exp(-2*(x-4)))', from: [-22, -5], label: 'y = 7/(1+exp(-2(x-4)))' },
];

export interface DemoShot {
  label: string;
  state: MatchState;
  record: ShotRecord;
  path: { xs: ArrayLike<number>; ys: ArrayLike<number>; steps: number };
}

const built = new Map<string, DemoShot>();

/**
 * Lays out one demo: two enemies on the curve, rocks beside it, and a rock near the end
 * for the shot to explode on. The same demo is reused, so this is only worked out once.
 */
export function buildDemo(index: number, rocks: number): DemoShot {
  const key = `${index % DEMOS.length}|${rocks}`;
  const cached = built.get(key);
  if (cached) return cached;
  const demo = DEMOS[index % DEMOS.length]!;
  const from = { x: toPxX(demo.from[0]!), y: toPxY(demo.from[1]!) };
  const probe = simulateShot({ mode: 'fn', expr: demo.expr, from, terrain: new Terrain([]), targets: [] });
  const at = (f: number) => {
    const k = Math.floor(probe.steps * f);
    return { x: probe.xs[k]!, y: probe.ys[k]! };
  };
  const a = at(0.55);
  const b = at(0.85);
  // How close a point comes to the curve, checked along the whole path.
  const gapToCurve = (x: number, y: number) => {
    let best = Infinity;
    for (let k = 0; k < probe.steps; k += 4) best = Math.min(best, Math.hypot(probe.xs[k]! - x, probe.ys[k]! - y));
    return best;
  };
  // Obstacles sit clear of the curve, on alternating sides of it. On a steep stretch a rock
  // placed above or below can still touch the curve, so those are left out.
  const circles: Circle[] = [];
  const clear = (rock: Circle) =>
    gapToCurve(rock.x, rock.y) > rock.r + 12
    && Math.hypot(rock.x - a.x, rock.y - a.y) > rock.r + 16
    && Math.hypot(rock.x - b.x, rock.y - b.y) > rock.r + 16
    && rock.y > rock.r && rock.y < PLANE_H - rock.r
    && circles.every((o) => Math.hypot(o.x - rock.x, o.y - rock.y) > o.r + rock.r + 6);
  for (let k = 0; k < rocks; k++) {
    const p = at((k + 0.6) / (rocks + 0.4));
    const r = 26 + ((k * 13) % 22);
    const side = k % 2 === 0 ? 1 : -1;
    // Try one side, then the other, then further away, until the rock is clear of the curve.
    for (const push of [side, -side, side * 1.7, -side * 1.7, side * 2.4, -side * 2.4]) {
      const rock = { x: p.x, y: p.y + push * (r + 22), r };
      if (clear(rock)) {
        circles.push(rock);
        break;
      }
    }
  }
  // A rock on the curve near its end, so the shot explodes where it can be seen.
  const stop = at(0.96);
  circles.push({ x: stop.x, y: stop.y, r: 18 });
  const path = simulateShot({ mode: 'fn', expr: demo.expr, from, terrain: new Terrain(circles), targets: [] });
  // A soldier only falls if the drawn shot really reaches them.
  const hits: { id: number; step: number }[] = [];
  for (const [s, id] of [[a, 1], [b, 2]] as const) {
    for (let k = 0; k < path.steps; k++) {
      if (Math.hypot(path.xs[k]! - s.x, path.ys[k]! - s.y) < 7) {
        hits.push({ id, step: k });
        break;
      }
    }
  }
  const state = {
    config: { kind: 'teams', mode: 'fn', abilities: false, soldiers: 1, seed: 0 },
    players: [
      { id: 'a', name: '', team: 1, soldierIds: [0], nextSoldier: 0, charge: 0, missileArmed: false, connected: true, kills: 0, deaths: 0, shots: 0, bestCombo: 0 },
      { id: 'b', name: '', team: 2, soldierIds: [1, 2], nextSoldier: 0, charge: 0, missileArmed: false, connected: true, kills: 0, deaths: 0, shots: 0, bestCombo: 0 },
    ],
    soldiers: [
      { id: 0, playerId: 'a', x: from.x, y: from.y, alive: true, angle: 0 },
      { id: 1, playerId: 'b', x: a.x, y: a.y, alive: true, angle: 0 },
      { id: 2, playerId: 'b', x: b.x, y: b.y, alive: true, angle: 0 },
    ],
    circles,
    holes: [],
    turn: 0,
    turnNumber: 1,
    over: false,
    winner: null,
    log: [],
  } as unknown as MatchState;
  const record = {
    playerId: 'a', soldierId: 0, expr: demo.expr, mode: 'fn', dir: 1, angle: 0, from, mirrored: false,
    steps: path.steps, reason: path.reason, end: path.end, hits, blastR: 12, blastKills: [],
  } as unknown as ShotRecord;
  const shot = { label: demo.label, state, record, path: { xs: path.xs, ys: path.ys, steps: path.steps } };
  built.set(key, shot);
  return shot;
}

/** A fresh copy of a demo's board, since the stage marks soldiers as hit while it plays. */
function freshState(state: MatchState): MatchState {
  return { ...state, soldiers: state.soldiers.map((s) => ({ ...s })), holes: [] } as MatchState;
}

/**
 * Plays real shots from the real simulation in a loop, knocking out two soldiers each time.
 * Used by the menu and the shop preview. Returns a function that stops it.
 */
export function runDemo(stage: Stage, opts: { rocks?: number; onCaption?: (label: string) => void; gapMs?: number } = {}): () => void {
  let live = true;
  const run = async (i: number): Promise<void> => {
    if (!live) return;
    const demo = buildDemo(i, opts.rocks ?? 2);
    stage.sync(freshState(demo.state));
    stage.activeSoldierId = 0;
    opts.onCaption?.(demo.label);
    await new Promise((r) => setTimeout(r, opts.gapMs ?? 900));
    if (!live) return;
    await stage.playShot(demo.record, demo.path);
    // Hidden tabs finish shots at once, so wait here rather than looping quickly.
    if (document.hidden) await new Promise((r) => setTimeout(r, 2000));
    void run(i + 1);
  };
  void (document.fonts?.ready ?? Promise.resolve()).then(() => run(0));
  return () => {
    live = false;
  };
}
