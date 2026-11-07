import { ALLIES, TARGETS, BLAST_R, DRAW_STEPS_PER_SEC, NEXT_TURN_DELAY_MS, PLANE_H, PLANE_W, PX_PER_UNIT, SOLDIER_R, type Circle, type MatchState, type ShotRecord } from '@mathbattles/sim';
import { drawHat } from './doodles';
import { drawObstacle, obstacleStyle, type ObstacleStyle } from './obstacles';

export type ThemeId = 'paper' | 'chalk' | 'blueprint';

export interface Theme {
  name: string;
  /** Colors for the small preview in Settings. */
  swatch: { page: string; line: string; ink: string };
  bg: string;
  grid: string;
  axis: string;
  label: string;
  biteEdge: string;
  team1: string;
  team2: string;
  mark: string;
  smoke: string;
}

export const THEMES: Record<ThemeId, Theme> = {
  paper: {
    name: 'Graph Paper', swatch: { page: '#eef0fb', line: '#cfd3f0', ink: '#2b2f7a' },
    bg: '#fbfbff', grid: '#dcdff6', axis: '#2b2f7a', label: '#5d62a0',
    biteEdge: '#00000055', team1: '#2b50e8', team2: '#ee3a57', mark: '#ffd33d', smoke: '#30304a',
  },
  chalk: {
    name: 'Chalkboard', swatch: { page: '#22423a', line: '#2f5449', ink: '#f2f6ea' },
    bg: '#22423a', grid: '#35594f', axis: '#eef3e6', label: '#b9cdbf',
    biteEdge: '#00000066', team1: '#9ad8ff', team2: '#ffb0a8', mark: '#ffd33d', smoke: '#d8e4dc',
  },
  blueprint: {
    name: 'Blueprint', swatch: { page: '#143a78', line: '#22508f', ink: '#eef4ff' },
    bg: '#143a78', grid: '#28539a', axis: '#e8f1ff', label: '#b7cdf2',
    biteEdge: '#00000066', team1: '#fff27a', team2: '#ff9e8a', mark: '#ffffff', smoke: '#d6e4ff',
  },
};

export interface StageLook {
  hat?: string;
  trail?: string;
  blast?: string;
}

interface ActiveShot {
  xs: ArrayLike<number>;
  ys: ArrayLike<number>;
  steps: number;
  record: ShotRecord;
  color: string;
  trail: string;
  blast: string;
  /** Simulated time in ms. It runs slower during a final knockout. */
  clock: number;
  lastFrame: number;
  exploded: boolean;
  finalShot: boolean;
  lastKillStep: number;
  kills: number;
  resolve: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  kind: 'spark' | 'smoke' | 'chunk' | 'confetti' | 'star' | 'ember';
  spin: number;
}

interface Floater {
  text: string;
  x: number;
  y: number;
  at: number;
  life: number;
  size: number;
  color: string;
}

interface Flyer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  angle: number;
  at: number;
  color: string;
  hat: string;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  at: number;
  color: string;
  style: string;
}

/** Draws a curve in a trail style. px maps x positions, for mirrored views. */
export function strokeTrail(
  c: CanvasRenderingContext2D,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  upto: number,
  color: string,
  trail: string,
  glow: boolean,
  px: (x: number) => number = (x) => x,
): void {
  if (upto < 2) return;
  const trace = () => {
    const stride = Math.max(1, Math.floor(upto / 1800));
    c.beginPath();
    c.moveTo(px(xs[0]!), ys[0]!);
    for (let i = stride; i < upto; i += stride) {
      const y = ys[i]!;
      if (Number.isFinite(y)) c.lineTo(px(xs[i]!), y);
    }
    const last = upto - 1;
    if (Number.isFinite(ys[last]!)) c.lineTo(px(xs[last]!), ys[last]!);
  };
  c.save();
  c.lineJoin = 'round';
  c.lineCap = 'round';
  if (trail === 'rainbow') {
    const stride = Math.max(1, Math.floor(upto / 1800));
    const seg = Math.max(1, Math.floor(upto / 120));
    c.lineWidth = 3.2;
    for (let i = 0; i < upto - 1; i += seg) {
      c.strokeStyle = `hsl(${(i / 14) % 360} 90% 55%)`;
      c.beginPath();
      c.moveTo(px(xs[i]!), ys[i]!);
      for (let j = i; j < Math.min(upto, i + seg + 1); j += stride) c.lineTo(px(xs[j]!), ys[j]!);
      c.stroke();
    }
    c.restore();
    return;
  }
  if (trail === 'candycane' || trail === 'frost' || trail === 'gold') {
    const layers: [string, number, number, number[]][] =
      trail === 'candycane' ? [['#ffffff', 6, 1, []], ['#e8304a', 6, 1, [7, 7]], ['#00000022', 1, 1, []]]
      : trail === 'frost' ? [['#bfe9ff', 13, 0.35, []], ['#8fd3ff', 6, 0.7, []], ['#ffffff', 2, 1, []]]
      : [['#ffd75e', 12, 0.35, []], ['#e0a400', 4.5, 1, []], ['#fff6c2', 1.4, 1, []]];
    for (const [stroke, width, alpha, dash] of layers) {
      c.strokeStyle = stroke;
      c.lineWidth = width;
      c.globalAlpha = alpha;
      c.setLineDash(dash);
      trace();
      c.stroke();
    }
    c.restore();
    return;
  }
  if (trail === 'lights' || trail === 'sparkle') {
    c.strokeStyle = trail === 'lights' ? '#2f6b3a' : color;
    c.lineWidth = trail === 'lights' ? 1.6 : 2.6;
    trace();
    c.stroke();
    // Bulbs or sparkles placed every few pixels along the path.
    const bulbs = ['#ff4d6d', '#3fd06e', '#ffd33d', '#4fb3ff'];
    let walked = 0;
    let n = 0;
    let lx = px(xs[0]!);
    let ly = ys[0]!;
    const stride = Math.max(1, Math.floor(upto / 1800));
    for (let i = stride; i < upto; i += stride) {
      const x = px(xs[i]!);
      const y = ys[i]!;
      if (!Number.isFinite(y)) continue;
      walked += Math.hypot(x - lx, y - ly);
      lx = x;
      ly = y;
      if (walked < (trail === 'lights' ? 13 : 17)) continue;
      walked = 0;
      n++;
      if (trail === 'lights') {
        const bulb = bulbs[n % bulbs.length]!;
        c.fillStyle = bulb;
        c.globalAlpha = 0.3;
        c.beginPath();
        c.arc(x, y + 3, 5, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;
        c.beginPath();
        c.ellipse(x, y + 3, 2.2, 3, 0, 0, Math.PI * 2);
        c.fill();
      } else {
        const size = n % 3 === 0 ? 4.5 : 3;
        c.fillStyle = n % 2 ? '#ffffff' : '#ffe27a';
        c.beginPath();
        c.moveTo(x, y - size);
        c.quadraticCurveTo(x, y, x + size, y);
        c.quadraticCurveTo(x, y, x, y + size);
        c.quadraticCurveTo(x, y, x - size, y);
        c.quadraticCurveTo(x, y, x, y - size);
        c.fill();
      }
    }
    c.restore();
    return;
  }
  if (trail === 'neon') {
    c.strokeStyle = color;
    c.globalAlpha = 0.25;
    c.lineWidth = 12;
    trace();
    c.stroke();
    c.globalAlpha = 0.55;
    c.lineWidth = 6;
    trace();
    c.stroke();
    c.globalAlpha = 1;
    c.strokeStyle = '#ffffff';
    c.lineWidth = 1.8;
    trace();
    c.stroke();
    c.restore();
    return;
  }
  if (trail === 'double') {
    c.strokeStyle = color;
    c.lineWidth = 6;
    trace();
    c.stroke();
    c.strokeStyle = '#ffffff';
    c.lineWidth = 2;
    trace();
    c.stroke();
    c.restore();
    return;
  }
  if (glow && trail !== 'dash' && trail !== 'ghost' && trail !== 'dots') {
    c.strokeStyle = color;
    c.globalAlpha = 0.18;
    c.lineWidth = trail === 'thick' ? 13 : 9;
    trace();
    c.stroke();
    c.globalAlpha = 1;
  }
  c.strokeStyle = color;
  c.lineWidth = trail === 'thick' ? 5 : trail === 'dots' ? 4.5 : 3;
  if (trail === 'dash') c.setLineDash([9, 7]);
  if (trail === 'dots') c.setLineDash([0.1, 9]);
  if (trail === 'ghost') c.globalAlpha = 0.45;
  trace();
  c.stroke();
  c.restore();
}

/** Draws an explosion style, t going from 0 to 1. */
export function drawBlast(c: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, color: string, style: string): void {
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineWidth = 6 * (1 - t) + 1.5;
  c.lineCap = 'round';
  if (style === 'star') {
    c.beginPath();
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2 + t;
      const len = a % 2 === 0 ? 1 : 0.7;
      c.moveTo(x + Math.cos(ang) * r * 0.8, y + Math.sin(ang) * r * 0.8);
      c.lineTo(x + Math.cos(ang) * (r + (64 * t + 10) * len), y + Math.sin(ang) * (r + (64 * t + 10) * len));
    }
    c.stroke();
  } else if (style === 'sigma' || style === 'pi') {
    c.font = `800 ${Math.round(r * 3 + 70 * t)}px "Shantell Sans", serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(style === 'pi' ? 'π' : 'Σ', x, y);
  } else if (style === 'sqrt' || style === 'infinity') {
    c.font = `800 ${Math.round(r * 3 + 70 * t)}px "Shantell Sans", serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(style === 'sqrt' ? '√' : '∞', x, y);
  } else if (style === 'snowflake') {
    const size = r + 50 * t;
    c.save();
    c.translate(x, y);
    c.rotate(t * 1.2);
    c.strokeStyle = '#9fd8ff';
    c.lineWidth = 3.5 * (1 - t) + 1.5;
    c.beginPath();
    for (let a = 0; a < 6; a++) {
      const ang = (a / 6) * Math.PI * 2;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      c.moveTo(0, 0);
      c.lineTo(dx * size, dy * size);
      for (const along of [0.45, 0.72]) {
        const bx = dx * size * along;
        const by = dy * size * along;
        const arm = size * 0.22;
        c.moveTo(bx, by);
        c.lineTo(bx + Math.cos(ang + 0.7) * arm, by + Math.sin(ang + 0.7) * arm);
        c.moveTo(bx, by);
        c.lineTo(bx + Math.cos(ang - 0.7) * arm, by + Math.sin(ang - 0.7) * arm);
      }
    }
    c.stroke();
    c.strokeStyle = '#ffffff';
    c.lineWidth = 1.2;
    c.stroke();
    c.restore();
  } else if (style === 'confetti') {
    const colors = ['#ffd33d', '#ff5d7e', '#4fb3ff', '#57d977', '#b57bff'];
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2 + (i % 3) * 0.3;
      const dist = r * 0.6 + (40 + (i % 4) * 12) * t;
      const px = x + Math.cos(ang) * dist;
      const py = y + Math.sin(ang) * dist + 30 * t * t;
      c.save();
      c.translate(px, py);
      c.rotate(ang + t * 8 + i);
      c.fillStyle = colors[i % colors.length]!;
      c.fillRect(-3.5, -1.8, 7, 3.6);
      c.restore();
    }
  } else if (style === 'gift') {
    const size = r * 1.5;
    c.save();
    c.translate(x, y);
    c.fillStyle = '#e8304a';
    c.fillRect(-size / 2, -size / 2 + 4, size, size * 0.8);
    c.fillStyle = '#ffd33d';
    c.fillRect(-2.5, -size / 2 + 4, 5, size * 0.8);
    // The lid flies off and spins away.
    c.translate(10 * t, -size / 2 - 40 * t);
    c.rotate(t * 2.4);
    c.fillStyle = '#c4183a';
    c.fillRect(-size / 2 - 2, -4, size + 4, 6);
    c.fillStyle = '#ffd33d';
    c.beginPath();
    c.ellipse(-4, -6, 4, 2.5, -0.5, 0, Math.PI * 2);
    c.ellipse(4, -6, 4, 2.5, 0.5, 0, Math.PI * 2);
    c.fill();
    c.restore();
    for (let i = 0; i < 8; i++) {
      const ang = -Math.PI / 2 + (i - 3.5) * 0.35;
      c.fillStyle = i % 2 ? '#ffd33d' : '#ffffff';
      c.beginPath();
      c.arc(x + Math.cos(ang) * (r + 50 * t), y - size / 2 + Math.sin(ang) * (r + 50 * t), 2.6, 0, Math.PI * 2);
      c.fill();
    }
  } else if (style === 'lightning') {
    // A jagged bolt from above, the same shape every time for a given spot.
    const top = y - 160;
    const pts: [number, number][] = [[x + 12, top]];
    let seed = Math.floor(x * 7 + y * 13);
    const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 1; i < 8; i++) pts.push([x + (rand() - 0.5) * 26 * (1 - i / 8), top + ((y - top) * i) / 8]);
    pts.push([x, y]);
    for (const [stroke, width] of [['#fff27a', 9 * (1 - t) + 2], ['#ffffff', 3]] as const) {
      c.strokeStyle = stroke;
      c.lineWidth = width;
      c.lineJoin = 'round';
      c.beginPath();
      pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
      c.stroke();
    }
    c.strokeStyle = '#fff27a';
    c.lineWidth = 3 * (1 - t) + 1;
    c.beginPath();
    c.arc(x, y, r + 34 * t, 0, Math.PI * 2);
    c.stroke();
  } else if (style === 'smite') {
    // A beam of light falls from the sky onto the target, then narrows and fades.
    const w = (r * 2.2 + 26) * (1 - t * 0.7);
    const top = y - 900;
    const g = c.createLinearGradient(x - w, 0, x + w, 0);
    g.addColorStop(0, 'rgba(255, 190, 40, 0)');
    g.addColorStop(0.18, 'rgba(255, 185, 30, 0.6)');
    g.addColorStop(0.36, 'rgba(255, 222, 110, 0.95)');
    g.addColorStop(0.5, 'rgba(255, 255, 255, 1)');
    g.addColorStop(0.64, 'rgba(255, 222, 110, 0.95)');
    g.addColorStop(0.82, 'rgba(255, 185, 30, 0.6)');
    g.addColorStop(1, 'rgba(255, 190, 40, 0)');
    c.fillStyle = g;
    c.fillRect(x - w, top, w * 2, y - top);
    // Gold edges so the beam stands out on light paper too.
    c.strokeStyle = 'rgba(230, 150, 0, 0.8)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x - w * 0.55, top);
    c.lineTo(x - w * 0.55, y);
    c.moveTo(x + w * 0.55, top);
    c.lineTo(x + w * 0.55, y);
    c.stroke();
    const glow = c.createRadialGradient(x, y, 0, x, y, r * 2 + 60 * t + 20);
    glow.addColorStop(0, 'rgba(255, 255, 255, 1)');
    glow.addColorStop(0.4, 'rgba(255, 228, 120, 0.7)');
    glow.addColorStop(1, 'rgba(255, 210, 80, 0)');
    c.fillStyle = glow;
    c.beginPath();
    c.arc(x, y, r * 2 + 60 * t + 20, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#ffd33d';
    c.lineWidth = 4 * (1 - t) + 1;
    c.beginPath();
    c.ellipse(x, y + 4, r + 80 * t, (r + 80 * t) * 0.32, 0, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#ffffff';
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2;
      const d = r + 70 * t;
      c.fillRect(x + Math.cos(ang) * d - 1.5, y - 40 * t * (i % 3) + Math.sin(ang) * d * 0.4 - 1.5, 3, 3);
    }
  } else if (style === 'heart') {
    const size = r * 1.2 + 46 * t;
    c.beginPath();
    c.moveTo(x, y + size);
    c.bezierCurveTo(x - size * 1.7, y - size * 0.3, x - size * 0.7, y - size * 1.2, x, y - size * 0.35);
    c.bezierCurveTo(x + size * 0.7, y - size * 1.2, x + size * 1.7, y - size * 0.3, x, y + size);
    c.fill();
  } else if (style === 'shock') {
    for (const k of [1, 0.65, 0.3]) {
      c.beginPath();
      c.arc(x, y, r + 80 * t * k, 0, Math.PI * 2);
      c.stroke();
    }
  } else {
    c.beginPath();
    c.arc(x, y, r + 70 * t, 0, Math.PI * 2);
    c.stroke();
    c.lineWidth = 3 * (1 - t) + 1;
    c.beginPath();
    c.arc(x, y, r * 0.6 + 38 * t, 0, Math.PI * 2);
    c.stroke();
  }
}

/** The bright flash of an explosion: a white core inside a fading orange ball. t goes from 0 to 1. */
export function drawFireball(c: CanvasRenderingContext2D, x: number, y: number, r: number, t: number): void {
  const size = r * (1.5 + 3.4 * Math.sqrt(t));
  const g = c.createRadialGradient(x, y, 0, x, y, size);
  const a = 1 - t;
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(0.25, `rgba(255,236,140,${a})`);
  g.addColorStop(0.55, `rgba(255,150,40,${a * 0.85})`);
  g.addColorStop(1, 'rgba(255,90,30,0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, size, 0, Math.PI * 2);
  c.fill();
}

export interface PastView {
  soldiers: { id: number; x: number; y: number; alive: boolean; playerId: string; angle: number }[];
  holes: Circle[];
  shooterId: number;
  path: { xs: ArrayLike<number>; ys: ArrayLike<number>; steps: number };
  shooterPlayer: string;
}

const MAX_PARTICLES = 700;
const motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
let motionReduced = !!motionQuery?.matches;
motionQuery?.addEventListener?.('change', (e) => { motionReduced = e.matches; });
const reducedMotion = () => motionReduced;

/** Frame pacing: about 60 per second while things move, about 30 while the field is calm. */
const BUSY_FRAME_MS = 15;
/**
 * The grid carries on this far past every edge of the field (in field pixels), so a camera
 * zoom or shake shows more graph instead of leftover pixels from earlier frames.
 */
const MARGIN = 120;
const CALM_FRAME_MS = 32;

/** Draws the field. Holds its own display copy so kills appear as the curve reaches them. */
export class Stage {
  private ctx: CanvasRenderingContext2D;
  private terrainLayer: HTMLCanvasElement;
  /** The grid, axes and obstacles, drawn once and copied each frame. */
  private baseLayer: HTMLCanvasElement;
  private baseKey = '';
  private terrainDirty = true;
  private raf = 0;
  private running = false;
  private lastNow = 0;
  private lastDraw = 0;
  private onScreen = true;
  private watcher: IntersectionObserver | null = null;

  state: MatchState | null = null;
  themeId: ThemeId = 'paper';
  mirror = false;
  looks: Record<string, StageLook> = {};
  private soldiers: { id: number; x: number; y: number; alive: boolean; playerId: string; angle: number; flown: boolean; bornAt: number }[] = [];
  private circles: Circle[] = [];
  private holes: Circle[] = [];
  private shot: ActiveShot | null = null;
  private rings: Ring[] = [];
  private fireballs: { x: number; y: number; r: number; at: number }[] = [];
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private flyers: Flyer[] = [];
  private shake = 0;
  private flash = 0;
  private zoom = { x: PLANE_W / 2, y: PLANE_H / 2, s: 1, target: 1, tx: PLANE_W / 2, ty: PLANE_H / 2 };
  activeSoldierId: number | null = null;
  previewPath: { xs: ArrayLike<number>; ys: ArrayLike<number>; steps: number } | null = null;
  aimAngle: number | null = null;
  aimDir: 1 | -1 = 1;
  /** True while someone at this screen is choosing a shot, so the aim direction shows. */
  aiming = false;
  private rockStyle: ObstacleStyle = obstacleStyle('candy');
  /** Which way each soldier last fired, in free-for-all. */
  private faceDirs = new Map<number, 1 | -1>();
  private past: PastView | null = null;
  onExplode?: (kills: number) => void;
  onKill?: () => void;
  /** Called when the field needs a big callout, such as the final knockout. */
  onFinalKill?: () => void;

  /** maxScale caps the drawing resolution. Decorative demos use less than a real match. */
  constructor(private canvas: HTMLCanvasElement, private maxScale = 2) {
    this.ctx = canvas.getContext('2d')!;
    this.terrainLayer = document.createElement('canvas');
    this.baseLayer = document.createElement('canvas');
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const cssW = this.canvas.clientWidth || PLANE_W;
    // Past twice the field's size, extra pixels cost a lot of drawing and look the same.
    const scale = Math.max(1, Math.min(this.maxScale, (cssW / PLANE_W) * dpr));
    const w = Math.round(PLANE_W * scale);
    const h = Math.round(PLANE_H * scale);
    // Setting a canvas size clears it, so only do it when the size really changes.
    const bw = Math.round((PLANE_W + 2 * MARGIN) * scale);
    const bh = Math.round((PLANE_H + 2 * MARGIN) * scale);
    if (this.canvas.width === w && this.canvas.height === h && this.baseLayer.width === bw) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.terrainLayer.width = w;
    this.terrainLayer.height = h;
    this.baseLayer.width = bw;
    this.baseLayer.height = bh;
    this.terrainDirty = true;
  }

  /** True while anything on the field is moving quickly. */
  private busy(): boolean {
    return !!this.shot || this.particles.length > 0 || this.flyers.length > 0 || this.rings.length > 0
      || this.fireballs.length > 0 || this.floaters.length > 0 || this.shake > 0.3 || this.flash > 0.01
      || Math.abs(this.zoom.s - this.zoom.target) > 0.002;
  }

  /** Copies the match to the display when nothing is animating. */
  sync(state: MatchState): void {
    this.state = state;
    if (this.shot) return;
    this.circles = state.circles;
    this.holes = state.holes.slice();
    const now = performance.now();
    this.soldiers = state.soldiers.map((s) => {
      const prev = this.soldiers.find((p) => p.id === s.id && p.playerId === s.playerId);
      return { ...s, flown: !s.alive && (prev ? prev.flown || !prev.alive : true), bornAt: prev?.bornAt ?? now };
    });
    this.terrainDirty = true;
  }

  /** Changes the obstacle design. It only affects what this viewer sees. */
  setRockStyle(id: string | undefined): void {
    this.rockStyle = obstacleStyle(id);
    this.terrainDirty = true;
  }

  /** Shows the board as it was at an earlier shot, without touching the live match. */
  showPast(view: PastView): void {
    this.past = view;
    this.terrainDirty = true;
  }

  clearPast(): void {
    if (!this.past) return;
    this.past = null;
    this.terrainDirty = true;
  }

  isAnimating(): boolean {
    return !!this.shot;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastNow = performance.now();
    document.addEventListener('visibilitychange', this.onVisibility);
    // A field scrolled out of view isn't drawn, unless a shot has to finish playing.
    if (typeof IntersectionObserver !== 'undefined') {
      this.watcher = new IntersectionObserver((entries) => {
        for (const e of entries) this.onScreen = e.isIntersecting;
      });
      this.watcher.observe(this.canvas);
    }
    const frame = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(frame);
      if (!this.onScreen && !this.shot) return;
      // Fast screens (120 Hz and up) don't need more frames than 60 Hz ones.
      if (now - this.lastDraw < (this.busy() ? BUSY_FRAME_MS : CALM_FRAME_MS)) return;
      this.lastDraw = now;
      this.draw(now);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.watcher?.disconnect();
    this.watcher = null;
    this.onScreen = true;
    // Anything waiting on a shot must not wait forever once this view is gone.
    this.finishShotNow();
  }

  /** Hidden tabs don't draw, so shots there finish at once rather than piling up. */
  private onVisibility = (): void => {
    if (document.hidden) this.finishShotNow();
  };

  private finishShotNow(): void {
    const shot = this.shot;
    if (!shot) return;
    this.shot = null;
    this.zoom.target = 1;
    if (this.state) this.sync(this.state);
    shot.resolve();
  }

  /** Plays a shot on the display. Resolves after the post-shot delay. */
  playShot(record: ShotRecord, path: { xs: ArrayLike<number>; ys: ArrayLike<number>; steps: number }): Promise<void> {
    return new Promise((resolve) => {
      if (document.hidden || !this.running) {
        resolve();
        return;
      }
      const theme = THEMES[this.themeId];
      const owner = this.state?.players.find((p) => p.id === record.playerId);
      const look = this.looks[record.playerId] ?? {};
      this.previewPath = null;
      const color = owner?.team === 2 ? theme.team2 : theme.team1;
      this.shot = {
        xs: path.xs,
        ys: path.ys,
        steps: path.steps,
        record,
        color,
        trail: look.trail ?? 'ink',
        blast: look.blast ?? 'ring',
        clock: 0,
        lastFrame: performance.now(),
        exploded: false,
        finalShot: !!this.state?.over && record.hits.length > 0,
        lastKillStep: record.hits.reduce((m, h) => Math.max(m, h.step), 0),
        kills: 0,
        resolve,
      };
      this.faceDirs.set(record.soldierId, record.dir);
      // Muzzle flash.
      this.burst(record.from.x, record.from.y, 14, color, 'spark', 2.2);
    });
  }

  /** Confetti across the field when a viewer wins. */
  celebrate(): void {
    if (reducedMotion()) return;
    const colors = ['#ffd33d', '#ff5d7e', '#4fb3ff', '#57d977', '#b57bff', '#ffffff'];
    for (let i = 0; i < 180; i++) {
      this.particles.push({
        x: Math.random() * PLANE_W,
        y: -20 - Math.random() * 260,
        vx: (Math.random() - 0.5) * 60,
        vy: 60 + Math.random() * 110,
        life: 0,
        max: 3.6 + Math.random() * 1.6,
        size: 3 + Math.random() * 4,
        color: colors[i % colors.length]!,
        kind: 'confetti',
        spin: Math.random() * 6,
      });
    }
  }

  fieldPoint(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * PLANE_W;
    const y = ((clientY - r.top) / r.height) * PLANE_H;
    return { x: this.mirror ? PLANE_W - x : x, y };
  }

  private px(x: number): number {
    return this.mirror ? PLANE_W - x : x;
  }

  private burst(x: number, y: number, n: number, color: string, kind: Particle['kind'], speed: number): void {
    if (reducedMotion()) return;
    for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (20 + Math.random() * 70) * speed;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 0,
        max: kind === 'smoke' ? 0.9 + Math.random() * 0.8 : kind === 'ember' ? 0.8 + Math.random() * 0.7 : 0.4 + Math.random() * 0.5,
        size:
          kind === 'smoke' ? 10 + Math.random() * 13
          : kind === 'chunk' ? 3.5 + Math.random() * 5
          : kind === 'ember' ? 2.5 + Math.random() * 2.5
          : 2.4 + Math.random() * 2.6,
        color,
        kind,
        spin: Math.random() * 6,
      });
    }
  }

  private float(text: string, x: number, y: number, size: number, color: string, now: number, life = 1100): void {
    this.floaters.push({ text, x, y, at: now, life, size, color });
  }

  private rockColorAt(x: number, y: number): string {
    for (let i = this.circles.length - 1; i >= 0; i--) {
      const c = this.circles[i]!;
      if (Math.hypot(c.x - x, c.y - y) <= c.r + 4) return this.rockStyle.debris(i);
    }
    return THEMES[this.themeId].smoke;
  }

  private drawTerrain(theme: Theme): void {
    const c = this.terrainLayer.getContext('2d')!;
    c.setTransform(this.terrainLayer.width / PLANE_W, 0, 0, this.terrainLayer.height / PLANE_H, 0, 0);
    c.clearRect(0, 0, PLANE_W, PLANE_H);
    c.globalCompositeOperation = 'source-over';
    this.circles.forEach((o, i) => drawObstacle(c, this.rockStyle, this.px(o.x), o.y, o.r, i));
    const holes = this.past?.holes ?? this.holes;
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = '#000';
    for (const h of holes) {
      c.beginPath();
      c.arc(this.px(h.x), h.y, h.r, 0, Math.PI * 2);
      c.fill();
    }
    // Scorched edge around each bite, drawn only where rock remains.
    c.globalCompositeOperation = 'source-atop';
    c.strokeStyle = theme.biteEdge;
    c.lineWidth = 4;
    for (const h of holes) {
      c.beginPath();
      c.arc(this.px(h.x), h.y, h.r + 1.5, 0, Math.PI * 2);
      c.stroke();
    }
    c.globalCompositeOperation = 'source-over';
    this.terrainDirty = false;
    const base = this.baseLayer.getContext('2d')!;
    const k = this.baseLayer.width / (PLANE_W + 2 * MARGIN);
    base.setTransform(k, 0, 0, k, MARGIN * k, MARGIN * k);
    this.drawBackground(base, theme);
    base.drawImage(this.terrainLayer, 0, 0, PLANE_W, PLANE_H);
    this.baseKey = `${this.themeId}|${this.mirror}`;
  }

  private drawBackground(c: CanvasRenderingContext2D, theme: Theme): void {
    // The paper and grid run past the field on every side, out to MARGIN.
    const left = -MARGIN;
    const top = -MARGIN;
    const right = PLANE_W + MARGIN;
    const bottom = PLANE_H + MARGIN;
    c.fillStyle = theme.bg;
    c.fillRect(left, top, right - left, bottom - top);
    const cx = PLANE_W / 2;
    const cy = PLANE_H / 2;
    c.strokeStyle = theme.grid;
    c.lineWidth = 1;
    c.beginPath();
    const ux = Math.ceil((cx + MARGIN) / PX_PER_UNIT);
    const uy = Math.ceil((cy + MARGIN) / PX_PER_UNIT);
    for (let u = -ux; u <= ux; u++) {
      const x = cx + u * PX_PER_UNIT;
      c.moveTo(x, top);
      c.lineTo(x, bottom);
    }
    for (let u = -uy; u <= uy; u++) {
      const y = cy - u * PX_PER_UNIT;
      c.moveTo(left, y);
      c.lineTo(right, y);
    }
    c.stroke();
    c.strokeStyle = theme.axis;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(left, cy);
    c.lineTo(right, cy);
    c.moveTo(cx, top);
    c.lineTo(cx, bottom);
    c.stroke();
    c.fillStyle = theme.label;
    c.font = '11px "Shantell Sans", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'top';
    for (let u = -20; u <= 20; u += 5) {
      if (u !== 0) c.fillText(String(u), cx + u * PX_PER_UNIT, cy + 4);
    }
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    for (let u = -10; u <= 10; u += 5) {
      if (u !== 0) c.fillText(String(u), cx + 5, cy - u * PX_PER_UNIT);
    }
  }

  /** The soldier: a round head with two eyes, facing the enemy side. */
  private drawFigure(c: CanvasRenderingContext2D, x: number, y: number, color: string, facing: number, bg: string): void {
    c.fillStyle = bg;
    c.strokeStyle = color;
    c.lineWidth = 2.4;
    c.beginPath();
    c.arc(x, y, SOLDIER_R, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.fillStyle = color;
    c.beginPath();
    c.arc(x + facing * 2.6, y - 1.5, 1.3, 0, Math.PI * 2);
    c.arc(x - facing * 0.8, y - 1.5, 1.3, 0, Math.PI * 2);
    c.fill();
  }

  private drawSoldier(c: CanvasRenderingContext2D, s: Stage['soldiers'][number], now: number, theme: Theme): void {
    const owner = this.state?.players.find((p) => p.id === s.playerId);
    const color = owner?.team === 2 ? theme.team2 : theme.team1;
    const x = this.px(s.x);
    const y = s.y;
    if (!s.alive) {
      // A faint marker where they fell.
      c.save();
      c.globalAlpha = 0.35;
      c.strokeStyle = color;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x - 5, y - 5);
      c.lineTo(x + 5, y + 5);
      c.moveTo(x + 5, y - 5);
      c.lineTo(x - 5, y + 5);
      c.stroke();
      c.restore();
      return;
    }
    const active = this.past ? s.id === this.past.shooterId : s.id === this.activeSoldierId;
    if (active) {
      const pulse = reducedMotion() ? 0 : (Math.sin(now / 240) + 1) * 1.6;
      c.fillStyle = theme.mark;
      c.globalAlpha = 0.75;
      c.beginPath();
      c.arc(x, y, SOLDIER_R + 7 + pulse, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
    }
    let facing: number;
    if (this.state?.config.kind === 'ffa') {
      // Free-for-all shots can go either way, so soldiers look where they aim or last fired.
      facing = active && this.aiming && !this.past ? this.aimDir : this.faceDirs.get(s.id) ?? 1;
    } else {
      facing = this.mirror ? (owner?.team === 2 ? 1 : -1) : owner?.team === 2 ? -1 : 1;
    }
    this.drawFigure(c, x, y, color, facing, theme.bg);
    drawHat(c, this.looks[s.playerId]?.hat ?? 'none', x, y - SOLDIER_R + 1, color, facing);
    // Practice targets and allies each get a label. A player's name follows their next soldier.
    const everyOne = owner?.id === TARGETS || owner?.id === ALLIES;
    if (owner?.name && (everyOne || this.nameBelongsOn(owner, s.id))) {
      c.font = '600 11px "Shantell Sans", sans-serif';
      c.textAlign = 'center';
      c.fillStyle = color;
      const lx = Math.max(34, Math.min(PLANE_W - 34, x));
      // Above the soldier and any hat, or below when that would leave the field.
      const above = y - SOLDIER_R - 9;
      if (above >= 13) {
        c.textBaseline = 'bottom';
        c.fillText(owner.name, lx, above);
      } else {
        c.textBaseline = 'top';
        c.fillText(owner.name, lx, y + SOLDIER_R + 6);
      }
    }
  }

  /** A player's name sits over the soldier who acts next, so it moves with the highlight. */
  private nameBelongsOn(owner: NonNullable<MatchState['players'][number]>, soldierId: number): boolean {
    const list = this.past?.soldiers ?? this.soldiers;
    if (this.past && owner.id === this.past.shooterPlayer) return soldierId === this.past.shooterId;
    const ids = owner.soldierIds;
    const start = this.past ? 0 : owner.nextSoldier;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[(start + i) % ids.length]!;
      if (list.find((q) => q.id === id)?.alive) return id === soldierId;
    }
    return false;
  }

  private knockOut(s: Stage['soldiers'][number], now: number, shot: ActiveShot): void {
    s.alive = false;
    s.flown = true;
    shot.kills++;
    this.onKill?.();
    if (reducedMotion()) return;
    const theme = THEMES[this.themeId];
    const owner = this.state?.players.find((p) => p.id === s.playerId);
    const color = owner?.team === 2 ? theme.team2 : theme.team1;
    this.flyers.push({
      x: s.x,
      y: s.y,
      vx: (Math.random() < 0.5 ? -1 : 1) * (70 + Math.random() * 70),
      vy: -230 - Math.random() * 80,
      spin: (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 6),
      angle: 0,
      at: now,
      color,
      hat: this.looks[s.playerId]?.hat ?? 'none',
    });
    this.burst(s.x, s.y, 18, '#ffd33d', 'star', 2);
    this.burst(s.x, s.y, 16, color, 'spark', 3);
    // The shooter's kill effect plays where the soldier falls.
    this.rings.push({ x: s.x, y: s.y, r: BLAST_R, at: now, color: shot.color, style: shot.blast });
    this.shake = Math.max(this.shake, 9);
    this.flash = Math.max(this.flash, 0.3);
    const words = ['KO!', 'DOUBLE!', 'TRIPLE!', 'QUAD!'];
    const word = words[Math.min(shot.kills - 1, words.length - 1)]!;
    this.float(word, this.px(s.x), s.y - 16, shot.kills > 1 ? 34 : 26, shot.kills > 1 ? '#ff4d7e' : color, now);
  }

  private explode(shot: ActiveShot, now: number): void {
    shot.exploded = true;
    const r = BLAST_R;
    const { x, y } = shot.record.end;
    const theme = THEMES[this.themeId];
    this.burst(x, y, 22, theme.smoke, 'smoke', 0.8);
    this.burst(x, y, 32, '#ffb02e', 'spark', 3.4);
    this.burst(x, y, 14, '#ff6a2a', 'ember', 1.5);
    this.burst(x, y, 20, this.rockColorAt(x, y), 'chunk', 2.3);
    this.holes.push({ x, y, r });
    this.terrainDirty = true;
    if (!reducedMotion()) this.fireballs.push({ x, y, r: Math.max(r * 1.3, 17), at: now });
    // Where the shot ends, everyone gets the same explosion. Kill effects are only for kills.
    this.rings.push({ x, y, r, at: now, color: shot.color, style: 'ring' });
    this.shake = Math.max(this.shake, 8);
    this.flash = Math.max(this.flash, 0.18);
    this.onExplode?.(shot.kills);
    this.zoom.target = 1;
    setTimeout(() => {
      const done = this.shot === shot;
      if (done) this.shot = null;
      if (done && this.state) this.sync(this.state);
      shot.resolve();
    }, NEXT_TURN_DELAY_MS);
  }

  private stepEffects(dt: number): void {
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.spin += dt * 6;
      if (p.kind === 'smoke') {
        p.vx *= 0.94;
        p.vy = p.vy * 0.94 - 18 * dt;
      } else if (p.kind === 'ember') {
        p.vx *= 0.96;
        p.vy = p.vy * 0.96 + 40 * dt;
      } else if (p.kind === 'confetti') {
        p.vx += Math.sin(p.spin) * 30 * dt;
      } else {
        p.vy += (p.kind === 'chunk' ? 420 : 200) * dt;
        p.vx *= 0.985;
      }
    }
    this.particles = this.particles.filter((p) => p.life < p.max && p.y < PLANE_H + 40);
    for (const f of this.flyers) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy += 620 * dt;
      f.angle += f.spin * dt;
    }
    this.flyers = this.flyers.filter((f) => f.y < PLANE_H + 40);
    this.shake *= Math.pow(0.0025, dt);
    this.flash *= Math.pow(0.004, dt);
    const z = this.zoom;
    if (z.target === 1) {
      z.tx = PLANE_W / 2;
      z.ty = PLANE_H / 2;
    }
    const k = 1 - Math.pow(0.002, dt);
    z.s += (z.target - z.s) * k;
    z.x += (z.tx - z.x) * k;
    z.y += (z.ty - z.y) * k;
  }

  private drawEffects(c: CanvasRenderingContext2D, now: number): void {
    for (const p of this.particles) {
      const t = p.life / p.max;
      const x = this.px(p.x);
      c.fillStyle = p.color;
      if (p.kind === 'smoke') {
        c.globalAlpha = (1 - t) * 0.3;
        c.beginPath();
        c.arc(x, p.y, p.size * (0.6 + t * 1.4), 0, Math.PI * 2);
        c.fill();
      } else if (p.kind === 'confetti') {
        c.globalAlpha = 1 - t * t * t;
        c.save();
        c.translate(x, p.y);
        c.rotate(p.spin);
        c.fillRect(-p.size / 2, -p.size / 4, p.size, (p.size / 2) * (0.5 + Math.abs(Math.sin(p.spin)) * 1.2));
        c.restore();
      } else if (p.kind === 'star') {
        c.globalAlpha = 1 - t;
        c.save();
        c.translate(x, p.y);
        c.rotate(p.spin);
        c.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = (i * 4 * Math.PI) / 5 - Math.PI / 2;
          c.lineTo(Math.cos(a) * (p.size + 1.5), Math.sin(a) * (p.size + 1.5));
        }
        c.closePath();
        c.fill();
        c.restore();
      } else if (p.kind === 'spark') {
        // A streak along its direction of travel, so fast sparks read clearly.
        c.globalAlpha = 1 - t;
        c.strokeStyle = p.color;
        c.lineCap = 'round';
        c.lineWidth = p.size * (1 - t * 0.5);
        c.beginPath();
        c.moveTo(x, p.y);
        c.lineTo(x - (this.mirror ? -p.vx : p.vx) * 0.05, p.y - p.vy * 0.05);
        c.stroke();
      } else if (p.kind === 'ember') {
        c.globalAlpha = (1 - t) * 0.35;
        c.beginPath();
        c.arc(x, p.y, p.size * 2.2, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1 - t;
        c.fillStyle = t < 0.4 ? '#ffe28a' : p.color;
        c.beginPath();
        c.arc(x, p.y, p.size * (1 - t * 0.4), 0, Math.PI * 2);
        c.fill();
      } else {
        c.globalAlpha = 1 - t;
        const s = p.kind === 'chunk' ? p.size : p.size * (1 - t * 0.5);
        c.fillRect(x - s / 2, p.y - s / 2, s, s);
      }
    }
    c.globalAlpha = 1;

    for (const f of this.flyers) {
      c.save();
      c.translate(this.px(f.x), f.y);
      c.rotate(f.angle);
      this.drawFigure(c, 0, 0, f.color, 1, THEMES[this.themeId].bg);
      drawHat(c, f.hat, 0, -SOLDIER_R + 1, f.color);
      c.restore();
    }

    this.fireballs = this.fireballs.filter((f) => now - f.at < 560);
    for (const f of this.fireballs) drawFireball(c, this.px(f.x), f.y, f.r, (now - f.at) / 560);

    this.rings = this.rings.filter((b) => now - b.at < 820);
    for (const b of this.rings) {
      const t = (now - b.at) / 820;
      const x = this.px(b.x);
      c.globalAlpha = 1 - t;
      drawBlast(c, x, b.y, b.r, t, b.color, b.style);
      c.globalAlpha = 1;
    }

    this.floaters = this.floaters.filter((f) => now - f.at < f.life);
    for (const f of this.floaters) {
      const t = (now - f.at) / f.life;
      // Punches in big, settles, drifts up, then fades.
      const punch = t < 0.12 ? 1.5 - (t / 0.12) * 0.5 : 1;
      const size = f.size * punch;
      const px = Math.max(size * 1.4, Math.min(PLANE_W - size * 1.4, f.x));
      const py = Math.max(size, f.y - t * 26);
      c.globalAlpha = t > 0.75 ? (1 - t) / 0.25 : 1;
      c.font = `700 ${size}px "Shantell Sans", sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineJoin = 'round';
      c.strokeStyle = '#ffffff';
      c.lineWidth = size / 4.5;
      c.strokeText(f.text, px, py);
      c.fillStyle = f.color;
      c.fillText(f.text, px, py);
      c.globalAlpha = 1;
    }
  }

  private advanceShot(c: CanvasRenderingContext2D, shot: ActiveShot, now: number): void {
    const still = reducedMotion();
    const realDt = now - shot.lastFrame;
    shot.lastFrame = now;
    // A match-ending hit slows time and moves in close.
    const reachedBefore = Math.floor((shot.clock / 1000) * DRAW_STEPS_PER_SEC);
    let scale = 1;
    if (shot.finalShot && !still && reachedBefore < shot.lastKillStep) {
      const left = shot.lastKillStep - reachedBefore;
      if (left < 260) {
        scale = 0.22;
        const last = shot.record.hits.find((h) => h.step === shot.lastKillStep);
        const victim = last && this.soldiers.find((q) => q.id === last.id);
        if (victim) {
          this.zoom.target = 1.7;
          // Centre on the victim, but never so far out that the view passes the drawn margin.
          const halfW = PLANE_W / 2 / this.zoom.target;
          const halfH = PLANE_H / 2 / this.zoom.target;
          this.zoom.tx = Math.max(halfW - MARGIN * 0.8, Math.min(PLANE_W - halfW + MARGIN * 0.8, this.px(victim.x)));
          this.zoom.ty = Math.max(halfH - MARGIN * 0.8, Math.min(PLANE_H - halfH + MARGIN * 0.8, victim.y));
        }
      }
    }
    shot.clock += realDt * scale;
    const reached = still ? shot.steps : Math.min(shot.steps, Math.floor((shot.clock / 1000) * DRAW_STEPS_PER_SEC));
    strokeTrail(c, shot.xs, shot.ys, reached, shot.color, shot.trail, true, (x) => this.px(x));

    for (const hit of shot.record.hits) {
      const s = this.soldiers.find((q) => q.id === hit.id);
      if (s && s.alive && reached >= hit.step) {
        this.knockOut(s, now, shot);
        if (shot.finalShot && hit.step === shot.lastKillStep) {
          this.zoom.target = 1;
          this.onFinalKill?.();
        }
      }
    }

    if (reached < shot.steps && !still && Number.isFinite(shot.ys[reached]!)) {
      const hx = shot.xs[reached]!;
      const hy = shot.ys[reached]!;
      const x = this.px(hx);
      // Comet head with sparks thrown off behind it.
      c.fillStyle = shot.color;
      c.globalAlpha = 0.3;
      c.beginPath();
      c.arc(x, hy, 9, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
      c.beginPath();
      c.arc(x, hy, 4.6, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(x, hy, 2, 0, Math.PI * 2);
      c.fill();
      if (this.particles.length < MAX_PARTICLES) {
        this.particles.push({
          x: hx, y: hy, vx: (Math.random() - 0.5) * 70, vy: (Math.random() - 0.5) * 70,
          life: 0, max: 0.3 + Math.random() * 0.3, size: 1.5 + Math.random() * 1.8, color: shot.color, kind: 'spark', spin: 0,
        });
      }
    }
    if (reached >= shot.steps && !shot.exploded) this.explode(shot, now);
  }

  private draw(now: number): void {
    const c = this.ctx;
    const theme = THEMES[this.themeId];
    const dt = Math.min(0.05, (now - this.lastNow) / 1000);
    this.lastNow = now;
    const base = this.canvas.width / PLANE_W;
    const baseY = this.canvas.height / PLANE_H;
    c.setTransform(base, 0, 0, baseY, 0, 0);
    this.stepEffects(dt);
    if (this.terrainDirty || this.baseKey !== `${this.themeId}|${this.mirror}`) this.drawTerrain(theme);

    // Start each frame clean, so nothing from an earlier frame can show through.
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, PLANE_W, PLANE_H);

    // Camera: zoom and shake apply to everything on the field.
    c.save();
    const z = this.zoom;
    if (z.s > 1.002) {
      // However far it's zoomed, the view stays inside the drawn margin around the field.
      const halfW = PLANE_W / 2 / z.s;
      const halfH = PLANE_H / 2 / z.s;
      const vx = Math.max(halfW - MARGIN * 0.9, Math.min(PLANE_W - halfW + MARGIN * 0.9, z.x));
      const vy = Math.max(halfH - MARGIN * 0.9, Math.min(PLANE_H - halfH + MARGIN * 0.9, z.y));
      c.translate(PLANE_W / 2, PLANE_H / 2);
      c.scale(z.s, z.s);
      c.translate(-vx, -vy);
    }
    if (this.shake > 0.3) c.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);

    c.drawImage(this.baseLayer, -MARGIN, -MARGIN, PLANE_W + 2 * MARGIN, PLANE_H + 2 * MARGIN);

    if (this.previewPath && !this.past) {
      c.save();
      c.setLineDash([4, 6]);
      c.strokeStyle = theme.axis;
      c.lineWidth = 2.5;
      c.lineCap = 'round';
      c.beginPath();
      const p = this.previewPath;
      const stride = Math.max(1, Math.floor(p.steps / 600));
      c.moveTo(this.px(p.xs[0]!), p.ys[0]!);
      for (let i = stride; i < p.steps; i += stride) if (Number.isFinite(p.ys[i]!)) c.lineTo(this.px(p.xs[i]!), p.ys[i]!);
      c.stroke();
      c.restore();
    }

    if (this.past) {
      const owner = this.state?.players.find((q) => q.id === this.past!.shooterPlayer);
      const color = owner?.team === 2 ? theme.team2 : theme.team1;
      strokeTrail(c, this.past.path.xs, this.past.path.ys, this.past.path.steps, color, this.looks[this.past.shooterPlayer]?.trail ?? 'ink', true, (x) => this.px(x));
    }

    if (this.shot) this.advanceShot(c, this.shot, now);

    if (this.past) {
      for (const s of this.past.soldiers) this.drawSoldier(c, { ...s, flown: false, bornAt: 0 }, now, theme);
    } else {
      for (const s of this.soldiers) this.drawSoldier(c, s, now, theme);
    }

    if (this.aimAngle !== null && this.activeSoldierId !== null && !this.past) {
      const s = this.soldiers.find((q) => q.id === this.activeSoldierId);
      if (s) {
        const mirroredShooter = this.state?.players.find((p) => p.id === s.playerId)?.team === 2 && this.state.config.kind === 'teams';
        // Angle is in the shooter's frame; convert it to screen direction.
        let sign: number = this.aimDir;
        if (mirroredShooter !== this.mirror) sign = -sign;
        const x = this.px(s.x);
        c.strokeStyle = theme.axis;
        c.lineWidth = 3;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(x, s.y);
        c.lineTo(x + sign * 28 * Math.cos(this.aimAngle), s.y - 28 * Math.sin(this.aimAngle));
        c.stroke();
      }
    }

    this.drawEffects(c, now);
    c.restore();

    if (this.flash > 0.01) {
      c.fillStyle = '#ffffff';
      c.globalAlpha = Math.min(0.6, this.flash);
      c.fillRect(0, 0, PLANE_W, PLANE_H);
      c.globalAlpha = 1;
    }
  }
}
