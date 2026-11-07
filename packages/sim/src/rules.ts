import { BLAST_R, DEFAULT_SOLDIERS, MAX_PLAYERS, MAX_SOLDIERS, PLANE_H, PLANE_W, SOLDIER_R, type Dir, type ShotMode } from './constants';
import { generateCircles, placeSoldiers, type SpawnSlot } from './map';
import { Rng } from './rng';
import { Terrain, type Circle } from './terrain';
import { simulateShot, type EndReason, type ShotResult } from './trajectory';

export type MatchKind = 'teams' | 'ffa';

export interface MatchConfig {
  kind: MatchKind;
  mode: ShotMode;
  soldiers: number;
  seed: number;
}

export interface PlayerSetup {
  id: string;
  name: string;
  /** 1 or 2 in team matches. Ignored in free-for-all. */
  team: 1 | 2;
  isBot?: boolean;
  botLevel?: string;
}

export interface Player extends PlayerSetup {
  soldierIds: number[];
  nextSoldier: number;
  connected: boolean;
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

export interface ShotRecord {
  playerId: string;
  soldierId: number;
  expr: string;
  mode: ShotMode;
  dir: Dir;
  angle: number;
  from: { x: number; y: number };
  mirrored: boolean;
  steps: number;
  reason: EndReason;
  end: { x: number; y: number };
  hits: { id: number; step: number }[];
}

export type MatchEvent =
  | { type: 'shot'; shot: ShotRecord }
  | { type: 'timeout'; playerId: string }
  | { type: 'leave'; playerId: string; removed?: number[] };

export interface MatchState {
  config: MatchConfig;
  players: Player[];
  soldiers: Soldier[];
  circles: Circle[];
  holes: Circle[];
  /** Index into players of whoever is up. */
  turn: number;
  turnNumber: number;
  over: boolean;
  /** Winning team (teams) or player id (ffa); null on a draw or while playing. */
  winner: 1 | 2 | string | null;
  log: MatchEvent[];
}

export class RuleError extends Error {}

export function createMatch(config: MatchConfig, setups: PlayerSetup[]): MatchState {
  const soldiersEach = Math.max(1, Math.min(MAX_SOLDIERS, config.soldiers || DEFAULT_SOLDIERS));
  const rng = new Rng(config.seed);
  const ordered = config.kind === 'teams' ? alternateTeams(setups, rng) : shuffled(setups, rng);

  const slots: SpawnSlot[] = [];
  for (const p of ordered) {
    for (let i = 0; i < soldiersEach; i++) {
      slots.push({ side: config.kind === 'teams' ? ((p.team - 1) as 0 | 1) : null });
    }
  }
  if (setups.length > MAX_PLAYERS) throw new RuleError(`A match can have at most ${MAX_PLAYERS} players.`);
  let placed;
  try {
    placed = placeSoldiers(rng, generateCircles(rng), slots);
  } catch {
    throw new RuleError('Too many soldiers for one map. Use fewer players or soldiers.');
  }

  let nextId = 0;
  const soldiers: Soldier[] = [];
  const players: Player[] = ordered.map((p) => {
    const ids: number[] = [];
    for (let i = 0; i < soldiersEach; i++) {
      const spot = placed.spots[nextId]!;
      soldiers.push({ id: nextId, playerId: p.id, x: spot.x, y: spot.y, alive: true, angle: 0 });
      ids.push(nextId);
      nextId++;
    }
    return {
      ...p,
      soldierIds: ids,
      nextSoldier: 0,
      connected: true,
      kills: 0,
      deaths: 0,
      shots: 0,
      bestCombo: 0,
    };
  });

  const state: MatchState = {
    config: { ...config, soldiers: soldiersEach },
    players,
    soldiers,
    circles: placed.circles,
    holes: [],
    turn: 0,
    turnNumber: 1,
    over: false,
    winner: null,
    log: [],
  };
  checkOver(state);
  return state;
}

/** Orders players so turns alternate between teams for as long as both have players. */
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

export function currentPlayer(state: MatchState): Player {
  return state.players[state.turn]!;
}

export function soldierById(state: MatchState, id: number): Soldier {
  return state.soldiers[id]!;
}

/** The soldier who acts this turn: the player's next living one. */
export function currentSoldier(state: MatchState): Soldier | null {
  const p = currentPlayer(state);
  for (let i = 0; i < p.soldierIds.length; i++) {
    const s = state.soldiers[p.soldierIds[(p.nextSoldier + i) % p.soldierIds.length]!]!;
    if (s.alive) return s;
  }
  return null;
}

export function isMirrored(state: MatchState, playerId: string): boolean {
  if (state.config.kind !== 'teams') return false;
  return state.players.find((p) => p.id === playerId)?.team === 2;
}

export function livingTargets(state: MatchState, excludeId: number): { id: number; x: number; y: number }[] {
  return state.soldiers.filter((s) => s.alive && s.id !== excludeId).map((s) => ({ id: s.id, x: s.x, y: s.y }));
}

export interface FireInput {
  expr: string;
  angle?: number;
  dir?: Dir;
}

/** Applies a shot to the state. Throws RuleError on an illegal action, ParseError on bad math. */
export function fire(
  state: MatchState,
  playerId: string,
  input: FireInput,
  terrain: Terrain = terrainOf(state),
): { record: ShotRecord; result: ShotResult } {
  assertTurn(state, playerId);
  const player = currentPlayer(state);
  const shooter = currentSoldier(state);
  if (!shooter) throw new RuleError('No soldier can act');

  const dir: Dir = state.config.kind === 'ffa' && input.dir === -1 ? -1 : 1;
  const mirrored = isMirrored(state, playerId);
  const angle = state.config.mode === 'ode2' ? clampAngle(input.angle ?? 0) : 0;

  const result = simulateShot({
    mode: state.config.mode,
    expr: input.expr,
    from: { x: shooter.x, y: shooter.y },
    angle,
    dir,
    mirrored,
    terrain,
    targets: livingTargets(state, shooter.id),
  });

  const record: ShotRecord = {
    playerId,
    soldierId: shooter.id,
    expr: input.expr,
    mode: state.config.mode,
    dir,
    angle: result.angle,
    from: { x: shooter.x, y: shooter.y },
    mirrored,
    steps: result.steps,
    reason: result.reason,
    end: result.end,
    hits: result.hits,
  };

  shooter.angle = result.angle;
  player.shots++;
  applyKills(state, player, result.hits.map((h) => h.id));
  const hole = { x: result.end.x, y: result.end.y, r: BLAST_R };
  state.holes.push(hole);
  terrain.carve(hole.x, hole.y, hole.r);
  state.log.push({ type: 'shot', shot: record });
  advance(state);
  return { record, result };
}

function applyKills(state: MatchState, shooter: Player, ids: number[]): void {
  let enemyHits = 0;
  for (const id of ids) {
    const s = state.soldiers[id]!;
    if (!s.alive) continue;
    s.alive = false;
    const owner = state.players.find((p) => p.id === s.playerId)!;
    owner.deaths++;
    const friendly = state.config.kind === 'teams' ? owner.team === shooter.team : owner.id === shooter.id;
    if (!friendly) {
      shooter.kills++;
      enemyHits++;
    }
  }
  shooter.bestCombo = Math.max(shooter.bestCombo, enemyHits);
}

/** The current player ran out of time. */
export function skipTurn(state: MatchState): void {
  if (state.over) return;
  state.log.push({ type: 'timeout', playerId: currentPlayer(state).id });
  advance(state);
}

/** A player left: their soldiers are removed and play continues. */
export function removePlayer(state: MatchState, playerId: string): void {
  const p = state.players.find((q) => q.id === playerId);
  if (!p || state.over) return;
  const wasTurn = currentPlayer(state).id === playerId;
  p.connected = false;
  const removed = p.soldierIds.filter((id) => state.soldiers[id]!.alive);
  for (const id of removed) state.soldiers[id]!.alive = false;
  state.log.push({ type: 'leave', playerId, removed });
  if (wasTurn) advance(state);
  else checkOver(state);
}

function assertTurn(state: MatchState, playerId: string): void {
  if (state.over) throw new RuleError('The match is over');
  if (currentPlayer(state).id !== playerId) throw new RuleError("It isn't your turn");
}

function clampAngle(a: number): number {
  const lim = Math.PI / 2 - 0.001;
  if (!Number.isFinite(a)) return 0;
  return Math.max(-lim, Math.min(lim, a));
}

function hasLiving(state: MatchState, p: Player): boolean {
  return p.soldierIds.some((id) => state.soldiers[id]!.alive);
}

function advance(state: MatchState): void {
  if (checkOver(state)) return;
  const cur = currentPlayer(state);
  const acting = cur.soldierIds.findIndex((_, i) => {
    const idx = (cur.nextSoldier + i) % cur.soldierIds.length;
    return state.soldiers[cur.soldierIds[idx]!]!.alive;
  });
  if (acting >= 0) cur.nextSoldier = (cur.nextSoldier + acting + 1) % cur.soldierIds.length;
  for (let i = 1; i <= state.players.length; i++) {
    const idx = (state.turn + i) % state.players.length;
    if (hasLiving(state, state.players[idx]!)) {
      state.turn = idx;
      break;
    }
  }
  state.turnNumber++;
}

function checkOver(state: MatchState): boolean {
  const alive = state.players.filter((p) => hasLiving(state, p));
  if (state.config.kind === 'teams') {
    const t1 = alive.some((p) => p.team === 1);
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
  const p = state.players.find((q) => q.id === playerId);
  if (!p) return false;
  return state.config.kind === 'teams' ? p.team === state.winner : p.id === state.winner;
}
