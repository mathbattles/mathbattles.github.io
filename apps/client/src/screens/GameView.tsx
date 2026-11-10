import { FunctionPicker, MathKeys, useMathKeys } from './MathKeys';
import {
  ParseError,
  RuleError,
  ROUND_MS,
  roundMoment,
  roundsOf,
  Terrain,
  isMirrored,
  isOnWinningSide,
  lastShotOf,
  playerById,
  simulateShot,
  soldierOf,
  validate,
  waitingOn,
  type Dir,
  type MatchState,
  type Player,
  type RoundRecord,
  type ShotRecord,
} from '@mathbattles/sim';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { roundPaths, type GameSession } from '../game/session';
import { Stage, themedColor } from '../render/stage';
import { cosmeticValue, gameTextScale, grantAchievement, look, noteKillExpression, profile } from '../store';
import { exprToTex, modeLabel, sound } from '../util';
import { t, useLang } from '../i18n';

export function winnerText(state: MatchState, viewer?: string): string {
  if (state.winner === null) return t('game.draw');
  if (viewer && state.players.some((p) => p.id === viewer)) {
    return isOnWinningSide(state, viewer) ? t('game.youWin') : t('game.youLose');
  }
  if (state.config.kind === 'teams') return state.winner === 1 ? t('game.blueWins') : t('game.redWins');
  return t('game.nameWins', { name: state.players.find((p) => p.id === state.winner)?.name ?? t('game.someone') });
}

export function Tex({ expr, prefix }: { expr: string; prefix: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    void import('katex').then(async ({ default: katex }) => {
      await import('katex/dist/katex.min.css');
      if (!live || !ref.current) return;
      katex.render(`${prefix.replaceAll("'", "'")} ${exprToTex(expr)}`, ref.current, { throwOnError: false, trust: false, strict: false, maxSize: 20, maxExpand: 50 });
    });
    return () => {
      live = false;
    };
  }, [expr, prefix]);
  return <div class="preview" ref={ref} aria-hidden="true" />;
}

/** A small dot in a player's colour. */
function Swatch({ color }: { color: string }) {
  return <i class="swatch" style={{ background: color }} aria-hidden="true" />;
}

/** Every round so far. Choosing one shows the board at that moment, like a chess move list. */
function RoundHistory(props: {
  rounds: RoundRecord[];
  state: MatchState;
  viewing: number | null;
  onView: (index: number | null) => void;
  canSee: (shot: ShotRecord) => boolean;
  colorOf: (id: string) => string;
}) {
  const { rounds, viewing } = props;
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    if (viewing === null) el.scrollTop = el.scrollHeight;
    else el.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  }, [rounds.length, viewing]);
  const nameOf = (id: string) => props.state.players.find((p) => p.id === id);
  const last = rounds.length - 1;
  const at = viewing ?? last;
  return (
    <div class="mini history">
      <h3>{t('game.roundHistory')}</h3>
      {rounds.length === 0 ? (
        <p class="muted small-note" style={{ margin: 0 }}>{t('game.roundsAppear')}</p>
      ) : (
        <>
          <ol class="shots" ref={list} tabIndex={0} aria-label={t('game.roundsInMatch')}>
            {rounds.map((round, i) => (
              <li class={viewing === i ? 'current' : ''}>
                <button class="shot round-entry" aria-current={viewing === i ? 'true' : undefined} onClick={() => props.onView(i)}>
                  <span class="num">{t('game.roundN', { n: round.n })}</span>
                  {round.shots.length === 0 && <span class="muted">{t('game.noShots')}</span>}
                  {round.shots.map((shot) => {
                    const owner = nameOf(shot.playerId);
                    const hits = shot.hits.length;
                    return (
                      <span class="body">
                        <span class="shooter" style={{ color: props.colorOf(shot.playerId) }}>{owner?.name ?? t('game.player')}</span>
                        <code>{props.canSee(shot) ? shot.expr : t('game.hiddenUntilEnd')}</code>
                        {hits > 0 && <span class="hits">{t('game.hits', { count: hits })}</span>}
                      </span>
                    );
                  })}
                  {round.beams.length > 0 && <span class="beam-note">{t('game.beamNote')}</span>}
                  {round.luck.map((id) => <span class="luck-note">{t('game.luckNote', { name: nameOf(id)?.name ?? '' })}</span>)}
                </button>
              </li>
            ))}
          </ol>
          <div class="row history-nav">
            <button class="small" aria-label={t('game.prevRound')} disabled={at <= 0 && viewing !== null} onClick={() => props.onView(Math.max(0, at - (viewing === null ? 0 : 1)))}>{t('game.back')}</button>
            <button class="small" aria-label={t('game.nextRound')} disabled={viewing === null} onClick={() => props.onView(viewing !== null && viewing < last ? viewing + 1 : null)}>{t('game.next')}</button>
            <button class={`small ${viewing === null ? 'on' : ''}`} disabled={viewing === null} onClick={() => props.onView(null)}>{t('game.live')}</button>
          </div>
        </>
      )}
    </div>
  );
}

/** Everyone's soldier, grouped by team in team matches. */
function Scores({ state, colorOf }: { state: MatchState; colorOf: (id: string) => string }) {
  const shown = state.players.filter((p) => !p.passive);
  const row = (p: Player) => {
    const alive = !!state.soldiers[p.soldierId]?.alive;
    return (
      <div class={`score-row ${alive ? '' : 'out'}`}>
        <span><Swatch color={colorOf(p.id)} />{p.name}{p.connected ? '' : ` ${t('game.left')}`}</span>
        <span>
          {alive && p.locked && !state.over ? <span class="locked-mark" title={t('game.lockedIn')}>✓</span> : null}
          {alive ? t('game.alive') : t('game.out')}
        </span>
      </div>
    );
  };
  if (state.config.kind !== 'teams') return <>{shown.map(row)}</>;
  return (
    <>
      {([1, 2] as const).map((team) => (
        <div class={`team-group team-${team}`}>
          <h4>{team === 1 ? t('game.blueTeam') : t('game.redTeam')}</h4>
          {shown.filter((p) => p.team === team).map(row)}
        </div>
      ))}
    </>
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
  useLang();
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
  const [knockout, setKnockout] = useState(false);
  const [roundSlam, setRoundSlam] = useState(0);
  const [celebrated, setCelebrated] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [award, setAward] = useState('');
  const lastRound = useRef(session.state.round);

  const state = session.state;
  const canAim = session.canAim();
  const locked = session.isLocked();
  const canType = canAim && !locked;
  const mode = state.config.mode;
  const viewer = session.viewerId();
  const colorOf = (id: string) => themedColor(playerById(state, id)?.color ?? '#2b50e8', profile.theme);

  useEffect(() => {
    const stage = new Stage(canvas.current!);
    stage.themeId = profile.theme;
    stage.looks = { [viewer]: look(), me: look() };
    stage.setRockStyle(cosmeticValue('obstacle'));
    stage.labelScale = gameTextScale();
    // The board gets the room during play, so the side tabs step aside.
    document.body.classList.add('in-game');
    stageRef.current = stage;
    stage.onExplode = () => sound('boom', profile.muted);
    stage.onKill = () => sound('kill', profile.muted);
    stage.onFinalKill = () => setKnockout(true);
    stage.onBeam = () => sound('beam', profile.muted);
    stage.onLuck = (id) => {
      sound('luck', profile.muted);
      // Surviving a coin flip earns an achievement and the Survivor title.
      if (id === session.viewerId() && !('replay' in session) && grantAchievement('brink-of-death')) {
        setAward(t('game.awardBrink'));
      }
    };
    session.attach(stage);
    stage.start();
    const onResize = () => {
      stage.resize();
    };
    window.addEventListener('resize', onResize);
    const unsub = session.subscribe(() => force((n) => n + 1));
    session.onRound = (r) => {
      // A new round brings you back to live, so you don't miss it.
      stage.clearPast();
      setViewing(null);
      if (r.shots.length) sound('fire', profile.muted);
      for (const s of r.shots) if (s.hits.length && s.playerId === session.viewerId()) noteKillExpression(s.expr);
    };
    const timer = setInterval(() => setNow(Date.now()), 250);
    force((n) => n + 1);
    return () => {
      unsub();
      clearInterval(timer);
      window.removeEventListener('resize', onResize);
      document.body.classList.remove('in-game');
      stage.stop();
      if (session.stage === stage) session.stage = null;
      if (!props.keepSession) session.dispose();
    };
  }, [session]);

  // Keep the display in step with whoever is aiming.
  const mySoldier = soldierOf(state, viewer);
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
    const watching = props.spectator || 'replay' in session;
    stage.youId = watching || session.handoff ? null : viewer;
    stage.activeSoldierId = state.over || !mySoldier?.alive ? null : mySoldier.id;
    stage.aimAngle = mode === 'ode2' && canAim ? angle : null;
    stage.aimDir = dir;
    stage.aiming = canAim;
  }, [state, state.round, viewer, canAim, angle, dir, mode, session.handoff]);

  const rounds = roundsOf(state);

  // A restarted map has a new, shorter history.
  useEffect(() => {
    if (viewing !== null && viewing >= rounds.length) setViewing(null);
  }, [rounds.length, viewing]);

  // Rewinding: show the board just after the chosen round, with all of its curves.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (viewing === null) {
      stage.clearPast();
      return;
    }
    const moment = roundMoment(state, viewing);
    if (!moment) return;
    const paths = roundPaths({ circles: state.circles, holes: moment.before.holes }, moment.round);
    stage.showPast({
      soldiers: moment.after.soldiers,
      holes: moment.after.holes,
      paths: moment.round.shots.map((s, i) => ({ path: paths[i]!, playerId: s.playerId })),
      beams: moment.round.beams,
    });
  }, [viewing, state]);

  // Left and right arrows step through rounds, unless you're typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || rounds.length === 0 || 'replay' in session) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setViewing((v) => (v === null ? rounds.length - 1 : Math.max(0, v - 1)));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setViewing((v) => (v === null || v >= rounds.length - 1 ? null : v + 1));
      } else if (e.key === 'Escape') {
        setViewing(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rounds.length]);

  const canSeeShot = (shot: ShotRecord) => !props.hideOthersShots || state.over || shot.playerId === viewer;

  // Countdown before the first round.
  const countdown = session.startsAt !== null ? Math.ceil((session.startsAt - now) / 1000) : null;
  const counting = countdown !== null && countdown > 0 && countdown <= 5 && !state.over;
  const showGo = countdown !== null && countdown > -1 && countdown <= 0 && state.log.length === 0 && !state.over;
  useEffect(() => {
    if (counting) sound('tick', profile.muted);
    else if (showGo) sound('go', profile.muted);
  }, [countdown]);

  // Each new round gets a callout and a sound, once aiming opens.
  useEffect(() => {
    if (canAim && session.showTimer && roundSlam !== state.round) {
      sound('turn', profile.muted);
      setRoundSlam(state.round);
    }
  }, [canAim, state.round]);

  const secs = session.deadline && !session.busy ? Math.min(ROUND_MS / 1000, Math.max(0, Math.ceil((session.deadline - now) / 1000))) : null;
  // The last ten seconds tick, while you haven't locked in.
  useEffect(() => {
    if (secs !== null && secs <= 10 && secs > 0 && canType && session.showTimer) sound('tick', profile.muted);
  }, [secs]);

  // Celebrate after the last round has finished playing.
  useEffect(() => {
    if (!state.over || session.busy || celebrated) return;
    setCelebrated(true);
    if ('replay' in session) return;
    if (state.winner !== null && isOnWinningSide(state, viewer)) {
      sound('win', profile.muted);
      stageRef.current?.celebrate();
    } else {
      sound('lose', profile.muted);
    }
  }, [state.over, session.busy]);

  // A new round, or the device changing hands, starts with a clear box (or the saved draft).
  useEffect(() => {
    if (lastRound.current !== state.round) {
      lastRound.current = state.round;
      setExpr('');
      setError('');
    }
  }, [state.round]);
  useEffect(() => {
    const d = session.restoreDraft;
    if (d) {
      session.restoreDraft = null;
      setExpr(d.expr);
      if (d.angle !== undefined) setAngle(d.angle);
      if (d.dir) setDir(d.dir);
    } else if (session.handoff) {
      setExpr('');
    }
  }, [session.restoreDraft, viewer, session.handoff]);
  useEffect(() => {
    if (canType) input.current?.focus({ preventScroll: true });
  }, [canType, state.round, viewer]);

  // Whatever is typed is kept, so a timeout can still fire it.
  useEffect(() => {
    if (canType) session.setDraft({ expr, angle: mode === 'ode2' ? angle : undefined, dir });
  }, [expr, angle, dir]);

  // Live error text and the whole curve, dotted, in your colour.
  const check = useMemo(() => (expr.trim() ? validate(expr, mode) : null), [expr, mode]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.previewPath = null;
    if (!canAim || session.handoff || !expr.trim() || check || !mySoldier?.alive) return;
    const path = simulateShot({
      mode, expr, angle, dir, from: { x: mySoldier.x, y: mySoldier.y }, mirrored: isMirrored(state, viewer),
      terrain: new Terrain(state.circles, state.holes), targets: [],
    });
    stage.previewPath = { xs: path.xs, ys: path.ys, steps: path.steps };
  }, [expr, angle, dir, check, canAim, state.round, viewer, session.handoff]);

  const last = lastShotOf(state, viewer);
  const recall = () => {
    if (!last || !canType) return;
    setExpr(last.expr);
    if (mode === 'ode2') setAngle(last.angle);
    setDir(last.dir);
    setError('');
    sound('click', profile.muted);
    input.current?.focus({ preventScroll: true });
  };

  const toggleLock = () => {
    if (!canAim) return;
    if (locked) {
      session.unlock();
      sound('unlock', profile.muted);
      return;
    }
    if (!expr.trim()) {
      setError(t('game.typeFirst'));
      return;
    }
    if (check) return;
    try {
      session.lock({ expr, angle: mode === 'ode2' ? angle : undefined, dir });
      sound('lock', profile.muted);
      setError('');
    } catch (e) {
      if (e instanceof ParseError || e instanceof RuleError) setError(e.message);
      else throw e;
    }
  };

  const waiting = waitingOn(state);
  const waitingStarting = 'waitingToStart' in session && (session as { waitingToStart: boolean }).waitingToStart;
  // The clock shows only while aiming is open, not during the countdown or while shots fly.
  const timed = session.showTimer && secs !== null && !state.over && !session.handoff && !session.busy && !counting && !waitingStarting;
  const status = state.over
    ? null
    : session.busy
      ? t('game.firing')
      : session.handoff
        ? t('game.passing')
        : waitingStarting || counting
          ? t('game.getReady')
          : waiting.length === 0
            ? t('game.allLocked')
            : waiting.map((p) => p.name).join(', ');
  const me = playerById(state, viewer);
  const lastRec = rounds[rounds.length - 1];
  const othersWaiting = waiting.filter((p) => p.id !== viewer).length;
  const canHandBack = !!session.handoff && session.canHandBack();

  return (
    <div class="game">
      <div class="field">
        <div class="status">
          {props.header}
          {status !== null && (
            <span class="who round-status" role="status">
              {timed && <span class={`timer ${secs! <= 10 ? 'low' : ''}`} role="timer">{secs}s</span>}
              {timed && ' - '}
              {!session.busy && !session.handoff && !waitingStarting && !counting && waiting.length > 0 ? (
                waiting.map((p, i) => (
                  <span>{i ? ', ' : ''}<span style={{ color: colorOf(p.id) }}>{p.name}</span></span>
                ))
              ) : status}
            </span>
          )}
          {props.soloInfo && <span class="muted">{props.soloInfo}</span>}
        </div>
        {props.coach && <div class="coach">{props.coach}</div>}
        <div class="fieldwrap">
          <canvas
            ref={canvas}
            width={770}
            height={450}
            role="img"
            aria-label={t('game.fieldLabel', { count: state.soldiers.filter((s) => s.alive).length })}
          />
          {counting && <div class="slam" key={countdown}><span>{countdown}</span></div>}
          {showGo && <div class="slam"><span>{t('game.go')}</span></div>}
          {!counting && !showGo && roundSlam === state.round && canAim && !session.handoff && state.round > 1 && (
            <div class="slam turn" key={roundSlam}><span>{t('game.roundN', { n: state.round })}</span></div>
          )}
          {knockout && viewing === null && <div class="slam knockout"><span>{t('game.finalKnockout')}</span></div>}
          {session.handoff && !state.over && (
            <div class="handoff" role="dialog" aria-label={t('game.passTo', { name: session.handoff })}>
              <div class="handoff-card sheet">
                <p class="handoff-title">{t('game.passTo', { name: session.handoff })}</p>
                <p class="muted">{t('game.passHint')}</p>
                <button class="primary" autoFocus onClick={() => { session.acceptHandoff(); sound('open', profile.muted); }}>
                  {t('game.imName', { name: session.handoff })}
                </button>
                {canHandBack && (
                  <button class="plain small" onClick={() => { if (session.handBack()) sound('unlock', profile.muted); }}>{t('game.handBack')}</button>
                )}
              </div>
            </div>
          )}
          {viewing !== null && (
            <div class="past-banner" role="status">
              <span>{t('game.lookingBack', { n: viewing + 1, total: rounds.length })}</span>
              <button class="small" onClick={() => setViewing(null)}>{t('game.backToLive')}</button>
            </div>
          )}
        </div>
        {props.notice && <p class="error" role="alert" style={{ marginTop: 8 }}>{props.notice}</p>}
        {award && <p class="ok award" role="status">{award}</p>}
        {props.result}
        {props.spectator && !state.over && !props.result && (
          <p class="watching" role="status">{props.hideOthersShots ? t('game.watchingHidden') : t('game.watching')}</p>
        )}
        {!props.spectator && !('replay' in session) && !state.over && !props.result && (
          <div class={`shotbar ${locked ? 'is-locked' : ''}`}>
            <div class="shotrow">
              <label for="fn-input" style={me ? { color: colorOf(me.id) } : undefined}>{modeLabel(mode)}</label>
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
                placeholder={canAim ? 'x/3 + 2*sin(x)' : me && !state.soldiers[me.soldierId]?.alive ? t('game.knockedOut') : t('game.waitForRound')}
                disabled={!canType}
                readOnly={locked}
                onInput={(e) => {
                  setExpr((e.target as HTMLInputElement).value);
                  setError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') toggleLock();
                  if (mode !== 'ode2' && e.key === 'ArrowUp' && !expr) {
                    e.preventDefault();
                    recall();
                  }
                  if (mode === 'ode2' && e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (!expr) recall();
                    else setAngle((a) => Math.min(1.55, a + (e.shiftKey ? 0.1 : 0.02)));
                  }
                  if (mode === 'ode2' && e.key === 'ArrowDown') {
                    e.preventDefault();
                    setAngle((a) => Math.max(-1.55, a - (e.shiftKey ? 0.1 : 0.02)));
                  }
                }}
              />
              <button
                class="recall"
                aria-label={last ? t('game.recallWith', { expr: last.expr }) : t('game.recall')}
                title={last ? t('game.recallWith', { expr: last.expr }) : t('game.recallNone')}
                disabled={!last || !canType}
                onClick={recall}
              >↑</button>
              <button class={`primary fire lock ${locked ? 'locked' : ''}`} data-sfx="none" onClick={toggleLock} disabled={!canAim || (!locked && !!check)} aria-pressed={locked}>
                {locked ? t('game.unlock') : session.instantFire ? t('game.fire') : t('game.lockIn')}
              </button>
            </div>
            {locked && canAim && (
              <p class="lock-note" role="status">
                {othersWaiting > 0 ? t('game.waitingForPlayers', { count: othersWaiting }) : t('game.firingSoon')}
              </p>
            )}
            <FunctionPicker input={input} value={expr} disabled={!canType} onChange={(v) => { setExpr(v); setError(''); }} />
            {keys.on && (
              <MathKeys input={input} mode={mode} value={expr} disabled={!canType} typing={keys.typing} setTyping={keys.setTyping}
                onChange={(v) => { setExpr(v); setError(''); }} />
            )}
            {expr.trim() && !check && <Tex expr={expr} prefix={modeLabel(mode)} />}
            {(check || error) && <p class="error" role="alert">{check?.message ?? error}</p>}
            <div class="controls2">
              {mode === 'ode2' && (
                <>
                  <span>{t('game.angle', { deg: ((angle * 180) / Math.PI).toFixed(1) })}</span>
                  <button class="small" aria-label={t('game.lowerAngle')} disabled={!canType} onClick={() => setAngle((a) => Math.max(-1.55, a - 0.02))}>{t('game.down')}</button>
                  <button class="small" aria-label={t('game.raiseAngle')} disabled={!canType} onClick={() => setAngle((a) => Math.min(1.55, a + 0.02))}>{t('game.up')}</button>
                </>
              )}
              {state.config.kind === 'ffa' && (
                <span class="row" role="group" aria-label={t('game.direction')}>
                  <button class="small dir-plus" disabled={!canType} onClick={() => setDir(1)} aria-pressed={dir === 1}>{t('game.firePlus')}</button>
                  <button class="small dir-minus" disabled={!canType} onClick={() => setDir(-1)} aria-pressed={dir === -1}>{t('game.fireMinus')}</button>
                </span>
              )}
            </div>
          </div>
        )}
      </div>
      <aside>
        <div class="mini scores">
          <h3>{t('game.players')}</h3>
          <Scores state={state} colorOf={colorOf} />
        </div>
        {lastRec && lastRec.shots.length > 0 && (
          <div class="mini last-shot">
            <h3>{t('game.lastRound')}</h3>
            {lastRec.shots.map((s) => (
              <code style={{ '--who': colorOf(s.playerId) }}>{canSeeShot(s) ? s.expr : t('game.hiddenUntilEnd')}</code>
            ))}
          </div>
        )}
        <RoundHistory rounds={rounds} state={state} viewing={viewing} onView={setViewing} canSee={canSeeShot} colorOf={colorOf} />
        {props.extraSide}
      </aside>
    </div>
  );
}
