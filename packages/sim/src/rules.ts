import { MAX_PLAYERS, type Dir, type ShotMode } from './constants';
import { START_ENERGY, MAX_ENERGY, cleanAbilities, type AbilityId } from './abilities';
import { assignColors } from './colors';
import { generateCircles, placeSoldiers, type RockShapes, type SpawnSlot } from './map';
import { cleanMap, type MapDef } from './maps';
import { Rng } from './rng';
import { Terrain, type Circle } from './terrain';
import type { EndReason } from './trajectory';

export type MatchKind = 'teams' | 'ffa';

export interface MatchConfig {
  kind: MatchKind;
  mode: ShotMode;
  seed: number;
  /** A player-made map. Without one, the seed makes a random map. */
  map?: MapDef;
  /** Free Play: energy never runs out. */
  freeEnergy?: boolean;
  /** How long each round lasts online, in seconds. 45 when missing. */
  roundSeconds?: number;
  /** Random maps mix rock shapes, or use circles only. Missing means circles, as older matches did. */
  rockShapes?: RockShapes;
}

export interface PlayerSetup {
  id: string;
  name: string;
  /** 1 or 2 in team matches. Ignored in free-for-all. */
  team: 1 | 2;
  isBot?: boolean;
  botLevel?: string;
  /** A colour the player picked. Taken colours fall back to the palette. */
  color?: string;
  /** Never aims or locks in: practice targets and the friends you mustn't hit. */
  passive?: boolean;
  /** Abilities this player owns. Hop is always included. */
  abilities?: AbilityId[];
}

export interface Player extends PlayerSetup {
  /** Every player controls exactly one soldier. */
  soldierId: number;
  color: string;
  connected: boolean;
  /** Locked in for this round. Only whether, never what: functions stay secret until the round fires. */
  locked: boolean;
  /** Energy for abilities, a whole number from 0 to 100. */
  energy: number;
  kills: number;
  deaths: number;
  shots: number;
  bestCombo: number;
}

export interface Soldier {
  id: number;
  playerId: string;
  x: number;
  y: number;
  alive: boolean;
  angle: number;
}

/** How a shot ended: the path's own reasons, or cut short by the round. */
export type ShotEnd = EndReason | 'killed' | 'collision' | 'beamcut';

export interface ShotRecord {
  playerId: string;
  soldierId: number;
  expr: string;
  mode: ShotMode;
  dir: Dir;
  angle: number;
  from: { x: number; y: number };
  mirrored: boolean;
  /** Steps actually drawn. Shorter than the full path when the shot was cut short. */
  steps: number;
  reason: ShotEnd;
  end: { x: number; y: number };
  /** Soldiers this shot killed, with the step of each hit. */
  hits: { id: number; step: number }[];
  /** The ability used with this shot, if any. */
  ability?: AbilityId;
  /** Where a ricochet bounced. */
  bounce?: { x: number; y: number; step: number };
}

/** A beam made where two shot tips met. It flies straight, through rock, until it leaves the field. */
export interface BeamRecord {
  /** Where the tips met, in field pixels. */
  at: { x: number; y: number };
  /** The step the tips met. The beam starts here. */
  step: number;
  /** One direction, or two (both ways) when the shots met head on. Unit vectors in field pixels. */
  dirs: { x: number; y: number }[];
  /** For each direction, the step its front leaves the field. */
  ends: number[];
  /** The two shots, by index in the round's shot list. */
  shots: [number, number];
  owners: [string, string];
  hits: { id: number; step: number }[];
}

/** How a soldier was knocked out. */
export type KillKind = 'shot' | 'beam' | 'hop' | 'heavy' | 'out';

export interface KillRecord {
  id: number;
  step: number;
  /** Players credited with the kill. A beam credits both of its shooters. Hopping out of the field credits nobody. */
  by: string[];
  beam?: boolean;
  kind: KillKind;
}

/** A soldier riding their own line with Hop. */
export interface HopRecord {
  playerId: string;
  soldierId: number;
  /** Index of the line in the round's shots. */
  shot: number;
  from: { x: number; y: number };
  /** The step the line finished, when the ride begins. */
  start: number;
  /** The last path point ridden. */
  pathEnd: number;
  /** Little hops over other lines. */
  overs: { step: number }[];
  /** Knocked aside by meeting a line head on, from this step on. */
  sides: { step: number; dx: number; dy: number }[];
  /** The step the ride along the line stopped. */
  rideEnd: number;
  /** The jump at the end: over a rock, or out of the field. */
  jump?: { start: number; steps: number; from: { x: number; y: number }; to: { x: number; y: number }; out: boolean };
  outcome: 'stand' | 'land' | 'out' | 'dead';
  /** Where the soldier stands once it's over. */
  at: { x: number; y: number };
}

export interface RoundRecord {
  n: number;
  shots: ShotRecord[];
  beams: BeamRecord[];
  kills: KillRecord[];
  /** Players who survived an exact tie on a coin flip. */
  luck: string[];
  /** How many steps the round takes to draw. */
  steps: number;
  /** Holes this round added to the terrain, so history can rewind it. */
  holes: number;
  hops: HopRecord[];
  /** Soldiers that moved this round, so history can rewind them. */
  moves: { id: number; from: { x: number; y: number }; to: { x: number; y: number } }[];
  /** Each player's energy before and after the round. */
  energy: { playerId: string; before: number; after: number }[];
}

export type MatchEvent =
  | { type: 'round'; round: RoundRecord }
  | { type: 'leave'; playerId: string; removed?: number[] };

export interface MatchState {
  config: MatchConfig;
  players: Player[];
  soldiers: Soldier[];
  circles: Circle[];
  holes: Circle[];
  /** Round number, from 1. */
  round: number;
  over: boolean;
  /** Winning team (teams) or player id (ffa); null on a draw or while playing. */
  winner: 1 | 2 | string | null;
  log: MatchEvent[];
}

export class RuleError extends Error {}

export function createMatch(config: MatchConfig, setups: PlayerSetup[]): MatchState {
  if (setups.length > MAX_PLAYERS) throw new RuleError(`A match can have at most ${MAX_PLAYERS} players.`);
  const rng = new Rng(config.seed);
  const ordered = config.kind === 'teams' ? alternateTeams(setups, rng) : shuffled(setups, rng);
  const slots: SpawnSlot[] = ordered.map((p) => ({ side: config.kind === 'teams' ? ((p.team - 1) as 0 | 1) : null }));

  // A custom map's spawns go to its teams in order. Anyone left over is placed at random.
  const map = config.map ? cleanMap(config.map) : null;
  const fixed: ({ x: number; y: number } | undefined)[] = [];
  if (map) {
    const free = [...map.spawns];
    for (const slot of slots) {
      const i = free.findIndex((s) => slot.side === null || s.team - 1 === slot.side);
      fixed.push(i >= 0 ? free.splice(i, 1)[0] : undefined);
    }
  }
  let placed;
  try {
    placed = placeSoldiers(rng, map ? map.circles : generateCircles(rng, config.rockShapes ?? 'circles', config.seed), slots, fixed);
  } catch {
    throw new RuleError('Too many players for one map.');
  }

  // Colours follow the order players joined in, so Blue, Red, Green, Yellow match the lobby.
  const colors = assignColors(setups.map((s) => s.color), config.seed);
  const colorOf = new Map(setups.map((s, i) => [s.id, colors[i]!]));
  const soldiers: Soldier[] = [];
  const players: Player[] = ordered.map((p, i) => {
    const spot = placed.spots[i]!;
    soldiers.push({ id: i, playerId: p.id, x: spot.x, y: spot.y, alive: true, angle: 0 });
    return {
      ...p,
      soldierId: i,
      color: colorOf.get(p.id)!,
      connected: true,
      locked: false,
      energy: config.freeEnergy ? MAX_ENERGY : START_ENERGY,
      abilities: cleanAbilities(p.abilities),
      kills: 0,
      deaths: 0,
      shots: 0,
      bestCombo: 0,
    };
  });

  const state: MatchState = {
    config: { kind: config.kind, mode: config.mode, seed: config.seed, ...(map ? { map } : {}), ...(config.freeEnergy ? { freeEnergy: true } : {}), ...(config.roundSeconds ? { roundSeconds: config.roundSeconds } : {}), ...(config.rockShapes === 'mixed' ? { rockShapes: 'mixed' as const } : {}) },
    players,
    soldiers,
    circles: placed.circles,
    holes: [],
    round: 1,
    over: false,
    winner: null,
    log: [],
  };
  checkOver(state);
  return state;
}

/** Orders players so the two teams interleave, which spreads spawns fairly. */
function alternateTeams(setups: PlayerSetup[], rng: Rng): PlayerSetup[] {
  const pools = {
    1: shuffled(setups.filter((p) => p.team === 1), rng),
    2: shuffled(setups.filter((p) => p.team === 2), rng),
  };
  let team: 1 | 2 = rng.next() < 0.5 ? 1 : 2;
  const out: PlayerSetup[] = [];
  while (pools[1].length || pools[2].length) {
    const pool: PlayerSetup[] = pools[team];
    if (pool.length) out.push(pool.shift()!);
    team = team === 1 ? 2 : 1;
  }
  return out;
}

function shuffled<T>(items: T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function terrainOf(state: MatchState): Terrain {
  return new Terrain(state.circles, state.holes);
}

export function soldierById(state: MatchState, id: number): Soldier {
  return state.soldiers[id]!;
}

export function playerById(state: MatchState, id: string): Player | undefined {
  return state.players.find((p) => p.id === id);
}

/** A player's one soldier. */
export function soldierOf(state: MatchState, playerId: string): Soldier | null {
  const p = playerById(state, playerId);
  return p ? state.soldiers[p.soldierId] ?? null : null;
}

export function isAlive(state: MatchState, p: Player): boolean {
  return !!state.soldiers[p.soldierId]?.alive;
}

/** Players who aim this round: alive, still here, and not a practice target. */
export function actors(state: MatchState): Player[] {
  return state.players.filter((p) => !p.passive && p.connected && isAlive(state, p));
}

/** Players the round is still waiting on, in seat order. */
export function waitingOn(state: MatchState): Player[] {
  return actors(state).filter((p) => !p.locked);
}

export function allLocked(state: MatchState): boolean {
  return !state.over && waitingOn(state).length === 0;
}

export function canAim(state: MatchState, playerId: string): boolean {
  const p = playerById(state, playerId);
  return !!p && !state.over && !p.passive && p.connected && isAlive(state, p);
}

/** Locks or unlocks a player's shot for this round. */
export function setLocked(state: MatchState, playerId: string, locked: boolean): void {
  if (state.over) throw new RuleError('The match is over');
  const p = playerById(state, playerId);
  if (!p || p.passive) throw new RuleError("You aren't playing in this match");
  if (!isAlive(state, p)) throw new RuleError('You were knocked out');
  p.locked = locked;
}

export function isMirrored(state: MatchState, playerId: string): boolean {
  if (state.config.kind !== 'teams') return false;
  return playerById(state, playerId)?.team === 2;
}

export function livingTargets(state: MatchState, excludeId: number): { id: number; x: number; y: number }[] {
  return state.soldiers.filter((s) => s.alive && s.id !== excludeId).map((s) => ({ id: s.id, x: s.x, y: s.y }));
}

/** The last function a player fired this match, to paste back in. */
export function lastShotOf(state: MatchState, playerId: string): ShotRecord | null {
  for (let i = state.log.length - 1; i >= 0; i--) {
    const e = state.log[i]!;
    if (e.type !== 'round') continue;
    const s = e.round.shots.find((x) => x.playerId === playerId);
    if (s) return s;
  }
  return null;
}

/**
 * A player's past functions, newest first, without repeats. The up arrow steps through these.
 * Each entry keeps its angle and direction too.
 */
export function historyOf(state: MatchState, playerId: string): ShotRecord[] {
  const out: ShotRecord[] = [];
  const seen = new Set<string>();
  for (let i = state.log.length - 1; i >= 0; i--) {
    const e = state.log[i]!;
    if (e.type !== 'round') continue;
    const s = e.round.shots.find((x) => x.playerId === playerId);
    if (!s) continue;
    const key = `${s.expr}|${s.mode === 'ode2' ? s.angle.toFixed(4) : ''}|${s.dir}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** A player left: their soldier is removed and play continues. */
export function removePlayer(state: MatchState, playerId: string): void {
  const p = playerById(state, playerId);
  if (!p || state.over) return;
  p.connected = false;
  p.locked = false;
  const s = state.soldiers[p.soldierId];
  const removed = s?.alive ? [s.id] : [];
  if (s) s.alive = false;
  state.log.push({ type: 'leave', playerId, removed });
  checkOver(state);
}

export function clampAngle(a: number): number {
  const lim = Math.PI / 2 - 0.001;
  if (!Number.isFinite(a)) return 0;
  return Math.max(-lim, Math.min(lim, a));
}

export function checkOver(state: MatchState): boolean {
  // Practice targets count as a side, so a solo level ends when they're all down.
  const alive = state.players.filter((p) => isAlive(state, p));
  if (state.config.kind === 'teams') {
    const t1 = alive.some((p) => p.team === 1 && !p.passive) || (alive.some((p) => p.team === 1) && !state.players.some((p) => p.team === 1 && !p.passive));
    const t2 = alive.some((p) => p.team === 2);
    if (t1 && t2) return false;
    state.over = true;
    state.winner = t1 ? 1 : t2 ? 2 : null;
    return true;
  }
  if (alive.length > 1) return false;
  state.over = true;
  state.winner = alive[0]?.id ?? null;
  return true;
}

export function isOnWinningSide(state: MatchState, playerId: string): boolean {
  if (!state.over || state.winner === null) return false;
  const p = playerById(state, playerId);
  if (!p) return false;
  return state.config.kind === 'teams' ? p.team === state.winner : p.id === state.winner;
}

/** Every round played so far, oldest first. */
export function roundsOf(state: MatchState): RoundRecord[] {
  const out: RoundRecord[] = [];
  for (const e of state.log) if (e.type === 'round') out.push(e.round);
  return out;
}
