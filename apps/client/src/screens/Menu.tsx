import { useEffect, useRef } from 'preact/hooks';
import { runDemo } from '../render/demo';
import { Stage } from '../render/stage';
import { cosmeticValue, currentQuests, profile } from '../store';
import { TopBar } from './Shared';

/** The hero is the game itself: a real shot traced by the real simulation. */
function HeroDemo() {
  const ref = useRef<HTMLCanvasElement>(null);
  const caption = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const stage = new Stage(ref.current!);
    stage.themeId = profile.theme;
    stage.setRockStyle(cosmeticValue('obstacle'));
    stage.start();
    const stopDemo = runDemo(stage, {
      onCaption: (label) => {
        if (caption.current) caption.current.textContent = `${label}: two hits with one function`;
      },
    });
    return () => {
      stopDemo();
      stage.stop();
    };
  }, []);
  return (
    <div class="hero">
      <canvas ref={ref} width={770} height={450} aria-hidden="true" />
      <h1><span>MathBattles.io</span></h1>
      <p class="tag" ref={caption}>Type a function. Your shot follows its graph.</p>
    </div>
  );
}

const MODES = [
  { href: '#/campaign', name: 'Campaign', text: 'Puzzles that teach you, from lines to y″.' },
  { href: '#/daily', name: 'Daily Challenge', text: 'One map for everyone today. Fewest shots wins.' },
  { href: '#/practice', name: 'Free Play', text: 'No timer, with a preview of your curve.' },
  { href: '#/ranked', name: 'Ranked', text: 'One-on-one for a place on the ladder.' },
  { href: '#/learn', name: 'Learn', text: 'A full course, from your first shot to winning matches.' },
  { href: '#/shop', name: 'Shop', text: 'Spend Sparks on hats, trails, and obstacles.' },
];

export function Menu() {
  const quests = currentQuests();
  const newPlayer = Object.keys(profile.stars).length === 0 && profile.matches === 0;
  return (
    <div class="page">
      <TopBar home />
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
        <span class="phone-only"><a href="#/settings">Settings</a>{' '}<a href="#/leaderboard">Leaderboard</a>{' '}</span><a href="#/privacy">Privacy</a>{' '}Inspired by Graphwar and Math Wars. Not affiliated with either.
      </p>
    </div>
  );
}
