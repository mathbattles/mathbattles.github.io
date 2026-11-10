import {
  ME,
  NEXT_ROUND_DELAY_MS,
  ROUND_MS,
  DRAW_STEPS_PER_SEC,
  BOT_LEVELS,
  RuleError,
  Terrain,
  actors,
  allLocked,
  applyAction,
  createMatch,
  createSolo,
  playerById,
  removePlayer,
  resolveRound,
  setLocked,
  simulateShot,
  soloCleared,
  soloHitFriend,
  terrainOf,
  validate,
  type BotLevel,
  type BotMove,
  type ChatLine,
  type Circle,
  type ClientMsg,
  type Dir,
  type Draft,
  type MatchConfig,
  type MatchState,
  type PlayerSetup,
  type Replay,
  type RoundRecord,
  type RoundShot,
  type Seat,
  type ServerMsg,
  type RoomSettings,
  type SoloDef,
} from '@mathbattles/sim';
import type { Stage } from '../render/stage';
import { serverText } from '../i18n';

export type { Draft };

export interface ShotPath {
  xs: ArrayLike<number>;
  ys: ArrayLike<number>;
  steps: number;
}

/** Rebuilds each shot's drawn path from the board as the round fired. */
export function roundPaths(board: { circles: Circle[]; holes: Circle[] }, round: RoundRecord): ShotPath[] {
  const terrain = new Terrain(board.circles, board.holes);
  return round.shots.map((shot) => {
    try {
      const path = simulateShot({
        mode: shot.mode,
        expr: shot.expr,
        from: shot.from,
        angle: shot.angle,
        dir: shot.dir,
        mirrored: shot.mirrored,
        terrain,
        targets: [],
      });
      return { xs: path.xs, ys: path.ys, steps: Math.min(path.steps, shot.steps) };
    } catch {
      return { xs: [], ys: [], steps: 0 };
    }
  });
}

/** How long a round takes to draw, plus the pause after it. */
export function roundMs(round: RoundRecord): number {
  return (round.steps / DRAW_STEPS_PER_SEC) * 1000 + NEXT_ROUND_DELAY_MS;
}

const isValid = (d: Draft | null | undefined, mode: MatchState['config']['mode']) =>
  !!d && !!d.expr.trim() && !validate(d.expr, mode);

/** Everything the game screen needs, however the match is being run. */
export abstract class GameSession {
  abstract state: MatchState;
  /** When the viewer's aiming time ends. */
  deadline: number | null = null;
  /** When the opening countdown ends, for matches that have one. */
  startsAt: number | null = null;
  /** True while a round's shots are drawing. */
  busy = false;
  stage: Stage | null = null;
  showTimer = true;
  chat: ChatLine[] = [];
  /** The draft to put back in the box, after a reconnect or a hand-over. Read once. */
  restoreDraft: Draft | null = null;
  /** On a shared device: the person who should take it next, before anything is shown. */
  handoff: string | null = null;
  /** Practice and campaign fire the moment you press the button: there's nobody to wait for. */
  instantFire = false;
  private listeners = new Set<() => void>();
  onRound?: (round: RoundRecord) => void;
  onOver?: (state: MatchState) => void;
  overNotified = false;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  protected emit(): void {
    this.listeners.forEach((l) => l());
  }
  /** The player whose controls this screen shows. */
  abstract viewerId(): string;
  /** Whether the viewer can type and lock in right now. */
  abstract canAim(): boolean;
  abstract lock(d: Draft): void;
  abstract unlock(): void;
  /** What's typed so far, so a timeout can still fire it. */
  setDraft(_d: Draft): void {}
  /** Takes the device after a hand-over cover. */
  acceptHandoff(): void {}
  /** Goes back to the previous person on a shared device, to change their shot. */
  handBack(): boolean {
    return false;
  }
  canHandBack(): boolean {
    return false;
  }
  isLocked(): boolean {
    return !!this.state && !!playerById(this.state, this.viewerId())?.locked;
  }
  skipVote(): void {}
  sendChat(_text: string): void {}
  attach(stage: Stage): void {
    this.stage = stage;
    stage.sync(this.state);
    this.begin();
  }
  protected begin(): void {}
  dispose(): void {}
  protected notifyOver(): void {
    if (this.state.over && !this.overNotified) {
      this.overNotified = true;
      this.onOver?.(this.state);
    }
    this.emit();
  }
  /** Plays a round that has already been applied to the state. */
  protected async animate(round: RoundRecord, board: { circles: Circle[]; holes: Circle[] }): Promise<void> {
    this.busy = true;
    this.deadline = null;
    this.onRound?.(round);
    this.emit();
    if (this.stage) {
      this.stage.state = this.state;
      await this.stage.playRound(round, roundPaths(board, round));
    }
    this.busy = false;
    this.stage?.sync(this.state);
  }
}

const LOCAL_COUNTDOWN_MS = 3000;

const BOT_BUDGET: Record<string, number> = { easy: 500, normal: 1200, hard: 2500, genius: 5000 };

let botWorker: Worker | null = null;
let botJob = 0;
export function askBot(state: MatchState, playerId: string, level: string, seed: number): Promise<BotMove> {
  botWorker ??= new Worker(new URL('../ai.worker.ts', import.meta.url), { type: 'module' });
  const id = ++botJob;
  const { generations, aimError } = BOT_LEVELS[(level as BotLevel) in BOT_LEVELS ? (level as BotLevel) : 'normal'];
  return new Promise((resolve) => {
    const worker = botWorker!;
    const handler = (e: MessageEvent<{ id: number; move: BotMove }>) => {
      if (e.data.id !== id) return;
      worker.removeEventListener('message', handler);
      resolve(e.data.move);
    };
    worker.addEventListener('message', handler);
    worker.postMessage({ id, state, playerId, generations, aimError, seed, budgetMs: BOT_BUDGET[level] ?? 1200 });
  });
}

/**
 * One device: any mix of people and bots. Everyone aims at once, so people take turns on the
 * device to aim in private (pass and lock), each with their own clock, while bots lock in by
 * themselves. When everyone has locked, all shots fire together.
 */
export class LocalSession extends GameSession {
  state: MatchState;
  private terrain: Terrain;
  private timer = 0;
  private disposed = false;
  private drafts = new Map<string, Draft>();
  /** The person aiming on the device now. */
  private aimer: string;
  private botsThinking = 0;
  private roundId = 0;
  readonly setups: PlayerSetup[];

  constructor(config: MatchConfig, setups: PlayerSetup[], opts: { noTimer?: boolean } = {}) {
    super();
    this.setups = setups;
    this.state = createMatch(config, setups);
    this.terrain = terrainOf(this.state);
    this.showTimer = !opts.noTimer;
    this.aimer = setups.find((s) => !s.isBot)?.id ?? setups[0]!.id;
  }

  private humans(): string[] {
    return actors(this.state).filter((p) => !p.isBot).map((p) => p.id);
  }
  /** More than one person shares this screen, so they hand it over. */
  private shared(): boolean {
    return this.setups.filter((s) => !s.isBot).length > 1;
  }

  canAim(): boolean {
    return !this.busy && !this.state.over && !this.handoff && Date.now() >= (this.startsAt ?? 0)
      && this.humans().includes(this.aimer);
  }
  viewerId(): string {
    return this.aimer;
  }

  protected override begin(): void {
    this.timer = window.setInterval(() => this.tick(), 250);
    this.startsAt = Date.now() + LOCAL_COUNTDOWN_MS;
    this.emit();
    setTimeout(() => this.beginRound(), LOCAL_COUNTDOWN_MS);
  }

  private beginRound(): void {
    if (this.disposed) return;
    if (this.state.over) return this.notifyOver();
    this.roundId++;
    this.drafts.clear();
    const round = this.roundId;
    // Bots think in the background and lock in after a short while.
    for (const p of actors(this.state)) {
      if (!p.isBot) continue;
      this.botsThinking++;
      void this.botRound(p.id, p.botLevel ? String(p.botLevel) : 'normal', round);
    }
    const first = this.humans()[0];
    if (first) this.passTo(first, true);
    else {
      // Everyone here is out: the bots play on while the people watch.
      this.handoff = null;
      this.deadline = null;
      this.emit();
    }
  }

  /** Gives the device to a person. Shared devices show a cover first, so nobody peeks. */
  private passTo(id: string, cover = true): void {
    this.aimer = id;
    this.handoff = this.shared() && cover ? playerById(this.state, id)?.name ?? 'the next player' : null;
    this.restoreDraft = this.drafts.get(id) ?? null;
    this.deadline = !this.handoff && this.showTimer ? Date.now() + ROUND_MS : null;
    this.emit();
  }

  override acceptHandoff(): void {
    if (!this.handoff) return;
    this.handoff = null;
    this.deadline = this.showTimer ? Date.now() + ROUND_MS : null;
    this.emit();
  }

  override canHandBack(): boolean {
    return !this.busy && this.humans().indexOf(this.aimer) > 0;
  }

  override handBack(): boolean {
    // The person before can take the device back to change their shot, until everyone has locked.
    const humans = this.humans();
    const i = humans.indexOf(this.aimer);
    const prev = humans[i - 1];
    if (!prev || this.busy) return false;
    setLocked(this.state, prev, false);
    this.passTo(prev, false);
    this.handoff = null;
    this.deadline = this.showTimer ? Date.now() + ROUND_MS : null;
    this.emit();
    return true;
  }

  private async botRound(id: string, level: string, round: number): Promise<void> {
    const started = performance.now();
    const p = playerById(this.state, id)!;
    const move = await askBot(this.state, id, level, this.state.config.seed + this.state.round * 31 + p.soldierId);
    const wait = 1500 + Math.random() * 2500 - (performance.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.botsThinking--;
    if (this.disposed || this.roundId !== round || this.state.over || this.busy) return;
    this.drafts.set(id, { expr: move.expr, angle: move.angle, dir: move.dir });
    setLocked(this.state, id, true);
    this.maybeFire();
  }

  override setDraft(d: Draft): void {
    if (!this.handoff) this.drafts.set(this.aimer, d);
  }

  lock(d: Draft): void {
    if (!this.canAim()) return;
    if (!d.expr.trim()) throw new RuleError('Type a function first');
    this.drafts.set(this.aimer, d);
    setLocked(this.state, this.aimer, true);
    this.next();
  }

  unlock(): void {
    if (this.busy || this.state.over) return;
    setLocked(this.state, this.aimer, false);
    this.emit();
  }

  /** Moves on to the next person who still needs to aim, or fires. */
  private next(): void {
    if (this.maybeFire()) return;
    const waiting = this.humans().filter((id) => !playerById(this.state, id)!.locked);
    if (waiting.length && this.shared()) this.passTo(waiting[0]!, true);
    else this.emit();
  }

  private maybeFire(): boolean {
    if (this.busy || this.state.over || !allLocked(this.state)) {
      this.emit();
      return false;
    }
    void this.fireRound();
    return true;
  }

  private async fireRound(): Promise<void> {
    this.handoff = null;
    const board = { circles: this.state.circles, holes: this.state.holes.slice() };
    const shots: RoundShot[] = [];
    for (const p of actors(this.state)) {
      const d = this.drafts.get(p.id);
      // Anything valid that was typed fires, locked or not.
      if (isValid(d, this.state.config.mode)) shots.push({ playerId: p.id, expr: d!.expr, angle: d!.angle, dir: d!.dir });
    }
    const round = resolveRound(this.state, shots, this.terrain);
    await this.animate(round, board);
    if (this.disposed) return;
    this.terrain = terrainOf(this.state);
    this.beginRound();
  }

  private tick(): void {
    if (this.busy || this.state.over || this.handoff || !this.deadline || Date.now() <= this.deadline) return;
    if (!this.humans().includes(this.aimer)) {
      this.deadline = null;
      return;
    }
    // Time's up for whoever has the device. What they typed stands; the next person goes.
    const id = this.aimer;
    this.deadline = null;
    const d = this.drafts.get(id);
    if (playerById(this.state, id) && !playerById(this.state, id)!.locked) {
      if (!isValid(d, this.state.config.mode)) this.drafts.delete(id);
      setLocked(this.state, id, true);
    }
    // Bots still thinking get a moment to finish.
    if (this.botsThinking > 0 && !this.shared()) {
      this.emit();
      return;
    }
    this.next();
  }

  override skipVote(): void {
    // All local players agree by definition.
    this.roundId++;
    this.state = createMatch({ ...this.state.config, seed: (Math.random() * 2 ** 31) >>> 0 }, this.setups);
    this.terrain = terrainOf(this.state);
    this.stage?.sync(this.state);
    this.beginRound();
  }
  override dispose(): void {
    this.disposed = true;
    clearInterval(this.timer);
  }
}

export interface SoloOutcome {
  cleared: boolean;
  friendHit: boolean;
  shots: { expr: string; angle?: number }[];
  /** The last round, for messages about how the shot went. */
}

/** Targets that don't shoot back: campaign and practice. */
export class SoloSession extends GameSession {
  state: MatchState;
  private terrain: Terrain;
  shots: { expr: string; angle?: number }[] = [];
  outcome: SoloOutcome | null = null;
  onFinish?: (o: SoloOutcome) => void;

  constructor(private def: SoloDef, private opts: { maxShots?: number; endless?: () => SoloDef } = {}) {
    super();
    this.instantFire = true;
    this.state = createSolo(def);
    this.terrain = terrainOf(this.state);
    this.showTimer = false;
  }
  get maxShots(): number | undefined {
    return this.opts.maxShots;
  }
  canAim(): boolean {
    return !this.busy && !this.state.over && !this.outcome;
  }
  viewerId(): string {
    return ME;
  }
  unlock(): void {}
  lock(d: Draft): void {
    if (!this.canAim()) return;
    if (!d.expr.trim()) throw new RuleError('Type a function first');
    const err = validate(d.expr, this.state.config.mode);
    if (err) throw new RuleError(err.message);
    const board = { circles: this.state.circles, holes: this.state.holes.slice() };
    const round = resolveRound(this.state, [{ playerId: ME, expr: d.expr, angle: d.angle, dir: d.dir }], this.terrain);
    const shot = round.shots[0];
    this.shots.push({ expr: d.expr, ...(this.state.config.mode === 'ode2' && shot ? { angle: shot.angle } : {}) });
    void this.animate(round, board).then(() => {
      const cleared = soloCleared(this.state);
      const friendHit = soloHitFriend(this.state);
      const out = this.opts.maxShots !== undefined && this.shots.length >= this.opts.maxShots;
      if (cleared && this.opts.endless) {
        this.restart(this.opts.endless());
        return;
      }
      if (cleared || friendHit || out || this.state.over) {
        this.outcome = { cleared: cleared && !friendHit, friendHit, shots: this.shots };
        this.onFinish?.(this.outcome);
      }
      this.emit();
    });
  }
  restart(def: SoloDef = this.def): void {
    this.def = def;
    this.state = createSolo(def);
    this.terrain = terrainOf(this.state);
    this.shots = [];
    this.outcome = null;
    this.busy = false;
    this.stage?.sync(this.state);
    this.emit();
  }
}

/** Builds the board as it stood before a given action, by replaying from the start. */
function stateAt(replay: Replay, actionIndex: number): MatchState {
  const state = createMatch(replay.config, replay.setups);
  for (let i = 0; i < actionIndex && i < replay.actions.length && !state.over; i++) applyAction(state, replay.actions[i]!);
  return state;
}

/**
 * Watches a stored match play back through the normal rules, round by round, with
 * play, pause, speed, frame steps, and jumping to any round.
 */
export class ReplaySession extends GameSession {
  state: MatchState;
  /** Index of the next action to play. */
  index = 0;
  playing = true;
  speed = 1;
  /** The player to highlight, or null for the first player. */
  follow: string | null = null;
  /** Bumped on every jump, so a playing loop knows to stop. */
  private generation = 0;
  private stopped = false;
  private looping = false;
  /** Action index of each round, in order. */
  readonly roundStarts: number[];

  constructor(readonly replay: Replay, startRound = 1) {
    super();
    this.state = createMatch(replay.config, replay.setups);
    this.showTimer = false;
    this.roundStarts = replay.actions.map((a, i) => (a.a === 'r' ? i : -1)).filter((i) => i >= 0);
    if (startRound > 1) this.jumpTo(startRound - 1);
  }
  canAim(): boolean {
    return false;
  }
  lock(): void {}
  unlock(): void {}
  viewerId(): string {
    return this.follow ?? this.state.players[0]!.id;
  }
  get totalRounds(): number {
    return this.roundStarts.length;
  }
  /** Rounds started so far, including one being drawn. */
  get roundsDone(): number {
    let n = 0;
    for (const i of this.roundStarts) if (i < this.index) n++;
    return n;
  }
  /** The round on screen: the one drawing, or the next one to play. */
  get roundShown(): number {
    return Math.min(this.totalRounds, this.busy ? this.roundsDone : this.roundsDone + 1);
  }
  get finished(): boolean {
    return this.index >= this.replay.actions.length && !this.busy;
  }
  get progress(): string {
    return `${this.roundShown} / ${this.totalRounds}`;
  }
  protected override begin(): void {
    if (this.stage) {
      this.stage.speed = this.speed;
      this.stage.paused = !this.playing;
    }
    void this.run(900);
  }
  setPlaying(on: boolean): void {
    this.playing = on;
    if (this.stage) this.stage.paused = !on;
    if (on && this.finished) this.seekRound(0);
    else if (on) void this.run(0);
    this.emit();
  }
  setSpeed(s: number): void {
    this.speed = s;
    if (this.stage) this.stage.speed = s;
    this.emit();
  }
  setFollow(id: string | null): void {
    this.follow = id;
    this.emit();
  }
  private jumpTo(roundsPlayed: number): void {
    const r = Math.max(0, Math.min(roundsPlayed, this.totalRounds));
    this.index = r === 0 ? 0 : (this.roundStarts[r - 1] ?? 0) + 1;
    // Leaves come between rounds; play them too, so the board matches.
    while (this.index < this.replay.actions.length && this.replay.actions[this.index]!.a === 'l') this.index++;
    this.state = stateAt(this.replay, this.index);
  }
  /** Shows the board after this many rounds (0 = the start). */
  seekRound(roundsPlayed: number): void {
    this.generation++;
    this.stage?.finishRoundNow();
    this.jumpTo(roundsPlayed);
    this.busy = false;
    this.overNotified = false;
    if (this.stage) this.stage.paused = !this.playing;
    this.stage?.sync(this.state);
    this.emit();
    if (this.playing) void this.run(300);
  }
  /** Back to the start of the round on screen, or the one before if it hasn't started. */
  prevRound(): void {
    this.seekRound(Math.max(0, this.roundsDone - 1));
  }
  /** Finishes the round being drawn, or plays the next one. */
  nextRound(): void {
    if (this.busy) {
      if (this.stage) this.stage.paused = false;
      this.stage?.finishRoundNow();
      return;
    }
    if (this.index >= this.replay.actions.length) return;
    if (this.stage) this.stage.paused = false;
    const gen = this.generation;
    void this.playNext(gen).then(() => {
      if (this.stage) this.stage.paused = !this.playing;
      if (this.playing) void this.run(0);
    });
  }
  /** Moves the round being drawn a frame forward or back. */
  stepFrame(dir: 1 | -1): void {
    if (!this.busy || !this.stage) return;
    this.setPlaying(false);
    this.stage.scrubRound(dir * 50);
  }
  private async playNext(gen: number): Promise<boolean> {
    if (this.index >= this.replay.actions.length) return false;
    const action = this.replay.actions[this.index++]!;
    try {
      if (action.a === 'r') {
        const board = { circles: this.state.circles, holes: this.state.holes.slice() };
        applyAction(this.state, action);
        const log = this.state.log[this.state.log.length - 1];
        if (log?.type === 'round') {
          if (this.stage) this.stage.speed = this.speed;
          await this.animate(log.round, board);
        }
      } else {
        applyAction(this.state, action);
        this.stage?.sync(this.state);
      }
    } catch {
      this.index = this.replay.actions.length; // A hand-edited replay can contain illegal moves.
    }
    if (gen !== this.generation) return false;
    this.emit();
    if (this.index >= this.replay.actions.length || this.state.over) this.notifyOver();
    return true;
  }
  private async run(delay: number): Promise<void> {
    if (this.looping) return;
    this.looping = true;
    const gen = this.generation;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    while (!this.stopped && this.playing && gen === this.generation && this.index < this.replay.actions.length) {
      if (!(await this.playNext(gen))) break;
    }
    this.looping = false;
    if (gen !== this.generation && this.playing && !this.stopped) void this.run(0);
    this.emit();
  }
  override dispose(): void {
    this.stopped = true;
  }
}

export type NetStatus = 'connecting' | 'lobby' | 'playing' | 'closed';

/** A match run by the server. The server's results are final; this only displays them. */
export class NetSession extends GameSession {
  state: MatchState = null as unknown as MatchState;
  status: NetStatus = 'connecting';
  you = '';
  code = '';
  host = '';
  seats: Seat[] = [];
  settings: RoomSettings | null = null;
  ranked = false;
  /** How many people are watching the room. */
  spectators = 0;
  error = '';
  ratingDelta: number | undefined;
  /** The short replay id the server saved when the match ended. */
  replayId: string | undefined;
  private ws: WebSocket | null = null;
  private clockSkew = 0;
  private queue: Promise<void> = Promise.resolve();
  private retry = 0;
  private closed = false;
  private pingTimer = 0;
  private errorTimer = 0;
  private draftTimer = 0;
  /** The exact player list the server used, for building replay links. */
  setups: PlayerSetup[] = [];
  muted = new Set<string>();

  constructor(private url: string, private joinMsg: Extract<ClientMsg, { t: 'join' }>) {
    super();
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify(this.joinMsg));
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping' }), 20_000);
    };
    ws.onmessage = (e) => this.handle(JSON.parse(e.data as string) as ServerMsg);
    ws.onclose = (e) => {
      clearInterval(this.pingTimer);
      if (this.closed) return;
      // The server refused this room for good, so trying again can't help.
      if (e.code >= 4000) {
        this.closed = true;
        this.status = 'closed';
        this.error ||= serverText("This room isn't available.");
        this.emit();
        return;
      }
      this.retry++;
      if (this.retry > 6) {
        this.status = 'closed';
        this.error = serverText("Can't reach the game server. Check your connection and rejoin.");
        this.emit();
        return;
      }
      this.error = serverText('Connection lost. Reconnecting.');
      this.emit();
      setTimeout(() => this.connect(), 800 * this.retry);
    };
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private showError(message: string): void {
    this.error = serverText(message);
    clearTimeout(this.errorTimer);
    this.errorTimer = window.setTimeout(() => {
      this.error = '';
      this.emit();
    }, 5000);
  }

  /** Runs in order. One failure must not stop every later update. */
  private enqueue(task: () => void | Promise<void>): void {
    this.queue = this.queue.then(task).catch((e) => console.error('Match update failed', e));
  }

  private toLocal(serverTime: number): number {
    return serverTime + this.clockSkew;
  }

  private handle(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome':
        this.you = msg.you;
        this.code = msg.code;
        break;
      case 'lobby':
        this.host = msg.host;
        this.seats = msg.seats;
        this.settings = msg.settings;
        this.ranked = msg.ranked;
        this.spectators = msg.spectators ?? 0;
        // Seat changes can arrive during a match. Only the server ending it returns everyone here.
        if (!msg.inMatch && !(msg.ranked && this.state?.over)) {
          this.status = 'lobby';
          this.state = null as unknown as MatchState;
          this.overNotified = false;
          this.ratingDelta = undefined;
          this.replayId = undefined;
        }
        break;
      case 'match':
        this.clockSkew = Date.now() - msg.serverNow;
        this.status = 'playing';
        this.state = msg.state;
        this.setups = msg.setups;
        this.deadline = this.toLocal(msg.deadline);
        this.startsAt = this.opening;
        this.overNotified = false;
        this.replayId = undefined;
        this.restoreDraft = msg.draft ?? null;
        this.chat = this.chat.slice(-40);
        this.stage?.sync(msg.state);
        break;
      case 'update':
        this.clockSkew = Date.now() - msg.serverNow;
        this.enqueue(() => {
          this.deadline = this.toLocal(msg.deadline);
          this.state = msg.state;
          this.stage?.sync(this.state);
          this.emit();
        });
        break;
      case 'round': {
        this.clockSkew = Date.now() - msg.serverNow;
        const round = msg.round;
        const next = msg.state;
        const deadline = this.toLocal(msg.deadline);
        this.enqueue(async () => {
          if (this.closed) return;
          // Read here, not on arrival, so queued rounds see the terrain left by earlier ones.
          const before = this.state;
          const board = { circles: before.circles, holes: before.holes.slice() };
          this.state = next;
          await this.animate(round, board);
          this.deadline = deadline;
          this.emit();
        });
        break;
      }
      case 'over':
        this.ratingDelta = msg.ratingDelta;
        this.replayId = msg.replayId;
        this.setups = msg.setups;
        this.enqueue(() => {
          this.state = msg.state;
          this.stage?.sync(msg.state);
          this.notifyOver();
        });
        break;
      case 'chat':
        this.chat = [...this.chat, msg.line].slice(-60);
        break;
      case 'error':
        this.showError(msg.message);
        break;
      case 'closed':
        this.closed = true;
        this.status = 'closed';
        this.error = serverText(msg.message);
        break;
      case 'pong':
        break;
    }
    this.emit();
  }

  /** True during the countdown before the round's clock starts, or while shots land. */
  get waitingToStart(): boolean {
    return this.deadline !== null && Date.now() < this.deadline - ROUND_MS;
  }
  private get opening(): number | null {
    return this.state && this.state.log.length === 0 && this.deadline !== null ? this.deadline - ROUND_MS : null;
  }
  canAim(): boolean {
    if (this.busy || !this.state || this.state.over || this.waitingToStart) return false;
    const me = playerById(this.state, this.you);
    return !!me && me.connected && !!this.state.soldiers[me.soldierId]?.alive;
  }
  viewerId(): string {
    return this.you;
  }
  override setDraft(d: Draft): void {
    clearTimeout(this.draftTimer);
    this.draftTimer = window.setTimeout(() => this.send({ t: 'draft', expr: d.expr, angle: d.angle, dir: d.dir }), 300);
  }
  lock(d: Draft): void {
    clearTimeout(this.draftTimer);
    if (!d.expr.trim()) throw new RuleError('Type a function first');
    this.send({ t: 'lock', expr: d.expr, angle: d.angle, dir: d.dir });
  }
  unlock(): void {
    this.send({ t: 'unlock' });
  }
  override skipVote(): void {
    this.send({ t: 'skipVote' });
  }
  override sendChat(text: string): void {
    this.send({ t: 'chat', text });
  }
  override attach(stage: Stage): void {
    this.stage = stage;
    if (this.state) stage.sync(this.state);
  }
  override dispose(): void {
    // Say so on purpose, so the seat frees up at once. A page reload doesn't send this, which
    // leaves the usual window to reconnect.
    if (!this.closed) this.send({ t: 'leave' });
    this.closed = true;
    clearInterval(this.pingTimer);
    clearTimeout(this.errorTimer);
    clearTimeout(this.draftTimer);
    this.ws?.close();
  }
}

export type { Dir };
export { RuleError, removePlayer };
