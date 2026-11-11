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
  historyOf,
  hopLanding,
  abilityDef,
  energyGain,
  BLAST_R,
  HEAVY_BLAST_MULT,
  MAX_ENERGY,
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
  type AbilityId,
  type KillRecord,
} from '@mathbattles/sim';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { roundPaths, type GameSession } from '../game/session';
import { Stage, themedColor } from '../render/stage';
import { abilityMenu, cosmeticValue, gameTextScale, grantAchievement, look, noteAbilityUse, noteKillExpression, profile } from '../store';
import { Icon, type IconName } from './Icons';
import { exprToTex, modeLabel, sound } from '../util';
import { t, useLang } from '../i18n';
import { FadeText, notify } from './Notices';

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

export const ABILITY_ICON: Record<AbilityId, IconName> = { hop: 'hop', ricochet: 'ricochet', heavy: 'heavy' };

/** A plain hand-drawn energy bar, with next round's gain shown faintly and the chosen ability's cost hatched. */
function EnergyBar({ energy, gain, cost, flash, free }: { energy: number; gain: number; cost: number; flash: boolean; free: boolean }) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / MAX_ENERGY) * 100))}%`;
  const after = Math.min(MAX_ENERGY, energy + gain);
  return (
    <div class={`energy ${flash ? 'flash' : ''}`} role="meter" aria-valuemin={0} aria-valuemax={MAX_ENERGY} aria-valuenow={energy} aria-label={t('energy.label')}>
      <Icon name="energy" class="energy-icon" />
      <div class="energy-track">
        <div class="energy-fill" style={{ width: pct(energy) }} />
        {!free && gain > 0 && energy < MAX_ENERGY && <div class="energy-ghost" style={{ left: pct(energy), width: `calc(${pct(after)} - ${pct(energy)})` }} />}
        {cost > 0 && <div class="energy-cost" style={{ left: `calc(${pct(energy)} - ${pct(Math.min(cost, energy))})`, width: pct(Math.min(cost, energy)) }} />}
      </div>
      <span class="energy-num">{free ? t('energy.unlimited') : `${energy} / ${MAX_ENERGY}`}</span>
      {!free && gain > 0 && energy < MAX_ENERGY && <span class="energy-gain">{t('energy.next', { n: gain })}</span>}
    </div>
  );
}

/** The ability menu: every owned ability, favourites first, greyed out when there isn't enough energy. */
function AbilityMenu({ energy, free, chosen, onPick, onClose }: { energy: number; free: boolean; chosen: AbilityId | null; onPick: (a: AbilityId) => void; onClose: () => void }) {
  const list = abilityMenu();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div class="ability-menu sheet" role="dialog" aria-label={t('ability.menu')}>
      <div class="ability-menu-head">
        <strong>{t('ability.menu')}</strong>
        <button class="small plain" aria-label={t('ability.close')} onClick={onClose}><Icon name="close" /></button>
      </div>
      {list.map((id) => {
        const def = abilityDef(id)!;
        const short = !free && energy < def.energy;
        return (
          <button class={`ability-choice ${chosen === id ? 'on' : ''}`} disabled={short} onClick={() => onPick(id)} aria-pressed={chosen === id}>
            <Icon name={ABILITY_ICON[id]} size="1.8em" />
            <span class="ability-text">
              <strong>{t(`ability.${id}.name`)}</strong>
              <small>{t(`ability.${id}.short`)}</small>
            </span>
            <span class="ability-cost"><Icon name="energy" />{def.energy}</span>
            {short && <small class="ability-need">{t('ability.need', { n: def.energy - energy })}</small>}
          </button>
        );
      })}
    </div>
  );
}

const KILL_ICON: Record<KillRecord['kind'], IconName> = { shot: 'skull', beam: 'beam', hop: 'hop', heavy: 'heavy', out: 'out' };

/** Every knockout this match, newest first, with how it happened. */
function KillFeed({ state, colorOf }: { state: MatchState; colorOf: (id: string) => string }) {
  const rows: { round: number; kill: KillRecord }[] = [];
  for (const r of roundsOf(state)) for (const k of r.kills) rows.push({ round: r.n, kill: k });
  if (!rows.length) return null;
  const nameOfSoldier = (id: number) => state.players.find((p) => p.soldierId === id);
  return (
    <div class="mini kill-feed">
      <h3>{t('feed.title')}</h3>
      <ol>
        {rows.slice(-8).reverse().map(({ kill }) => {
          const victim = nameOfSoldier(kill.id);
          const by = kill.by.map((id) => state.players.find((p) => p.id === id)).filter(Boolean);
          return (
            <li>
              {by.length > 0 && by.map((p, i) => <span>{i ? ' + ' : ''}<span style={{ color: colorOf(p!.id) }}>{p!.name}</span></span>)}
              <span class="feed-how" title={t(`feed.${kill.kind}`)}><Icon name={KILL_ICON[kill.kind] ?? 'skull'} label={t(`feed.${kill.kind}`)} /></span>
              {victim && <span style={{ color: colorOf(victim.id) }}>{victim.name}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
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
          {alive && p.locked && !state.over ? <span class="locked-mark" title={t('game.lockedIn')}><Icon name="check" label={t('game.lockedIn')} /></span> : null}
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
  // Up arrow history: which past function is showing, and what was typed before stepping in.
  const [histIdx, setHistIdx] = useState(-1);
  const typedBefore = useRef('');
  const [ability, setAbility] = useState<AbilityId | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [callouts, setCallouts] = useState<{ id: number; name: string; color: string; ability: AbilityId }[]>([]);
  const [energyFlash, setEnergyFlash] = useState(false);

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
    stage.onSfx = (name) => sound(name as Parameters<typeof sound>[0], profile.muted);
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
      const me = session.viewerId();
      for (const s of r.shots) if (s.hits.length && s.playerId === me) noteKillExpression(s.expr);
      // Everyone sees who used which ability.
      const used = r.shots.filter((s) => s.ability).map((s, i) => {
        const p = session.state.players.find((q) => q.id === s.playerId);
        return { id: Date.now() + i, name: p?.name ?? '', color: themedColor(p?.color ?? '#2b50e8', profile.theme), ability: s.ability! };
      });
      if (used.length) {
        setCallouts(used);
        setTimeout(() => setCallouts([]), 2600);
      }
      if (!('replay' in session)) {
        for (const s of r.shots) {
          if (s.playerId !== me || !s.ability) continue;
          const kills = r.kills.filter((k) => k.by.includes(me) && (s.ability === 'hop' ? k.kind === 'hop' : true)).length;
          noteAbilityUse(s.ability, kills);
          if (s.ability === 'hop' && r.kills.some((k) => k.kind === 'hop' && k.by.includes(me)) && grantAchievement('leap-of-faith')) setAward(t('award.leap'));
          if (s.ability === 'ricochet' && s.hits.length && s.bounce && s.hits.some((h) => h.step > s.bounce!.step) && grantAchievement('bank-shot')) setAward(t('award.bank'));
          if (s.ability === 'heavy' && r.kills.filter((k) => k.kind === 'heavy' && k.by.includes(me)).length >= 2 && grantAchievement('crater-maker')) setAward(t('award.crater'));
        }
        // A beam cut off a shot that would have hit you.
        const mine = session.state.players.find((p) => p.id === me);
        if (mine && r.shots.some((s) => s.reason === 'beamcut' && s.playerId !== me) && session.state.soldiers[mine.soldierId]?.alive) {
          const cutAimedAtMe = r.shots.some((s) => s.reason === 'beamcut' && s.playerId !== me && Math.hypot(s.end.x - session.state.soldiers[mine.soldierId]!.x, s.end.y - session.state.soldiers[mine.soldierId]!.y) < 60);
          if (cutAimedAtMe && grantAchievement('clean-cut')) setAward(t('award.clean'));
        }
        // A kill fills the bar right up.
        const e = r.energy?.find((x) => x.playerId === me);
        if (e && e.after >= MAX_ENERGY && e.before < MAX_ENERGY) {
          sound('energyFull', profile.muted);
          setEnergyFlash(true);
          setTimeout(() => setEnergyFlash(false), 1400);
        } else if (e && e.after > e.before) {
          sound('energyTick', profile.muted);
        }
      }
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
      setHistIdx(-1);
      setAbility(null);
      setMenuOpen(false);
    }
  }, [state.round]);
  useEffect(() => {
    const d = session.restoreDraft;
    if (d) {
      session.restoreDraft = null;
      setExpr(d.expr);
      if (d.angle !== undefined) setAngle(d.angle);
      if (d.dir) setDir(d.dir);
      setAbility(d.ability ?? null);
    } else if (session.handoff) {
      setExpr('');
    }
  }, [session.restoreDraft, viewer, session.handoff]);
  useEffect(() => {
    if (canType) input.current?.focus({ preventScroll: true });
  }, [canType, state.round, viewer]);

  // Whatever is typed is kept, so a timeout can still fire it.
  useEffect(() => {
    if (canType) session.setDraft({ expr, angle: mode === 'ode2' ? angle : undefined, dir, ...(ability ? { ability } : {}) });
  }, [expr, angle, dir, ability]);

  // Live error text and the whole curve, dotted, in your colour.
  const check = useMemo(() => (expr.trim() ? validate(expr, mode) : null), [expr, mode]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.previewPath = null;
    stage.previewBlast = null;
    stage.previewLanding = null;
    if (!canAim || session.handoff || !expr.trim() || check || !mySoldier?.alive) return;
    const terrain = new Terrain(state.circles, state.holes);
    // The preview shows what the chosen ability really does: the bounce, the blast, or the landing.
    const path = simulateShot({
      mode, expr, angle, dir, from: { x: mySoldier.x, y: mySoldier.y }, mirrored: isMirrored(state, viewer),
      terrain, targets: [], ricochet: ability === 'ricochet',
    });
    stage.previewPath = { xs: path.xs, ys: path.ys, steps: path.steps };
    if (ability === 'heavy') stage.previewBlast = { x: path.end.x, y: path.end.y, r: BLAST_R * HEAVY_BLAST_MULT };
    if (ability === 'hop') stage.previewLanding = hopLanding(terrain, path);
  }, [expr, angle, dir, check, canAim, state.round, viewer, session.handoff, ability]);

  // Up steps back through your past functions, one per press, wrapping to the newest; down steps forward.
  const history = historyOf(state, viewer);
  const nextIdx = history.length ? (histIdx + 1) % history.length : -1;
  const upcoming = nextIdx >= 0 ? history[nextIdx] : undefined;
  const recall = (step: 1 | -1 = 1) => {
    if (!history.length || !canType) return;
    if (histIdx === -1) typedBefore.current = expr;
    let i = histIdx + step;
    if (i >= history.length) i = 0;
    if (i < 0) {
      // Past the newest going down: back to what you were typing.
      setHistIdx(-1);
      setExpr(typedBefore.current);
      return;
    }
    const shot = history[i]!;
    setHistIdx(i);
    setExpr(shot.expr);
    if (mode === 'ode2') setAngle(shot.angle);
    setDir(shot.dir);
    setError('');
    sound('click', profile.muted);
    input.current?.focus({ preventScroll: true });
  };
  const leaveHistory = () => {
    if (histIdx === -1) return;
    setHistIdx(-1);
    setExpr(typedBefore.current);
  };

  const me0 = playerById(state, viewer);
  const free = !!state.config.freeEnergy;
  const energy = me0?.energy ?? 0;
  const chosenDef = ability ? abilityDef(ability) : undefined;
  const abilitiesHere = session.abilitiesOn && !props.spectator && (me0?.abilities?.length ?? 0) > 0;
  const pickAbility = (a: AbilityId) => {
    const def = abilityDef(a)!;
    if (!free && energy < def.energy) {
      sound('noEnergy', profile.muted);
      notify(t('ability.needEnergy', { name: def.name, n: def.energy - energy }), 'info');
      return;
    }
    setAbility(a);
    setMenuOpen(false);
    sound('abilitySelect', profile.muted);
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
      session.lock({ expr, angle: mode === 'ode2' ? angle : undefined, dir, ...(ability ? { ability } : {}) });
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
  const status = state.over || 'replay' in session
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
          {callouts.length > 0 && (
            <div class="callouts" role="status">
              {callouts.map((c) => (
                <span class="callout" key={c.id} style={{ '--who': c.color }}>
                  <Icon name={ABILITY_ICON[c.ability]} /> <strong>{c.name}</strong> {t(`ability.${c.ability}.name`)}
                </span>
              ))}
            </div>
          )}
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
        <FadeText text={props.notice ?? ''} />
        {award && <p class="ok award" role="status">{award}</p>}
        {props.result}
        {props.spectator && !state.over && !props.result && (
          <p class="watching" role="status">{props.hideOthersShots ? t('game.watchingHidden') : t('game.watching')}</p>
        )}
        {!props.spectator && !('replay' in session) && !state.over && !props.result && (
          <div class={`shotbar ${locked ? 'is-locked' : ''}`}>
            {abilitiesHere && me0 && (
              <EnergyBar energy={energy} gain={energyGain(state.round)} cost={chosenDef?.energy ?? 0} flash={energyFlash} free={free} />
            )}
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
                  setHistIdx(-1);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') toggleLock();
                  // Up and down walk the history while the box is empty or still shows a past function.
                  const inHistory = !expr || histIdx !== -1;
                  if (e.key === 'Escape' && histIdx !== -1) {
                    e.preventDefault();
                    leaveHistory();
                  }
                  if (e.key === 'ArrowUp' && (mode !== 'ode2' || inHistory) && inHistory) {
                    e.preventDefault();
                    recall(1);
                  } else if (mode === 'ode2' && e.key === 'ArrowUp') {
                    e.preventDefault();
                    setAngle((a) => Math.min(1.55, a + (e.shiftKey ? 0.1 : 0.02)));
                  }
                  if (e.key === 'ArrowDown' && histIdx !== -1) {
                    e.preventDefault();
                    recall(-1);
                  } else if (mode === 'ode2' && e.key === 'ArrowDown') {
                    e.preventDefault();
                    setAngle((a) => Math.max(-1.55, a - (e.shiftKey ? 0.1 : 0.02)));
                  }
                }}
              />
              <span class="recall-group">
                <button
                  class="recall"
                  aria-label={upcoming ? t('game.recallWith', { expr: upcoming.expr }) : t('game.recall')}
                  title={upcoming ? t('game.recallWith', { expr: upcoming.expr }) : t('game.recallNone')}
                  disabled={!history.length || !canType}
                  onClick={() => recall(1)}
                ><Icon name="up" /></button>
                {histIdx !== -1 && (
                  <>
                    <button class="recall small" aria-label={t('game.recallNewer')} title={t('game.recallNewer')} disabled={!canType} onClick={() => recall(-1)}><Icon name="down" /></button>
                    <span class="recall-count" aria-live="polite">{histIdx + 1} / {history.length}</span>
                  </>
                )}
              </span>
              {abilitiesHere && (
                <span class="ability-anchor">
                  <button
                    class={`ability-button ${ability ? 'on' : ''}`}
                    aria-haspopup="dialog"
                    aria-expanded={menuOpen}
                    disabled={!canType}
                    onClick={() => { setMenuOpen(!menuOpen); sound('abilityOpen', profile.muted); }}
                  >
                    <Icon name={ability ? ABILITY_ICON[ability] : 'ability'} /> {t('ability.button')}
                  </button>
                  {menuOpen && <AbilityMenu energy={energy} free={free} chosen={ability} onPick={pickAbility} onClose={() => setMenuOpen(false)} />}
                </span>
              )}
              <button class={`primary fire lock ${locked ? 'locked' : ''} ${ability ? 'with-ability' : ''}`} data-sfx="none" onClick={toggleLock} disabled={!canAim || (!locked && !!check)} aria-pressed={locked}>
                {ability && !locked && <Icon name={ABILITY_ICON[ability]} />}
                {locked ? t('game.unlock') : `${session.instantFire ? t('game.fire') : t('game.lockIn')}${ability ? ` (${t(`ability.${ability}.name`)})` : ''}`}
              </button>
              {ability && !locked && (
                <button class="small plain ability-clear" aria-label={t('ability.clear')} title={t('ability.clear')} onClick={() => setAbility(null)}><Icon name="close" /></button>
              )}
            </div>
            {locked && canAim && (
              <p class="lock-note" role="status">
                {othersWaiting > 0 ? t('game.waitingForPlayers', { count: othersWaiting }) : t('game.firingSoon')}
              </p>
            )}
            <div class="fn-row">
              <FunctionPicker input={input} value={expr} disabled={!canType} onChange={(v) => { setExpr(v); setError(''); }} />
              {state.config.kind === 'ffa' && (
                <span class="row dir-group" role="group" aria-label={t('game.direction')}>
                  <button class="small dir-plus" disabled={!canType} onClick={() => { setDir(1); sound('toggle', profile.muted); }} aria-pressed={dir === 1}>{t('game.firePlus')}</button>
                  <button class="small dir-minus" disabled={!canType} onClick={() => { setDir(-1); sound('toggle', profile.muted); }} aria-pressed={dir === -1}>{t('game.fireMinus')}</button>
                </span>
              )}
            </div>
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
        <KillFeed state={state} colorOf={colorOf} />
        <RoundHistory rounds={rounds} state={state} viewing={viewing} onView={setViewing} canSee={canSeeShot} colorOf={colorOf} />
        {props.extraSide}
      </aside>
    </div>
  );
}
