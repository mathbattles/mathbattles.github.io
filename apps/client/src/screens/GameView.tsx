import { FunctionPicker, MathKeys, useMathKeys } from './MathKeys';
import {
  ParseError,
  RuleError,
  shotMoment,
  shotsOf,
  Terrain,
  currentPlayer,
  currentSoldier,
  isMirrored,
  isOnWinningSide,
  simulateShot,
  validate,
  type Dir,
  type MatchState,
  type ShotRecord,
} from '@mathbattles/sim';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { GameSession } from '../game/session';
import { Stage } from '../render/stage';
import { cosmeticValue, look, noteKillExpression, profile } from '../store';
import { exprToTex, modeLabel, sound } from '../util';

const PREVIEW_FRACTION = 0.18;

export function winnerText(state: MatchState, viewer?: string): string {
  if (state.winner === null) return 'Draw: nobody is left standing';
  if (viewer && state.players.some((p) => p.id === viewer)) {
    return isOnWinningSide(state, viewer) ? 'You win' : 'You lose';
  }
  if (state.config.kind === 'teams') return state.winner === 1 ? 'Blue team wins' : 'Red team wins';
  return `${state.players.find((p) => p.id === state.winner)?.name ?? 'Someone'} wins`;
}

export function Tex({ expr, prefix }: { expr: string; prefix: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    void import('katex').then(async ({ default: katex }) => {
      await import('katex/dist/katex.min.css');
      if (!live || !ref.current) return;
      katex.render(`${prefix.replaceAll("'", "'")} ${exprToTex(expr)}`, ref.current, { throwOnError: false, trust: false, strict: false });
    });
    return () => {
      live = false;
    };
  }, [expr, prefix]);
  return <div class="preview" ref={ref} aria-hidden="true" />;
}

/** Every shot so far. Choosing one shows the board at that moment, like a chess move list. */
function ShotHistory(props: {
  shots: ShotRecord[];
  state: MatchState;
  viewing: number | null;
  onView: (index: number | null) => void;
  canSee: (shot: ShotRecord) => boolean;
}) {
  const { shots, viewing } = props;
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    if (viewing === null) el.scrollTop = el.scrollHeight;
    else el.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  }, [shots.length, viewing]);
  const nameOf = (id: string) => props.state.players.find((p) => p.id === id);
  const last = shots.length - 1;
  const at = viewing ?? last;
  return (
    <div class="mini history">
      <h3>Shot history</h3>
      {shots.length === 0 ? (
        <p class="muted small-note" style={{ margin: 0 }}>Shots appear here as they're fired.</p>
      ) : (
        <>
          <ol class="shots" ref={list} tabIndex={0} aria-label="Shots in this match">
            {shots.map((shot, i) => {
              const owner = nameOf(shot.playerId);
              const hits = shot.hits.length;
              return (
                <li class={viewing === i ? 'current' : ''}>
                  <button class="shot" aria-current={viewing === i ? 'true' : undefined} onClick={() => props.onView(i)}>
                    <span class="num">{i + 1}.</span>
                    <span class="body">
                      <span class={`team-${owner?.team ?? 1} shooter`}>{owner?.name ?? 'Player'}</span>
                      <code>{props.canSee(shot) ? shot.expr : 'Hidden until the match ends'}</code>
                      {hits > 0 && <span class="hits">{hits === 1 ? '1 hit' : `${hits} hits`}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div class="row history-nav">
            <button class="small" aria-label="Previous shot" disabled={at <= 0 && viewing !== null} onClick={() => props.onView(Math.max(0, at - (viewing === null ? 0 : 1)))}>Back</button>
            <button class="small" aria-label="Next shot" disabled={viewing === null} onClick={() => props.onView(viewing !== null && viewing < last ? viewing + 1 : null)}>Next</button>
            <button class={`small ${viewing === null ? 'on' : ''}`} disabled={viewing === null} onClick={() => props.onView(null)}>Live</button>
          </div>
        </>
      )}
    </div>
  );
}

export function GameView(props: {
  session: GameSession;
  coach?: string | null;
  header?: ComponentChildren;
  result?: ComponentChildren;
  extraSide?: ComponentChildren;
  soloInfo?: string;
  /** A passing message that must not get in the way of playing. */
  notice?: string;
  /** Online rooms can keep other players' functions private until the match ends. */
  hideOthersShots?: boolean;
  /** The room screen owns online sessions, which outlive one match. */
  keepSession?: boolean;
  /** Watching someone else's match: no function box. */
  spectator?: boolean;
}) {
  const { session } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const keys = useMathKeys();
  const [, force] = useState(0);
  const [expr, setExpr] = useState('');
  const [angle, setAngle] = useState(0);
  const [dir, setDir] = useState<Dir>(1);
  const [error, setError] = useState('');
  const [chat, setChat] = useState('');
  const [knockout, setKnockout] = useState(false);
  const [turnSlam, setTurnSlam] = useState(0);
  const [celebrated, setCelebrated] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const chatBox = useRef<HTMLDivElement>(null);
  const lastTurn = useRef(session.state.turnNumber);

  const state = session.state;
  const canAct = session.canAct();
  const mode = state.config.mode;
  const viewer = session.viewerId();

  useEffect(() => {
    const stage = new Stage(canvas.current!);
    stage.themeId = profile.theme;
    stage.looks = { [viewer]: look(), me: look() };
    stage.setRockStyle(cosmeticValue('obstacle'));
    // The board gets the room during play, so the side tabs step aside.
    document.body.classList.add('in-game');
    stageRef.current = stage;
    stage.onExplode = () => sound('boom', profile.muted);
    stage.onKill = () => sound('kill', profile.muted);
    stage.onFinalKill = () => setKnockout(true);
    session.attach(stage);
    stage.start();
    const onResize = () => {
      stage.resize();
    };
    window.addEventListener('resize', onResize);
    const unsub = session.subscribe(() => force((n) => n + 1));
    session.onShot = (r) => {
      // A new shot brings you back to live, so you don't miss it or your turn.
      stage.clearPast();
      setViewing(null);
      sound('fire', profile.muted);
      if (r.hits.length && r.playerId === viewer) noteKillExpression(r.expr);
    };
    const t = setInterval(() => setNow(Date.now()), 250);
    force((n) => n + 1);
    return () => {
      unsub();
      clearInterval(t);
      window.removeEventListener('resize', onResize);
      document.body.classList.remove('in-game');
      stage.stop();
      if (session.stage === stage) session.stage = null;
      if (!props.keepSession) session.dispose();
    };
  }, [session]);

  // Keep the display in step with whoever is acting.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.mirror = isMirrored(state, viewer);
    if ('seats' in session) {
      for (const seat of session.seats as { id: string; hat?: string }[]) {
        if (seat.id !== viewer) stage.looks[seat.id] = { hat: seat.hat };
      }
      stage.looks[viewer] = look();
    }
    stage.activeSoldierId = state.over ? null : currentSoldier(state)?.id ?? null;
    stage.aimAngle = mode === 'ode2' && canAct ? angle : null;
    stage.aimDir = dir;
    stage.aiming = canAct;
  }, [state, state.turnNumber, viewer, canAct, angle, dir, mode]);

  const shots = shotsOf(state);

  // A restarted map has a new, shorter history.
  useEffect(() => {
    if (viewing !== null && viewing >= shots.length) setViewing(null);
  }, [shots.length, viewing]);

  // Rewinding: show the board just after the chosen shot, with its curve.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (viewing === null) {
      stage.clearPast();
      return;
    }
    const moment = shotMoment(state, viewing);
    if (!moment) return;
    const { shot } = moment;
    const path = simulateShot({
      mode: shot.mode,
      expr: shot.expr,
      from: shot.from,
      angle: shot.angle,
      dir: shot.dir,
      mirrored: shot.mirrored,
      terrain: new Terrain(state.circles, moment.before.holes),
      targets: [],
    });
    stage.showPast({
      soldiers: moment.after.soldiers,
      holes: moment.after.holes,
      shooterId: shot.soldierId,
      shooterPlayer: shot.playerId,
      path: { xs: path.xs, ys: path.ys, steps: Math.min(path.steps, shot.steps) },
    });
  }, [viewing, state]);

  // Left and right arrows step through shots, unless you're typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || shots.length === 0) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setViewing((v) => (v === null ? shots.length - 1 : Math.max(0, v - 1)));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setViewing((v) => (v === null || v >= shots.length - 1 ? null : v + 1));
      } else if (e.key === 'Escape') {
        setViewing(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shots.length]);

  const canSeeShot = (shot: ShotRecord) => !props.hideOthersShots || state.over || shot.playerId === viewer;

  // Countdown before the first turn.
  const countdown = session.startsAt !== null ? Math.ceil((session.startsAt - now) / 1000) : null;
  const counting = countdown !== null && countdown > 0 && countdown <= 5 && !state.over;
  const showGo = countdown !== null && countdown > -1 && countdown <= 0 && state.log.length === 0 && !state.over;
  useEffect(() => {
    if (counting) sound('tick', profile.muted);
    else if (showGo) sound('go', profile.muted);
  }, [countdown]);

  // A big "your turn" callout whenever control comes to this screen in a timed match.
  useEffect(() => {
    if (canAct && session.showTimer) {
      sound('turn', profile.muted);
      setTurnSlam(state.turnNumber);
    }
  }, [canAct, state.turnNumber]);

  // Celebrate after the last shot has finished playing.
  useEffect(() => {
    if (!state.over || session.busy || celebrated) return;
    setCelebrated(true);
    if (state.winner !== null && isOnWinningSide(state, viewer)) {
      sound('win', profile.muted);
      stageRef.current?.celebrate();
    } else {
      sound('lose', profile.muted);
    }
  }, [state.over, session.busy]);

  useEffect(() => {
    if (canAct) {
      // Only a new turn clears the box. Opening the screen must not erase what's being typed.
      if (lastTurn.current !== state.turnNumber) {
        lastTurn.current = state.turnNumber;
        setExpr('');
        setError('');
      }
      input.current?.focus({ preventScroll: true });
    }
  }, [canAct, state.turnNumber]);

  useEffect(() => {
    if (chatBox.current) chatBox.current.scrollTop = chatBox.current.scrollHeight;
  }, [session.chat.length]);

  // Live error text and, in every mode, the first stretch of the curve.
  const check = useMemo(() => (expr.trim() ? validate(expr, mode) : null), [expr, mode]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.previewPath = null;
    const s = currentSoldier(state);
    if (!canAct || !expr.trim() || check || !s) return;
    const path = simulateShot({
      mode, expr, angle, dir, from: { x: s.x, y: s.y }, mirrored: isMirrored(state, currentPlayer(state).id),
      terrain: new Terrain(state.circles, state.holes), targets: [],
    });
    stage.previewPath = { xs: path.xs, ys: path.ys, steps: Math.max(2, Math.ceil(path.steps * PREVIEW_FRACTION)) };
  }, [expr, angle, dir, check, canAct, state.turnNumber]);

  const doFire = () => {
    if (!canAct) return;
    if (!expr.trim()) {
      setError('Type a function first');
      return;
    }
    try {
      session.fire({ expr, angle: mode === 'ode2' ? angle : undefined, dir });
      setError('');
    } catch (e) {
      if (e instanceof ParseError || e instanceof RuleError) setError(e.message);
      else throw e;
    }
  };

  const cur = currentPlayer(state);
  const secs = session.deadline && !session.busy ? Math.min(60, Math.max(0, Math.ceil((session.deadline - now) / 1000))) : null;
  const me = state.players.find((p) => p.id === viewer);
  const lastShot = shots[shots.length - 1];

  return (
    <div class="game">
      <div class="field">
        <div class="status">
          {props.header}
          {!state.over && (
            <span class={`who team-${cur.team}`}>
              {canAct ? (state.players.filter((p) => !p.isBot).length > 1 && session.showTimer && !('you' in session) ? `${cur.name}, your turn` : 'Your turn') : session.busy ? 'Shot in the air' : 'waitingToStart' in session && session.waitingToStart ? 'Get ready' : `${cur.name} is aiming`}
            </span>
          )}
          {props.soloInfo && <span class="muted">{props.soloInfo}</span>}
          {session.showTimer && secs !== null && !state.over && <span class={`timer ${secs <= 10 ? 'low' : ''}`} role="timer">{secs}s</span>}
        </div>
        {props.coach && <div class="coach">{props.coach}</div>}
        <div class="fieldwrap">
          <canvas
            ref={canvas}
            width={770}
            height={450}
            role="img"
            aria-label={`Graph battlefield. ${state.soldiers.filter((s) => s.alive).length} soldiers standing.`}
          />
          {counting && <div class="slam" key={countdown}><span>{countdown}</span></div>}
          {showGo && <div class="slam"><span>Go!</span></div>}
          {!counting && !showGo && turnSlam === state.turnNumber && canAct && <div class="slam turn" key={turnSlam}><span>Your turn!</span></div>}
          {knockout && viewing === null && <div class="slam knockout"><span>Final knockout!</span></div>}
          {viewing !== null && (
            <div class="past-banner" role="status">
              <span>Looking back at shot {viewing + 1} of {shots.length}</span>
              <button class="small" onClick={() => setViewing(null)}>Back to live</button>
            </div>
          )}
        </div>
        {props.notice && <p class="error" role="alert" style={{ marginTop: 8 }}>{props.notice}</p>}
        {props.result}
        {props.spectator && !state.over && !props.result && <p class="watching" role="status">You're watching this match. Functions show when each shot is fired{props.hideOthersShots ? ', once the match ends' : ''}.</p>}
        {!props.spectator && !state.over && !props.result && (
          <div class="shotbar">
            <div class="shotrow">
              <label for="fn-input">{modeLabel(mode)}</label>
              <input
                id="fn-input"
                ref={input}
                type="text"
                value={expr}
                maxLength={200}
                autocomplete="off"
                autocapitalize="off"
                spellcheck={false}
                inputMode={keys.on && !keys.typing ? 'none' : 'text'}
                placeholder={canAct ? 'x/3 + 2*sin(x)' : 'Wait for your turn'}
                disabled={!canAct}
                onInput={(e) => {
                  setExpr((e.target as HTMLInputElement).value);
                  setError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') doFire();
                  if (mode === 'ode2' && e.key === 'ArrowUp') {
                    e.preventDefault();
                    setAngle((a) => Math.min(1.55, a + (e.shiftKey ? 0.1 : 0.02)));
                  }
                  if (mode === 'ode2' && e.key === 'ArrowDown') {
                    e.preventDefault();
                    setAngle((a) => Math.max(-1.55, a - (e.shiftKey ? 0.1 : 0.02)));
                  }
                }}
              />
              <button class="primary fire" data-sfx="none" onClick={doFire} disabled={!canAct || !!check}>Fire</button>
            </div>
            <FunctionPicker input={input} value={expr} disabled={!canAct} onChange={(v) => { setExpr(v); setError(''); }} />
            {keys.on && (
              <MathKeys input={input} mode={mode} value={expr} disabled={!canAct} typing={keys.typing} setTyping={keys.setTyping}
                onChange={(v) => { setExpr(v); setError(''); }} />
            )}
            {expr.trim() && !check && <Tex expr={expr} prefix={modeLabel(mode)} />}
            {(check || error) && <p class="error" role="alert">{check?.message ?? error}</p>}
            <div class="controls2">
              {mode === 'ode2' && (
                <>
                  <span>Angle {((angle * 180) / Math.PI).toFixed(1)}°</span>
                  <button class="small" aria-label="Lower angle" disabled={!canAct} onClick={() => setAngle((a) => Math.max(-1.55, a - 0.02))}>Down</button>
                  <button class="small" aria-label="Raise angle" disabled={!canAct} onClick={() => setAngle((a) => Math.min(1.55, a + 0.02))}>Up</button>
                </>
              )}
              {state.config.kind === 'ffa' && (
                <span class="row" role="group" aria-label="Shot direction">
                  <button class="small dir-plus" disabled={!canAct} onClick={() => setDir(1)} aria-pressed={dir === 1}>Fire toward +x</button>
                  <button class="small dir-minus" disabled={!canAct} onClick={() => setDir(-1)} aria-pressed={dir === -1}>Fire toward −x</button>
                </span>
              )}
            </div>
          </div>
        )}
      </div>
      <aside>
        <div class="mini scores">
          <h3>Soldiers</h3>
          {state.players.filter((p) => p.soldierIds.length).map((p) => {
            const alive = p.soldierIds.filter((id) => state.soldiers[id]?.alive).length;
            return (
              <div class={`team-${p.team} ${alive ? '' : 'out'}`}>
                <span>{p.name}{p.connected ? '' : ' (left)'}</span>
                <span>{alive}/{p.soldierIds.length}</span>
              </div>
            );
          })}
        </div>
        {lastShot && (
          <div class="mini last-shot">
            <h3>Last shot</h3>
            <code>{canSeeShot(lastShot) ? lastShot.expr : 'Hidden until the match ends'}</code>
          </div>
        )}
        <ShotHistory shots={shots} state={state} viewing={viewing} onView={setViewing} canSee={canSeeShot} />
        {props.extraSide}
      </aside>
    </div>
  );
}
