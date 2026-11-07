import { Terrain, simulateShot, toPxX, toPxY } from '@mathbattles/sim';
import { useEffect, useRef } from 'preact/hooks';
import { currentQuests, profile } from '../store';
import { Stage } from '../render/stage';
import { TopBar } from './Shared';

const DEMOS = [
  { expr: '5*sin(x/3)', from: [-22, -1], label: 'y = 5 sin(x/3)' },
  { expr: 'x/4+3*sin(x/2)', from: [-22, -4], label: 'y = x/4 + 3 sin(x/2)' },
  { expr: '-x^2/60', from: [-20, 6], label: 'y = -x²/60' },
  { expr: '7/(1+exp(-2*(x-4)))', from: [-22, -5], label: 'y = 7/(1+exp(-2(x-4)))' },
];

/** The hero is the game itself: a real shot traced by the real simulation. */
function HeroDemo() {
  const ref = useRef<HTMLCanvasElement>(null);
  const caption = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const stage = new Stage(ref.current!);
    stage.themeId = profile.theme;
    stage.start();
    let live = true;
    const run = async (i: number) => {
      if (!live) return;
      const demo = DEMOS[i % DEMOS.length]!;
      const from = { x: toPxX(demo.from[0]!), y: toPxY(demo.from[1]!) };
      const terrain = new Terrain([]);
      const probe = simulateShot({ mode: 'fn', expr: demo.expr, from, terrain, targets: [] });
      const pick = (f: number) => {
        const k = Math.floor(probe.steps * f);
        return { x: probe.xs[k]!, y: probe.ys[k]! };
      };
      const a = pick(0.55);
      const b = pick(0.85);
      const off = (Math.floor(probe.steps * 0.3));
      const rock = { x: probe.xs[off]!, y: probe.ys[off]! + 62, r: 38 };
      const rock2 = { x: probe.xs[Math.floor(probe.steps * 0.7)]!, y: probe.ys[Math.floor(probe.steps * 0.7)]! - 58, r: 30 };
      const state = {
        config: { kind: 'teams', mode: 'fn', abilities: false, soldiers: 1, seed: 0 },
        players: [
          { id: 'a', name: '', team: 1, soldierIds: [0], nextSoldier: 0, charge: 0, missileArmed: false, connected: true, kills: 0, deaths: 0, shots: 0, bestCombo: 0 },
          { id: 'b', name: '', team: 2, soldierIds: [1, 2], nextSoldier: 0, charge: 0, missileArmed: false, connected: true, kills: 0, deaths: 0, shots: 0, bestCombo: 0 },
        ],
        soldiers: [
          { id: 0, playerId: 'a', x: from.x, y: from.y, alive: true, angle: 0 },
          { id: 1, playerId: 'b', x: a.x, y: a.y, alive: true, angle: 0 },
          { id: 2, playerId: 'b', x: b.x, y: b.y, alive: true, angle: 0 },
        ],
        circles: [rock, rock2],
        holes: [],
        turn: 0,
        turnNumber: 1,
        over: false,
        winner: null,
        log: [],
      } as Parameters<Stage['sync']>[0];
      stage.sync(state);
      stage.activeSoldierId = 0;
      if (caption.current) caption.current.textContent = `${demo.label}: two hits with one function`;
      await new Promise((r) => setTimeout(r, 900));
      if (!live) return;
      const hit = (s: { x: number; y: number }, id: number) => {
        let step = 0;
        for (let k = 0; k < probe.steps; k++) {
          if (Math.hypot(probe.xs[k]! - s.x, probe.ys[k]! - s.y) < 7) {
            step = k;
            break;
          }
        }
        return { id, step };
      };
      await stage.playShot(
        {
          playerId: 'a', soldierId: 0, expr: demo.expr, mode: 'fn', dir: 1, angle: 0, from, mirrored: false,
          steps: probe.steps, reason: probe.reason, end: probe.end, hits: [hit(a, 1), hit(b, 2)], blastR: 12, blastKills: [],
        },
        { xs: probe.xs, ys: probe.ys, steps: probe.steps },
      );
      void run(i + 1);
    };
    void document.fonts?.ready.then(() => run(0));
    return () => {
      live = false;
      stage.stop();
    };
  }, []);
  return (
    <div class="hero">
      <canvas ref={ref} width={770} height={450} aria-hidden="true" />
      <h1>MathBattles.io</h1>
      <p class="tag" ref={caption}>Type a function. Your shot follows its graph.</p>
    </div>
  );
}

const MODES = [
  { href: '#/campaign', name: 'Campaign', text: 'Puzzles that teach you, from lines to y″.' },
  { href: '#/daily', name: 'Daily Challenge', text: 'One map for everyone today. Fewest shots wins.' },
  { href: '#/practice', name: 'Practice', text: 'No timer, with a preview of your curve.' },
  { href: '#/ranked', name: 'Ranked', text: 'One-on-one for a place on the ladder.' },
  { href: '#/learn', name: 'Learn', text: 'Every function, plus tricks for hard shots.' },
  { href: '#/shop', name: 'Shop', text: 'Spend Sparks on hats, trails, and titles.' },
];

export function Menu() {
  const quests = currentQuests();
  const newPlayer = Object.keys(profile.stars).length === 0 && profile.matches === 0;
  return (
    <div class="page">
      <TopBar />
      <HeroDemo />
      <div class="menu-main">
        {newPlayer ? (
          <>
            <a class="btn primary" href="#/level/0-1">Learn to play in 3 shots</a>
            <a class="btn" href="#/online">Play online</a>
          </>
        ) : (
          <a class="btn primary" href="#/online">Play online</a>
        )}
        <a class="btn" href="#/local">Play bots or friends here</a>
      </div>
      <div class="menu-list">
        {MODES.map((m) => (
          <a class="menu-item" href={m.href}><strong>{m.name}</strong><span>{m.text}</span></a>
        ))}
      </div>
      <div class="sheet" style={{ marginTop: 16 }}>
        <h3>Quests</h3>
        {quests.map((q) => (
          <div class="row" style={{ justifyContent: 'space-between' }}>
            <span class={q.paid ? 'ok' : ''}>{q.text}</span>
            <span>{q.progress}/{q.goal}, {q.reward} Sparks</span>
          </div>
        ))}
      </div>
      <p class="muted" style={{ marginTop: 16 }}>
        <a href="#/settings">Settings</a>{' '}<a href="#/leaderboard">Leaderboard</a>{' '}<a href="#/privacy">Privacy</a>{' '}Inspired by Graphwar and Math Wars. Not affiliated with either.
      </p>
    </div>
  );
}
