import { BLAST_R, DRAW_STEPS_PER_SEC, NEXT_TURN_DELAY_MS, PLANE_H, PLANE_W, PX_PER_UNIT, SOLDIER_R, TELEPORT_RADIUS, type Circle, type MatchState, type ShotRecord } from '@mathbattles/sim';
import { drawHat } from './doodles';

export type ThemeId = 'paper' | 'chalk' | 'blueprint';

export interface Theme {
  bg: string;
  grid: string;
  axis: string;
  label: string;
  rock: string;
  rockLine: string;
  team1: string;
  team2: string;
  mark: string;
}

export const THEMES: Record<ThemeId, Theme & { name: string }> = {
  paper: { name: 'Graph Paper', bg: '#f2faf6', grid: '#bfe0d6', axis: '#1c3a8c', label: '#4a5f9e', rock: '#38404c', rockLine: '#5b6573', team1: '#1c3a8c', team2: '#d62f3a', mark: '#f7e64a' },
  chalk: { name: 'Chalkboard', bg: '#22423a', grid: '#35594f', axis: '#eef3e6', label: '#b9cdbf', rock: '#0f2019', rockLine: '#51736a', team1: '#9ad8ff', team2: '#ffb0a8', mark: '#f7e64a' },
  blueprint: { name: 'Blueprint', bg: '#143a78', grid: '#28539a', axis: '#e8f1ff', label: '#b7cdf2', rock: '#0a2147', rockLine: '#6e94d1', team1: '#fff27a', team2: '#ff9e8a', mark: '#ffffff' },
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
  startedAt: number;
  exploded: boolean;
  resolve: () => void;
}

interface Burst {
  x: number;
  y: number;
  r: number;
  at: number;
  color: string;
  style: string;
}

const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Draws the field. Holds its own display copy so kills appear as the curve reaches them. */
export class Stage {
  private ctx: CanvasRenderingContext2D;
  private terrainLayer: HTMLCanvasElement;
  private terrainDirty = true;
  private raf = 0;
  private running = false;

  state: MatchState | null = null;
  themeId: ThemeId = 'paper';
  mirror = false;
  looks: Record<string, StageLook> = {};
  private soldiers: { id: number; x: number; y: number; alive: boolean; playerId: string; angle: number; deadAt: number }[] = [];
  private circles: Circle[] = [];
  private holes: Circle[] = [];
  private shot: ActiveShot | null = null;
  private bursts: Burst[] = [];
  activeSoldierId: number | null = null;
  previewPath: { xs: ArrayLike<number>; ys: ArrayLike<number>; steps: number } | null = null;
  aimAngle: number | null = null;
  aimDir: 1 | -1 = 1;
  teleportFrom: { x: number; y: number } | null = null;
  onExplode?: (kills: number) => void;
  onKill?: () => void;

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
    this.soldiers = state.soldiers.map((s) => {
      const prev = this.soldiers.find((p) => p.id === s.id && p.playerId === s.playerId);
      return { ...s, deadAt: s.alive ? 0 : prev?.deadAt || 1 };
    });
    this.terrainDirty = true;
  }

  isAnimating(): boolean {
    return !!this.shot;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const frame = () => {
      if (!this.running) return;
      this.draw(performance.now());
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
      this.shot = {
        xs: path.xs,
        ys: path.ys,
        steps: path.steps,
        record,
        color: owner?.team === 2 ? theme.team2 : theme.team1,
        trail: look.trail ?? 'ink',
        blast: look.blast ?? 'ring',
        startedAt: performance.now(),
        exploded: false,
        resolve,
      };
    });
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

  private drawTerrain(theme: Theme): void {
    const c = this.terrainLayer.getContext('2d')!;
    c.setTransform(this.terrainLayer.width / PLANE_W, 0, 0, this.terrainLayer.height / PLANE_H, 0, 0);
    c.clearRect(0, 0, PLANE_W, PLANE_H);
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = theme.rock;
    for (const o of this.circles) {
      c.beginPath();
      c.arc(this.px(o.x), o.y, o.r, 0, Math.PI * 2);
      c.fill();
    }
    // Pencil shading, clipped to the rocks.
    c.globalCompositeOperation = 'source-atop';
    c.strokeStyle = theme.rockLine;
    c.lineWidth = 1;
    c.beginPath();
    for (let i = -PLANE_H; i < PLANE_W; i += 9) {
      c.moveTo(i, PLANE_H);
      c.lineTo(i + PLANE_H, 0);
    }
    c.stroke();
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = '#000';
    for (const h of this.holes) {
      c.beginPath();
      c.arc(this.px(h.x), h.y, h.r, 0, Math.PI * 2);
      c.fill();
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
    c.font = '11px "Shantell Sans", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'top';
    for (let u = -20; u <= 20; u += 5) {
      if (u !== 0) c.fillText(String(u), cx + u * PX_PER_UNIT, cy + 3);
    }
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    for (let u = -10; u <= 10; u += 5) {
      if (u !== 0) c.fillText(String(u), cx + 4, cy - u * PX_PER_UNIT);
    }
  }

  private drawPath(
    c: CanvasRenderingContext2D,
    xs: ArrayLike<number>,
    ys: ArrayLike<number>,
    upto: number,
    color: string,
    trail: string,
  ): void {
    if (upto < 2) return;
    c.save();
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.strokeStyle = color;
    c.lineWidth = trail === 'thick' ? 4.5 : 2.4;
    if (trail === 'dash') c.setLineDash([9, 7]);
    if (trail === 'ghost') c.globalAlpha = 0.45;
    const stride = Math.max(1, Math.floor(upto / 1800));
    if (trail === 'rainbow') {
      const seg = Math.max(1, Math.floor(upto / 120));
      for (let i = 0; i < upto - 1; i += seg) {
        c.strokeStyle = `hsl(${(i / 14) % 360} 85% 50%)`;
        c.beginPath();
        c.moveTo(this.px(xs[i]!), ys[i]!);
        for (let j = i; j < Math.min(upto, i + seg + 1); j += stride) c.lineTo(this.px(xs[j]!), ys[j]!);
        c.stroke();
      }
    } else {
      c.beginPath();
      c.moveTo(this.px(xs[0]!), ys[0]!);
      for (let i = stride; i < upto; i += stride) {
        const y = ys[i]!;
        if (Number.isFinite(y)) c.lineTo(this.px(xs[i]!), y);
      }
      const last = upto - 1;
      if (Number.isFinite(ys[last]!)) c.lineTo(this.px(xs[last]!), ys[last]!);
      c.stroke();
    }
    c.restore();
  }

  private drawSoldier(c: CanvasRenderingContext2D, s: Stage['soldiers'][number], now: number, theme: Theme): void {
    const owner = this.state?.players.find((p) => p.id === s.playerId);
    const color = owner?.team === 2 ? theme.team2 : theme.team1;
    const x = this.px(s.x);
    const y = s.y;
    if (!s.alive) {
      if (s.deadAt <= 1) {
        c.strokeStyle = color;
        c.globalAlpha = 0.35;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(x - 5, y - 5);
        c.lineTo(x + 5, y + 5);
        c.moveTo(x + 5, y - 5);
        c.lineTo(x - 5, y + 5);
        c.stroke();
        c.globalAlpha = 1;
        return;
      }
      const t = Math.min(1, (now - s.deadAt) / 700);
      c.globalAlpha = 1 - t * 0.65;
      c.strokeStyle = color;
      c.lineWidth = 2.2;
      c.beginPath();
      c.arc(x, y, SOLDIER_R + t * 10, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.moveTo(x - 5, y - 5);
      c.lineTo(x + 5, y + 5);
      c.moveTo(x + 5, y - 5);
      c.lineTo(x - 5, y + 5);
      c.stroke();
      c.globalAlpha = 1;
      return;
    }
    if (s.id === this.activeSoldierId) {
      c.fillStyle = theme.mark;
      c.globalAlpha = 0.75;
      c.beginPath();
      c.arc(x, y, SOLDIER_R + 7, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
    }
    c.fillStyle = theme.bg;
    c.strokeStyle = color;
    c.lineWidth = 2.4;
    c.beginPath();
    c.arc(x, y, SOLDIER_R, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    // Face looks toward the enemy side.
    const facing = this.mirror ? (owner?.team === 2 ? 1 : -1) : owner?.team === 2 ? -1 : 1;
    c.fillStyle = color;
    c.beginPath();
    c.arc(x + facing * 2.6, y - 1.5, 1.3, 0, Math.PI * 2);
    c.arc(x - facing * 0.8, y - 1.5, 1.3, 0, Math.PI * 2);
    c.fill();
    drawHat(c, this.looks[s.playerId]?.hat ?? 'none', x, y - SOLDIER_R + 1, color);
    if (owner && owner.soldierIds[0] === s.id) {
      c.font = '600 11px "Shantell Sans", sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'bottom';
      c.fillStyle = color;
      // Keep names inside the field near its edges and top.
      c.fillText(owner.name, Math.max(34, Math.min(PLANE_W - 34, x)), Math.max(14, y - SOLDIER_R - 9));
    }
  }

  private draw(now: number): void {
    const c = this.ctx;
    const theme = THEMES[this.themeId];
    c.setTransform(this.canvas.width / PLANE_W, 0, 0, this.canvas.height / PLANE_H, 0, 0);
    this.drawBackground(c, theme);
    if (this.terrainDirty) this.drawTerrain(theme);
    c.drawImage(this.terrainLayer, 0, 0, PLANE_W, PLANE_H);

    if (this.previewPath) {
      c.save();
      c.setLineDash([4, 6]);
      this.drawPath(c, this.previewPath.xs, this.previewPath.ys, this.previewPath.steps, theme.axis, 'ink');
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

    const shot = this.shot;
    if (shot) {
      const elapsed = now - shot.startedAt;
      const reached = reducedMotion() ? shot.steps : Math.min(shot.steps, Math.floor((elapsed / 1000) * DRAW_STEPS_PER_SEC));
      this.drawPath(c, shot.xs, shot.ys, reached, shot.color, shot.trail);
      for (const hit of shot.record.hits) {
        const s = this.soldiers.find((q) => q.id === hit.id);
        if (s && s.alive && reached >= hit.step) {
          s.alive = false;
          s.deadAt = now;
          this.onKill?.();
        }
      }
      if (reached < shot.steps && !reducedMotion() && Number.isFinite(shot.ys[reached]!)) {
        c.fillStyle = shot.color;
        c.beginPath();
        c.arc(this.px(shot.xs[reached]!), shot.ys[reached]!, 3.5, 0, Math.PI * 2);
        c.fill();
      }
      if (reached >= shot.steps && !shot.exploded) {
        shot.exploded = true;
        const r = shot.record.blastR ?? BLAST_R;
        this.holes.push({ x: shot.record.end.x, y: shot.record.end.y, r });
        this.terrainDirty = true;
        this.bursts.push({ x: shot.record.end.x, y: shot.record.end.y, r, at: now, color: shot.color, style: shot.blast });
        for (const id of shot.record.blastKills ?? []) {
          const s = this.soldiers.find((q) => q.id === id);
          if (s && s.alive) {
            s.alive = false;
            s.deadAt = now;
          }
        }
        this.onExplode?.(shot.record.hits.length + (shot.record.blastKills?.length ?? 0));
        setTimeout(() => {
          const done = this.shot === shot;
          if (done) this.shot = null;
          if (done && this.state) this.sync(this.state);
          shot.resolve();
        }, NEXT_TURN_DELAY_MS);
      }
    }

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
        c.lineWidth = 2.5;
        c.beginPath();
        c.moveTo(x, s.y);
        c.lineTo(x + sign * 26 * Math.cos(this.aimAngle), s.y - 26 * Math.sin(this.aimAngle));
        c.stroke();
      }
    }

    this.bursts = this.bursts.filter((b) => now - b.at < 700);
    for (const b of this.bursts) {
      const t = (now - b.at) / 700;
      const x = this.px(b.x);
      c.globalAlpha = 1 - t;
      c.strokeStyle = b.color;
      c.fillStyle = b.color;
      c.lineWidth = 3;
      if (b.style === 'star') {
        c.beginPath();
        for (let a = 0; a < 10; a++) {
          const ang = (a / 10) * Math.PI * 2 + t;
          c.moveTo(x + Math.cos(ang) * b.r * 0.6, b.y + Math.sin(ang) * b.r * 0.6);
          c.lineTo(x + Math.cos(ang) * (b.r + 16 * t + 4), b.y + Math.sin(ang) * (b.r + 16 * t + 4));
        }
        c.stroke();
      } else if (b.style === 'sigma') {
        c.font = `800 ${Math.round(b.r * 2 + 18 * t)}px "Shantell Sans", sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('Σ', x, b.y);
      } else {
        c.beginPath();
        c.arc(x, b.y, b.r + 16 * t, 0, Math.PI * 2);
        c.stroke();
      }
      c.globalAlpha = 1;
    }
  }
}
