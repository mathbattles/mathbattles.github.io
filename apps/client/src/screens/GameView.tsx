import {
  ABILITY_COST,
  ParseError,
  RuleError,
  Terrain,
  currentPlayer,
  currentSoldier,
  isMirrored,
  isOnWinningSide,
  simulateShot,
  validate,
  type Dir,
  type MatchState,
} from '@mathbattles/sim';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { GameSession } from '../game/session';
import { Stage } from '../render/stage';
import { look, noteKillExpression, profile } from '../store';
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

function Tex({ expr, prefix }: { expr: string; prefix: string }) {
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

export function GameView(props: {
  session: GameSession;
  coach?: string | null;
  header?: ComponentChildren;
  result?: ComponentChildren;
  extraSide?: ComponentChildren;
  showFunctions?: boolean;
  soloInfo?: string;
  /** A passing message that must not get in the way of playing. */
  notice?: string;
  /** The room screen owns online sessions, which outlive one match. */
  keepSession?: boolean;
}) {
  const { session } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [, force] = useState(0);
  const [expr, setExpr] = useState('');
  const [angle, setAngle] = useState(0);
  const [dir, setDir] = useState<Dir>(1);
  const [error, setError] = useState('');
  const [chat, setChat] = useState('');
  const [teleporting, setTeleporting] = useState(false);
  const [knockout, setKnockout] = useState(false);
  const [turnSlam, setTurnSlam] = useState(0);
  const [celebrated, setCelebrated] = useState(false);
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
      sound('fire', profile.muted);
      if (r.hits.length && r.playerId === viewer) noteKillExpression(r.expr);
    };
    const t = setInterval(() => setNow(Date.now()), 250);
    force((n) => n + 1);
    return () => {
      unsub();
      clearInterval(t);
      window.removeEventListener('resize', onResize);
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
  }, [state, state.turnNumber, viewer, canAct, angle, dir, mode]);

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
        setTeleporting(false);
      }
      input.current?.focus({ preventScroll: true });
    }
  }, [canAct, state.turnNumber]);

  useEffect(() => {
    if (chatBox.current) chatBox.current.scrollTop = chatBox.current.scrollHeight;
  }, [session.chat.length]);

  // Live error text and, where allowed, the first stretch of the curve.
  const check = useMemo(() => (expr.trim() ? validate(expr, mode) : null), [expr, mode]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.previewPath = null;
    const s = currentSoldier(state);
    if (!session.preview || !canAct || !expr.trim() || check || !s) return;
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

  const clickField = (e: MouseEvent) => {
    const stage = stageRef.current;
    if (!stage || !teleporting) return;
    const p = stage.fieldPoint(e.clientX, e.clientY);
    try {
      session.teleport(Math.round(p.x), Math.round(p.y));
      setTeleporting(false);
      stage.teleportFrom = null;
      setError('');
    } catch (err) {
      if (err instanceof RuleError) setError(err.message);
      else throw err;
    }
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const s = currentSoldier(state);
    stage.teleportFrom = teleporting && s ? { x: s.x, y: s.y } : null;
  }, [teleporting]);

  const cur = currentPlayer(state);
  const secs = session.deadline && !session.busy ? Math.min(60, Math.max(0, Math.ceil((session.deadline - now) / 1000))) : null;
  const me = state.players.find((p) => p.id === viewer);
  const lastShot = [...state.log].reverse().find((e) => e.type === 'shot');

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
            onClick={clickField}
            style={teleporting ? { cursor: 'crosshair' } : undefined}
            role="img"
            aria-label={`Graph battlefield. ${state.soldiers.filter((s) => s.alive).length} soldiers standing.`}
          />
          {counting && <div class="slam" key={countdown}><span>{countdown}</span></div>}
          {showGo && <div class="slam"><span>Go!</span></div>}
          {!counting && !showGo && turnSlam === state.turnNumber && canAct && <div class="slam turn" key={turnSlam}><span>Your turn!</span></div>}
          {knockout && <div class="slam knockout"><span>Final knockout!</span></div>}
        </div>
        {props.notice && <p class="error" role="alert" style={{ marginTop: 8 }}>{props.notice}</p>}
        {props.result}
        {!state.over && !props.result && (
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
                inputMode="text"
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
              <button class="primary fire" onClick={doFire} disabled={!canAct || !!check}>Fire</button>
            </div>
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
              {state.config.abilities && me?.ability && (
                <span class="row">
                  <span class="charge" role="img" aria-label={`Charge ${me.charge} of ${ABILITY_COST}`}>
                    {Array.from({ length: ABILITY_COST }, (_, i) => <i class={i < me.charge ? 'full' : ''} />)}
                  </span>
                  {me.ability === 'teleport' ? (
                    <button class={`small ${teleporting ? 'on' : ''}`} disabled={!canAct || me.charge < ABILITY_COST} onClick={() => setTeleporting((t) => !t)}>
                      {teleporting ? 'Click the field' : 'Teleport'}
                    </button>
                  ) : (
                    <button class={`small ${me.missileArmed ? 'on' : ''}`} disabled={!canAct || me.charge < ABILITY_COST || me.missileArmed} onClick={() => { try { session.missile(); } catch (e) { if (e instanceof RuleError) setError(e.message); else throw e; } }}>
                      {me.missileArmed ? 'Missile armed' : 'Arm missile'}
                    </button>
                  )}
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
        {props.showFunctions && lastShot?.type === 'shot' && (
          <div class="mini">
            <h3>Last shot</h3>
            <code>{lastShot.shot.expr}</code>
          </div>
        )}
        {props.extraSide}
      </aside>
    </div>
  );
}
