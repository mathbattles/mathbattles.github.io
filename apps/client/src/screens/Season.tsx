import { COSMETICS, SEASON, SEASON_REWARDS, seasonActive, seasonLevel, utcDayNumber, weekNumber } from '@mathbattles/sim';
import { useEffect, useRef } from 'preact/hooks';
import { currentQuests, profile } from '../store';
import { ItemThumb } from './Meta';
import { useProfile } from './Shared';

const KIND_LABEL: Record<string, string> = { hat: 'Hat', trail: 'Shot trail', title: 'Title', blast: 'Kill effect', obstacle: 'Obstacles' };

function timeLeft(ms: number): string {
  if (ms <= 0) return 'ended';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} left`;
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return hours >= 1 ? `${hours} hour${hours === 1 ? '' : 's'} left` : `${mins} min left`;
}

/** The season pass: 50 levels of rewards, earned with season XP from matches and quests. */
export function SeasonPass() {
  useProfile();
  const track = useRef<HTMLDivElement>(null);
  const xp = profile.seasonId === SEASON.id ? profile.seasonXp : 0;
  const lv = seasonLevel(xp);
  const active = seasonActive(Date.now());
  useEffect(() => {
    // Start the track at the next reward.
    const el = track.current?.querySelector<HTMLElement>('.pass-level.next');
    if (el && track.current) track.current.scrollLeft = el.offsetLeft - track.current.clientWidth / 2 + el.clientWidth / 2;
  }, []);
  return (
    <div class="sheet season">
      <div class="season-head">
        <div>
          <h3 style={{ margin: 0 }}>{SEASON.name} pass</h3>
          <p class="muted small-note" style={{ margin: 0 }}>
            {active ? `Ends at Christmas, ${timeLeft(SEASON.ends - Date.now())}.` : 'This season has ended.'} Earn season XP from matches and quests.
          </p>
        </div>
        <div class="season-level" aria-label={`Season level ${lv.level} of ${SEASON.levels}`}>
          <span>Level</span>
          <strong>{lv.level}</strong>
        </div>
      </div>
      <div class="bar season-bar" role="progressbar" aria-valuenow={lv.into} aria-valuemax={lv.need} aria-label="Progress to the next season level">
        <i style={{ width: `${(lv.into / lv.need) * 100}%` }} />
      </div>
      <p class="muted small-note" style={{ margin: '4px 0 10px' }}>{lv.maxed ? 'Every level is unlocked. Well played!' : `${lv.into} of ${lv.need} XP to level ${lv.level + 1}.`}</p>
      <div class="pass-track" ref={track} role="list" aria-label="Season rewards">
        {SEASON_REWARDS.map((r) => {
          const got = profile.seasonPaid.includes(r.level) || lv.level >= r.level;
          const next = r.level === lv.level + 1;
          const item = 'cosmetic' in r ? COSMETICS.find((c) => c.id === r.cosmetic) : undefined;
          return (
            <div role="listitem" class={`pass-level ${got ? 'got' : ''} ${next ? 'next' : ''} ${r.level === SEASON.levels ? 'final' : ''} ${item ? `kind-${item.kind}` : 'kind-sparks'}`}>
              <span class="pass-num">{r.level}</span>
              {item ? <ItemThumb item={item} /> : <div class="pass-sparks" aria-hidden="true">✦</div>}
              <strong>{item ? item.name : `${'sparks' in r ? r.sparks : 0} Sparks`}</strong>
              <small>{item ? KIND_LABEL[item.kind] : 'Currency'}</small>
              {got && <span class="pass-check" aria-label="Unlocked">✓</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Today's quests and this week's, with what each one pays. */
export function QuestsPanel() {
  useProfile();
  const quests = currentQuests();
  const now = Date.now();
  const day = utcDayNumber(now);
  const nextDay = (day + 1) * 86_400_000;
  // Weeks start on Monday (UTC), the same as the weekly quest reset.
  const nextWeek = ((weekNumber(day) + 1) * 7 - 3) * 86_400_000;
  const group = (weekly: boolean) => quests.filter((q) => !!q.weekly === weekly);
  const list = (items: ReturnType<typeof currentQuests>) => (
    <ul class="quests">
      {items.map((q) => (
        <li class={q.paid ? 'done' : ''}>
          <div class="quest-text">
            <span>{q.text}</span>
            <small class="muted">{q.reward} Sparks and {q.seasonXp} season XP</small>
          </div>
          <div class="quest-progress">
            <div class="bar" role="progressbar" aria-valuenow={q.progress} aria-valuemax={q.goal} aria-label={q.text}><i style={{ width: `${(q.progress / q.goal) * 100}%` }} /></div>
            <small>{q.paid ? 'Done' : `${q.progress}/${q.goal}`}</small>
          </div>
        </li>
      ))}
    </ul>
  );
  return (
    <div class="sheet quests-sheet">
      <h3>Quests</h3>
      <div class="quest-group">
        <h4>Today <small class="muted">New quests in {timeLeft(nextDay - now).replace(' left', '')}</small></h4>
        {list(group(false))}
      </div>
      <div class="quest-group">
        <h4>This week <small class="muted">New quests in {timeLeft(nextWeek - now).replace(' left', '')}</small></h4>
        {list(group(true))}
      </div>
    </div>
  );
}
