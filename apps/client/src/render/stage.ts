import { BLAST_R, DRAW_STEPS_PER_SEC, NEXT_TURN_DELAY_MS, PLANE_H, PLANE_W, PX_PER_UNIT, SOLDIER_R, TELEPORT_RADIUS, type Circle, type MatchState, type ShotRecord } from '@mathbattles/sim';
import { drawHat } from './doodles';

export type ThemeId = 'arena' | 'paper' | 'chalk' | 'blueprint';

export interface Theme {
  name: string;
  bg: string;
  grid: string;
  axis: string;
  label: string;
  rocks: { fill: string; rim: string; spot: string }[];
  biteEdge: string;
  team1: string;
  team2: string;
  mark: string;
  smoke: string;
}

export const THEMES: Record<ThemeId, Theme> = {
  arena: {
    name: 'Arena', bg: '#f6f6ff', grid: '#dcdff6', axis: '#6a6fc9', label: '#7d82cf',
    rocks: [
      { fill: '#f7d65c', rim: '#d9a92a', spot: '#e6bb3a' },
      { fill: '#6fb7f2', rim: '#3e86cf', spot: '#529fe0' },
    ],
    biteEdge: '#00000055', team1: '#2b50e8', team2: '#ee3a57', mark: '#ffd33d', smoke: '#30304a',
  },
  paper: {
    name: 'Graph Paper', bg: '#f2faf6', grid: '#bfe0d6', axis: '#1c3a8c', label: '#4a5f9e',
    rocks: [{ fill: '#4b5463', rim: '#2c323c', spot: '#5d6778' }],
    biteEdge: '#00000066', team1: '#1c3a8c', team2: '#d62f3a', mark: '#f7e64a', smoke: '#38404c',
  },
  chalk: {
    name: 'Chalkboard', bg: '#22423a', grid: '#35594f', axis: '#eef3e6', label: '#b9cdbf',
    rocks: [{ fill: '#10241c', rim: '#51736a', spot: '#1d3a2f' }],
    biteEdge: '#ffffff33', team1: '#9ad8ff', team2: '#ffb0a8', mark: '#f7e64a', smoke: '#d8e4dc',
  },
  blueprint: {
    name: 'Blueprint', bg: '#143a78', grid: '#28539a', axis: '#e8f1ff', label: '#b7cdf2',
    rocks: [{ fill: '#0a2147', rim: '#6e94d1', spot: '#123066' }],
    biteEdge: '#ffffff33', team1: '#fff27a', team2: '#ff9e8a', mark: '#ffffff', smoke: '#d6e4ff',
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
  kind: 'spark' | 'smoke' | 'chunk' | 'confetti' | 'star';
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

const MAX_PARTICLES = 700;
const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Draws the field. Holds its own display copy so kills appear as the curve reaches them. */
export class Stage {
  private ctx: CanvasRenderingContext2D;
  private terrainLayer: HTMLCanvasElement;
  private terrainDirty = true;
  private raf = 0;
  private running = false;
  private lastNow = 0;

  state: MatchState | null = null;
  themeId: ThemeId = 'arena';
  mirror = false;
  looks: Record<string, StageLook> = {};
  private soldiers: { id: number; x: number; y: number; alive: boolean; playerId: string; angle: number; flown: boolean; bornAt: number }[] = [];
  private circles: Circle[] = [];
  private holes: Circle[] = [];
  private shot: ActiveShot | null = null;
  private rings: Ring[] = [];
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
  teleportFrom: { x: number; y: number } | null = null;
  onExplode?: (kills: number) => void;
  onKill?: () => void;
  /** Called when the field needs a big callout, such as the final knockout. */
  onFinalKill?: () => void;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.terrainLayer = document.createElement('canvas');
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const cssW = this.canvas.clientWidth || PLANE_W;
    const scale = Math.max(1, Math.min(2.5, (cssW / PLANE_W) * dpr));
    this.canvas.width = Math.round(PLANE_W * scale);
    this.canvas.height = Math.round(PLANE_H * scale);
    this.terrainLayer.width = this.canvas.width;
    this.terrainLayer.height = this.canvas.height;
    this.terrainDirty = true;
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

  isAnimating(): boolean {
    return !!this.shot;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastNow = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      this.draw(now);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Plays a shot on the display. Resolves after the post-shot delay. */
  playShot(record: ShotRecord, path: { xs: ArrayLike<number>; ys: ArrayLike<number>; steps: number }): Promise<void> {
    return new Promise((resolve) => {
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
        max: kind === 'smoke' ? 0.7 + Math.random() * 0.7 : 0.35 + Math.random() * 0.45,
        size: kind === 'smoke' ? 6 + Math.random() * 9 : kind === 'chunk' ? 2 + Math.random() * 4 : 1.2 + Math.random() * 2.2,
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
    const theme = THEMES[this.themeId];
    for (let i = this.circles.length - 1; i >= 0; i--) {
      const c = this.circles[i]!;
      if (Math.hypot(c.x - x, c.y - y) <= c.r + 4) return theme.rocks[i % theme.rocks.length]!.fill;
    }
    return theme.smoke;
  }

  private drawTerrain(theme: Theme): void {
    const c = this.terrainLayer.getContext('2d')!;
    c.setTransform(this.terrainLayer.width / PLANE_W, 0, 0, this.terrainLayer.height / PLANE_H, 0, 0);
    c.clearRect(0, 0, PLANE_W, PLANE_H);
    c.globalCompositeOperation = 'source-over';
    this.circles.forEach((o, i) => {
      const look = theme.rocks[i % theme.rocks.length]!;
      const x = this.px(o.x);
      c.save();
      c.beginPath();
      c.arc(x, o.y, o.r, 0, Math.PI * 2);
      c.fillStyle = look.fill;
      c.fill();
      c.clip();
      // Crater spots, placed by a fixed pattern so they stay put between redraws.
      c.fillStyle = look.spot;
      const count = Math.floor(o.r / 7);
      for (let k = 0; k < count; k++) {
        const a = k * 2.399963 + i;
        const d = o.r * Math.sqrt((k + 0.5) / count) * 0.85;
        c.beginPath();
        c.arc(x + Math.cos(a) * d, o.y + Math.sin(a) * d, 1.6 + (k % 3), 0, Math.PI * 2);
        c.fill();
      }
      // Shaded lower edge and a bright upper edge give each one a rounded look.
      c.strokeStyle = look.rim;
      c.lineWidth = 7;
      c.beginPath();
      c.arc(x, o.y + 2.5, o.r, 0, Math.PI * 2);
      c.stroke();
      c.strokeStyle = '#ffffff66';
      c.lineWidth = 2.5;
      c.beginPath();
      // Tiny rocks can be smaller than this inset, and a negative radius would throw.
      c.arc(x, o.y, Math.max(0.5, o.r - 3.5), Math.PI * 1.1, Math.PI * 1.65);
      c.stroke();
      c.restore();
    });
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = '#000';
    for (const h of this.holes) {
      c.beginPath();
      c.arc(this.px(h.x), h.y, h.r, 0, Math.PI * 2);
      c.fill();
    }
    // Scorched edge around each bite, drawn only where rock remains.
    c.globalCompositeOperation = 'source-atop';
    c.strokeStyle = theme.biteEdge;
    c.lineWidth = 4;
    for (const h of this.holes) {
      c.beginPath();
      c.arc(this.px(h.x), h.y, h.r + 1.5, 0, Math.PI * 2);
      c.stroke();
    }
    c.globalCompositeOperation = 'source-over';
    this.terrainDirty = false;
  }

  private drawBackground(c: CanvasRenderingContext2D, theme: Theme): void {
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, PLANE_W, PLANE_H);
    const cx = PLANE_W / 2;
    const cy = PLANE_H / 2;
    c.strokeStyle = theme.grid;
    c.lineWidth = 1;
    c.beginPath();
    for (let u = -25; u <= 25; u++) {
      const x = cx + u * PX_PER_UNIT;
      c.moveTo(x, 0);
      c.lineTo(x, PLANE_H);
    }
    for (let u = -14; u <= 14; u++) {
      const y = cy - u * PX_PER_UNIT;
      c.moveTo(0, y);
      c.lineTo(PLANE_W, y);
    }
    c.stroke();
    c.strokeStyle = theme.axis;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, cy);
    c.lineTo(PLANE_W, cy);
    c.moveTo(cx, 0);
    c.lineTo(cx, PLANE_H);
    c.stroke();
    c.fillStyle = theme.label;
    c.font = '500 11px Fredoka, sans-serif';
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

  private tracePath(c: CanvasRenderingContext2D, xs: ArrayLike<number>, ys: ArrayLike<number>, upto: number): void {
    const stride = Math.max(1, Math.floor(upto / 1800));
    c.beginPath();
    c.moveTo(this.px(xs[0]!), ys[0]!);
    for (let i = stride; i < upto; i += stride) {
      const y = ys[i]!;
      if (Number.isFinite(y)) c.lineTo(this.px(xs[i]!), y);
    }
    const last = upto - 1;
    if (Number.isFinite(ys[last]!)) c.lineTo(this.px(xs[last]!), ys[last]!);
  }

  private drawPath(
    c: CanvasRenderingContext2D,
    xs: ArrayLike<number>,
    ys: ArrayLike<number>,
    upto: number,
    color: string,
    trail: string,
    glow: boolean,
  ): void {
    if (upto < 2) return;
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
        c.moveTo(this.px(xs[i]!), ys[i]!);
        for (let j = i; j < Math.min(upto, i + seg + 1); j += stride) c.lineTo(this.px(xs[j]!), ys[j]!);
        c.stroke();
      }
      c.restore();
      return;
    }
    if (glow && trail !== 'dash' && trail !== 'ghost') {
      c.strokeStyle = color;
      c.globalAlpha = 0.18;
      c.lineWidth = trail === 'thick' ? 13 : 9;
      this.tracePath(c, xs, ys, upto);
      c.stroke();
      c.globalAlpha = 1;
    }
    c.strokeStyle = color;
    c.lineWidth = trail === 'thick' ? 5 : 3;
    if (trail === 'dash') c.setLineDash([9, 7]);
    if (trail === 'ghost') c.globalAlpha = 0.45;
    this.tracePath(c, xs, ys, upto);
    c.stroke();
    c.restore();
  }

  private drawBody(c: CanvasRenderingContext2D, x: number, y: number, color: string, facing: number, theme: Theme): void {
    // A chunky little figure: square head, block body, two legs.
    c.lineWidth = 1.6;
    c.strokeStyle = '#1d1d3a';
    c.fillStyle = color;
    c.beginPath();
    c.roundRect(x - 2.7, y + 6, 2.2, 3, 0.6);
    c.roundRect(x + 0.5, y + 6, 2.2, 3, 0.6);
    c.fill();
    c.beginPath();
    c.roundRect(x - 3.8, y + 1, 7.6, 5.6, 1.4);
    c.fill();
    c.stroke();
    c.fillStyle = '#ffe0b8';
    c.beginPath();
    c.roundRect(x - 4.4, y - 6.4, 8.8, 8, 2.2);
    c.fill();
    c.stroke();
    c.fillStyle = '#1d1d3a';
    c.beginPath();
    c.arc(x + facing * 2.4, y - 2.8, 1.05, 0, Math.PI * 2);
    c.arc(x - facing * 0.6, y - 2.8, 1.05, 0, Math.PI * 2);
    c.fill();
    void theme;
  }

  private drawSoldier(c: CanvasRenderingContext2D, s: Stage['soldiers'][number], now: number, theme: Theme): void {
    const owner = this.state?.players.find((p) => p.id === s.playerId);
    const color = owner?.team === 2 ? theme.team2 : theme.team1;
    const x = this.px(s.x);
    if (!s.alive) {
      // A faint marker where they fell.
      c.save();
      c.globalAlpha = 0.28;
      c.strokeStyle = color;
      c.lineWidth = 2.4;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(x - 5, s.y - 5);
      c.lineTo(x + 5, s.y + 5);
      c.moveTo(x + 5, s.y - 5);
      c.lineTo(x - 5, s.y + 5);
      c.stroke();
      c.restore();
      return;
    }
    const still = reducedMotion();
    const active = s.id === this.activeSoldierId;
    const y = s.y + (still ? 0 : Math.sin(now / 420 + s.id * 1.7) * (active ? 1.1 : 0.5));
    const facing = this.mirror ? (owner?.team === 2 ? 1 : -1) : owner?.team === 2 ? -1 : 1;
    if (active) {
      const pulse = still ? 0 : (Math.sin(now / 240) + 1) * 2.2;
      c.fillStyle = theme.mark;
      c.globalAlpha = 0.45;
      c.beginPath();
      c.arc(x, s.y, SOLDIER_R + 7 + pulse, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
      c.strokeStyle = theme.mark;
      c.lineWidth = 2.2;
      c.beginPath();
      c.arc(x, s.y, SOLDIER_R + 7 + pulse, 0, Math.PI * 2);
      c.stroke();
    }
    this.drawBody(c, x, y, color, facing, theme);
    drawHat(c, this.looks[s.playerId]?.hat ?? 'none', x, y - 6.4, color);
    if (active) {
      const by = s.y - SOLDIER_R - 26 + (still ? 0 : Math.sin(now / 200) * 2.5);
      c.fillStyle = theme.mark;
      c.strokeStyle = '#1d1d3a';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(x - 6, by);
      c.lineTo(x + 6, by);
      c.lineTo(x, by + 8);
      c.closePath();
      c.fill();
      c.stroke();
    }
    if (owner && owner.soldierIds[0] === s.id && owner.name) {
      c.font = '600 11px Fredoka, sans-serif';
      const w = c.measureText(owner.name).width + 10;
      const nx = Math.max(w / 2 + 2, Math.min(PLANE_W - w / 2 - 2, x));
      const ny = Math.max(10, s.y - SOLDIER_R - 15);
      c.fillStyle = '#1d1d3acc';
      c.beginPath();
      c.roundRect(nx - w / 2, ny - 7, w, 14, 7);
      c.fill();
      c.fillStyle = '#ffffff';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(owner.name, nx, ny);
    }
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
    this.shake = Math.max(this.shake, 9);
    this.flash = Math.max(this.flash, 0.3);
    const words = ['KO!', 'DOUBLE!', 'TRIPLE!', 'QUAD!'];
    const word = words[Math.min(shot.kills - 1, words.length - 1)]!;
    this.float(word, this.px(s.x), s.y - 16, shot.kills > 1 ? 34 : 26, shot.kills > 1 ? '#ff4d7e' : color, now);
  }

  private explode(shot: ActiveShot, now: number): void {
    shot.exploded = true;
    const r = shot.record.blastR ?? BLAST_R;
    const { x, y } = shot.record.end;
    const big = r > BLAST_R;
    const theme = THEMES[this.themeId];
    this.burst(x, y, big ? 28 : 16, theme.smoke, 'smoke', big ? 1.1 : 0.7);
    this.burst(x, y, big ? 34 : 18, '#ffb02e', 'spark', big ? 3.4 : 2.4);
    this.burst(x, y, big ? 26 : 14, this.rockColorAt(x, y), 'chunk', big ? 2.6 : 1.8);
    this.holes.push({ x, y, r });
    this.terrainDirty = true;
    this.rings.push({ x, y, r, at: now, color: shot.color, style: shot.blast });
    this.shake = Math.max(this.shake, big ? 12 : 5);
    this.flash = Math.max(this.flash, big ? 0.35 : 0.12);
    for (const id of shot.record.blastKills ?? []) {
      const s = this.soldiers.find((q) => q.id === id);
      if (s && s.alive) this.knockOut(s, now, shot);
    }
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
        c.globalAlpha = (1 - t) * 0.5;
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
      this.drawBody(c, 0, 0, f.color, 1, THEMES[this.themeId]);
      drawHat(c, f.hat, 0, -6.4, f.color);
      c.restore();
    }

    this.rings = this.rings.filter((b) => now - b.at < 620);
    for (const b of this.rings) {
      const t = (now - b.at) / 620;
      const x = this.px(b.x);
      c.globalAlpha = 1 - t;
      c.strokeStyle = b.color;
      c.fillStyle = b.color;
      c.lineWidth = 4 * (1 - t) + 1;
      if (b.style === 'star') {
        c.beginPath();
        for (let a = 0; a < 12; a++) {
          const ang = (a / 12) * Math.PI * 2 + t;
          c.moveTo(x + Math.cos(ang) * b.r * 0.7, b.y + Math.sin(ang) * b.r * 0.7);
          c.lineTo(x + Math.cos(ang) * (b.r + 34 * t + 6), b.y + Math.sin(ang) * (b.r + 34 * t + 6));
        }
        c.stroke();
      } else if (b.style === 'sigma') {
        c.font = `700 ${Math.round(b.r * 2.4 + 40 * t)}px Fredoka, sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('Σ', x, b.y);
      } else {
        c.beginPath();
        c.arc(x, b.y, b.r + 36 * t, 0, Math.PI * 2);
        c.stroke();
      }
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
      c.font = `700 ${size}px Fredoka, sans-serif`;
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
          this.zoom.tx = this.px(victim.x);
          this.zoom.ty = victim.y;
        }
      }
    }
    shot.clock += realDt * scale;
    const reached = still ? shot.steps : Math.min(shot.steps, Math.floor((shot.clock / 1000) * DRAW_STEPS_PER_SEC));
    this.drawPath(c, shot.xs, shot.ys, reached, shot.color, shot.trail, true);

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
    if (this.terrainDirty) this.drawTerrain(theme);

    // Camera: zoom and shake apply to everything on the field.
    c.save();
    const z = this.zoom;
    if (z.s > 1.002) {
      c.translate(PLANE_W / 2, PLANE_H / 2);
      c.scale(z.s, z.s);
      c.translate(-z.x, -z.y);
    }
    if (this.shake > 0.3) c.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);

    this.drawBackground(c, theme);
    c.drawImage(this.terrainLayer, 0, 0, PLANE_W, PLANE_H);

    if (this.previewPath) {
      c.save();
      c.setLineDash([4, 6]);
      this.drawPath(c, this.previewPath.xs, this.previewPath.ys, this.previewPath.steps, theme.axis, 'ink', false);
      c.restore();
    }

    if (this.teleportFrom) {
      c.save();
      c.setLineDash([6, 6]);
      c.strokeStyle = theme.axis;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(this.px(this.teleportFrom.x), this.teleportFrom.y, TELEPORT_RADIUS, 0, Math.PI * 2);
      c.stroke();
      c.restore();
    }

    if (this.shot) this.advanceShot(c, this.shot, now);

    for (const s of this.soldiers) this.drawSoldier(c, s, now, theme);

    if (this.aimAngle !== null && this.activeSoldierId !== null) {
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
