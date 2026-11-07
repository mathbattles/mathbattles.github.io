import { ME, createSolo, soloNext, toPxX, toPxY, type MatchState, type ShotMode, type SoloDef } from '@mathbattles/sim';
import { buildLevel, type LevelShape } from './campaign';

/** Text may use `backticks` for math. */
export type Block =
  | { t: 'h'; text: string }
  | { t: 'p'; text: string }
  | { t: 'tip'; text: string }
  | { t: 'table'; rows: [string, string][] }
  | Playground
  | Sliders
  | Challenge
  | Quiz;

/** A free board: pick an example or type anything, and see the curve as you type. */
export interface Playground {
  t: 'play';
  note: string;
  mode: ShotMode;
  from: [number, number];
  start: string;
  examples: { expr: string; note: string; angle?: number }[];
  angle?: number;
  /** Targets and rocks at exact graph positions, to aim at or explain with. */
  targets?: [number, number][];
  rocks?: [number, number, number][];
}

/** Drag sliders and watch a formula's numbers change the curve. */
export interface Sliders {
  t: 'sliders';
  note: string;
  mode: ShotMode;
  from: [number, number];
  /** Numbers go in {braces}. A parameter called angle sets the firing angle instead. */
  template: string;
  params: { name: string; label: string; min: number; max: number; step: number; value: number }[];
}

/** A task with targets. Checked by actually firing the shot. */
export interface Challenge extends LevelShape {
  t: 'challenge';
  id: string;
  title: string;
  task: string;
  hints: string[];
  /** Show the whole curve as dashes while typing. Early lessons only. */
  preview?: boolean;
  /** How many shots the player gets before the board resets. Default 1. */
  shots?: number;
  /** Lets the player choose a firing direction. */
  ffa?: boolean;
  requires?: { pattern: string; message: string };
  /** Proves the lesson's point: a straight line to the first target must fail here. */
  blocksStraight?: boolean;
}

export interface Quiz {
  t: 'quiz';
  id: string;
  q: string;
  options: string[];
  answer: number;
  why: string;
}

export interface Lesson {
  id: string;
  title: string;
  blurb: string;
  blocks: Block[];
}

export interface Unit {
  title: string;
  blurb: string;
  lessons: Lesson[];
}

export const UNITS: Unit[] = [
  {
    title: 'Your first shots',
    blurb: 'What the game is, and how to read the board.',
    lessons: [
      {
        id: 'first-shot',
        title: 'Type a function, fire a shot',
        blurb: 'The one idea the whole game is built on.',
        blocks: [
          { t: 'p', text: 'MathBattles is a battle on a graph. You don\'t aim with a mouse. You type a math function, and your shot flies along that function\'s graph. If the curve passes through an enemy, they\'re out.' },
          { t: 'p', text: 'The simplest function is `0`. Its graph is a flat line, so your shot flies straight across.' },
          { t: 'play', note: 'Choose an example. The dashed line shows the curve before you fire. Then press Fire, or type your own.', mode: 'fn', from: [-20, 0], start: '0', examples: [
            { expr: '0', note: 'A flat line' },
            { expr: 'x/2', note: 'A line that climbs' },
            { expr: '-x/3', note: 'A line that falls' },
            { expr: '3*sin(x)', note: 'A wave' },
          ] },
          { t: 'challenge', id: 'first-shot-1', title: 'Your first hit', task: 'A target is straight ahead. Hit it with a flat shot.', mode: 'fn', solution: '0', from: [-15, 3], hits: [8], preview: true, hints: ['Flat means the height never changes.', 'Type the number 0 in the box and press Fire.'] },
          { t: 'quiz', id: 'first-shot-q', q: 'What decides where your shot goes?', options: ['How long you hold Fire', 'The graph of the function you type', 'Where you click on the board'], answer: 1, why: 'Your shot follows the graph. Nothing else steers it, so the math is your aim.' },
        ],
      },
      {
        id: 'read-graph',
        title: 'Reading the board',
        blurb: 'Coordinates tell you exactly where everything is.',
        blocks: [
          { t: 'p', text: 'The board is a graph. `x` runs left and right from -25 to 25. `y` runs down and up from about -14.6 to 14.6. The center, where the two dark lines cross, is (0, 0).' },
          { t: 'p', text: 'A point is written (x, y): how far across, then how far up. So (5, -3) is 5 to the right of center and 3 below it. Each small square on the board is 1 unit.' },
          { t: 'tip', text: 'Move your mouse over any board in this course to read the exact coordinates under it. In a match, the numbers on the two dark lines do the same job.' },
          { t: 'play', note: 'These targets are at (-10, 8), (5, -3), and (15, 6). Find each one, then hover over them to check.', mode: 'fn', from: [-20, 0], start: '0', targets: [[-10, 8], [5, -3], [15, 6]], examples: [
            { expr: 'x/2.5', note: 'Passes near (-10, 8)' },
            { expr: 'x/12', note: 'Passes under (15, 6)' },
          ] },
          { t: 'quiz', id: 'read-graph-q1', q: 'Where is the point 5 right of center and 3 below it?', options: ['(3, -5)', '(5, -3)', '(-5, 3)'], answer: 1, why: 'Across comes first, then up. Below center means y is negative.' },
          { t: 'quiz', id: 'read-graph-q2', q: 'You stand at (-10, 2), and a target is at (5, 2). How far across is it?', options: ['5 units', '10 units', '15 units'], answer: 2, why: 'From -10 to 5 is 15 units: subtract the x values, 5 - (-10) = 15.' },
          { t: 'challenge', id: 'read-graph-1', title: 'Up to the target', task: 'This target is higher than you. Fire a line that climbs, using `x/2`.', mode: 'fn', solution: 'x/2', from: [-16, -4], hits: [0], preview: true, hints: ['`x/2` climbs 1 unit for every 2 units across.', 'Type x/2 exactly.'] },
        ],
      },
      {
        id: 'starts-at-you',
        title: 'Your curve always starts at you',
        blurb: 'Why adding a number changes nothing, and what does matter.',
        blocks: [
          { t: 'p', text: 'A graph of `x/2` normally passes through the center of the board. But your shot has to leave from your soldier. So the game slides the whole curve up or down until it passes through you.' },
          { t: 'p', text: 'That means adding a number does nothing at all. `x/2`, `x/2+9`, and `x/2-100` are the same shot. Only the shape matters.' },
          { t: 'play', note: 'Try all three. The curve doesn\'t move.', mode: 'fn', from: [-18, -2], start: 'x/2', examples: [
            { expr: 'x/2', note: 'The plain line' },
            { expr: 'x/2+9', note: 'Same shot' },
            { expr: 'x/2-100', note: 'Still the same' },
          ] },
          { t: 'p', text: 'Sliding only moves the curve up and down, never sideways. So your left-to-right position still matters for curved shapes. The lowest point of `x^2/40` is always at x = 0, wherever you stand.' },
          { t: 'play', note: 'The shape of `x^2/40` bottoms out at x = 0 from either starting point. Compare it with the next example.', mode: 'fn', from: [-15, 5], start: 'x^2/40', examples: [
            { expr: 'x^2/40', note: 'Lowest point at x = 0' },
            { expr: '(x+8)^2/40', note: 'Lowest point at x = -8' },
          ] },
          { t: 'quiz', id: 'starts-q', q: 'What\'s the difference between the shots `x/3` and `x/3+5`?', options: ['The second starts 5 higher', 'Nothing: they\'re the same shot', 'The second is steeper'], answer: 1, why: 'The game slides the curve to pass through your soldier, so an added number is cancelled out.' },
          { t: 'challenge', id: 'starts-1', title: 'Use the bottom of the curve', task: 'The target sits where this curve is lowest, at x = 0. Fire `x^2/40`.', mode: 'fn', solution: 'x^2/40', from: [-15, 0], hits: [0], preview: true, hints: ['The little `^` means "to the power of".', 'Type x^2/40 exactly.'] },
        ],
      },
      {
        id: 'typing-math',
        title: 'Typing math',
        blurb: 'Every symbol you can use, and the mistake that catches everyone.',
        blocks: [
          { t: 'table', rows: [
            ['+  -  *  /', 'Add, subtract, multiply, divide'],
            ['2x  or  2*x', 'Both mean 2 times x'],
            ['x^2', 'x to the power of 2'],
            ['sin(x)  cos(x)  tan(x)', 'Waves, using radians'],
            ['sqrt(x)  abs(x)', 'Square root, and absolute value (drops the minus sign)'],
            ['ln(x)  log(x)  exp(x)', 'Natural log, base-10 log, and e to the x'],
            ['pi  e', 'The numbers 3.14... and 2.71...'],
          ] },
          { t: 'h', text: 'Use parentheses' },
          { t: 'p', text: 'Math goes in the usual order: powers, then multiply and divide, then add and subtract. So `1/x+2` means (1/x) + 2, not 1 over (x+2). When in doubt, add parentheses.' },
          { t: 'play', note: 'Compare these. The missing parentheses change the shot completely.', mode: 'fn', from: [-20, 0], start: '1/(x+2)', examples: [
            { expr: '10/(x+2)', note: 'Divides by x+2' },
            { expr: '10/x+2', note: 'Divides by x, then adds 2' },
            { expr: '-x^2/60', note: 'Minus applies after the power' },
            { expr: '(-x)^2/60', note: 'Minus applies first' },
          ] },
          { t: 'quiz', id: 'typing-q', q: 'How does the game read `1/x+2`?', options: ['1 divided by (x+2)', '(1 divided by x) + 2', 'An error'], answer: 1, why: 'Division comes before addition. To divide by x+2, write 1/(x+2).' },
          { t: 'challenge', id: 'typing-1', title: 'Parentheses on purpose', task: 'Use parentheses to move the lowest point of a parabola to x = -5. Square `(x+5)`, then divide by 40.', mode: 'fn', solution: '(x+5)^2/40', from: [-20, 3], hits: [-5], preview: true, requires: { pattern: '\\(x\\+5\\)', message: 'Use (x+5) with its parentheses, so the whole thing gets squared.' }, hints: ['`(x+5)` is 0 when x = -5, so that\'s where the lowest point lands.', 'Type (x+5)^2/40'] },
        ],
      },
    ],
  },
  {
    title: 'Straight shots',
    blurb: 'Lines are your most reliable shot. Learn to aim them exactly.',
    lessons: [
      {
        id: 'slope',
        title: 'Slope: how fast a line climbs',
        blurb: 'The number in front of x controls everything.',
        blocks: [
          { t: 'p', text: 'In `a*x`, the number a is the slope: how many units the line climbs for each unit across. Positive climbs, negative falls, and 0 is flat.' },
          { t: 'sliders', note: 'Drag the slider and watch the line.', mode: 'fn', from: [-20, 0], template: '{a}*x', params: [{ name: 'a', label: 'Slope', min: -2, max: 2, step: 0.05, value: 0.5 }] },
          { t: 'p', text: 'Dividing gives gentle slopes, which is what you\'ll usually want. `x/4` is the same as `0.25*x`.' },
          { t: 'quiz', id: 'slope-q', q: 'Which line falls the fastest?', options: ['`-x/5`', '`x/2`', '`-2*x`'], answer: 2, why: '`-2*x` drops 2 units for every 1 across. `-x/5` only drops 0.2.' },
          { t: 'challenge', id: 'slope-1', title: 'Gentle climb', task: 'Hit the target with a slowly climbing line.', mode: 'fn', solution: 'x/4', from: [-18, -3], hits: [12], preview: true, hints: ['Try x divided by some number.', 'The curve climbs 7.5 units over 30 across. That\'s 1 unit for every 4.', 'Type x/4'] },
          { t: 'challenge', id: 'slope-2', title: 'Downhill', task: 'This one is below you. Use a negative slope.', mode: 'fn', solution: '-x/3', from: [-15, 6], hits: [9], preview: true, hints: ['A minus sign makes a line fall.', 'It falls 8 units over 24 across. That\'s 1 unit for every 3.', 'Type -x/3'] },
        ],
      },
      {
        id: 'aiming',
        title: 'Aiming exactly',
        blurb: 'The formula that hits any target in a clear line.',
        blocks: [
          { t: 'p', text: 'Here\'s the formula you\'ll use constantly. To aim from you to a target:' },
          { t: 'tip', text: 'slope = (target y - your y) / (target x - your x)' },
          { t: 'p', text: 'Say you\'re at (-15, -4), and the target is at (5, 6). Up 10, across 20. The slope is 10/20, or 0.5, so fire `x/2`.' },
          { t: 'play', note: 'Here\'s that exact setup. Fire `0.5*x`, then try the wrong slopes to see how far off they land.', mode: 'fn', from: [-15, -4], start: '0.5*x', targets: [[5, 6]], examples: [
            { expr: '0.5*x', note: 'Exactly right' },
            { expr: '0.4*x', note: 'Slightly low' },
            { expr: '0.6*x', note: 'Slightly high' },
          ] },
          { t: 'tip', text: 'Small errors grow with distance. A close target forgives a rough slope, and a far one doesn\'t. Use two or three decimal places on long shots.' },
          { t: 'challenge', id: 'aim-1', title: 'No preview', task: 'No dashed line this time. Read both positions below the board, and work out the slope yourself.', mode: 'fn', solution: 'x/2', from: [-15, -4], hits: [5], hints: ['Target y minus your y, divided by target x minus your x.', '(6 - (-4)) / (5 - (-15)) = 10/20.', 'Type x/2'] },
          { t: 'challenge', id: 'aim-2', title: 'Aim down', task: 'Same formula. The answer comes out negative this time.', mode: 'fn', solution: '-x/4', from: [-20, 6], hits: [12], hints: ['Up is negative here, since the target is lower than you.', '(-2 - 6) / (12 - (-20)) = -8/32.', 'Type -x/4'] },
          { t: 'challenge', id: 'aim-3', title: 'A steep one', task: 'Close and high. Decimals are fine.', mode: 'fn', solution: '0.7*x', from: [-14, -8], hits: [6], hints: ['Up 14, across 20.', '14/20 = 0.7', 'Type 0.7*x'] },
        ],
      },
      {
        id: 'multi-hits',
        title: 'Double hits and teammates',
        blurb: 'Shots keep going through everyone they touch.',
        blocks: [
          { t: 'p', text: 'A shot doesn\'t stop when it hits a soldier. It keeps flying until it reaches an obstacle or the edge of the board. Line up two enemies and you can take both with one shot.' },
          { t: 'p', text: 'This works against you too. Shots hit teammates in exactly the same way, and they\'re out just like an enemy. Your own soldier is the one thing a shot can\'t hit.' },
          { t: 'challenge', id: 'multi-1', title: 'Two in a row', task: 'Both targets are on one line. Take them with one shot.', mode: 'fn', solution: 'x/3', from: [-20, -6], hits: [-4, 12], preview: true, hints: ['Aim at either one. If they\'re truly on a line, you\'ll get both.', 'Up 5.3 over 16 across is about 1/3.', 'Type x/3'] },
          { t: 'challenge', id: 'multi-2', title: 'Mind your friend', task: 'Hit the red target, but your blue teammate must survive. Hitting them fails the shot.', mode: 'fn', solution: 'x/2', from: [-16, -5], hits: [6], friends: [[-4, -3]], preview: true, hints: ['A straight line works here. It just has to pass above your teammate.', 'Up 11 over 22 across.', 'Type x/2'] },
          { t: 'quiz', id: 'multi-q', q: 'Your shot hits an enemy. What happens to the shot?', options: ['It stops and explodes there', 'It keeps going along the curve', 'It bounces off'], answer: 1, why: 'Shots pass through soldiers, so one good curve can take several. They explode only at an obstacle, the edge, or an invalid value.' },
        ],
      },
    ],
  },
  {
    title: 'Curved shots',
    blurb: 'Bend over and under obstacles.',
    lessons: [
      {
        id: 'parabolas',
        title: 'Parabolas: arcing over things',
        blurb: 'Your go-to shot when something is in the way.',
        blocks: [
          { t: 'p', text: 'Squaring makes a U shape. In `a*(x-b)^2/50`, b is where the curve turns around. a is how sharply it bends. A negative a flips it to an upside-down arc, which is perfect for going over a rock.' },
          { t: 'sliders', note: 'Slide b to move the turning point, and make a negative to arc over.', mode: 'fn', from: [-20, 0], template: '{a}*(x-{b})^2/50', params: [
            { name: 'a', label: 'Bend', min: -3, max: 3, step: 0.1, value: -1 },
            { name: 'b', label: 'Turning point', min: -20, max: 20, step: 0.5, value: -5 },
          ] },
          { t: 'tip', text: 'Plain `x^2` reaches 100 at x = 10, far off the board. Always scale powers down by dividing, as in `x^2/50`.' },
          { t: 'challenge', id: 'para-1', title: 'Over the rock', task: 'A straight shot hits the rock. Arc over it, with the top of the arc at x = -4.', mode: 'fn', solution: '-(x+4)^2/40', from: [-18, -6], hits: [10], rocks: [[-4, -5, 3.5]], blocksStraight: true, hints: ['Start with -(x+4)^2. The minus flips it, and x+4 puts the top at x = -4.', 'That bends too sharply, so divide by a number. Try 30 to 50.', 'Type -(x+4)^2/40'] },
          { t: 'challenge', id: 'para-2', title: 'Under the rock', task: 'This time, dip under it. The bottom of the curve goes at x = -2.', mode: 'fn', solution: '(x+2)^2/40', from: [-18, 6], hits: [14], rocks: [[-2, 5, 3.5]], blocksStraight: true, hints: ['No minus this time, since you want a U.', 'x+2 puts the bottom at x = -2. Then scale it down.', 'Type (x+2)^2/40'] },
        ],
      },
      {
        id: 'abs',
        title: 'abs: sharp turns',
        blurb: 'A V shape changes direction in an instant.',
        blocks: [
          { t: 'p', text: '`abs` removes minus signs, which turns a line into a V. `a*abs(x-b)` turns sharply at x = b. Where a parabola bends gradually, this can skim right past a corner and then head straight for a target.' },
          { t: 'sliders', note: 'Move the turning point. Make the slope negative for an upside-down V.', mode: 'fn', from: [-20, 2], template: '{a}*abs(x-{b})', params: [
            { name: 'a', label: 'Slope', min: -1.5, max: 1.5, step: 0.05, value: 0.5 },
            { name: 'b', label: 'Turning point', min: -20, max: 20, step: 0.5, value: -6 },
          ] },
          { t: 'challenge', id: 'abs-1', title: 'Down and back up', task: 'Dive under the rock, then climb to the target. Turn at x = -4.', mode: 'fn', solution: 'abs(x+4)', from: [-16, 6], hits: [2], rocks: [[-4, 5, 3]], blocksStraight: true, hints: ['Use abs with x+4 inside, so the turn lands at x = -4.', 'A slope of 1 is steep enough, so you don\'t need a number in front.', 'Type abs(x+4)'] },
          { t: 'quiz', id: 'abs-q', q: 'Where does `2*abs(x-7)` turn?', options: ['x = 2', 'x = 7', 'x = -7'], answer: 1, why: 'The inside, x-7, is zero at x = 7. That\'s where the V turns.' },
        ],
      },
      {
        id: 'explosions',
        title: 'Why shots explode early',
        blurb: 'Four causes, and how to fix each one.',
        blocks: [
          { t: 'p', text: 'A shot ends at the first of these: an obstacle, the edge of the board, or one of the four problems below. Try each one and read the message under the board.' },
          { t: 'play', note: 'Every example here breaks in a different way.', mode: 'fn', from: [-20, 0], start: 'sqrt(x)', examples: [
            { expr: 'sqrt(x)', note: 'Invalid value' },
            { expr: 'sqrt(abs(x))', note: 'The fix' },
            { expr: '2*abs(x+5)/(x+5)', note: 'A jump' },
            { expr: 'sin(100*x)', note: 'Too long' },
            { expr: 'x^2', note: 'Off the board' },
            { expr: 'x^2/50', note: 'The fix' },
          ] },
          { t: 'table', rows: [
            ['Invalid value', 'sqrt or ln of a negative number, or dividing by zero. You stand at negative x, so sqrt(x) fails right away. Use sqrt(abs(x)).'],
            ['A sudden jump', 'The curve breaks and reappears elsewhere. Shots can\'t teleport. Lesson "Smooth steps" shows the fix.'],
            ['Too long', 'A shot gets 20,000 tiny steps. Very wiggly curves use them up. Lower the frequency.'],
            ['Off the board', 'The curve simply left. Scale it down by dividing.'],
          ] },
          { t: 'quiz', id: 'explode-q1', q: 'You\'re at x = -15. Why does `ln(x)` fail at once?', options: ['ln needs parentheses', 'ln of a negative number is invalid', 'It\'s too steep'], answer: 1, why: 'Logs and square roots of negatives aren\'t real numbers. Wrap the inside in abs, as in ln(abs(x)).' },
          { t: 'quiz', id: 'explode-q2', q: '`sin(100*x)` explodes partway. What\'s the best fix?', options: ['Add 100', 'Use a smaller number, like sin(x)', 'Use cos instead'], answer: 1, why: 'It wiggles so fast that it runs out of length. Lower frequency means a shorter path.' },
          { t: 'challenge', id: 'explode-1', title: 'Fix the square root', task: 'Use a square root to reach this target. Plain `sqrt(x)` explodes, so make it work.', mode: 'fn', solution: '2*sqrt(abs(x))', from: [-20, -4], hits: [-6], preview: true, requires: { pattern: 'sqrt', message: 'Use sqrt in your function for this one.' }, hints: ['Use abs to keep the inside positive.', 'Use a number in front to change how steep it is.', 'Type 2*sqrt(abs(x))'] },
        ],
      },
    ],
  },
  {
    title: 'Waves',
    blurb: 'Weave between targets and around cover.',
    lessons: [
      {
        id: 'sine',
        title: 'sin: height and width',
        blurb: 'Two numbers control any wave.',
        blocks: [
          { t: 'p', text: 'In `a*sin(x/b)`, a is the height of the wave, and b stretches it sideways. One full wave is about 6.3 times b wide. So `sin(x)` repeats every 6.3 units, and `sin(x/3)` every 19.' },
          { t: 'sliders', note: 'Change the height and width.', mode: 'fn', from: [-22, 0], template: '{a}*sin(x/{b})', params: [
            { name: 'a', label: 'Height', min: 0, max: 8, step: 0.25, value: 4 },
            { name: 'b', label: 'Width', min: 0.5, max: 6, step: 0.25, value: 2 },
          ] },
          { t: 'quiz', id: 'sine-q', q: 'How would you make `sin(x)` wave 5 units high, and 3 times wider?', options: ['`5*sin(x/3)`', '`3*sin(x/5)`', '`sin(5*x)/3`'], answer: 0, why: 'The number in front sets the height. Dividing x inside stretches it sideways.' },
          { t: 'challenge', id: 'sine-1', title: 'Two on the wave', task: 'Use a wave to take both targets in one shot.', mode: 'fn', solution: '4*sin(x)', from: [-18, 0], hits: [-6, 5], preview: true, requires: { pattern: 'sin', message: 'Use sin for this one.' }, hints: ['Try a width of 1, so just sin(x), and change the height.', 'A height of 4 does it.', 'Type 4*sin(x)'] },
          { t: 'challenge', id: 'sine-2', title: 'A long wave', task: 'These two are far apart, so you need a much wider wave.', mode: 'fn', solution: '5*sin(x/3)', from: [-20, 0], hits: [-8, 12], preview: true, requires: { pattern: 'sin', message: 'Use sin for this one.' }, hints: ['Divide x by something, about 3.', 'A height of about 5.', 'Type 5*sin(x/3)'] },
        ],
      },
      {
        id: 'cosine',
        title: 'cos, and shifting a wave',
        blurb: 'Choose where the wave begins.',
        blocks: [
          { t: 'p', text: '`cos` is the same wave as `sin`, moved along. Adding a number inside, as in `sin(x+c)`, shifts any wave sideways. That lets you put a peak exactly where you need one.' },
          { t: 'sliders', note: 'The shift slides the wave along. Watch the peaks move.', mode: 'fn', from: [-20, 0], template: '{a}*sin(x/{b}+{c})', params: [
            { name: 'a', label: 'Height', min: 0, max: 8, step: 0.25, value: 4 },
            { name: 'b', label: 'Width', min: 0.5, max: 5, step: 0.25, value: 2 },
            { name: 'c', label: 'Shift', min: 0, max: 6.3, step: 0.1, value: 0 },
          ] },
          { t: 'challenge', id: 'cos-1', title: 'A cosine shot', task: 'Take both targets with a cosine wave.', mode: 'fn', solution: '3*cos(x/2)', from: [-14, 1], hits: [0, 12], preview: true, requires: { pattern: 'cos', message: 'Use cos for this one.' }, hints: ['Try a height near 3.', 'Divide x by 2 to stretch it.', 'Type 3*cos(x/2)'] },
        ],
      },
      {
        id: 'mixing',
        title: 'Adding shapes together',
        blurb: 'The most powerful idea in the game.',
        blocks: [
          { t: 'p', text: 'You can add any shapes with `+`. Add a line to a wave, and you get a wave that climbs. The line aims the shot, and the wave dodges things on the way.' },
          { t: 'sliders', note: 'The slope aims, and the height weaves.', mode: 'fn', from: [-20, -6], template: '{m}*x+{a}*sin(x)', params: [
            { name: 'm', label: 'Slope', min: -1, max: 1, step: 0.05, value: 0.35 },
            { name: 'a', label: 'Wave height', min: 0, max: 6, step: 0.25, value: 2 },
          ] },
          { t: 'challenge', id: 'mix-1', title: 'Climb and weave', task: 'Combine a line and a wave to hit both.', mode: 'fn', solution: 'x/3+2*sin(x)', from: [-20, -6], hits: [-3, 11], preview: true, requires: { pattern: 'sin', message: 'Use a wave, added to a line.' }, hints: ['Start with x/3 for the climb.', 'Add 2*sin(x) to it.', 'Type x/3+2*sin(x)'] },
          { t: 'challenge', id: 'mix-2', title: 'Around your friend', task: 'A teammate is between you and the target. Weave around them.', mode: 'fn', solution: '4*sin(x/2)', from: [-20, 0], hits: [10], friends: [[0, 3]], preview: true, hints: ['A wave avoids anything it isn\'t passing through.', 'Height 4, width 2.', 'Type 4*sin(x/2)'] },
        ],
      },
    ],
  },
  {
    title: 'Walls and gaps',
    blurb: 'The tools strong players rely on.',
    lessons: [
      {
        id: 'steps',
        title: 'Smooth steps',
        blurb: 'Climb a wall at an exact spot.',
        blocks: [
          { t: 'p', text: 'A true jump ends your shot. But a very steep smooth curve works fine. This formula makes one: it stays flat, rises fast at one spot, and stays flat again.' },
          { t: 'tip', text: 'a/(1+exp(-k*(x-b)))  rises by a at x = b. Larger k makes a sharper step.' },
          { t: 'sliders', note: 'Change the height, sharpness, and position of the step.', mode: 'fn', from: [-20, -5], template: '{a}/(1+exp(-{k}*(x-{b})))', params: [
            { name: 'a', label: 'Height', min: -12, max: 12, step: 0.5, value: 8 },
            { name: 'k', label: 'Sharpness', min: 0.3, max: 6, step: 0.1, value: 3 },
            { name: 'b', label: 'Position', min: -18, max: 18, step: 0.5, value: 0 },
          ] },
          { t: 'tip', text: 'You don\'t need to memorize this exact form. Copy it from the cheat sheet in the last lesson, and change the three numbers.' },
          { t: 'challenge', id: 'steps-1', title: 'Up and over', task: 'Stay low past the first rock, step up at x = -2, then clear the second rock.', mode: 'fn', solution: '8/(1+exp(-3*(x+2)))', from: [-18, -5], hits: [12], rocks: [[8, -5, 3.5], [-10, 5, 3]], blocksStraight: true, hints: ['The formula is a/(1+exp(-k*(x-b))).', 'Use a height of 8, sharpness 3, and x+2 for the position.', 'Type 8/(1+exp(-3*(x+2)))'] },
        ],
      },
      {
        id: 'double-steps',
        title: 'Stacking steps',
        blurb: 'Add steps together to climb twice, or to go up and back down.',
        blocks: [
          { t: 'p', text: 'Since you can add anything, you can add two steps. Two positive steps climb like a staircase. A positive step and then a negative one make a bump over a wall.' },
          { t: 'play', note: 'Each of these is two steps added together.', mode: 'fn', from: [-20, -6], start: '5/(1+exp(-3*(x+8)))+5/(1+exp(-3*(x-4)))', examples: [
            { expr: '5/(1+exp(-3*(x+8)))+5/(1+exp(-3*(x-4)))', note: 'A staircase' },
            { expr: '8/(1+exp(-3*(x+8)))-8/(1+exp(-3*(x-4)))', note: 'A bump' },
          ] },
          { t: 'challenge', id: 'dsteps-1', title: 'The staircase', task: 'A straight line runs into the rock. Stay under it with two steps: climb at x = -8, and again at x = 4.', mode: 'fn', solution: '5/(1+exp(-3*(x+8)))+5/(1+exp(-3*(x-4)))', from: [-20, -8], hits: [14], rocks: [[-1, 4, 3.6], [-14, 5, 3]], blocksStraight: true, hints: ['Write one step, then a + and a second step.', 'Each has a height of 5 and sharpness 3.', 'The positions are x+8 and x-4.'] },
        ],
      },
      {
        id: 'choosing',
        title: 'Choosing the right shot',
        blurb: 'Look at the board, and know what to reach for.',
        blocks: [
          { t: 'table', rows: [
            ['Nothing in the way', 'A line. Use the slope formula.'],
            ['One rock in the way', 'A parabola arcing over or under it.'],
            ['A sharp corner to pass', 'abs, turning right beside it.'],
            ['Several things to avoid', 'A wave, or a line plus a wave.'],
            ['A big wall', 'A smooth step, or two.'],
            ['Two enemies nearby', 'Look for a line or wave through both.'],
          ] },
          { t: 'quiz', id: 'choose-q1', q: 'One round rock sits directly between you and an enemy. What\'s the simplest choice?', options: ['A parabola over it', 'A very high-frequency sine', 'A true jump'], answer: 0, why: 'One obstacle usually needs one bend. High frequency runs out of length, and a jump ends your shot.' },
          { t: 'quiz', id: 'choose-q2', q: 'Rocks above and below leave a narrow gap straight ahead. What should you try first?', options: ['A careful straight line', 'A wave', 'A big step'], answer: 0, why: 'If a straight line fits, nothing is more accurate. Save the complicated shots for when you need them.' },
          { t: 'challenge', id: 'choose-1', title: 'Through the gap', task: 'Two rocks leave one way through. Find it.', mode: 'fn', solution: 'x/5', from: [-18, -3], hits: [14], rocks: [[0, 4, 2.5], [0, -4, 2.5]], hints: ['Use the slope formula. A straight line fits.', 'Up 6.4 over 32 across.', 'Type x/5'] },
        ],
      },
    ],
  },
  {
    title: "y' mode",
    blurb: 'Describe the slope, and let the game work out the curve.',
    lessons: [
      {
        id: 'first-order',
        title: "What y' means",
        blurb: 'A new way of thinking about a shot.',
        blocks: [
          { t: 'p', text: "Some matches use `y'` mode. Instead of the curve's height, you type its slope at every point: how steep it should be, right here. The game then flies along those directions, starting from your soldier." },
          { t: 'p', text: "A constant slope makes a straight line. So `y' = 0.5` is the same shot as `y = x/2`. You can use `x` and `y` in your rule, and that's where it gets interesting." },
          { t: 'play', note: "These are all y' rules.", mode: 'ode1', from: [-20, 0], start: '0.5', examples: [
            { expr: '0.5', note: 'A straight line up' },
            { expr: 'x/15', note: 'The slope changes as x grows' },
            { expr: '2*sin(x/2)', note: 'The slope waves' },
          ] },
          { t: 'quiz', id: 'first-q', q: "Which y' rule gives a flat shot?", options: ['`1`', '`0`', '`x`'], answer: 1, why: 'A slope of 0 means no climbing at all, anywhere.' },
          { t: 'challenge', id: 'first-1', title: 'A constant slope', task: 'Hit the target with a constant slope.', mode: 'ode1', solution: '0.5', from: [-16, -4], hits: [4], preview: true, hints: ['Just type a single number.', 'Up 10 over 20 across.', 'Type 0.5'] },
        ],
      },
      {
        id: 'y-rules',
        title: 'Rules that use y',
        blurb: 'Curves that steer themselves.',
        blocks: [
          { t: 'p', text: "Using `y` in the rule makes the shot react to its own height. `-y/3` always steers toward y = 0: high up, the slope points down, and low down, it points up. `y/8` does the opposite, and speeds away from 0." },
          { t: 'sliders', note: 'Negative pulls the shot toward y = 0. Positive pushes it away.', mode: 'ode1', from: [-20, 8], template: '{a}*y', params: [{ name: 'a', label: 'Strength', min: -0.8, max: 0.3, step: 0.02, value: -0.3 }] },
          { t: 'challenge', id: 'rules-1', title: 'Pulled to the center', task: 'Start high, and settle toward the middle of the board.', mode: 'ode1', solution: '-y/3', from: [-18, 9], hits: [2], preview: true, hints: ['Use y in your rule, with a minus sign.', 'Divide it by about 3.', 'Type -y/3'] },
          { t: 'challenge', id: 'rules-2', title: 'A slope that changes', task: 'Use x to make the slope grow as you go.', mode: 'ode1', solution: 'x/15', from: [-15, 3], hits: [10], preview: true, hints: ['Your rule only needs x, divided by a number.', 'Try numbers from 10 to 20.', 'Type x/15'] },
        ],
      },
    ],
  },
  {
    title: "y'' mode",
    blurb: 'Aim with an angle, and steer with acceleration.',
    lessons: [
      {
        id: 'second-order',
        title: 'Angle and gravity',
        blurb: 'Lob your shot like a thrown ball.',
        blocks: [
          { t: 'p', text: "In `y''` mode, you set a firing angle, using the Up and Down arrow keys or buttons. Your function says how the slope changes along the way. A negative number works like gravity." },
          { t: 'sliders', note: 'Raise the angle and adjust gravity. This is how you lob a shot.', mode: 'ode2', from: [-20, -6], template: '{g}', params: [
            { name: 'g', label: 'Gravity', min: -0.3, max: 0.3, step: 0.01, value: -0.1 },
            { name: 'angle', label: 'Angle', min: -1.2, max: 1.4, step: 0.02, value: 0.7 },
          ] },
          { t: 'tip', text: "This is the only mode where the angle does anything. In the other modes, your soldier's angle is ignored." },
          { t: 'challenge', id: 'second-1', title: 'A lob', task: 'Angle up, and let gravity bring it down onto the target. Try `-0.1`, then find the angle.', mode: 'ode2', solution: '-0.1', angle: 0.7, from: [-18, -6], hits: [2], preview: true, hints: ['Type -0.1 in the box.', 'Then hold the Up button until the dashed curve touches the target.', 'About 40 degrees.'] },
          { t: 'challenge', id: 'second-2', title: 'Over the rock', task: 'Lob it high enough to clear the rock.', mode: 'ode2', solution: '-0.12', angle: 0.75, from: [-20, -6], hits: [0], rocks: [[-10, -4, 2.8]], preview: true, hints: ['Use gravity of about -0.12.', 'Raise the angle to about 43 degrees.'] },
        ],
      },
      {
        id: 'springs',
        title: 'Springs and drag',
        blurb: "Using y and y' in the rule.",
        blocks: [
          { t: 'p', text: "`-y/4` is a spring: the further the shot is from y = 0, the harder it's pulled back. It swings like a wave. `-y'/4` is drag: it fights the slope, so the shot flattens out." },
          { t: 'play', note: 'Compare a spring with drag.', mode: 'ode2', from: [-20, 3], angle: 0.5, start: '-y/4', examples: [
            { expr: '-y/4', note: 'A spring', angle: 0.5 },
            { expr: "-y'/4", note: 'Drag flattens out', angle: 0.9 },
            { expr: "-y/4-y'/10", note: 'A spring that fades', angle: 0.5 },
          ] },
          { t: 'challenge', id: 'springs-1', title: 'Swing through both', task: 'Use a spring to swing through both targets.', mode: 'ode2', solution: '-y/4', angle: 0.3, from: [-20, 3], hits: [-8, 8], preview: true, hints: ['Use y with a minus sign, divided by about 4.', 'A low angle, about 17 degrees.'] },
          { t: 'quiz', id: 'springs-q', q: "What does `-y'/4` do to a shot?", options: ['Makes it swing', 'Slows the slope, so it flattens out', 'Pulls it toward y = 0'], answer: 1, why: "It works against the slope itself, like air resistance." },
        ],
      },
    ],
  },
  {
    title: 'Real matches',
    blurb: 'Everything else you need to win.',
    lessons: [
      {
        id: 'match-flow',
        title: 'How a match runs',
        blurb: 'Turns, timers, and teams.',
        blocks: [
          { t: 'p', text: 'Teams take turns. Each turn is 60 seconds, and if the time runs out, your turn is skipped. With more than one soldier, they take turns too: the highlighted soldier is the one who fires.' },
          { t: 'p', text: 'You always see your own team on the left, firing right, even if your side is really on the right. Your opponent sees the same thing from their side, so aim as usual.' },
          { t: 'tip', text: 'Use your full 60 seconds. Read the coordinates, do the math, and check your parentheses. A careful shot beats a fast one.' },
          { t: 'p', text: 'The Shot history box lists every shot. Click any of them, or use the left and right arrow keys, to see the board at that moment. It\'s a great way to learn from a good opponent. You can keep typing while you look.' },
          { t: 'quiz', id: 'flow-q1', q: 'You\'re on the right-hand team. Which way do your shots go on your screen?', options: ['Left, across the board', 'Right: you always see yourself on the left', 'You choose'], answer: 1, why: 'The view is mirrored for one team, so everyone plays left to right.' },
          { t: 'quiz', id: 'flow-q2', q: 'What happens if your 60 seconds run out?', options: ['You lose a soldier', 'Your turn is skipped', 'The match ends'], answer: 1, why: "You only lose that turn, but it's a free turn for your opponent." },
        ],
      },
      {
        id: 'terrain',
        title: 'Breaking through obstacles',
        blurb: 'Every shot changes the map.',
        blocks: [
          { t: 'p', text: 'Shots explode where they end, and that takes a bite out of the obstacle. The bite stays for the rest of the match. A rock that blocks you now may be open after a few shots, for you and for your opponent.' },
          { t: 'tip', text: 'If you have no clean shot, chip away at the rock between you and the enemy. But think about it from their side: the hole works both ways.' },
          { t: 'challenge', id: 'terrain-1', title: 'Dig a path', task: 'The rock blocks a flat shot. Keep firing `0` until you break through. You have 6 shots.', mode: 'fn', solution: '0', from: [-15, 0], hits: [10], rocks: [[0, 0, 1.3]], shots: 6, preview: true, hints: ['Each shot digs a little further.', 'Just type 0 and fire again and again.'] },
          { t: 'quiz', id: 'terrain-q', q: 'A shot passes through an enemy, then reaches a rock. What happens?', options: ['Nothing is damaged', 'The enemy is out, and the rock gets a bite', 'Only the rock gets hit'], answer: 1, why: 'Hits happen along the path, and the explosion happens where the shot ends.' },
        ],
      },
      {
        id: 'free-for-all',
        title: 'Free-for-all and firing left',
        blurb: 'Everyone against everyone, in both directions.',
        blocks: [
          { t: 'p', text: 'In Free-for-all, the last player standing wins, and enemies can be on either side. So you choose a firing direction: toward +x or toward -x. Your soldier turns to face the way you\'re aiming.' },
          { t: 'p', text: 'Your function stays on the same graph. So firing toward -x along `x/5` goes down to the left, because that line is lower on the left.' },
          { t: 'challenge', id: 'ffa-1', title: 'Fire left', task: 'The target is to your left. Choose "Fire toward −x", then fire `x/5`.', mode: 'fn', solution: 'x/5', dir: -1, ffa: true, from: [15, 0], hits: [-5], preview: true, hints: ['Press the "Fire toward −x" button first.', 'Type x/5'] },
          { t: 'quiz', id: 'ffa-q', q: 'You fire `x/2` toward -x. What does your shot do on screen?', options: ['Climbs to the left', 'Falls to the left', 'Flies right'], answer: 1, why: 'The line x/2 gets lower as x gets smaller. Going left means going down.' },
        ],
      },
      {
        id: 'winning',
        title: 'A routine for every turn',
        blurb: 'Plus the cheat sheet to keep.',
        blocks: [
          { t: 'h', text: 'Every turn, in order' },
          { t: 'table', rows: [
            ['1. Find your soldier', 'The highlighted one. Note its x and y.'],
            ['2. Pick a target', 'Look for two in a line. Avoid teammates.'],
            ['3. Check the way', 'What is between you? Choose the shape from that.'],
            ['4. Do the math', 'Slope formula first, then add a bend if needed.'],
            ['5. Check before firing', 'Read the formula shown under the box. Is it what you meant?'],
          ] },
          { t: 'h', text: 'If you miss' },
          { t: 'p', text: 'Your curve stays on the screen as it flies. Note how far off you were, and change one number next time. Most good shots take a small adjustment.' },
          { t: 'h', text: 'Cheat sheet' },
          { t: 'table', rows: [
            ['(Ty-Sy)/(Tx-Sx)*x', 'Line from you (S) to a target (T)'],
            ['-(x-b)^2/40', 'Arc over something at x = b'],
            ['(x-b)^2/40', 'Dip under something at x = b'],
            ['a*abs(x-b)', 'Sharp turn at x = b'],
            ['a*sin(x/b)', 'Wave: a high, about 6.3b wide'],
            ['m*x+a*sin(x)', 'Climbing wave'],
            ['a/(1+exp(-3*(x-b)))', 'Step of height a at x = b'],
            ['sqrt(abs(x))', 'A square root that works at negative x'],
            ["y' = -y/3", 'Drifts toward y = 0'],
            ["y'' = -0.1", 'Gravity. Raise your angle and lob it'],
            ["y'' = -y/4", 'A spring, which swings'],
            ["y'' = -y'/4", 'Drag, which flattens out'],
          ] },
        ],
      },
    ],
  },
  {
    title: 'Final test',
    blurb: 'No dashed line. Use what you know.',
    lessons: [
      {
        id: 'final',
        title: 'The final test',
        blurb: 'Six shots, with no preview.',
        blocks: [
          { t: 'p', text: 'These cover the whole course. The preview is hidden here, so you prove you can read the board yourself. Real matches show it, but it only covers the start of a shot. The hints are there if you need them. When you pass these, you\'re ready.' },
          { t: 'challenge', id: 'final-1', title: 'A clean line', task: 'Read the positions, and work out the slope.', mode: 'fn', solution: '0.3*x', from: [-20, -5], hits: [10], hints: ['Up 9, across 30.', 'Type 0.3*x'] },
          { t: 'challenge', id: 'final-2', title: 'Over the top', task: 'Something is in the way. Arc over it.', mode: 'fn', solution: '-(x+3)^2/50', from: [-16, -6], hits: [10], rocks: [[-3, -4, 2.5]], blocksStraight: true, hints: ['An upside-down parabola, with its top near x = -3.', 'Type -(x+3)^2/50'] },
          { t: 'challenge', id: 'final-3', title: 'Don\'t hit your friend', task: 'Take both targets without touching your teammate.', mode: 'fn', solution: 'x/4+3*sin(x/2)', from: [-20, -5], hits: [-8, 9], friends: [[0, 5]], hints: ['A line plus a wave.', 'Try x/4 for the climb.', 'Type x/4+3*sin(x/2)'] },
          { t: 'challenge', id: 'final-4', title: 'The wall', task: 'A wall stands in the way. Step up over it.', mode: 'fn', solution: '9/(1+exp(-3*(x+1)))', from: [-18, -6], hits: [14], rocks: [[6, -5.5, 4.5]], blocksStraight: true, hints: ['Use a smooth step of about 9, at about x = -1.', 'Type 9/(1+exp(-3*(x+1)))'] },
          { t: 'challenge', id: 'final-5', title: "In y' mode", task: "This match is in y' mode. Drift toward the center.", mode: 'ode1', solution: '-y/4', from: [-18, 8], hits: [0], hints: ['Use y, with a minus sign.', 'Type -y/4'] },
          { t: 'challenge', id: 'final-6', title: "In y'' mode", task: 'Lob it over the rock.', mode: 'ode2', solution: '-0.1', angle: 0.8, from: [-20, -6], hits: [2], rocks: [[-8, -4, 2.5]], hints: ['Gravity of -0.1.', 'An angle of about 46 degrees.'] },
        ],
      },
    ],
  },
];

export const LESSONS: Lesson[] = UNITS.flatMap((u) => u.lessons);

/** The exercises in a lesson that have to be finished for it to count as done. */
export function requiredIds(lesson: Lesson): string[] {
  const out: string[] = [];
  for (const b of lesson.blocks) if (b.t === 'challenge' || b.t === 'quiz') out.push(b.id);
  return out.length ? out : [`read:${lesson.id}`];
}

export function lessonDone(lesson: Lesson, done: readonly string[]): boolean {
  return requiredIds(lesson).every((id) => done.includes(id));
}

export function challengeDef(c: Challenge): SoloDef {
  return buildLevel(c);
}

/** A fresh board for a challenge. Free-for-all rules are what allow firing left. */
export function challengeState(c: Challenge): MatchState {
  const state = createSolo(challengeDef(c));
  if (c.ffa) state.config.kind = 'ffa';
  return state;
}

/** A fresh board for a playground, slider, or example. */
export function freeBoard(mode: ShotMode, from: [number, number], targets: [number, number][] = [], rocks: [number, number, number][] = []): MatchState {
  const state = createSolo({
    mode,
    shooter: { x: toPxX(from[0]), y: toPxY(from[1]) },
    enemies: targets.map(([x, y]) => ({ x: toPxX(x), y: toPxY(y) })),
    circles: rocks.map(([x, y, r]) => ({ x: toPxX(x), y: toPxY(y), r: r * 15.4 })),
  });
  soloNext(state);
  return state;
}

export { ME };
