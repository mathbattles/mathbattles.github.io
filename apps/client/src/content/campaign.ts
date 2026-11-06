import { Terrain, createSolo, simulateShot, toPxX, toPxY, type Circle, type ShotMode, type SoloDef } from '@mathbattles/sim';

export interface Level {
  id: string;
  chapter: number;
  title: string;
  tip: string;
  mode: ShotMode;
  /** A known answer. Tests fire it to prove the level can be cleared. */
  solution: string;
  angle?: number;
  from: [number, number];
  /** x positions of targets, which sit on the solution's curve. */
  hits: number[];
  /** [x, distance from the curve, radius], in graph units. */
  rocks?: [number, number, number][];
  /** [x, distance from the curve], in graph units. */
  friends?: [number, number][];
  coach?: string[];
}

export const CHAPTERS = [
  { name: 'First shots', blurb: 'Learn to fire, one idea at a time.' },
  { name: 'Lines', blurb: 'Slope sets where a straight shot goes.' },
  { name: 'Curves', blurb: 'Powers, abs, and avoiding invalid values.' },
  { name: 'Waves', blurb: 'sin and cos weave between targets.' },
  { name: 'Walls', blurb: 'Bend over rocks and through gaps.' },
  { name: "y' equations", blurb: 'Describe the slope and let the game solve it.' },
  { name: "y'' equations", blurb: 'Aim with an angle, then steer with acceleration.' },
];

type L = Omit<Level, 'id' | 'chapter'>;

const RAW: L[][] = [
  [
    { title: 'Straight ahead', tip: 'Your shot follows the graph of what you type. y = 0 is flat.', mode: 'fn', solution: '0', from: [-15, 2], hits: [10],
      coach: ['Type 0 in the box and press Fire. The function always starts from your soldier, so 0 means a flat shot.'] },
    { title: 'Tilt it', tip: 'x/2 rises 1 unit for every 2 units across.', mode: 'fn', solution: 'x/2', from: [-15, -4], hits: [5],
      coach: ['The target is higher up. Type x/2 to make the shot climb.'] },
    { title: 'Go down', tip: 'A minus sign flips the slope.', mode: 'fn', solution: '-x/3', from: [-15, 6], hits: [9],
      coach: ['Now aim down with -x/3. Try other numbers if you miss. Shots are free here.'] },
  ],
  [
    { title: 'Gentle climb', tip: 'Dividing makes a slope gentler.', mode: 'fn', solution: 'x/4', from: [-18, -3], hits: [12] },
    { title: 'Steep climb', tip: 'Multiplying makes a slope steeper.', mode: 'fn', solution: '2*x', from: [-8, -9], hits: [0] },
    { title: 'Two in a row', tip: 'A shot passes through everyone it touches.', mode: 'fn', solution: 'x/3', from: [-20, -6], hits: [-4, 12] },
    { title: 'Downhill pair', tip: 'Line up both targets, then find the slope.', mode: 'fn', solution: '-x/2', from: [-16, 8], hits: [-4, 10] },
    { title: 'Mind your friend', tip: 'Shots hit teammates too. Stay clear of the blue soldier.', mode: 'fn', solution: 'x/2', from: [-16, -5], hits: [6], friends: [[-4, -3]] },
    { title: 'Between friends', tip: 'Thread the line between your teammates.', mode: 'fn', solution: '-x/4', from: [-18, 3], hits: [14], friends: [[-6, 3], [4, -3]] },
  ],
  [
    { title: 'A parabola', tip: 'Divide powers by a big number or they leave the field fast.', mode: 'fn', solution: 'x^2/30', from: [-15, 2], hits: [15] },
    { title: 'Upside down', tip: 'A minus sign in front opens the curve downward.', mode: 'fn', solution: '-x^2/30', from: [-15, -2], hits: [12] },
    { title: 'Shift the bottom', tip: '(x-5)^2 moves the lowest point to x = 5.', mode: 'fn', solution: '(x-5)^2/40', from: [-16, 0], hits: [5] },
    { title: 'The V', tip: 'abs(x) makes a sharp V shape.', mode: 'fn', solution: 'abs(x)/2', from: [-16, 4], hits: [0, 12] },
    { title: 'Safe roots', tip: 'You stand at negative x, so sqrt(x) fails. sqrt(abs(x)) works.', mode: 'fn', solution: '2*sqrt(abs(x))', from: [-20, -4], hits: [-6] },
    { title: 'Cubic twist', tip: 'x^3 rises, flattens, and rises again.', mode: 'fn', solution: 'x^3/900', from: [-14, -1], hits: [0, 10] },
  ],
  [
    { title: 'First wave', tip: 'sin(x) wiggles between -1 and 1.', mode: 'fn', solution: 'sin(x)', from: [-20, 0], hits: [-5] },
    { title: 'Bigger wave', tip: 'The number in front is the height of the wave.', mode: 'fn', solution: '4*sin(x)', from: [-18, 0], hits: [-6, 5] },
    { title: 'Longer wave', tip: 'Dividing x stretches the wave sideways.', mode: 'fn', solution: '5*sin(x/3)', from: [-20, 0], hits: [-8, 12] },
    { title: 'Cosine start', tip: 'cos starts at its peak, which changes where the shot goes first.', mode: 'fn', solution: '3*cos(x/2)', from: [-14, 1], hits: [0, 12] },
    { title: 'Wave on a slope', tip: 'Add a line to a wave to climb while weaving.', mode: 'fn', solution: 'x/3+2*sin(x)', from: [-20, -6], hits: [-3, 11] },
    { title: 'Weave past', tip: 'Use the wave to go around your teammate.', mode: 'fn', solution: '4*sin(x/2)', from: [-20, 0], hits: [10], friends: [[0, 3]] },
  ],
  [
    { title: 'Over the rock', tip: 'A straight shot hits the rock. Arc over it.', mode: 'fn', solution: '-(x+4)^2/40', from: [-18, -6], hits: [10], rocks: [[-4, -5, 3.5]] },
    { title: 'Under the rock', tip: 'Dip below, then come back up.', mode: 'fn', solution: '(x+2)^2/40', from: [-18, 6], hits: [14], rocks: [[-2, 5, 3.5]] },
    { title: 'Through the gap', tip: 'Two rocks leave one way through.', mode: 'fn', solution: 'x/5', from: [-18, -3], hits: [14], rocks: [[0, 4, 2.5], [0, -4, 2.5]] },
    { title: 'Step up', tip: 'a/(1+exp(-k*(x-b))) makes a smooth step of height a at x = b.', mode: 'fn', solution: '8/(1+exp(-3*(x+2)))', from: [-18, -5], hits: [12], rocks: [[8, -5, 3.5], [-10, 5, 3]] },
    { title: 'Slalom', tip: 'A wave goes around rocks on both sides.', mode: 'fn', solution: '5*sin(x/3)', from: [-20, 0], hits: [14], rocks: [[-12, -5, 2.5], [-2, 5, 2.5]] },
    { title: 'Ricochet row', tip: 'Line up three targets for one big shot.', mode: 'fn', solution: '-x^2/60+x/4', from: [-18, -3], hits: [-8, 2, 12], rocks: [[-3, 5, 2.5], [7, -5, 2.5]] },
    { title: 'Double step', tip: 'Add two steps to clear two walls.', mode: 'fn', solution: '5/(1+exp(-3*(x+8)))+5/(1+exp(-3*(x-4)))', from: [-20, -8], hits: [14], rocks: [[-3, -5, 3], [10, -5, 3]] },
  ],
  [
    { title: 'Constant slope', tip: "y' is the slope at each point. A constant gives a straight line.", mode: 'ode1', solution: '0.5', from: [-16, -4], hits: [4] },
    { title: 'Slope from x', tip: "y' = x/15 makes the slope grow as x grows.", mode: 'ode1', solution: 'x/15', from: [-15, 3], hits: [10] },
    { title: 'Back to center', tip: "y' = -y/3 always pulls the shot toward y = 0.", mode: 'ode1', solution: '-y/3', from: [-18, 9], hits: [2] },
    { title: 'Running away', tip: "y' = y/8 grows faster the further the shot gets from 0.", mode: 'ode1', solution: 'y/8', from: [-18, 2], hits: [-4] },
    { title: 'Wave slope', tip: "A sine slope gives a wave that keeps going.", mode: 'ode1', solution: '2*sin(x/2)', from: [-20, 0], hits: [-8, 8] },
    { title: 'Around the rock', tip: "Use a slope that changes sign to arc over.", mode: 'ode1', solution: '-x/12', from: [-16, -6], hits: [10], rocks: [[0, -4, 2.5]] },
  ],
  [
    { title: 'Aim with angle', tip: "With y'' = 0 the shot is a straight line at your firing angle.", mode: 'ode2', solution: '0', angle: 0.4, from: [-16, -4], hits: [4],
      coach: ['Press the up and down arrows to change the angle. This is the only mode where angle matters.'] },
    { title: 'Gravity', tip: "A negative y'' pulls the shot down like gravity.", mode: 'ode2', solution: '-0.1', angle: 0.7, from: [-18, -6], hits: [2] },
    { title: 'Reverse gravity', tip: "A positive y'' pulls up.", mode: 'ode2', solution: '0.1', angle: -0.7, from: [-18, 6], hits: [2] },
    { title: 'A spring', tip: "y'' = -y/4 swings back and forth around y = 0.", mode: 'ode2', solution: '-y/4', angle: 0.3, from: [-20, 3], hits: [-8, 8] },
    { title: 'With drag', tip: "Using y' in the equation slows the slope down.", mode: 'ode2', solution: "-y'/4", angle: 0.9, from: [-20, -6], hits: [-12] },
    { title: 'Lob the rock', tip: 'Angle up, let gravity bring it down behind the rock.', mode: 'ode2', solution: '-0.12', angle: 0.75, from: [-20, -6], hits: [0], rocks: [[-10, -4, 2.8]] },
  ],
];

export const LEVELS: Level[] = RAW.flatMap((chapter, c) =>
  chapter.map((l, i) => ({ ...l, id: `${c}-${i + 1}`, chapter: c })),
);

/** Builds the playable map, placing targets and rocks relative to the solution curve. */
export function buildLevel(level: Level): SoloDef {
  const shooter = { x: toPxX(level.from[0]), y: toPxY(level.from[1]) };
  const base = (circles: Circle[] = []) =>
    simulateShot({ mode: level.mode, expr: level.solution, angle: level.angle, from: shooter, terrain: new Terrain(circles), targets: [] });
  const path = base();
  const curveAt = (gx: number): number => {
    const px = toPxX(gx);
    for (let i = 0; i < path.steps; i++) {
      if (path.xs[i]! >= px) return path.ys[i]!;
    }
    return path.ys[path.steps - 1]!;
  };
  return {
    mode: level.mode,
    shooter,
    enemies: level.hits.map((gx) => ({ x: toPxX(gx), y: curveAt(gx) })),
    allies: level.friends?.map(([gx, dy]) => ({ x: toPxX(gx), y: curveAt(gx) - dy * 15.4 })),
    circles: (level.rocks ?? []).map(([gx, dy, r]) => ({ x: toPxX(gx), y: curveAt(gx) - dy * 15.4, r: r * 15.4 })),
  };
}

export function parFor(level: Level): number {
  return level.solution.replace(/\s/g, '').length + 6;
}

export function starsFor(level: Level, shots: { expr: string }[]): number {
  let stars = 1;
  if (shots.length === 1) stars++;
  const longest = Math.max(...shots.map((s) => s.expr.replace(/\s/g, '').length));
  if (longest <= parFor(level)) stars++;
  return stars;
}

export function levelUnlocked(level: Level, stars: Record<string, number>): boolean {
  const idx = LEVELS.indexOf(level);
  if (idx === 0) return true;
  return (stars[LEVELS[idx - 1]!.id] ?? 0) > 0;
}

export function checkSolo(level: Level) {
  return createSolo(buildLevel(level));
}
