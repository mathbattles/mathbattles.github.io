import {
  ME,
  NEXT_TURN_DELAY_MS,
  TURN_MS,
  DRAW_STEPS_PER_SEC,
  BOT_LEVELS,
  RuleError,
  Terrain,
  applyAction,
  armMissile,
  createMatch,
  createSolo,
  currentPlayer,
  fire,
  removePlayer,
  simulateShot,
  skipTurn,
  soloCleared,
  soloHitFriend,
  soloNext,
  terrainOf,
  useTeleport,
  type BotLevel,
  type BotMove,
  type ChatLine,
  type ClientMsg,
  type Dir,
  type MatchConfig,
  type MatchState,
  type PlayerSetup,
  type Replay,
  type ReplayAction,
  type Seat,
  type ServerMsg,
  type RoomSettings,
  type ShotRecord,
  type SoloDef,
} from '@mathbattles/sim';
import type { Stage } from '../render/stage';

export interface FireArgs {
  expr: string;
  angle?: number;
  dir?: Dir;
}

/** Everything the game screen needs, however the match is being run. */
export abstract class GameSession {
  abstract state: MatchState;
  deadline: number | null = null;
  /** When the opening countdown ends, for matches that have one. */
  startsAt: number | null = null;
  busy = false;
  stage: Stage | null = null;
  preview = false;
  showTimer = true;
  chat: ChatLine[] = [];
  private listeners = new Set<() => void>();
  onShot?: (record: ShotRecord) => void;
  onOver?: (state: MatchState) => void;
  overNotified = false;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  protected emit(): void {
    this.listeners.forEach((l) => l());
  }
  /** Whether someone at this screen controls the current player. */
  abstract canAct(): boolean;
  abstract viewerId(): string;
  abstract fire(args: FireArgs): void;
  abstract teleport(x: number, y: number): void;
  abstract missile(): void;
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
}

const LOCAL_COUNTDOWN_MS = 3000;

const BOT_BUDGET: Record<string, number> = { easy: 500, normal: 1200, hard: 2500, genius: 5000 };

let botWorker: Worker | null = null;
let botJob = 0;
function askBot(state: MatchState, level: string, seed: number): Promise<BotMove> {
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
    worker.postMessage({ id, state, generations, aimError, seed, budgetMs: BOT_BUDGET[level] ?? 1200 });
  });
}

/** One device: any mix of people sharing the keyboard and bots. */
export class LocalSession extends GameSession {
  state: MatchState;
  private terrain: Terrain;
  private timer = 0;
  private lastHuman: string;
  private disposed = false;
  readonly setups: PlayerSetup[];

  constructor(config: MatchConfig, setups: PlayerSetup[], opts: { preview?: boolean; noTimer?: boolean } = {}) {
    super();
    this.setups = setups;
    this.state = createMatch(config, setups);
    this.terrain = terrainOf(this.state);
    this.preview = !!opts.preview;
    this.showTimer = !opts.noTimer;
    this.lastHuman = setups.find((s) => !s.isBot)?.id ?? setups[0]!.id;
  }

  canAct(): boolean {
    return !this.busy && !this.state.over && !currentPlayer(this.state).isBot && Date.now() >= (this.startsAt ?? 0);
  }
  viewerId(): string {
    const cur = currentPlayer(this.state);
    if (!cur.isBot) this.lastHuman = cur.id;
    return this.lastHuman;
  }

  protected override begin(): void {
    this.timer = window.setInterval(() => this.tick(), 250);
    this.startsAt = Date.now() + LOCAL_COUNTDOWN_MS;
    this.emit();
    setTimeout(() => {
      this.beginTurn();
    }, LOCAL_COUNTDOWN_MS);
  }

  private beginTurn(): void {
    if (this.disposed) return;
    if (this.state.over) return this.notifyOver();
    const cur = currentPlayer(this.state);
    this.deadline = this.showTimer ? Date.now() + TURN_MS : null;
    this.emit();
    if (cur.isBot) void this.botTurn(cur.botLevel ? String(cur.botLevel) : 'normal');
  }

  private async botTurn(level: string): Promise<void> {
    const turn = this.state.turnNumber;
    const started = performance.now();
    const move = await askBot(this.state, level, this.state.config.seed + turn);
    const wait = 900 - (performance.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (this.disposed || this.state.turnNumber !== turn || this.state.over) return;
    this.fire(move);
  }

  private tick(): void {
    if (this.deadline && !this.busy && Date.now() > this.deadline && !this.state.over) {
      skipTurn(this.state);
      this.stage?.sync(this.state);
      this.beginTurn();
    }
  }

  fire(args: FireArgs): void {
    if (this.busy) return;
    const cur = currentPlayer(this.state).id;
    const { record, result } = fire(this.state, cur, args, this.terrain);
    this.busy = true;
    this.deadline = null;
    this.onShot?.(record);
    this.emit();
    const done = () => {
      this.busy = false;
      this.stage?.sync(this.state);
      this.beginTurn();
    };
    if (this.stage) void this.stage.playShot(record, { xs: result.xs, ys: result.ys, steps: result.steps }).then(done);
    else done();
    if (this.stage) this.stage.state = this.state;
  }

  teleport(x: number, y: number): void {
    useTeleport(this.state, currentPlayer(this.state).id, x, y, this.terrain);
    this.stage?.sync(this.state);
    this.emit();
  }
  missile(): void {
    armMissile(this.state, currentPlayer(this.state).id);
    this.emit();
  }
  override skipVote(): void {
    // All local players agree by definition.
    this.state = createMatch({ ...this.state.config, seed: (Math.random() * 2 ** 31) >>> 0 }, this.setups);
    this.terrain = terrainOf(this.state);
    this.stage?.sync(this.state);
    this.beginTurn();
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
}

/** Targets that don't shoot back: campaign, practice, and the Daily Challenge. */
export class SoloSession extends GameSession {
  state: MatchState;
  private terrain: Terrain;
  shots: { expr: string; angle?: number }[] = [];
  outcome: SoloOutcome | null = null;
  onFinish?: (o: SoloOutcome) => void;

  constructor(private def: SoloDef, private opts: { maxShots?: number; preview?: boolean; endless?: () => SoloDef } = {}) {
    super();
    this.state = createSolo(def);
    this.terrain = terrainOf(this.state);
    this.preview = !!opts.preview;
    this.showTimer = false;
  }
  get maxShots(): number | undefined {
    return this.opts.maxShots;
  }
  canAct(): boolean {
    return !this.busy && !this.state.over && !this.outcome;
  }
  viewerId(): string {
    return ME;
  }
  fire(args: FireArgs): void {
    if (this.busy) return;
    const { record, result } = fire(this.state, ME, args, this.terrain);
    this.shots.push({ expr: args.expr, ...(this.state.config.mode === 'ode2' ? { angle: record.angle } : {}) });
    soloNext(this.state);
    this.busy = true;
    this.onShot?.(record);
    this.emit();
    const done = () => {
      this.busy = false;
      this.stage?.sync(this.state);
      const cleared = soloCleared(this.state);
      const friendHit = soloHitFriend(this.state);
      const out = this.opts.maxShots !== undefined && this.shots.length >= this.opts.maxShots;
      if (cleared && this.opts.endless) {
        this.restart(this.opts.endless());
        return;
      }
      if (cleared || friendHit || out) {
        this.outcome = { cleared: cleared && !friendHit, friendHit, shots: this.shots };
        this.onFinish?.(this.outcome);
      }
      this.emit();
    };
    if (this.stage) {
      this.stage.state = this.state;
      void this.stage.playShot(record, { xs: result.xs, ys: result.ys, steps: result.steps }).then(done);
    } else done();
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
  teleport(): void {}
  missile(): void {}
}

/** Watches a stored match play back through the normal rules. */
export class ReplaySession extends GameSession {
  state: MatchState;
  private terrain: Terrain;
  private index = 0;
  private stopped = false;

  constructor(private replay: Replay) {
    super();
    this.state = createMatch(replay.config, replay.setups);
    this.terrain = terrainOf(this.state);
    this.showTimer = false;
  }
  canAct(): boolean {
    return false;
  }
  viewerId(): string {
    return this.state.players[0]!.id;
  }
  fire(): void {}
  teleport(): void {}
  missile(): void {}
  get progress(): string {
    return `Action ${Math.min(this.index, this.replay.actions.length)} of ${this.replay.actions.length}`;
  }
  protected override begin(): void {
    void this.run();
  }
  private async run(): Promise<void> {
    await new Promise((r) => setTimeout(r, 900));
    while (!this.stopped && this.index < this.replay.actions.length) {
      const action: ReplayAction = this.replay.actions[this.index++]!;
      try {
        if (action.a === 'f') {
          const { record, result } = fire(this.state, action.p, { expr: action.e, angle: action.g, dir: action.d }, this.terrain);
          this.busy = true;
          this.emit();
          if (this.stage) {
            this.stage.state = this.state;
            await this.stage.playShot(record, { xs: result.xs, ys: result.ys, steps: result.steps });
          }
          this.busy = false;
        } else {
          applyAction(this.state, action);
          this.terrain = terrainOf(this.state);
        }
      } catch {
        break; // A hand-edited link can contain illegal moves; stop at the first one.
      }
      this.stage?.sync(this.state);
      this.emit();
    }
    this.notifyOver();
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
  error = '';
  ratingDelta: number | undefined;
  private ws: WebSocket | null = null;
  private clockSkew = 0;
  private queue: Promise<void> = Promise.resolve();
  private retry = 0;
  private closed = false;
  private pingTimer = 0;
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
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.closed) return;
      this.retry++;
      if (this.retry > 6) {
        this.status = 'closed';
        this.error = "Can't reach the game server. Check your connection and rejoin.";
        this.emit();
        return;
      }
      this.error = 'Connection lost. Reconnecting.';
      this.emit();
      setTimeout(() => this.connect(), 800 * this.retry);
    };
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private toLocal(serverTime: number): number {
    return serverTime + this.clockSkew;
  }

  private handle(msg: ServerMsg): void {
    if (msg.t !== 'error' && msg.t !== 'pong') this.error = '';
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
        // Seat changes can arrive during a match. Only the server ending it returns everyone here.
        if (!msg.inMatch && !(msg.ranked && this.state?.over)) {
          this.status = 'lobby';
          this.state = null as unknown as MatchState;
          this.overNotified = false;
          this.ratingDelta = undefined;
        }
        break;
      case 'match':
        this.clockSkew = Date.now() - msg.serverNow;
        this.status = 'playing';
        this.state = msg.state;
        this.deadline = this.toLocal(msg.deadline);
        this.startsAt = this.opening;
        this.overNotified = false;
        this.chat = this.chat.slice(-40);
        this.stage?.sync(msg.state);
        break;
      case 'update':
        this.clockSkew = Date.now() - msg.serverNow;
        this.deadline = this.toLocal(msg.deadline);
        this.state = msg.state;
        this.queue = this.queue.then(() => {
          if (this.state) this.stage?.sync(this.state);
        });
        break;
      case 'shot': {
        this.clockSkew = Date.now() - msg.serverNow;
        const before = this.state;
        const shot = msg.shot;
        const next = msg.state;
        const deadline = this.toLocal(msg.deadline);
        this.queue = this.queue.then(async () => {
          if (this.closed) return;
          this.busy = true;
          this.deadline = deadline;
          this.state = next;
          this.onShot?.(shot);
          this.emit();
          const path = simulateShot({
            mode: shot.mode,
            expr: shot.expr,
            from: shot.from,
            angle: shot.angle,
            dir: shot.dir,
            mirrored: shot.mirrored,
            terrain: new Terrain(before.circles, before.holes),
            targets: [],
          });
          const steps = Math.min(path.steps, shot.steps);
          if (this.stage) {
            this.stage.state = next;
            await this.stage.playShot(shot, { xs: path.xs, ys: path.ys, steps });
          }
          this.busy = false;
          this.stage?.sync(this.state);
          this.emit();
        });
        break;
      }
      case 'over':
        this.ratingDelta = msg.ratingDelta;
        this.queue = this.queue.then(() => {
          this.state = msg.state;
          this.stage?.sync(msg.state);
          this.notifyOver();
        });
        break;
      case 'chat':
        this.chat = [...this.chat, msg.line].slice(-60);
        break;
      case 'error':
        this.error = msg.message;
        break;
      case 'pong':
        break;
    }
    this.emit();
  }

  /** How long the server waits for the shot animation before the next turn starts. */
  static animationMs(steps: number): number {
    return (steps / DRAW_STEPS_PER_SEC) * 1000 + NEXT_TURN_DELAY_MS;
  }

  /** True during the countdown before a turn's clock starts. */
  get waitingToStart(): boolean {
    return this.deadline !== null && Date.now() < this.deadline - TURN_MS;
  }
  private get opening(): number | null {
    return this.state && this.state.log.length === 0 && this.deadline !== null ? this.deadline - TURN_MS : null;
  }
  canAct(): boolean {
    return !this.busy && !!this.state && !this.state.over && !this.waitingToStart && currentPlayer(this.state).id === this.you;
  }
  viewerId(): string {
    return this.you;
  }
  fire(args: FireArgs): void {
    this.send({ t: 'fire', expr: args.expr, angle: args.angle, dir: args.dir });
  }
  teleport(x: number, y: number): void {
    this.send({ t: 'teleport', x, y });
  }
  missile(): void {
    this.send({ t: 'missile' });
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
    this.closed = true;
    clearInterval(this.pingTimer);
    this.ws?.close();
  }
}

export { RuleError, removePlayer };
