import { PLACEMENT_MATCHES, RANKS, rankFor, type RatingChange } from '@mathbattles/sim';
import { useEffect } from 'preact/hooks';
import { t } from '../i18n';
import { profile } from '../store';
import { sound } from '../util';
import { RankBadge, tierProgress } from './RankedInfo';

/**
 * Your rating change after a ranked match. Moving into a new tier turns it into a
 * "Rank up!" or "Rank down" card with the new badge, its own sound, and the way to the next tier.
 */
export function RankChange({ change }: { change: RatingChange }) {
  const before = rankFor(change.before);
  const after = rankFor(change.after);
  const delta = change.after - change.before;
  const from = RANKS.findIndex((r) => r.name === before);
  const to = RANKS.findIndex((r) => r.name === after);
  const moved = to > from ? 'up' : to < from ? 'down' : null;
  const p = tierProgress(change.after);
  useEffect(() => {
    if (moved) sound(moved === 'up' ? 'rankUp' : 'rankDown', profile.muted);
  }, [moved, change.after]);
  // games counts this match, so this was placement match number games.
  const placement = change.games <= PLACEMENT_MATCHES ? t('rank.placement', { n: change.games, total: PLACEMENT_MATCHES }) : null;
  return (
    <div class={`rank-change ${moved ? `moved ${moved}` : ''}`} role="status">
      <RankBadge index={to} size={moved ? 72 : 40} />
      <div class="rank-change-text">
        {moved && <strong class="rank-change-title">{moved === 'up' ? t('rank.up') : t('rank.down')}</strong>}
        <span>
          {moved ? t('rank.nowIn', { rank: after }) : after}
          {' '}
          <b class={delta >= 0 ? 'gain' : 'loss'}>{delta >= 0 ? '+' : ''}{delta}</b>
          {' '}
          <small class="muted">({change.after})</small>
        </span>
        <div class="bar rank-bar" role="progressbar" aria-valuenow={Math.round(p.share * 100)} aria-valuemax={100} aria-label={t('ui.progressToTheNextRank')}>
          <i style={{ width: `${p.share * 100}%` }} />
        </div>
        <small class="muted">{p.next ? t('rank.toNext', { n: p.toNext, rank: p.next.name }) : t('rank.top')}</small>
        {placement && <small class="placement-tag"><span>{placement}</span></small>}
      </div>
    </div>
  );
}
