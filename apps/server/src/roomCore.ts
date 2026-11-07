import {
  BOT_LEVELS,
  BOT_NAMES,
  COSMETICS,
  DEFAULT_ROOM_SETTINGS,
  DRAW_STEPS_PER_SEC,
  MAX_PLAYERS,
  NEXT_TURN_DELAY_MS,
  ParseError,
  RECONNECT_GRACE_MS,
  RuleError,
  START_DELAY_MS,
  TURN_MS,
  armMissile,
  chooseMove,
  createMatch,
  currentPlayer,
  fire,
  removePlayer,
  skipTurn,
  useTeleport,
  type AbilityId,
  type BotLevel,
  type ChatLine,
  type ClientMsg,
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
  onRankedOver?(winnerSeat: string, loserSeat: string): Promise<number | undefined>;
  /** Runs once when a match ends, after any rating change is known. */
  onMatchOver?(state: MatchState, setups: PlayerSetup[], ratingDelta: number | undefined): void;
}

interface Internal extends Seat {
  conns: Set<string>;
  disconnectedAt: number | null;
  skip: boolean;
  lastChat: number;
}

const RANKED_SETTINGS: RoomSettings = { kind: 'teams', mode: 'fn', abilities: false, soldiers: 1, showFunctions: false };
const MAX_SEATS = MAX_PLAYERS;
const LOBBY_RETURN_MS = 12_000;
const RANKED_NO_SHOW_MS = 30_000;
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
  private tokenSeat = new Map<string, string>();
  private deadline = 0;
  private busyUntil = 0;
  private botAt = 0;
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
  }

  private publicSeat(s: Internal): Seat {
    return { id: s.id, name: s.name, team: s.team, ready: s.ready, isBot: s.isBot, connected: s.connected, ability: s.ability, hat: s.hat };
  }

  private sendLobby(to?: string): void {
    const msg: ServerMsg = { t: 'lobby', host: this.host, seats: this.seats.map((s) => this.publicSeat(s)), settings: this.settings, ranked: this.ranked, inMatch: !!this.state };
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
    if (this.connSeat.has(connId)) return;
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
        ability: msg.ability === 'missile' ? 'missile' : 'teleport',
        hat: typeof msg.hat === 'string' && HAT_VALUES.has(msg.hat) ? msg.hat : undefined,
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
        case 'fire':
          this.onFire(seat, msg);
          return;
        case 'teleport':
          if (!this.canAct(seat)) throw new RuleError("It isn't your turn");
          useTeleport(this.state!, seat.id, Number(msg.x), Number(msg.y));
          this.broadcastUpdate();
          return;
        case 'missile':
          if (!this.canAct(seat)) throw new RuleError("It isn't your turn");
          armMissile(this.state!, seat.id);
          this.broadcastUpdate();
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
    if (p.mode === 'fn' || p.mode === 'ode1' || p.mode === 'ode2') this.settings.mode = p.mode as ShotMode;
    if (typeof p.abilities === 'boolean') this.settings.abilities = p.abilities;
    if (typeof p.showFunctions === 'boolean') this.settings.showFunctions = p.showFunctions;
    if (typeof p.soldiers === 'number') this.settings.soldiers = Math.max(1, Math.min(4, Math.trunc(p.soldiers) || 1));
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
      ability: this.io.random() < 0.5 ? 'teleport' : 'missile',
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
      .map((s) => ({ id: s.id, name: s.name, team: s.team, ability: s.ability as AbilityId, isBot: s.isBot, botLevel: s.isBot ? s.id.split(':')[1] : undefined }));
    this.state = createMatch(
      { kind: this.settings.kind, mode: this.settings.mode, abilities: this.settings.abilities, soldiers: this.settings.soldiers, seed },
      setups,
    );
    // The exact list used here, so replay links can rebuild this same match.
    this.setups = setups;
    this.noShowAt = 0;
    for (const s of this.seats) s.skip = s.isBot;
    this.deadline = this.io.now() + START_DELAY_MS + TURN_MS;
    this.busyUntil = this.io.now() + START_DELAY_MS;
    this.botAt = 0;
    this.lobbyAt = 0;
    this.planBot();
    this.broadcastMatch();
    this.sendLobby();
    this.schedule();
  }

  private sendMatchTo(connId: string): void {
    if (this.state) this.io.send(connId, { t: 'match', state: this.state, setups: this.setups, deadline: this.deadline, serverNow: this.io.now() });
  }
  private broadcastMatch(): void {
    if (this.state) this.broadcast({ t: 'match', state: this.state, setups: this.setups, deadline: this.deadline, serverNow: this.io.now() });
  }
  private broadcastUpdate(): void {
    if (this.state) this.broadcast({ t: 'update', state: this.state, deadline: this.deadline, serverNow: this.io.now() });
  }

  private canAct(seat: Internal): boolean {
    return !!this.state && !this.state.over && currentPlayer(this.state).id === seat.id && this.io.now() >= this.busyUntil;
  }

  private onFire(seat: Internal, msg: Extract<ClientMsg, { t: 'fire' }>): void {
    if (!this.state || this.state.over) throw new RuleError('The match is over');
    if (currentPlayer(this.state).id !== seat.id) throw new RuleError("It isn't your turn");
    if (this.io.now() < this.busyUntil) throw new RuleError('Wait for the last shot to land');
    this.doFire(seat.id, String(msg.expr ?? ''), typeof msg.angle === 'number' ? msg.angle : undefined, msg.dir === -1 ? -1 : 1);
  }

  private doFire(playerId: string, expr: string, angle: number | undefined, dir: 1 | -1): void {
    const state = this.state!;
    const { record } = fire(state, playerId, { expr, angle, dir });
    const animation = (record.steps / DRAW_STEPS_PER_SEC) * 1000 + NEXT_TURN_DELAY_MS;
    this.busyUntil = this.io.now() + animation;
    this.deadline = this.busyUntil + TURN_MS;
    this.botAt = 0;
    this.broadcast({ t: 'shot', shot: record, state, deadline: this.deadline, serverNow: this.io.now() });
    this.afterTurn(animation);
  }

  private afterTurn(delay: number): void {
    const state = this.state!;
    if (state.over) {
      this.finish(delay);
      return;
    }
    this.planBot();
    this.schedule();
  }

  private finish(delay: number): void {
    const state = this.state!;
    // A ranked room is one match only: it stays on the result and can't start again.
    this.lobbyAt = this.ranked ? 0 : this.io.now() + delay + LOBBY_RETURN_MS;
    this.botAt = 0;
    const setups = this.setups;
    const send = (ratingDelta?: number) => {
      this.finalMsg = { t: 'over', state, setups, ratingDelta };
      this.broadcast(this.finalMsg);
      this.io.onMatchOver?.(state, setups, ratingDelta);
    };
    if (this.ranked && this.io.onRankedOver && state.winner !== null) {
      const winner = state.players.find((p) => p.team === state.winner);
      const loser = state.players.find((p) => p.team !== state.winner);
      if (winner && loser) {
        void this.io.onRankedOver(winner.id, loser.id).then(send, () => send());
        this.schedule();
        return;
      }
    }
    send();
    this.schedule();
  }

  private finalMsg: ServerMsg | null = null;

  private planBot(): void {
    const state = this.state!;
    const cur = currentPlayer(state);
    this.botAt = cur.isBot ? Math.max(this.busyUntil, this.io.now()) + 900 : 0;
  }

  private runBot(): void {
    const state = this.state!;
    const cur = currentPlayer(state);
    this.botAt = 0;
    if (!cur.isBot) return;
    const lv = (cur.botLevel ?? 'normal') as BotLevel;
    const def = BOT_LEVELS[lv] ?? BOT_LEVELS.normal;
    const move = chooseMove(state, {
      generations: def.generations,
      aimError: def.aimError,
      seed: state.config.seed + state.turnNumber,
      maxEvals: this.io.botMaxEvals,
    });
    this.doFire(cur.id, move.expr, move.angle, move.dir);
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
    if (this.state && !this.state.over) {
      if (this.botAt && now >= this.botAt) {
        this.runBot();
      } else if (now >= this.deadline) {
        skipTurn(this.state);
        this.busyUntil = now;
        this.deadline = now + TURN_MS;
        if (this.state.over) {
          this.broadcastUpdate();
          this.finish(0);
        } else {
          this.planBot();
          this.broadcastUpdate();
        }
      }
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
      const wasTurn = currentPlayer(this.state).id === seat.id;
      removePlayer(this.state, seat.id);
      this.system(`${seat.name} left the match.`);
      if (this.state.over) {
        this.broadcastUpdate();
        this.finish(0);
      } else {
        if (wasTurn) {
          this.busyUntil = this.io.now();
          this.deadline = this.io.now() + TURN_MS;
          this.planBot();
        }
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
      times.push(this.deadline);
      if (this.botAt) times.push(this.botAt);
    }
    if (this.lobbyAt) times.push(this.lobbyAt);
    if (this.noShowAt && !this.state) times.push(this.noShowAt);
    for (const s of this.seats) {
      if (s.disconnectedAt !== null && !s.connected && !s.isBot) times.push(s.disconnectedAt + RECONNECT_GRACE_MS);
    }
    this.io.wake(times.length ? Math.min(...times) : null);
  }
}
