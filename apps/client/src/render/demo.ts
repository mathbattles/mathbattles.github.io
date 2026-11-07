import { Terrain, simulateShot, toPxX, toPxY, type Circle, type MatchState } from '@mathbattles/sim';
import type { Stage } from './stage';

export const DEMOS = [
  { expr: '5*sin(x/3)', from: [-22, -1], label: 'y = 5 sin(x/3)' },
  { expr: 'x/4+3*sin(x/2)', from: [-22, -4], label: 'y = x/4 + 3 sin(x/2)' },
  { expr: '-x^2/60', from: [-20, 6], label: 'y = -x²/60' },
  { expr: '7/(1+exp(-2*(x-4)))', from: [-22, -5], label: 'y = 7/(1+exp(-2(x-4)))' },
];

/**
 * Plays real shots from the real simulation in a loop, knocking out two soldiers each time.
 * Used by the menu and the shop preview. Returns a function that stops it.
 */
export function runDemo(stage: Stage, opts: { rocks?: number; onCaption?: (label: string) => void; gapMs?: number } = {}): () => void {
  let live = true;
  const run = async (i: number): Promise<void> => {
    if (!live) return;
    const demo = DEMOS[i % DEMOS.length]!;
    const from = { x: toPxX(demo.from[0]!), y: toPxY(demo.from[1]!) };
    const probe = simulateShot({ mode: 'fn', expr: demo.expr, from, terrain: new Terrain([]), targets: [] });
    const at = (f: number) => {
      const k = Math.floor(probe.steps * f);
      return { x: probe.xs[k]!, y: probe.ys[k]! };
    };
    const a = at(0.55);
    const b = at(0.85);
    // Obstacles sit clear of the curve, on alternating sides of it.
    const circles: Circle[] = [];
    const count = opts.rocks ?? 2;
    for (let k = 0; k < count; k++) {
      const p = at((k + 0.6) / (count + 0.4));
      const r = 26 + ((k * 13) % 22);
      circles.push({ x: p.x, y: p.y + (k % 2 === 0 ? 1 : -1) * (r + 22), r });
    }
    // A rock on the curve near its end, so the shot explodes where it can be seen.
    const stop = at(0.95);
    circles.push({ x: stop.x, y: stop.y, r: 20 });
    const path = simulateShot({ mode: 'fn', expr: demo.expr, from, terrain: new Terrain(circles), targets: [] });
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
    stage.sync(state);
    stage.activeSoldierId = 0;
    opts.onCaption?.(demo.label);
    await new Promise((r) => setTimeout(r, opts.gapMs ?? 900));
    if (!live) return;
    const hit = (s: { x: number; y: number }, id: number) => {
      let step = 0;
      for (let k = 0; k < path.steps; k++) {
        if (Math.hypot(path.xs[k]! - s.x, path.ys[k]! - s.y) < 7) {
          step = k;
          break;
        }
      }
      return { id, step };
    };
    await stage.playShot(
      {
        playerId: 'a', soldierId: 0, expr: demo.expr, mode: 'fn', dir: 1, angle: 0, from, mirrored: false,
        steps: path.steps, reason: path.reason, end: path.end, hits: [hit(a, 1), hit(b, 2)], blastR: 12, blastKills: [],
      },
      { xs: path.xs, ys: path.ys, steps: path.steps },
    );
    // Hidden tabs finish shots at once, so wait here rather than looping quickly.
    if (document.hidden) await new Promise((r) => setTimeout(r, 2000));
    void run(i + 1);
  };
  void (document.fonts?.ready ?? Promise.resolve()).then(() => run(0));
  return () => {
    live = false;
  };
}
