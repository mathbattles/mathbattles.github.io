import { ACHIEVEMENTS } from '@mathbattles/sim';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { CHAPTERS, LEVELS, buildLevel, levelUnlocked, parFor, starsFor } from '../content/campaign';
import { SoloSession } from '../game/session';
export { ReplayScreen, ShortReplay } from './Replay';
import { grantAchievement, profile, saveProfile, setStars } from '../store';
import { go, modeName } from '../util';
import { GameView } from './GameView';
import { TopBar, useProfile } from './Shared';
import { t } from '../i18n';

function Stars({ n }: { n: number }) {
  return <span class="stars" aria-label={`${n} of 3 stars`}>{'★'.repeat(n)}{'☆'.repeat(3 - n)}</span>;
}

export function Campaign() {
  useProfile();
  const total = LEVELS.reduce((a, l) => a + (profile.stars[l.id] ?? 0), 0);
  return (
    <div class="page">
      <TopBar title={t('ui.campaign')} />
      <p>{total} of {LEVELS.length * 3} stars. Each level teaches one idea. You earn a star for clearing it, one for clearing it in a single shot, and one for a short function.</p>
      {CHAPTERS.map((ch, c) => (
        <div class="sheet">
          <h3>{ch.name}</h3>
          <p class="muted">{ch.blurb}</p>
          <div class="levels">
            {LEVELS.filter((l) => l.chapter === c).map((l) => {
              const open = levelUnlocked(l, profile.stars);
              return (
                <button class="level" disabled={!open} onClick={() => go(`/level/${l.id}`)}>
                  {l.title}
                  <small>{open ? <Stars n={profile.stars[l.id] ?? 0} /> : 'Locked'}</small>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function LevelScreen({ id }: { id: string }) {
  const level = LEVELS.find((l) => l.id === id);
  const [attempt, setAttempt] = useState(1);
  const session = useMemo(() => (level ? new SoloSession(buildLevel(level), { maxShots: 5 }) : null), [id, attempt]);
  const [result, setResult] = useState<null | { cleared: boolean; friendHit: boolean; stars: number; gained: number }>(null);

  useEffect(() => {
    setResult(null);
    if (!session || !level) return;
    session.onFinish = (o) => {
      if (o.cleared) {
        const stars = starsFor(level, o.shots);
        const gained = setStars(level.id, stars);
        if (LEVELS.every((l) => (profile.stars[l.id] ?? 0) > 0)) grantAchievement('campaign-complete');
        setResult({ cleared: true, friendHit: false, stars, gained });
      } else {
        setResult({ cleared: false, friendHit: o.friendHit, stars: 0, gained: 0 });
      }
    };
  }, [session]);

  if (!level || !session) {
    return <div class="page"><TopBar /><p>{t('ui.thatLevelDoesnTExist')} <a href="#/campaign">{t('ui.openTheCampaign')}</a>.</p></div>;
  }
  const idx = LEVELS.indexOf(level);
  const next = LEVELS[idx + 1];
  return (
    <GameView
      key={`${id}-${attempt}`}
      session={session}
      coach={level.coach?.[0] ?? level.tip}
      header={<span class="row"><a class="btn small" href="#/campaign">{t('ui.levels')}</a><strong>{level.title}</strong></span>}
      soloInfo={`${modeName(level.mode)}. Up to 5 shots. Short function: ${parFor(level)} characters or fewer.`}
      result={result && (
        <div class="sheet result-card">
          {result.cleared ? (
            <>
              <h2>{t('ui.levelCleared')} <Stars n={result.stars} /></h2>
              {result.gained > 0 && <p>You earned {result.gained * 15} Sparks.</p>}
            </>
          ) : (
            <>
              <h2>{result.friendHit ? 'You hit a teammate' : 'Out of shots'}</h2>
              <p>{result.friendHit ? 'Your shot passed through a teammate. Bend it around them and retry.' : 'Retry and adjust the numbers in your function.'}</p>
            </>
          )}
          <div class="row">
            {result.cleared && next && <button class="primary" onClick={() => go(`/level/${next.id}`)}>{t('ui.nextLevel')}</button>}
            <button class={result.cleared ? '' : 'primary'} onClick={() => setAttempt(attempt + 1)}>{t('ui.retry')}</button>
            <a class="btn" href="#/campaign">{t('ui.allLevels')}</a>
          </div>
        </div>
      )}
    />
  );
}

export const achievementList = ACHIEVEMENTS;
