import { MathKeys, useMathKeys } from './MathKeys';
import {
  ParseError,
  RuleError,
  Terrain,
  fire,
  simulateShot,
  soloCleared,
  soloHitFriend,
  soloNext,
  terrainOf,
  toGameX,
  toGameY,
  validate,
  type Dir,
  type EndReason,
  type MatchState,
  type ShotMode,
  type ShotRecord,
} from '@mathbattles/sim';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  LESSONS,
  ME,
  UNITS,
  challengeState,
  freeBoard,
  lessonDone,
  requiredIds,
  type Block,
  type Challenge,
  type Lesson,
  type Playground,
  type Quiz,
  type Sliders,
} from '../content/learn';
import { Stage } from '../render/stage';
import { cosmeticValue, look, markLearned, profile } from '../store';
import { modeLabel, sound } from '../util';
import { Tex } from './GameView';
import { TopBar, useProfile } from './Shared';

/** Turns `backticks` into math text. */
function Rich({ text }: { text: string }) {
  const parts = text.split('`');
  return <>{parts.map((part, i) => (i % 2 ? <code>{part}</code> : part))}</>;
}

const REASON_TEXT: Record<EndReason, string> = {
  obstacle: 'It ended at an obstacle.',
  edge: 'It left the board.',
  invalid: "It hit an invalid value, such as the square root of a negative number.",
  steep: 'It hit a sudden jump, and shots can\'t jump.',
  'too-long': 'It ran out of length, because the curve is too wiggly.',
};

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
const pointText = (x: number, y: number) => `(${fmt(toGameX(x))}, ${fmt(toGameY(y))})`;

interface BoardHandle {
  stage: Stage | null;
}

/** The field used throughout the course, with a coordinate readout under the mouse. */
function Board(props: {
  state: MatchState;
  mirrorKey?: string;
  handle: { current: BoardHandle };
  overlay?: ComponentChildren;
  aimAngle: number | null;
  dir: Dir;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState('');
  useEffect(() => {
    const stage = new Stage(canvas.current!);
    stage.themeId = profile.theme;
    stage.looks = { [ME]: look() };
    stage.setRockStyle(cosmeticValue('obstacle'));
    stage.activeSoldierId = 0;
    stage.aiming = true;
    stage.sync(props.state);
    props.handle.current.stage = stage;
    const onResize = () => stage.resize();
    window.addEventListener('resize', onResize);
    // Only boards on screen draw, since a lesson can have several.
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) stage.start();
      else stage.stop();
    });
    seen.observe(canvas.current!);
    return () => {
      seen.disconnect();
      window.removeEventListener('resize', onResize);
      stage.stop();
      props.handle.current.stage = null;
    };
  }, []);
  useEffect(() => {
    const stage = props.handle.current.stage;
    if (!stage) return;
    stage.aimAngle = props.aimAngle;
    stage.aimDir = props.dir;
  }, [props.aimAngle, props.dir]);
  const move = (e: MouseEvent) => {
    const stage = props.handle.current.stage;
    if (!stage) return;
    const p = stage.fieldPoint(e.clientX, e.clientY);
    setHover(`x = ${fmt(toGameX(p.x))}, y = ${fmt(toGameY(p.y))}`);
  };
  return (
    <div class="lesson-field">
      <canvas ref={canvas} width={770} height={450} onMouseMove={move} onMouseLeave={() => setHover('')} aria-label="Practice graph" role="img" />
      {hover && <span class="coords">{hover}</span>}
      {props.overlay}
    </div>
  );
}

function FunctionBox(props: {
  mode: ShotMode;
  expr: string;
  onExpr: (v: string) => void;
  onFire: () => void;
  disabled: boolean;
  error: string;
  fireLabel?: string;
}) {
  const bad = props.expr.trim() ? validate(props.expr, props.mode) : null;
  const box = useRef<HTMLInputElement>(null);
  const keys = useMathKeys();
  return (
    <>
      <div class="shotrow">
        <label>{modeLabel(props.mode)}
          <span class="sr-only"> function</span>
        </label>
        <input
          ref={box}
          type="text"
          inputMode={keys.on && !keys.typing ? 'none' : 'text'}
          value={props.expr}
          aria-label={`Function, ${modeLabel(props.mode)}`}
          maxLength={200}
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          placeholder="Type a function"
          onInput={(e) => props.onExpr((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') props.onFire();
          }}
        />
        <button class="primary fire" data-sfx="none" disabled={props.disabled || !props.expr.trim() || !!bad} onClick={props.onFire}>{props.fireLabel ?? 'Fire'}</button>
      </div>
      {keys.on && <MathKeys input={box} mode={props.mode} value={props.expr} onChange={props.onExpr} disabled={props.disabled} typing={keys.typing} setTyping={keys.setTyping} />}
      {props.expr.trim() && !bad && <Tex expr={props.expr} prefix={modeLabel(props.mode)} />}
      {(bad || props.error) && <p class="error" role="alert">{bad?.message ?? props.error}</p>}
    </>
  );
}

function AngleControls({ angle, onAngle, disabled }: { angle: number; onAngle: (a: number) => void; disabled?: boolean }) {
  const clamp = (a: number) => Math.max(-1.55, Math.min(1.55, a));
  return (
    <div class="controls2">
      <span>Angle {((angle * 180) / Math.PI).toFixed(1)}°</span>
      <button class="small" aria-label="Lower angle" disabled={disabled} onClick={() => onAngle(clamp(angle - 0.02))}>Down</button>
      <button class="small" aria-label="Raise angle" disabled={disabled} onClick={() => onAngle(clamp(angle + 0.02))}>Up</button>
      <button class="small" aria-label="Lower angle a lot" disabled={disabled} onClick={() => onAngle(clamp(angle - 0.1))}>Down more</button>
      <button class="small" aria-label="Raise angle a lot" disabled={disabled} onClick={() => onAngle(clamp(angle + 0.1))}>Up more</button>
    </div>
  );
}

/** Draws the curve for what's typed, as dashes. */
function showCurve(stage: Stage | null, state: MatchState, expr: string, angle: number, dir: Dir, fraction = 1): string {
  if (!stage) return '';
  stage.previewPath = null;
  if (!expr.trim() || validate(expr, state.config.mode)) return '';
  const me = state.soldiers[0]!;
  const path = simulateShot({ mode: state.config.mode, expr, angle, dir, from: { x: me.x, y: me.y }, terrain: new Terrain(state.circles, state.holes), targets: [] });
  stage.previewPath = { xs: path.xs, ys: path.ys, steps: Math.max(2, Math.ceil(path.steps * fraction)) };
  return REASON_TEXT[path.reason];
}

/** Fires for real on this board, and returns what happened. */
async function fireOn(stage: Stage | null, state: MatchState, terrain: Terrain, expr: string, angle: number, dir: Dir): Promise<ShotRecord> {
  const { record, result } = fire(state, ME, { expr, angle, dir }, terrain);
  soloNext(state);
  sound('fire', profile.muted);
  if (stage) {
    stage.state = state;
    await stage.playShot(record, { xs: result.xs, ys: result.ys, steps: result.steps });
  }
  return record;
}

function PlaygroundBlock({ block }: { block: Playground }) {
  const make = () => freeBoard(block.mode, block.from, block.targets ?? [], block.rocks ?? []);
  const state = useRef(make());
  const handle = useRef<BoardHandle>({ stage: null });
  const [expr, setExpr] = useState(block.start);
  const [angle, setAngle] = useState(block.angle ?? 0.5);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setInfo(showCurve(handle.current.stage, state.current, expr, angle, 1));
  }, [expr, angle]);

  const shoot = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const terrain = terrainOf(state.current);
      const record = await fireOn(handle.current.stage, state.current, terrain, expr, angle, 1);
      const hits = record.hits.length;
      setInfo(`${hits ? `It hit ${hits === 1 ? '1 target' : `${hits} targets`}. ` : ''}${REASON_TEXT[record.reason]} It ended at ${pointText(record.end.x, record.end.y)}.`);
    } catch (e) {
      if (e instanceof ParseError || e instanceof RuleError) setError(e.message);
      else throw e;
    }
    state.current = make();
    handle.current.stage?.sync(state.current);
    showCurve(handle.current.stage, state.current, expr, angle, 1);
    setBusy(false);
  };

  return (
    <div class="lesson-box">
      <p class="box-note"><Rich text={block.note} /></p>
      <Board state={state.current} handle={handle} aimAngle={block.mode === 'ode2' ? angle : null} dir={1} />
      <div class="chips" role="group" aria-label="Examples">
        {block.examples.map((ex) => (
          <button class={`chip ${expr === ex.expr ? 'on' : ''}`} disabled={busy} onClick={() => { setExpr(ex.expr); if (ex.angle !== undefined) setAngle(ex.angle); }}>
            <code>{ex.expr}</code>
            <small>{ex.note}</small>
          </button>
        ))}
      </div>
      <FunctionBox mode={block.mode} expr={expr} onExpr={setExpr} onFire={() => void shoot()} disabled={busy} error={error} />
      {block.mode === 'ode2' && <AngleControls angle={angle} onAngle={setAngle} disabled={busy} />}
      {info && <p class="muted box-info" role="status">{info}</p>}
    </div>
  );
}

function SlidersBlock({ block }: { block: Sliders }) {
  const state = useRef(freeBoard(block.mode, block.from));
  const handle = useRef<BoardHandle>({ stage: null });
  const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries(block.params.map((p) => [p.name, p.value])));
  const expr = useMemo(() => block.template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = Number((values[name] ?? 0).toFixed(3));
    return v < 0 ? `(${v})` : String(v);
  }), [values]);
  const angle = values.angle ?? 0;
  useEffect(() => {
    showCurve(handle.current.stage, state.current, expr, angle, 1);
  }, [expr, angle]);
  // The first draw has to wait until the board exists.
  useEffect(() => {
    showCurve(handle.current.stage, state.current, expr, angle, 1);
  }, []);
  return (
    <div class="lesson-box">
      <p class="box-note"><Rich text={block.note} /></p>
      <Board state={state.current} handle={handle} aimAngle={block.mode === 'ode2' ? angle : null} dir={1} />
      <p class="slider-expr">{modeLabel(block.mode)} <code>{expr}</code></p>
      <div class="sliders">
        {block.params.map((p) => (
          <label class="slider">
            <span>{p.label}: <strong>{p.name === 'angle' ? `${((values[p.name]! * 180) / Math.PI).toFixed(0)}°` : Number(values[p.name]!.toFixed(3))}</strong></span>
            <input type="range" min={p.min} max={p.max} step={p.step} value={values[p.name]} style={{ '--val': `${((values[p.name]! - p.min) / (p.max - p.min)) * 100}%` }} onInput={(e) => setValues({ ...values, [p.name]: Number((e.target as HTMLInputElement).value) })} />
          </label>
        ))}
      </div>
    </div>
  );
}

/** Says how close a miss was, which is what you need in order to adjust. */
function missText(record: ShotRecord, before: MatchState, path: { xs: ArrayLike<number>; ys: ArrayLike<number>; steps: number }): string {
  const hitIds = new Set(record.hits.map((h) => h.id));
  const remaining = before.soldiers.filter((s) => s.playerId === 'targets' && s.alive && !hitIds.has(s.id));
  if (!remaining.length) return REASON_TEXT[record.reason];
  const t = remaining[0]!;
  let best = Infinity;
  let bestY = 0;
  let passed = false;
  for (let i = 0; i < path.steps; i += 3) {
    const dx = Math.abs(path.xs[i]! - t.x);
    if (dx < best) {
      best = dx;
      bestY = path.ys[i]!;
      passed = dx < 3;
    }
  }
  if (!passed) return `${REASON_TEXT[record.reason]} It ended before reaching the target at ${pointText(t.x, t.y)}.`;
  const off = (t.y - bestY) / 15.4;
  return `${REASON_TEXT[record.reason]} At the target, your shot was ${fmt(Math.abs(off))} ${off > 0 ? 'above' : 'below'} it.`;
}

function ChallengeBlock({ block, onDone, done }: { block: Challenge; onDone: (id: string) => void; done: boolean }) {
  const state = useRef(challengeState(block));
  const terrain = useRef(terrainOf(state.current));
  const handle = useRef<BoardHandle>({ stage: null });
  const [expr, setExpr] = useState('');
  const [angle, setAngle] = useState(0);
  const [dir, setDir] = useState<Dir>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [won, setWon] = useState(false);
  const [hintsShown, setHintsShown] = useState(0);
  const [misses, setMisses] = useState(0);
  const [shotsLeft, setShotsLeft] = useState(block.shots ?? 1);

  // Your last miss stays on the board to adjust from, until you change something.
  const lastMiss = useRef<{ key: string; path: { xs: ArrayLike<number>; ys: ArrayLike<number>; steps: number } } | null>(null);
  const attemptKey = `${expr}|${angle}|${dir}`;

  useEffect(() => {
    const stage = handle.current.stage;
    if (busy || !stage) return;
    if (lastMiss.current?.key === attemptKey) {
      stage.previewPath = lastMiss.current.path;
      return;
    }
    lastMiss.current = null;
    showCurve(stage, state.current, expr, angle, dir, 1);
    if (!block.preview) stage.previewPath = null;
  }, [attemptKey, busy]);

  const reset = () => {
    state.current = challengeState(block);
    terrain.current = terrainOf(state.current);
    handle.current.stage?.sync(state.current);
    setShotsLeft(block.shots ?? 1);
  };

  const shoot = async () => {
    if (busy || !expr.trim()) return;
    if (block.requires && !new RegExp(block.requires.pattern).test(expr.replace(/\s/g, ''))) {
      setError(block.requires.message);
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    const before = JSON.parse(JSON.stringify(state.current)) as MatchState;
    try {
      const me = state.current.soldiers[0]!;
      const path = simulateShot({ mode: block.mode, expr, angle, dir, from: { x: me.x, y: me.y }, terrain: terrain.current, targets: [] });
      const record = await fireOn(handle.current.stage, state.current, terrain.current, expr, angle, block.ffa ? dir : 1);
      const cleared = soloCleared(state.current);
      const friend = soloHitFriend(state.current);
      const left = shotsLeft - 1;
      if (cleared && !friend) {
        setWon(true);
        sound('win', profile.muted);
        handle.current.stage?.celebrate();
        setMessage(`Direct hit, using ${expr.trim()}.`);
        onDone(block.id);
      } else if (friend) {
        setMisses((m) => m + 1);
        setMessage('That hit your teammate, which fails the shot. Try a curve that passes clear of them.');
        reset();
      } else if (left > 0) {
        setShotsLeft(left);
        setMessage(`${missText(record, before, path)} You have ${left} ${left === 1 ? 'shot' : 'shots'} left.`);
      } else {
        setMisses((m) => m + 1);
        setMessage(`Not quite. ${missText(record, before, path)} Adjust a number and try again.`);
        reset();
        lastMiss.current = { key: attemptKey, path: { xs: path.xs, ys: path.ys, steps: path.steps } };
      }
    } catch (e) {
      if (e instanceof ParseError || e instanceof RuleError) setError(e.message);
      else throw e;
    }
    setBusy(false);
  };

  const positions = () => {
    const s = state.current;
    const me = s.soldiers[0]!;
    const targets = s.soldiers.filter((q) => q.playerId === 'targets' && q.alive);
    const friends = s.soldiers.filter((q) => q.playerId === 'allies' && q.alive);
    return (
      <p class="muted positions">
        You: {pointText(me.x, me.y)}. {targets.length === 1 ? 'Target' : 'Targets'}: {targets.map((t) => pointText(t.x, t.y)).join(', ') || 'none left'}.
        {friends.length > 0 && ` Teammate: ${friends.map((t) => pointText(t.x, t.y)).join(', ')}.`}
      </p>
    );
  };

  const again = () => {
    setWon(false);
    setMessage('');
    setExpr('');
    reset();
  };

  return (
    <div class={`lesson-box challenge ${won || done ? 'cleared' : ''}`} data-challenge={block.id}>
      <h3>{block.title}{(won || done) && <span class="ok"> Done</span>}</h3>
      <p><Rich text={block.task} /></p>
      <Board state={state.current} handle={handle} aimAngle={block.mode === 'ode2' ? angle : null} dir={dir} />
      {positions()}
      {won ? (
        <div class="row">
          <p class="ok" role="status" style={{ margin: 0 }}>{message}</p>
          <button class="small" onClick={again}>Try another way</button>
        </div>
      ) : (
        <>
          <FunctionBox mode={block.mode} expr={expr} onExpr={setExpr} onFire={() => void shoot()} disabled={busy} error={error} />
          {block.mode === 'ode2' && <AngleControls angle={angle} onAngle={setAngle} disabled={busy} />}
          {block.ffa && (
            <div class="controls2" role="group" aria-label="Shot direction">
              <button class="small dir-plus" disabled={busy} onClick={() => setDir(1)} aria-pressed={dir === 1}>Fire toward +x</button>
              <button class="small dir-minus" disabled={busy} onClick={() => setDir(-1)} aria-pressed={dir === -1}>Fire toward −x</button>
            </div>
          )}
          {message && <p class="miss" role="status">{message}</p>}
          <div class="hints">
            {block.hints.slice(0, hintsShown).map((h, i) => <p class="hint"><strong>Hint {i + 1}:</strong> <Rich text={h} /></p>)}
            {hintsShown < block.hints.length ? (
              <button class={`small ${misses >= 2 ? 'on' : ''}`} onClick={() => setHintsShown(hintsShown + 1)}>{hintsShown === 0 ? 'Show a hint' : 'Show another hint'}</button>
            ) : (
              <button class="small" onClick={() => { setExpr(block.solution); if (block.angle !== undefined) setAngle(block.angle); if (block.dir) setDir(block.dir); }}>Fill in the answer</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function QuizBlock({ block, onDone, done }: { block: Quiz; onDone: (id: string) => void; done: boolean }) {
  const [picked, setPicked] = useState<number | null>(done ? block.answer : null);
  const right = picked === block.answer;
  return (
    <div class={`lesson-box quiz ${right ? 'cleared' : ''}`} data-quiz={block.id}>
      <h3><Rich text={block.q} /></h3>
      <div class="quiz-options" role="group" aria-label="Answers">
        {block.options.map((o, i) => (
          <button
            class={`${picked === i ? (i === block.answer ? 'right' : 'wrong') : ''}`}
            aria-pressed={picked === i}
            onClick={() => {
              setPicked(i);
              if (i === block.answer) {
                sound('turn', profile.muted);
                onDone(block.id);
              }
            }}
          >
            <Rich text={o} />
          </button>
        ))}
      </div>
      {picked !== null && (
        <p class={right ? 'ok' : 'error'} role="status">{right ? 'Right. ' : 'Not quite, try again. '}{right && <Rich text={block.why} />}</p>
      )}
    </div>
  );
}

function BlockView({ block, lesson, onDone }: { block: Block; lesson: Lesson; onDone: (id: string) => void }) {
  switch (block.t) {
    case 'h':
      return <h3 class="lesson-h"><Rich text={block.text} /></h3>;
    case 'p':
      return <p class="lesson-p"><Rich text={block.text} /></p>;
    case 'tip':
      return <p class="lesson-tip"><Rich text={block.text} /></p>;
    case 'table':
      return (
        <div class="lesson-table">
          <table><tbody>{block.rows.map(([a, b]) => <tr><td><code>{a}</code></td><td>{b}</td></tr>)}</tbody></table>
        </div>
      );
    case 'play':
      return <PlaygroundBlock block={block} />;
    case 'sliders':
      return <SlidersBlock block={block} />;
    case 'challenge':
      return <ChallengeBlock block={block} onDone={onDone} done={profile.learnDone.includes(block.id)} />;
    case 'quiz':
      return <QuizBlock block={block} onDone={onDone} done={profile.learnDone.includes(block.id)} />;
  }
  void lesson;
  return null;
}

function LessonScreen({ lesson }: { lesson: Lesson }) {
  useProfile();
  const index = LESSONS.indexOf(lesson);
  const next = LESSONS[index + 1];
  const prev = LESSONS[index - 1];
  const required = requiredIds(lesson);
  const finished = required.filter((id) => profile.learnDone.includes(id)).length;
  const isRead = required[0]!.startsWith('read:');
  useEffect(() => {
    // Reading-only lessons count as done once opened.
    if (isRead) markLearned(required[0]!);
  }, [lesson.id]);
  return (
    <div class="page lesson">
      <TopBar title="Learn" />
      <p class="crumb"><a href="#/learn">All lessons</a>, lesson {index + 1} of {LESSONS.length}</p>
      <h2>{lesson.title}</h2>
      <p class="muted">{lesson.blurb}</p>
      {lesson.blocks.map((b, i) => <BlockView key={`${lesson.id}-${i}`} block={b} lesson={lesson} onDone={markLearned} />)}
      <div class="lesson-foot">
        {!isRead && <p class={finished === required.length ? 'ok' : 'muted'}>{finished === required.length ? 'Lesson complete.' : `${finished} of ${required.length} exercises done.`}</p>}
        <div class="row">
          {prev && <a class="btn" href={`#/learn/${prev.id}`}>Previous lesson</a>}
          {next ? <a class={`btn ${finished === required.length ? 'primary' : ''}`} href={`#/learn/${next.id}`}>Next: {next.title}</a> : <a class="btn primary" href="#/local">Play your first match</a>}
        </div>
      </div>
    </div>
  );
}

function Overview() {
  useProfile();
  const done = LESSONS.filter((l) => lessonDone(l, profile.learnDone)).length;
  const nextUp = LESSONS.find((l) => !lessonDone(l, profile.learnDone));
  return (
    <div class="page">
      <TopBar title="Learn" />
      <div class="sheet learn-top">
        <h3>{done === 0 ? 'Learn to play, step by step' : done === LESSONS.length ? "You've finished the course" : 'Pick up where you left off'}</h3>
        <p>Each lesson explains one idea, lets you experiment with it on a real board, then has you try it. By the end, you'll be able to read any board and pick the right shot.</p>
        <div class="bar" role="progressbar" aria-label="Course progress" aria-valuenow={done} aria-valuemax={LESSONS.length}><i style={{ width: `${(done / LESSONS.length) * 100}%` }} /></div>
        <p class="muted" style={{ marginTop: 6 }}>{done} of {LESSONS.length} lessons complete</p>
        {nextUp ? (
          <a class="btn primary" href={`#/learn/${nextUp.id}`}>{done === 0 ? 'Start the first lesson' : `Continue: ${nextUp.title}`}</a>
        ) : (
          <div class="row">
            <a class="btn primary" href="#/local">Play bots</a>
            <a class="btn" href="#/campaign">Try the campaign</a>
            <a class="btn" href="#/online">Play online</a>
          </div>
        )}
      </div>
      {UNITS.map((unit, u) => {
        const unitDone = unit.lessons.filter((l) => lessonDone(l, profile.learnDone)).length;
        return (
          <div class="sheet">
            <h3>{u + 1}. {unit.title} <small class="muted">{unitDone}/{unit.lessons.length}</small></h3>
            <p class="muted">{unit.blurb}</p>
            <div class="lesson-list">
              {unit.lessons.map((l) => {
                const isDone = lessonDone(l, profile.learnDone);
                return (
                  <a class={`lesson-link ${isDone ? 'done' : ''} ${nextUp === l ? 'next' : ''}`} href={`#/learn/${l.id}`}>
                    <strong>{isDone && <span aria-label="Complete">✓ </span>}{l.title}</strong>
                    <small>{l.blurb}</small>
                  </a>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Learn({ lessonId }: { lessonId?: string }) {
  if (!lessonId) return <Overview />;
  const lesson = LESSONS.find((l) => l.id === lessonId);
  if (!lesson) {
    return (
      <div class="page">
        <TopBar title="Learn" />
        <div class="sheet"><h3>That lesson doesn't exist</h3><a class="btn" href="#/learn">See all lessons</a></div>
      </div>
    );
  }
  return <LessonScreen key={lesson.id} lesson={lesson} />;
}
