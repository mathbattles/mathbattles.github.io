import type { MatchConfig, MatchEvent, MatchState, PlayerSetup } from './rules';
import { createMatch, currentPlayer, fire, removePlayer, skipTurn } from './rules';

/**
 * A replay is the match's seed, setup, and actions. It rebuilds the whole match through
 * the normal rules, so it stays small enough to share as a link.
 */
export interface Replay {
  v: 1;
  config: MatchConfig;
  setups: PlayerSetup[];
  actions: ReplayAction[];
}

export type ReplayAction =
  | { a: 'f'; p: string; e: string; g?: number; d?: 1 | -1 }
  | { a: 's' }
  | { a: 'l'; p: string };

export function makeReplay(state: MatchState, setups: PlayerSetup[]): Replay {
  return { v: 1, config: state.config, setups, actions: state.log.map(toAction) };
}

function toAction(e: MatchEvent): ReplayAction {
  switch (e.type) {
    case 'shot':
      return {
        a: 'f',
        p: e.shot.playerId,
        e: e.shot.expr,
        ...(e.shot.mode === 'ode2' ? { g: e.shot.angle } : {}),
        ...(e.shot.dir === -1 ? { d: -1 as const } : {}),
      };
    case 'timeout':
      return { a: 's' };
    case 'leave':
      return { a: 'l', p: e.playerId };
  }
}

export function applyAction(state: MatchState, action: ReplayAction): void {
  switch (action.a) {
    case 'f':
      fire(state, action.p, { expr: action.e, angle: action.g, dir: action.d });
      return;
    case 's':
      skipTurn(state);
      return;
    case 'l':
      removePlayer(state, action.p);
  }
}

export function replayStart(replay: Replay): MatchState {
  return createMatch(replay.config, replay.setups);
}

/*
 * Link format, version 2. Everything is packed into bytes, then written in URL-safe base64:
 *   2, flags (kind, mode, soldiers), seed, player count,
 *   each player: flags (team, bot, bot level), name length, name,
 *   action count, each action: a tag, then its data.
 * Player ids are left out (players are numbered instead), and so is who fired each shot,
 * because the rules already know whose turn it is. Common pieces of math, such as "sin(",
 * take one byte each. Links from the first version, which were plain JSON, still open.
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
const TAG_SHOT = 0;
const TAG_SHOT_LEFT = 1;
const TAG_SKIP = 2;
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
  w.byte(2);
  w.byte(KINDS.indexOf(config.kind) | (MODES.indexOf(config.mode) << 1) | ((config.soldiers - 1) << 3));
  // Seeds are whole numbers. Store the sign separately so negative seeds work too.
  const seed = Math.trunc(config.seed);
  w.uint(Math.abs(seed) * 2 + (seed < 0 ? 1 : 0));
  w.byte(setups.length);
  for (const s of setups) {
    const level = s.isBot ? Math.max(0, BOT_LEVEL_CODES.indexOf(s.botLevel ?? '')) : 0;
    w.byte((s.team === 2 ? 1 : 0) | (s.isBot ? 2 : 0) | (level << 2));
    w.text(s.name);
  }
  const index = new Map(setups.map((s, i) => [s.id, i]));
  w.uint(replay.actions.length);
  for (const a of replay.actions) {
    if (a.a === 'f') {
      w.byte(a.d === -1 ? TAG_SHOT_LEFT : TAG_SHOT);
      if (config.mode === 'ode2') w.float(a.g ?? 0);
      w.expr(a.e);
    } else if (a.a === 's') {
      w.byte(TAG_SKIP);
    } else {
      w.byte(TAG_LEAVE);
      w.byte(index.get(a.p) ?? 0);
    }
  }
  return toBase64Url(w.bytes);
}

function decodeV2(bytes: Uint8Array): Replay {
  const r = new Reader(bytes);
  r.byte();
  const flags = r.byte();
  const kind = KINDS[flags & 1]!;
  const mode = MODES[(flags >> 1) & 3];
  if (!mode) throw new Error('Unknown mode');
  const soldiers = ((flags >> 3) & 3) + 1;
  const rawSeed = r.uint();
  const seed = rawSeed % 2 === 1 ? -(rawSeed - 1) / 2 : rawSeed / 2;
  const count = r.byte();
  if (count < 2 || count > 10) throw new Error('Bad player count');
  const setups: PlayerSetup[] = [];
  for (let i = 0; i < count; i++) {
    const f = r.byte();
    const isBot = !!(f & 2);
    setups.push({
      id: `p${i}`,
      name: r.text(),
      team: f & 1 ? 2 : 1,
      ...(isBot ? { isBot: true, botLevel: BOT_LEVEL_CODES[(f >> 2) & 3] } : {}),
    });
  }
  const config: MatchConfig = { kind, mode, soldiers, seed };
  const total = r.uint();
  if (total > MAX_REPLAY_ACTIONS) throw new Error('Too many actions');
  const actions: ReplayAction[] = [];
  // Shots don't store who fired, so play the match forward to know whose turn each one was.
  const state = createMatch(config, setups);
  for (let k = 0; k < total; k++) {
    const tag = r.byte();
    let action: ReplayAction;
    if (tag === TAG_SHOT || tag === TAG_SHOT_LEFT) {
      const g = mode === 'ode2' ? r.float() : undefined;
      const e = r.expr();
      action = { a: 'f', p: currentPlayer(state).id, e, ...(g !== undefined ? { g } : {}), ...(tag === TAG_SHOT_LEFT ? { d: -1 as const } : {}) };
    } else if (tag === TAG_SKIP) {
      action = { a: 's' };
    } else if (tag === TAG_LEAVE) {
      const who = setups[r.byte()];
      if (!who) throw new Error('Unknown player');
      action = { a: 'l', p: who.id };
    } else {
      throw new Error('Unknown action');
    }
    actions.push(action);
    if (!state.over) applyAction(state, action);
  }
  return { v: 1, config, setups, actions };
}

export function decodeReplay(text: string): Replay | null {
  try {
    const bytes = fromBase64Url(text);
    const r = bytes[0] === 2 ? decodeV2(bytes) : (JSON.parse(new TextDecoder().decode(bytes)) as Replay);
    return replayIsSane(r) ? r : null;
  } catch {
    return null;
  }
}

const MAX_REPLAY_ACTIONS = 5000;

/** Replay links can be edited by hand, so check the shape before building a match from one. */
function replayIsSane(r: Replay): boolean {
  if (!r || r.v !== 1 || !r.config || !Array.isArray(r.setups) || !Array.isArray(r.actions)) return false;
  const { kind, mode, soldiers, seed } = r.config;
  if (kind !== 'teams' && kind !== 'ffa') return false;
  if (mode !== 'fn' && mode !== 'ode1' && mode !== 'ode2') return false;
  if (!Number.isInteger(soldiers) || soldiers < 1 || soldiers > 4 || !Number.isFinite(seed)) return false;
  if (r.setups.length < 2 || r.setups.length > 10 || r.actions.length > MAX_REPLAY_ACTIONS) return false;
  const ids = new Set<string>();
  for (const s of r.setups) {
    if (!s || typeof s.id !== 'string' || typeof s.name !== 'string' || (s.team !== 1 && s.team !== 2)) return false;
    ids.add(s.id);
  }
  if (ids.size !== r.setups.length) return false;
  // Old links can hold abilities, which no longer exist, so those matches can't be rebuilt.
  return r.actions.every((a) => !!a && typeof a === 'object' && (a.a === 'f' || a.a === 's' || a.a === 'l'));
}
