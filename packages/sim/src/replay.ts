import type { MatchConfig, MatchEvent, MatchState, PlayerSetup } from './rules';
import { cleanMap } from './maps';
import { createMatch, removePlayer } from './rules';
import { resolveRound } from './round';
import { isHexColor } from './colors';
import { ABILITY_IDS, cleanAbilities, type AbilityId } from './abilities';
import { ROCK_SHAPES } from './shapes';

/**
 * A replay is the match's seed, setup, and each round's shots. It rebuilds the whole match
 * through the normal rules, so it stays small enough to store and share.
 */
export interface Replay {
  v: 3 | 4 | 5;
  config: MatchConfig;
  setups: PlayerSetup[];
  actions: ReplayAction[];
}

export interface ReplayShot {
  p: string;
  e: string;
  g?: number;
  d?: 1 | -1;
  /** The ability used, if any. */
  a?: AbilityId;
}

export type ReplayAction =
  | { a: 'r'; shots: ReplayShot[] }
  | { a: 'l'; p: string };

export function makeReplay(state: MatchState, setups: PlayerSetup[]): Replay {
  // Store each player's final colour, so the replay looks exactly like the match did.
  const colors = new Map(state.players.map((p) => [p.id, p.color]));
  const owned = new Map(state.players.map((p) => [p.id, p.abilities ?? []]));
  return {
    v: 5,
    config: state.config,
    setups: setups.map((s) => ({ ...s, ...(colors.has(s.id) ? { color: colors.get(s.id) } : {}), abilities: owned.get(s.id) ?? cleanAbilities(s.abilities) })),
    actions: state.log.map(toAction),
  };
}

function toAction(e: MatchEvent): ReplayAction {
  if (e.type === 'leave') return { a: 'l', p: e.playerId };
  return {
    a: 'r',
    shots: e.round.shots.map((s) => ({
      p: s.playerId,
      e: s.expr,
      ...(s.mode === 'ode2' ? { g: s.angle } : {}),
      ...(s.dir === -1 ? { d: -1 as const } : {}),
      ...(s.ability ? { a: s.ability } : {}),
    })),
  };
}

export function applyAction(state: MatchState, action: ReplayAction): void {
  if (action.a === 'l') {
    removePlayer(state, action.p);
    return;
  }
  resolveRound(state, action.shots.map((s) => ({ playerId: s.p, expr: s.e, angle: s.g, dir: s.d, ability: s.a })));
}

export function replayStart(replay: Replay): MatchState {
  return createMatch(replay.config, replay.setups);
}

/*
 * Replay format, version 3. Everything is packed into bytes, then written in URL-safe base64:
 *   3, flags (kind, mode, custom map), seed, the map if there is one, player count,
 *   each player: flags (team, bot, bot level, has colour), name, colour (3 bytes),
 *   action count, each action: a tag, then its data. A round lists its shots, each with
 *   the player's number (and a bit for shooting left), the angle in y'' mode, and the math.
 * Common pieces of math, such as "sin(", take one byte each.
 * Versions 1 and 2 were for turn-based matches, which can't be rebuilt any more.
 */

const KINDS = ['teams', 'ffa'] as const;
const MODES = ['fn', 'ode1', 'ode2'] as const;
const BOT_LEVEL_CODES = ['easy', 'normal', 'hard', 'genius'];
const TOKENS = ['sqrt(', 'sin(', 'cos(', 'tan(', 'abs(', 'exp(', 'log(', 'ln(', "y''", "y'", 'pi', 'x^2', 'x^3', '*x', 'x/', ')^2', '(x+', '(x-', '*sin(x', '*cos(x', '/(1+exp(-'];
// Longest pieces are tried first, so "*sin(x" wins over "sin(".
const TOKEN_ORDER = TOKENS.map((t, i) => [t, i] as const).sort((a, b) => b[0].length - a[0].length);
const TOKEN_BASE = 0x80;
const END = 0x00;
const WIDE = 0x01;
const TAG_ROUND = 0;
const LEFT_BIT = 0x80;
const TAG_LEAVE = 3;

class Writer {
  bytes: number[] = [];
  byte(b: number): void {
    this.bytes.push(b & 0xff);
  }
  uint(n: number): void {
    let v = Math.floor(n);
    do {
      let b = v % 128;
      v = Math.floor(v / 128);
      if (v > 0) b |= 0x80;
      this.byte(b);
    } while (v > 0);
  }
  float(n: number): void {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, n);
    for (let i = 0; i < 8; i++) this.byte(view.getUint8(i));
  }
  text(s: string): void {
    const b = new TextEncoder().encode(s);
    this.uint(b.length);
    for (const x of b) this.byte(x);
  }
  expr(s: string): void {
    let i = 0;
    while (i < s.length) {
      const hit = TOKEN_ORDER.find(([t]) => s.startsWith(t, i));
      if (hit) {
        this.byte(TOKEN_BASE + hit[1]);
        i += hit[0].length;
        continue;
      }
      const code = s.codePointAt(i)!;
      if (code >= 0x20 && code < 0x7f) this.byte(code);
      else {
        this.byte(WIDE);
        this.uint(code);
      }
      i += code > 0xffff ? 2 : 1;
    }
    this.byte(END);
  }
}

class Reader {
  i = 0;
  constructor(private bytes: Uint8Array) {}
  byte(): number {
    if (this.i >= this.bytes.length) throw new Error('Replay ended early');
    return this.bytes[this.i++]!;
  }
  uint(): number {
    let n = 0;
    let scale = 1;
    for (let k = 0; k < 8; k++) {
      const b = this.byte();
      n += (b & 0x7f) * scale;
      if (!(b & 0x80)) return n;
      scale *= 128;
    }
    throw new Error('Number too long');
  }
  float(): number {
    const view = new DataView(new ArrayBuffer(8));
    for (let k = 0; k < 8; k++) view.setUint8(k, this.byte());
    return view.getFloat64(0);
  }
  text(): string {
    const len = this.uint();
    if (len > 200) throw new Error('Name too long');
    const start = this.i;
    this.i += len;
    if (this.i > this.bytes.length) throw new Error('Replay ended early');
    return new TextDecoder().decode(this.bytes.subarray(start, this.i));
  }
  expr(): string {
    let out = '';
    for (;;) {
      const b = this.byte();
      if (b === END) return out;
      if (b === WIDE) out += String.fromCodePoint(this.uint());
      else if (b >= TOKEN_BASE) {
        const t = TOKENS[b - TOKEN_BASE];
        if (t === undefined) throw new Error('Unknown piece');
        out += t;
      } else out += String.fromCharCode(b);
      if (out.length > 400) throw new Error('Function too long');
    }
  }
}

function toBase64Url(bytes: ArrayLike<number>): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const bin = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function encodeReplay(replay: Replay): string {
  const { config, setups } = replay;
  const w = new Writer();
  w.byte(5);
  const map = config.map ? cleanMap(config.map) : null;
  w.byte(KINDS.indexOf(config.kind) | (MODES.indexOf(config.mode) << 1) | (map ? 0x20 : 0) | (config.freeEnergy ? 0x40 : 0) | (config.rockShapes === 'mixed' ? 0x80 : 0));
  // Seeds are whole numbers. Store the sign separately so negative seeds work too.
  const seed = Math.trunc(config.seed);
  w.uint(Math.abs(seed) * 2 + (seed < 0 ? 1 : 0));
  // A custom map travels inside the replay, so anyone can watch without having the map.
  if (map) {
    w.text(map.name);
    w.uint(map.circles.length);
    for (const c of map.circles) {
      w.uint(c.x);
      w.uint(c.y);
      w.uint(c.r);
      // Version 5: the rock's shape, and its rotation in 256ths of a turn.
      w.byte(Math.max(0, ROCK_SHAPES.indexOf(c.shape ?? 'circle')));
      w.byte(((Math.round(((c.rot ?? 0) / (2 * Math.PI)) * 256) % 256) + 256) % 256);
    }
    w.uint(map.spawns.length);
    for (const sp of map.spawns) {
      w.uint(sp.x);
      w.uint(sp.y);
      w.byte(sp.team);
    }
  }
  w.byte(setups.length);
  for (const s of setups) {
    const level = s.isBot ? Math.max(0, BOT_LEVEL_CODES.indexOf(s.botLevel ?? '')) : 0;
    const color = isHexColor(s.color) ? s.color : null;
    w.byte((s.team === 2 ? 1 : 0) | (s.isBot ? 2 : 0) | (level << 2) | (color ? 0x40 : 0));
    w.text(s.name);
    if (color) {
      const n = parseInt(color.slice(1), 16);
      w.byte(n >> 16);
      w.byte(n >> 8);
      w.byte(n);
    }
    // Owned abilities, one bit each.
    const owned = cleanAbilities(s.abilities);
    w.byte(ABILITY_IDS.reduce((m, id, i) => (owned.includes(id) ? m | (1 << i) : m), 0));
  }
  const index = new Map(setups.map((s, i) => [s.id, i]));
  w.uint(replay.actions.length);
  for (const a of replay.actions) {
    if (a.a === 'r') {
      w.byte(TAG_ROUND);
      w.byte(a.shots.length);
      for (const shot of a.shots) {
        w.byte((index.get(shot.p) ?? 0) | (shot.d === -1 ? LEFT_BIT : 0));
        w.byte(shot.a ? ABILITY_IDS.indexOf(shot.a) + 1 : 0);
        if (config.mode === 'ode2') w.float(shot.g ?? 0);
        w.expr(shot.e);
      }
    } else {
      w.byte(TAG_LEAVE);
      w.byte(index.get(a.p) ?? 0);
    }
  }
  return toBase64Url(w.bytes);
}

function decodeV3(bytes: Uint8Array): Replay {
  const r = new Reader(bytes);
  const version = r.byte() as 3 | 4 | 5;
  const v4 = version >= 4;
  const v5 = version >= 5;
  const flags = r.byte();
  const kind = KINDS[flags & 1]!;
  const mode = MODES[(flags >> 1) & 3];
  if (!mode) throw new Error('Unknown mode');
  const rawSeed = r.uint();
  const seed = rawSeed % 2 === 1 ? -(rawSeed - 1) / 2 : rawSeed / 2;
  let map: MatchConfig['map'];
  if (flags & 0x20) {
    const name = r.text();
    const circles = Array.from({ length: Math.min(r.uint(), 100) }, () => {
      const c = { x: r.uint(), y: r.uint(), r: r.uint() };
      if (!v5) return c;
      const shape = ROCK_SHAPES[r.byte()] ?? 'circle';
      const rot = (r.byte() / 256) * 2 * Math.PI;
      return shape === 'circle' ? c : { ...c, shape, rot };
    });
    const spawns = Array.from({ length: Math.min(r.uint(), 40) }, () => ({ x: r.uint(), y: r.uint(), team: (r.byte() === 2 ? 2 : 1) as 1 | 2 }));
    map = cleanMap({ name, circles, spawns }) ?? undefined;
    if (!map) throw new Error('Bad map');
  }
  const count = r.byte();
  if (count < 2 || count > 10) throw new Error('Bad player count');
  const setups: PlayerSetup[] = [];
  for (let i = 0; i < count; i++) {
    const f = r.byte();
    const isBot = !!(f & 2);
    const name = r.text();
    let color: string | undefined;
    if (f & 0x40) color = '#' + [r.byte(), r.byte(), r.byte()].map((b) => b.toString(16).padStart(2, '0')).join('');
    const mask = v4 ? r.byte() : 0;
    const abilities = cleanAbilities(ABILITY_IDS.filter((_, k) => mask & (1 << k)));
    setups.push({
      abilities,
      id: `p${i}`,
      name,
      team: f & 1 ? 2 : 1,
      ...(isBot ? { isBot: true, botLevel: BOT_LEVEL_CODES[(f >> 2) & 3] } : {}),
      ...(color ? { color } : {}),
    });
  }
  const config: MatchConfig = { kind, mode, seed, ...(map ? { map } : {}), ...(v4 && flags & 0x40 ? { freeEnergy: true } : {}), ...(v5 && flags & 0x80 ? { rockShapes: 'mixed' as const } : {}) };
  const total = r.uint();
  if (total > MAX_REPLAY_ACTIONS) throw new Error('Too many actions');
  const actions: ReplayAction[] = [];
  for (let k = 0; k < total; k++) {
    const tag = r.byte();
    if (tag === TAG_ROUND) {
      const n = r.byte();
      if (n > count) throw new Error('Too many shots');
      const shots: ReplayShot[] = [];
      for (let j = 0; j < n; j++) {
        const b = r.byte();
        const who = setups[b & 0x7f];
        if (!who) throw new Error('Unknown player');
        const ab = v4 ? r.byte() : 0;
        const g = mode === 'ode2' ? r.float() : undefined;
        const e = r.expr();
        const a = ab ? ABILITY_IDS[ab - 1] : undefined;
        shots.push({ p: who.id, e, ...(g !== undefined ? { g } : {}), ...(b & LEFT_BIT ? { d: -1 as const } : {}), ...(a ? { a } : {}) });
      }
      actions.push({ a: 'r', shots });
    } else if (tag === TAG_LEAVE) {
      const who = setups[r.byte()];
      if (!who) throw new Error('Unknown player');
      actions.push({ a: 'l', p: who.id });
    } else {
      throw new Error('Unknown action');
    }
  }
  return { v: version, config, setups, actions };
}

export function decodeReplay(text: string): Replay | null {
  try {
    const bytes = fromBase64Url(text);
    if (bytes[0] !== 3 && bytes[0] !== 4 && bytes[0] !== 5) return null;
    const r = decodeV3(bytes);
    return replayIsSane(r) ? r : null;
  } catch {
    return null;
  }
}

/** True for links from before simultaneous rounds, which can't be rebuilt any more. */
export function replayIsOld(text: string): boolean {
  try {
    const bytes = fromBase64Url(text);
    if (bytes[0] === 2) return true;
    const json = JSON.parse(new TextDecoder().decode(bytes)) as { v?: unknown };
    return json?.v === 1;
  } catch {
    return false;
  }
}

const MAX_REPLAY_ACTIONS = 5000;

/** Replays can be edited by hand, so check the shape before building a match from one. */
function replayIsSane(r: Replay): boolean {
  if (!r || (r.v !== 3 && r.v !== 4 && r.v !== 5) || !r.config || !Array.isArray(r.setups) || !Array.isArray(r.actions)) return false;
  const { kind, mode, seed } = r.config;
  if (kind !== 'teams' && kind !== 'ffa') return false;
  if (mode !== 'fn' && mode !== 'ode1' && mode !== 'ode2') return false;
  if (!Number.isFinite(seed)) return false;
  if (r.setups.length < 2 || r.setups.length > 10 || r.actions.length > MAX_REPLAY_ACTIONS) return false;
  const ids = new Set<string>();
  for (const s of r.setups) {
    if (!s || typeof s.id !== 'string' || typeof s.name !== 'string' || (s.team !== 1 && s.team !== 2)) return false;
    ids.add(s.id);
  }
  if (ids.size !== r.setups.length) return false;
  return r.actions.every((a) => !!a && typeof a === 'object' && (a.a === 'r' || a.a === 'l'));
}
