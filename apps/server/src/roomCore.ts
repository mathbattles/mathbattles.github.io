import {
  BOT_LEVELS,
  BOT_NAMES,
  COSMETICS,
  DEFAULT_ROOM_SETTINGS,
  DRAW_STEPS_PER_SEC,
  MAX_FUNCTION_CHARS,
  MAX_PLAYERS,
  NEXT_ROUND_DELAY_MS,
  ParseError,
  RECONNECT_GRACE_MS,
  RuleError,
  START_DELAY_MS,
  ABILITY_IDS,
  ROUND_SECONDS,
  cleanAbilities,
  isAbilityId,
  actors,
  allLocked,
  chooseMove,
  cleanMap,
  createMatch,
  encodeReplay,
  makeReplay,
  removePlayer,
  resolveRound,
  setLocked,
  type BotLevel,
  type ChatLine,
  type ClientMsg,
  type AbilityId,
  type Draft,
  type RatingChange,
  type MatchState,
  type PlayerSetup,
  type RoomSettings,
  type Seat,
  type ServerMsg,
  type ShotMode,
} from '@mathbattles/sim';
import { cleanChat, cleanName } from './moderation';

export interface RoomIO {
  send(connId: string, msg: ServerMsg): void;
  now(): number;
  /** Requests a call to tick() at this time. Replaces any earlier request. */
  wake(at: number | null): void;
  random(): number;
  /** The most shots a bot may simulate per move on the server. */
  botMaxEvals: number;
  onLobbyChange?(info: { players: number; kind: string; mode: string; inLobby: boolean }): void;
  onRankedOver?(winnerSeat: string, loserSeat: string): Promise<Record<string, RatingChange> | undefined>;
  /** Stores a finished match's replay and returns its short id. */
  saveReplay?(code: string): Promise<string | undefined>;
  /** Runs once when a match ends, after any rating change is known. */
  onMatchOver?(state: MatchState, setups: PlayerSetup[], ratingDelta: number | undefined, replayId?: string, ratings?: Record<string, RatingChange>): void;
}

interface Internal extends Seat {
  /** Abilities this player owns, checked when they join. */
  abilities: AbilityId[];
  conns: Set<string>;
  disconnectedAt: number | null;
  skip: boolean;
  lastChat: number;
}

const RANKED_SETTINGS: RoomSettings = { kind: 'teams', mode: 'fn', showFunctions: false, roundSeconds: 45, rockShapes: 'mixed' };
const MAX_SEATS = MAX_PLAYERS;
const LOBBY_RETURN_MS = 12_000;
const RANKED_NO_SHOW_MS = 30_000;
const MAX_SPECTATORS = 20;
const HAT_VALUES = new Set(COSMETICS.filter((c) => c.kind === 'hat').map((c) => c.value));

/**
 * A room's full logic, free of Cloudflare APIs so it can be tested directly.
 * All results are computed here. Clients only send what they intend to do.
 */
export class RoomCore {
  seats: Internal[] = [];
  host = '';
  settings: RoomSettings;
  state: MatchState | null = null;
  private connSeat = new Map<string, string>();
  /** Connections watching without a seat. They see everything players see, and can't act. */
  private spectators = new Set<string>();
  private tokenSeat = new Map<string, string>();
  /** When the current round ends. */
  private deadline = 0;
  /** When the current round opens for locking: after the start delay or the last round's shots. */
  private busyUntil = 0;
  /** What each player has typed this round. Never sent to anyone else. */
  private drafts = new Map<string, Draft>();
  /** When each bot locks in this round. */
  private botAt = new Map<string, number>();
  /** Seats that voted to play again after the last match. */
  private rematch = new Set<string>();
  private lobbyAt = 0;
  private nextSeat = 1;
  private setups: PlayerSetup[] = [];
  private noShowAt = 0;
  private cancelled = false;
  private readonly ranked: boolean;

  constructor(readonly code: string, private io: RoomIO, opts: { ranked?: boolean; rankedPair?: [string, string] } = {}) {
    this.ranked = !!opts.ranked;
    this.settings = this.ranked ? RANKED_SETTINGS : { ...DEFAULT_ROOM_SETTINGS };
    this.rankedPair = opts.rankedPair;
  }
  private rankedPair?: [string, string];

  setRankedPair(pair: [string, string]): void {
    this.rankedPair = pair;
  }
  hasRankedPair(): boolean {
    return !!this.rankedPair;
  }

  private broadcast(msg: ServerMsg): void {
    for (const conn of this.connSeat.keys()) this.io.send(conn, msg);
    for (const conn of this.spectators) this.io.send(conn, msg);
  }

  private publicSeat(s: Internal): Seat {
    return { id: s.id, name: s.name, team: s.team, ready: s.ready, isBot: s.isBot, connected: s.connected, hat: s.hat };
  }

  private sendLobby(to?: string): void {
    const msg: ServerMsg = { t: 'lobby', host: this.host, seats: this.seats.map((s) => this.publicSeat(s)), settings: this.settings, ranked: this.ranked, inMatch: !!this.state, spectators: this.spectators.size, rematch: [...this.rematch] };
    if (to) this.io.send(to, msg);
    else this.broadcast(msg);
    this.io.onLobbyChange?.({ players: this.seats.filter((s) => s.connected).length, kind: this.settings.kind, mode: this.settings.mode, inLobby: !this.state });
  }

  private system(text: string): void {
    this.broadcast({ t: 'chat', line: { from: '', text, system: true } });
  }

  connect(_connId: string): void {
    /* Nothing is known until the join message arrives. */
  }

  /** identity is proven by the transport layer: a verified user id or a guest token. */
  join(connId: string, identity: string, msg: Extract<ClientMsg, { t: 'join' }>): void {
    // A connection gets one seat. Joining again could otherwise leave ghost seats behind.
    if (this.connSeat.has(connId) || this.spectators.has(connId)) return;
    if (msg.spectate) {
      this.watch(connId);
      return;
    }
    if (this.ranked) {
      if (this.cancelled) {
        this.io.send(connId, { t: 'closed', message: "This ranked match was cancelled because a player didn't connect." });
        return;
      }
      if (!this.rankedPair || !this.rankedPair.includes(identity)) {
        this.io.send(connId, { t: 'closed', message: 'This ranked match is for two other players.' });
        return;
      }
      if (!this.noShowAt) this.noShowAt = this.io.now() + RANKED_NO_SHOW_MS;
    }
    const existing = this.tokenSeat.get(identity);
    let seat = existing ? this.seats.find((s) => s.id === existing) : undefined;
    if (!seat) {
      if (this.state || this.seats.length >= MAX_SEATS) {
        this.io.send(connId, { t: 'error', message: this.state ? 'A match is in progress in this room. Try again when it ends.' : 'This room is full.' });
        return;
      }
      const humans = this.seats.filter((s) => !s.isBot);
      seat = {
        id: `s${this.nextSeat++}`,
        name: this.uniqueName(cleanName(msg.name)),
        team: this.ranked ? (humans.length === 0 ? 1 : 2) : this.balancedTeam(),
        ready: false,
        isBot: false,
        connected: true,
        hat: typeof msg.hat === 'string' && HAT_VALUES.has(msg.hat) ? msg.hat : undefined,
        abilities: cleanAbilities(msg.abilities),
        conns: new Set(),
        disconnectedAt: null,
        skip: false,
        lastChat: 0,
      };
      this.seats.push(seat);
      this.tokenSeat.set(identity, seat.id);
      this.system(`${seat.name} joined.`);
    }
    // Also covers a room whose host left while everyone else was briefly disconnected.
    if (!this.host) this.host = seat.id;
    seat.conns.add(connId);
    seat.connected = true;
    seat.disconnectedAt = null;
    this.connSeat.set(connId, seat.id);
    this.io.send(connId, { t: 'welcome', you: seat.id, code: this.code });
    this.sendLobby();
    if (this.state) this.sendMatchTo(connId);
    // Someone returning after the end of a match still gets the result.
    if (this.state?.over && this.finalMsg) this.io.send(connId, this.finalMsg);
    if (this.ranked && !this.state) {
      const humans = this.seats.filter((s) => !s.isBot && s.connected);
      if (humans.length === 2) this.startMatch();
    }
    this.schedule();
  }

  /** Joins as a watcher: no seat, no turn, and nothing they send changes the room. */
  private watch(connId: string): void {
    if (this.spectators.size >= MAX_SPECTATORS) {
      this.io.send(connId, { t: 'closed', message: 'Too many people are watching this room right now.' });
      return;
    }
    this.spectators.add(connId);
    this.io.send(connId, { t: 'welcome', you: '', code: this.code });
    this.sendLobby();
    if (this.state) this.sendMatchTo(connId);
    if (this.state?.over && this.finalMsg) this.io.send(connId, this.finalMsg);
  }

  private uniqueName(name: string): string {
    const used = new Set(this.seats.map((s) => s.name.toLowerCase()));
    if (!used.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) {
      const candidate = `${name.slice(0, 13)} ${i}`;
      if (!used.has(candidate.toLowerCase())) return candidate;
    }
  }

  private balancedTeam(): 1 | 2 {
    const t1 = this.seats.filter((s) => s.team === 1).length;
    const t2 = this.seats.filter((s) => s.team === 2).length;
    return t1 <= t2 ? 1 : 2;
  }

  disconnect(connId: string): void {
    if (this.spectators.delete(connId)) {
      this.sendLobby();
      return;
    }
    const id = this.connSeat.get(connId);
    this.connSeat.delete(connId);
    const seat = this.seats.find((s) => s.id === id);
    if (!seat) return;
    seat.conns.delete(connId);
    if (seat.conns.size > 0) return;
    seat.connected = false;
    seat.disconnectedAt = this.io.now();
    this.system(`${seat.name} lost connection.`);
    this.sendLobby();
    this.schedule();
  }

  private seatOf(connId: string): Internal | undefined {
    const id = this.connSeat.get(connId);
    return this.seats.find((s) => s.id === id);
  }

  handle(connId: string, msg: ClientMsg): void {
    const seat = this.seatOf(connId);
    if (!seat) return;
    const fail = (message: string) => this.io.send(connId, { t: 'error', message });
    const isHost = seat.id === this.host;
    try {
      switch (msg.t) {
        case 'ping':
          this.io.send(connId, { t: 'pong' });
          return;
        case 'chat':
          this.chat(seat, msg.text, connId);
          return;
        case 'leave':
          this.leave(seat);
          return;
        case 'skipVote':
          this.skipVote(seat);
          return;
        case 'settings':
          if (!isHost || this.ranked || this.state) return;
          this.applySettings(msg.settings);
          this.sendLobby();
          return;
        case 'team':
          if (this.state || this.ranked || this.settings.kind === 'ffa') return;
          seat.team = msg.team === 2 ? 2 : 1;
          this.sendLobby();
          return;
        case 'ready':
          if (this.state || this.ranked) return;
          seat.ready = !!msg.ready;
          this.sendLobby();
          return;
        case 'addBot':
          if (!isHost || this.state || this.ranked) return;
          this.addBot(msg.level);
          return;
        case 'removeSeat':
          if (!isHost || this.state || this.ranked) return;
          this.removeSeat(msg.id);
          return;
        case 'start':
          if (!isHost || this.state || this.ranked) return;
          this.tryStart(fail);
          return;
        case 'draft':
          this.onDraft(seat, msg);
          return;
        case 'lock':
          this.onLock(seat, msg);
          return;
        case 'unlock':
          this.onUnlock(seat);
          return;
        case 'rematch':
          this.onRematch(seat);
          return;
        default:
          return;
      }
    } catch (e) {
      if (e instanceof RuleError || e instanceof ParseError) fail(e.message);
      else throw e;
    }
  }

  /** Leaving on purpose frees the seat right away, with no reconnect window. */
  private leave(seat: Internal): void {
    for (const conn of seat.conns) this.connSeat.delete(conn);
    seat.conns.clear();
    seat.connected = false;
    seat.disconnectedAt = null;
    this.system(`${seat.name} left.`);
    this.dropSeat(seat);
    this.schedule();
  }

  private applySettings(p: Partial<RoomSettings>): void {
    if (p.kind === 'teams' || p.kind === 'ffa') this.settings.kind = p.kind;
    // Only y = f(x) matches are offered now.
    this.settings.mode = 'fn';
    if ('map' in p) this.settings.map = p.map ? cleanMap(p.map) : null;
    if (typeof p.showFunctions === 'boolean') this.settings.showFunctions = p.showFunctions;
    if (typeof p.roundSeconds === 'number' && (ROUND_SECONDS as readonly number[]).includes(p.roundSeconds)) this.settings.roundSeconds = p.roundSeconds;
    if (p.rockShapes === 'mixed' || p.rockShapes === 'circles') this.settings.rockShapes = p.rockShapes;
  }

  private addBot(level: string): void {
    if (this.seats.length >= MAX_SEATS) return;
    const lv: BotLevel = level in BOT_LEVELS ? (level as BotLevel) : 'normal';
    const used = new Set(this.seats.map((s) => s.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.nextSeat}`;
    this.seats.push({
      id: `b${this.nextSeat++}:${lv}`,
      name,
      team: this.balancedTeam(),
      ready: true,
      isBot: true,
      connected: true,
      abilities: [...ABILITY_IDS],
      conns: new Set(),
      disconnectedAt: null,
      skip: true,
      lastChat: 0,
    });
    this.sendLobby();
  }

  private removeSeat(id: string): void {
    const seat = this.seats.find((s) => s.id === id);
    if (!seat || id === this.host) return;
    for (const [token, sid] of this.tokenSeat) if (sid === id) this.tokenSeat.delete(token);
    this.seats = this.seats.filter((s) => s.id !== id);
    for (const conn of seat.conns) {
      this.io.send(conn, { t: 'error', message: 'The host removed you from this room.' });
      this.connSeat.delete(conn);
    }
    this.sendLobby();
  }

  private tryStart(fail: (m: string) => void): void {
    const present = this.seats.filter((s) => s.connected);
    if (present.length < 2) return fail('You need at least 2 players. Invite someone or add a bot.');
    if (this.settings.kind === 'teams') {
      if (!present.some((s) => s.team === 1) || !present.some((s) => s.team === 2)) return fail('Each team needs at least one player.');
    }
    const notReady = present.filter((s) => !s.ready && s.id !== this.host);
    if (notReady.length) return fail(`Waiting for ${notReady.map((s) => s.name).join(', ')} to be ready.`);
    this.startMatch();
  }

  private startMatch(): void {
    const seed = Math.floor(this.io.random() * 2 ** 31);
    const setups: PlayerSetup[] = this.seats
      .filter((s) => s.connected)
      .map((s) => ({ id: s.id, name: s.name, team: s.team, isBot: s.isBot, botLevel: s.isBot ? s.id.split(':')[1] : undefined, abilities: s.abilities }));
    this.state = createMatch(
      { kind: this.settings.kind, mode: this.settings.mode, seed, roundSeconds: this.roundSeconds(), rockShapes: this.settings.rockShapes ?? 'mixed', ...(this.settings.map ? { map: this.settings.map } : {}) },
      setups,
    );
    // The exact list used here, so replay links can rebuild this same match.
    this.setups = setups;
    this.noShowAt = 0;
    for (const s of this.seats) s.skip = s.isBot;
    this.deadline = this.io.now() + START_DELAY_MS + this.roundMs();
    this.busyUntil = this.io.now() + START_DELAY_MS;
    this.drafts.clear();
    this.rematch.clear();
    this.lobbyAt = 0;
    this.planBots();
    this.broadcastMatch();
    this.sendLobby();
    this.schedule();
  }

  private sendMatchTo(connId: string): void {
    if (!this.state) return;
    const seatId = this.connSeat.get(connId);
    const draft = seatId ? this.drafts.get(seatId) ?? null : null;
    this.io.send(connId, { t: 'match', state: this.state, setups: this.setups, deadline: this.deadline, serverNow: this.io.now(), draft });
  }
  private broadcastMatch(): void {
    if (this.state) this.broadcast({ t: 'match', state: this.state, setups: this.setups, deadline: this.deadline, serverNow: this.io.now(), draft: null });
  }
  private broadcastUpdate(): void {
    if (this.state) this.broadcast({ t: 'update', state: this.state, deadline: this.deadline, serverNow: this.io.now() });
  }

  private cleanDraft(msg: { expr?: unknown; angle?: unknown; dir?: unknown; ability?: unknown }): Draft {
    const expr = String(msg.expr ?? '').slice(0, MAX_FUNCTION_CHARS);
    return {
      expr,
      ...(typeof msg.angle === 'number' && Number.isFinite(msg.angle) ? { angle: msg.angle } : {}),
      dir: msg.dir === -1 ? -1 : 1,
      ...(isAbilityId(msg.ability) ? { ability: msg.ability } : {}),
    };
  }

  /** Ranked is always 45 seconds. Other rooms use the host's choice. */
  private roundSeconds(): number {
    return this.ranked ? 45 : this.settings.roundSeconds || 45;
  }
  private roundMs(): number {
    return this.roundSeconds() * 1000;
  }

  /** Everyone still here voting Rematch starts a new match straight away. */
  private onRematch(seat: Internal): void {
    if (!this.state?.over || this.ranked) return;
    this.rematch.add(seat.id);
    const humans = this.seats.filter((s) => !s.isBot && s.connected);
    if (humans.length >= 1 && humans.every((s) => this.rematch.has(s.id)) && this.seats.filter((s) => s.connected).length >= 2) {
      this.system('Everyone wants a rematch. Here we go!');
      this.finalMsg = null;
      this.startMatch();
    } else {
      this.system(`${seat.name} wants a rematch.`);
      this.sendLobby();
    }
  }

  private roundOpen(): boolean {
    return !!this.state && !this.state.over && this.io.now() >= this.busyUntil;
  }

  private onDraft(seat: Internal, msg: Extract<ClientMsg, { t: 'draft' }>): void {
    if (!this.state || this.state.over) return;
    const p = this.state.players.find((q) => q.id === seat.id);
    if (!p || p.locked) return;
    this.drafts.set(seat.id, this.cleanDraft(msg));
  }

  private onLock(seat: Internal, msg: Extract<ClientMsg, { t: 'lock' }>): void {
    if (!this.state || this.state.over) throw new RuleError('The match is over');
    if (!this.roundOpen()) throw new RuleError('Wait for the last round to finish');
    const draft = this.cleanDraft(msg);
    if (!draft.expr.trim()) throw new RuleError('Type a function first');
    setLocked(this.state, seat.id, true);
    this.drafts.set(seat.id, draft);
    this.afterLockChange();
  }

  private onUnlock(seat: Internal): void {
    if (!this.roundOpen()) return;
    setLocked(this.state!, seat.id, false);
    this.broadcastUpdate();
  }

  /** Fires the round as soon as everyone still playing has locked in. */
  private afterLockChange(): void {
    if (this.state && !this.state.over && allLocked(this.state)) this.closeRound();
    else this.broadcastUpdate();
  }

  /** Everyone's shot fires at once: locked ones, and anything valid that was typed in time. */
  private closeRound(): void {
    const state = this.state!;
    const shots = actors(state)
      .map((p) => ({ p, d: this.drafts.get(p.id) }))
      .filter(({ d }) => !!d && d.expr.trim() !== '')
      .map(({ p, d }) => ({ playerId: p.id, expr: d!.expr, angle: d!.angle, dir: d!.dir, ability: d!.ability }));
    const round = resolveRound(state, shots);
    this.drafts.clear();
    this.botAt.clear();
    const animation = (round.steps / DRAW_STEPS_PER_SEC) * 1000 + NEXT_ROUND_DELAY_MS;
    this.busyUntil = this.io.now() + animation;
    this.deadline = this.busyUntil + this.roundMs();
    this.broadcast({ t: 'round', round, state, deadline: this.deadline, serverNow: this.io.now() });
    if (state.over) {
      this.finish(animation);
      return;
    }
    this.planBots();
    this.schedule();
  }

  private finish(delay: number): void {
    const state = this.state!;
    // A ranked room is one match only: it stays on the result and can't start again.
    this.lobbyAt = this.ranked ? 0 : this.io.now() + delay + LOBBY_RETURN_MS;
    this.botAt.clear();
    const setups = this.setups;
    const send = (ratings?: Record<string, RatingChange>, replayId?: string) => {
      // The winner's gain, kept for older screens. Each player's own change is in ratings.
      const winner = state.players.find((p) => p.team === state.winner);
      const w = winner && ratings?.[winner.id];
      const ratingDelta = w ? w.after - w.before : undefined;
      this.finalMsg = { t: 'over', state, setups, ...(ratingDelta !== undefined ? { ratingDelta } : {}), ...(ratings ? { ratings } : {}), ...(replayId ? { replayId } : {}) };
      this.broadcast(this.finalMsg);
      this.io.onMatchOver?.(state, setups, ratingDelta, replayId, ratings);
    };
    let rating: Promise<Record<string, RatingChange> | undefined> | null = null;
    if (this.ranked && this.io.onRankedOver && state.winner !== null) {
      const winner = state.players.find((p) => p.team === state.winner);
      const loser = state.players.find((p) => p.team !== state.winner);
      if (winner && loser) rating = this.io.onRankedOver(winner.id, loser.id).catch(() => undefined);
    }
    let replay: Promise<string | undefined> | null = null;
    if (this.io.saveReplay) {
      try {
        replay = this.io.saveReplay(encodeReplay(makeReplay(state, setups))).catch(() => undefined);
      } catch {
        replay = null;
      }
    }
    if (rating || replay) {
      void Promise.all([rating ?? Promise.resolve(undefined), replay ?? Promise.resolve(undefined)]).then(([d, id]) => send(d, id));
      this.schedule();
      return;
    }
    send();
    this.schedule();
  }

  private finalMsg: ServerMsg | null = null;

  /** Bots lock in a few seconds into the round, at different times, like people do. */
  private planBots(): void {
    const state = this.state!;
    this.botAt.clear();
    const open = Math.max(this.busyUntil, this.io.now());
    for (const p of actors(state)) {
      if (!p.isBot) continue;
      const slow = p.botLevel === 'easy' ? 4_000 : 0;
      const at = open + 4_000 + slow + this.io.random() * 11_000;
      this.botAt.set(p.id, Math.min(at, this.deadline - 1_000));
    }
  }

  private runBot(id: string): void {
    const state = this.state!;
    this.botAt.delete(id);
    const p = state.players.find((q) => q.id === id);
    if (!p?.isBot || p.locked || state.over) return;
    const lv = (p.botLevel ?? 'normal') as BotLevel;
    const def = BOT_LEVELS[lv] ?? BOT_LEVELS.normal;
    const move = chooseMove(state, {
      playerId: id,
      generations: def.generations,
      aimError: def.aimError,
      seed: state.config.seed + state.round * 31 + p.soldierId,
      maxEvals: this.io.botMaxEvals,
      useAbilities: true,
    });
    this.drafts.set(id, { expr: move.expr, angle: move.angle, dir: move.dir, ...(move.ability ? { ability: move.ability } : {}) });
    setLocked(state, id, true);
    this.afterLockChange();
  }

  /** Runs whatever is due. Called by the alarm. */
  tick(): void {
    const now = this.io.now();
    for (const seat of [...this.seats]) {
      if (seat.isBot || seat.connected || seat.disconnectedAt === null) continue;
      if (now - seat.disconnectedAt < RECONNECT_GRACE_MS) continue;
      seat.disconnectedAt = null;
      this.dropSeat(seat);
    }
    if (this.state && !this.state.over && now >= this.busyUntil) {
      for (const [id, at] of [...this.botAt]) {
        if (!this.state || this.state.over || now < this.busyUntil) break;
        if (now >= at) this.runBot(id);
      }
      if (this.state && !this.state.over && now >= this.busyUntil && now >= this.deadline) this.closeRound();
    }
    if (this.state?.over && this.lobbyAt && now >= this.lobbyAt) this.backToLobby();
    if (this.ranked && !this.state && this.noShowAt && now >= this.noShowAt) {
      this.noShowAt = 0;
      this.cancelled = true;
      this.broadcast({ t: 'closed', message: "Your opponent didn't connect, so the match was cancelled. Your rating didn't change." });
    }
    this.schedule();
  }

  private dropSeat(seat: Internal): void {
    for (const [token, sid] of this.tokenSeat) if (sid === seat.id) this.tokenSeat.delete(token);
    if (this.state && !this.state.over && this.state.players.some((p) => p.id === seat.id)) {
      removePlayer(this.state, seat.id);
      this.drafts.delete(seat.id);
      this.botAt.delete(seat.id);
      this.system(`${seat.name} left the match.`);
      if (this.state.over) {
        this.broadcastUpdate();
        this.finish(0);
      } else if (this.roundOpen()) {
        this.afterLockChange();
      } else {
        this.broadcastUpdate();
      }
    }
    this.seats = this.seats.filter((s) => s.id !== seat.id);
    if (this.host === seat.id) {
      const next = this.seats.find((s) => !s.isBot && s.connected);
      this.host = next?.id ?? '';
      if (next) this.system(`${next.name} is now the host.`);
    }
    if (!this.seats.some((s) => !s.isBot)) this.seats = [];
    if (!this.seats.some((s) => s.id === this.host)) this.host = this.seats.find((s) => !s.isBot && s.connected)?.id ?? '';
    this.sendLobby();
  }

  private backToLobby(): void {
    this.state = null;
    this.finalMsg = null;
    this.rematch.clear();
    this.lobbyAt = 0;
    for (const s of this.seats) s.ready = s.isBot;
    for (const s of [...this.seats]) {
      if (!s.isBot && !s.connected) this.dropSeat(s);
    }
    this.sendLobby();
  }

  private skipVote(seat: Internal): void {
    if (!this.state || this.state.over || this.ranked) return;
    seat.skip = true;
    const everyone = this.seats.filter((s) => !s.isBot && s.connected).every((s) => s.skip);
    if (everyone) {
      this.system('Everyone voted to skip. Here is a new map.');
      this.startMatch();
    } else {
      this.system(`${seat.name} wants a new map. Type -skip to agree.`);
    }
  }

  private chat(seat: Internal, text: string, connId: string): void {
    const raw = String(text ?? '').trim();
    const now = this.io.now();
    if (now - seat.lastChat < 800) {
      this.io.send(connId, { t: 'error', message: 'You are sending messages too quickly.' });
      return;
    }
    seat.lastChat = now;
    if (raw.toLowerCase() === '-skip') return this.skipVote(seat);
    const clean = cleanChat(raw);
    if (!clean) return;
    const line: ChatLine = { fromId: seat.id, from: seat.name, text: clean };
    this.broadcast({ t: 'chat', line });
  }

  private schedule(): void {
    const times: number[] = [];
    if (this.state && !this.state.over) {
      times.push(Math.max(this.deadline, this.busyUntil));
      for (const at of this.botAt.values()) times.push(Math.max(at, this.busyUntil));
    }
    if (this.lobbyAt) times.push(this.lobbyAt);
    if (this.noShowAt && !this.state) times.push(this.noShowAt);
    for (const s of this.seats) {
      if (s.disconnectedAt !== null && !s.connected && !s.isBot) times.push(s.disconnectedAt + RECONNECT_GRACE_MS);
    }
    this.io.wake(times.length ? Math.min(...times) : null);
  }
}
