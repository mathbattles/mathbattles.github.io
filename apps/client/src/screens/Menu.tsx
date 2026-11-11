import { useEffect, useRef } from 'preact/hooks';
import { runDemo } from '../render/demo';
import { Stage } from '../render/stage';
import { cosmeticValue, profile } from '../store';
import { QuestsPanel } from './Season';
import { TopBar } from './Shared';
import { t } from '../i18n';

/** The hero is the game itself: a real shot traced by the real simulation. */
function HeroDemo() {
  const ref = useRef<HTMLCanvasElement>(null);
  const caption = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const stage = new Stage(ref.current!, 1.5);
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
      <h1><span>{t('ui.mathbattlesIo')}</span></h1>
      <p class="tag" ref={caption}>{t('ui.typeAFunctionYourShotFollows')}</p>
    </div>
  );
}

const MODES = [
  { href: '#/campaign', name: 'Campaign', text: 'Puzzles that teach you, from lines to y″.' },
  { href: '#/maps', name: 'Custom maps', text: 'Build your own maps, share them, and play other people’s.' },
  { href: '#/practice', name: 'Free Play', text: 'No timer, with a preview of your curve.' },
  { href: '#/ranked', name: 'Ranked', text: 'One-on-one for a place on the ladder.' },
  { href: '#/learn', name: 'Learn', text: 'A full course, from your first shot to winning matches.' },
  { href: '#/shop', name: 'Cosmetics', text: 'Spend Sparks on hats, trails, and obstacles.' },
  { href: '#/abilities', name: 'Abilities', text: 'Hop, Ricochet and Heavy Shot: spend energy to change your shot.' },
  { href: '#/season', name: 'Season pass', text: 'Fifty levels of rewards, quests, and the countdown to the season end.' },
  { href: '#/inventory', name: 'Inventory', text: 'Everything you own, and how rare it is.' },
  { href: '#/friends', name: 'Friends', text: 'Add friends, start a party, and play together.' },
];

export function Menu() {
  const newPlayer = Object.keys(profile.stars).length === 0 && profile.matches === 0;
  return (
    <div class="page">
      <TopBar home />
      <HeroDemo />
      <div class="menu-main">
        {newPlayer ? (
          <>
            <a class="btn primary" href="#/level/0-1">{t('ui.learnToPlayIn3Shots')}</a>
            <a class="btn" href="#/online">{t('ui.playOnline')}</a>
          </>
        ) : (
          <a class="btn primary" href="#/online">{t('ui.playOnline')}</a>
        )}
        <a class="btn" href="#/local">{t('ui.playBotsOrFriendsHere')}</a>
      </div>
      <div class="menu-list">
        {MODES.map((m) => (
          <a class="menu-item" href={m.href}><strong>{m.name}</strong><span>{m.text}</span></a>
        ))}
      </div>
      <QuestsPanel />
      <p class="muted" style={{ marginTop: 16 }}>
        <span class="phone-only"><a href="#/settings">{t('ui.settings')}</a>{' '}<a href="#/leaderboard">{t('ui.leaderboard')}</a>{' '}</span><a href="#/privacy">{t('ui.privacy')}</a>{' '}Inspired by Graphwar and Math Wars. Not affiliated with either.
      </p>
    </div>
  );
}
