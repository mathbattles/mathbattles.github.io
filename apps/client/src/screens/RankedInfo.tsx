import { PLACEMENT_MATCHES, RANKS, START_RATING, rankFor, type MatchRecord } from '@mathbattles/sim';
import { useEffect, useState } from 'preact/hooks';
import { useAuth } from '../auth';
import { loadHistory } from '../history';
import { fetchLeaderboard, myRanked, type LeaderRow } from '../net/api';
import { MatchList } from './History';
import { t } from '../i18n';

/** Where a rating sits: its tier, the next tier, and how far along it is. */
export function tierProgress(rating: number) {
  const index = RANKS.reduce((best, r, i) => (rating >= r.min ? i : best), 0);
  const tier = RANKS[index]!;
  const next = RANKS[index + 1];
  const share = next ? Math.max(0, Math.min(1, (rating - tier.min) / (next.min - tier.min))) : 1;
  return { index, tier, next, share, toNext: next ? next.min - rating : 0 };
}

/** Each tier's colour, from bronze Arithmetic up to gold Medalist. */
const RANK_COLORS = ['#c08a5b', '#a9b4c0', '#5fb0e8', '#57d977', '#b57bff', '#ffcf2e'];

/** The drawing at the centre of each tier's badge: a sign of that branch of maths. */
function RankMark({ index }: { index: number }) {
  const line = { fill: 'none', stroke: 'currentColor', 'stroke-width': 4.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;
  switch (index) {
    case 0: // Arithmetic: a plus sign.
      return <path {...line} d="M32 19v26M19 32h26" />;
    case 1: // Algebra: an x.
      return <path {...line} d="M21 22c6 0 8 4 11 10s5 10 11 10M43 22c-5 0-8 6-11 10s-6 10-11 10" />;
    case 2: // Geometry: a triangle with a compass arc.
      return <g {...line}><path d="M32 18L45 43H19Z" /><path stroke-width="3" d="M24 43a8 8 0 0 1 3.5-6.6" /></g>;
    case 3: // Calculus: an integral sign.
      return <path {...line} d="M38 18c-4-3-8 0-7 5l2 18c1 5-3 8-7 5" />;
    case 4: // Analysis: an infinity loop.
      return <path {...line} d="M32 32c-4-6-13-6-13 0s9 6 13 0 13-6 13 0-9 6-13 0Z" />;
    default: // Medalist: a star.
      return <path {...line} fill="#ffffff" fill-opacity="0.9" stroke-width="3" d="M32 17l4.4 9.3 10.1 1.3-7.4 7 1.9 10L32 39.7l-9 4.9 1.9-10-7.4-7 10.1-1.3Z" />;
  }
}

/** A hand-drawn badge for a tier: a coloured medal with that branch of maths drawn on it. */
export function RankBadge({ index, size = 64 }: { index: number; size?: number }) {
  const i = Math.max(0, Math.min(index, RANK_COLORS.length - 1));
  const fill = RANK_COLORS[i]!;
  // Higher tiers get more notches around the rim.
  const notches = 6 + i * 2;
  const rim = Array.from({ length: notches * 2 }, (_, k) => {
    const a = (k / (notches * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = k % 2 ? 26.5 : 29.5;
    return `${(32 + Math.cos(a) * r).toFixed(1)},${(32 + Math.sin(a) * r).toFixed(1)}`;
  }).join(' ');
  return (
    <svg class="rank-badge" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <polygon points={rim} fill={fill} stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" />
      <circle cx="32" cy="32" r="20" fill="#ffffff" fill-opacity="0.35" stroke="currentColor" stroke-width="2" />
      <RankMark index={i} />
    </svg>
  );
}

/** Every tier, highest first, with where it starts. Guests see it too, before signing up. */
export function RankLadder({ here }: { here?: number }) {
  return (
    <div class="sheet">
      <h3>{t('ui.ranks')}</h3>
      <ol class="rank-ladder">
        {[...RANKS].reverse().map((r) => {
          const i = RANKS.indexOf(r);
          return (
            <li class={i === here ? 'here' : ''}>
              <RankBadge index={i} size={26} />
              <span>{r.name}</span>
              <small class="muted">{i === 0 ? t('rank.startAt', { n: START_RATING }) : `${r.min}+`}</small>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** "Placement 2 / 3" while the first ranked matches still count double, or null after. */
export function placementText(games: number | undefined): string | null {
  if (games === undefined || games >= PLACEMENT_MATCHES) return null;
  return t('rank.placement', { n: games + 1, total: PLACEMENT_MATCHES });
}

/** Your ranked standing, record and recent ranked matches. */
export function RankedInfo() {
  const auth = useAuth();
  const [me, setMe] = useState<{ rating: number; games: number; place: number | null; total: number } | null>(null);
  const [matches, setMatches] = useState<MatchRecord[] | null>(null);
  const [top, setTop] = useState<LeaderRow[] | null>(null);
  useEffect(() => {
    void fetchLeaderboard().then((rows) => setTop(rows ? rows.slice(0, 10) : []));
  }, []);
  useEffect(() => {
    if (!auth.ready) return;
    let live = true;
    if (auth.user) void myRanked().then((r) => live && setMe(r.data ?? null));
    void loadHistory(auth.token).then((list) => live && setMatches(list.filter((m) => m.kind === 'ranked')));
    return () => {
      live = false;
    };
  }, [auth.ready, auth.user?.uid]);

  const rating = me?.rating ?? auth.rating ?? START_RATING;
  const p = tierProgress(rating);
  const ranked = matches ?? [];
  const wins = ranked.filter((m) => m.result === 'win').length;
  const losses = ranked.filter((m) => m.result === 'loss').length;
  let streak = 0;
  for (const m of ranked) {
    if (streak === 0) streak = m.result === 'win' ? 1 : m.result === 'loss' ? -1 : 0;
    else if (streak > 0 && m.result === 'win') streak++;
    else if (streak < 0 && m.result === 'loss') streak--;
    else break;
  }
  const change = ranked.slice(0, 10).reduce((sum, m) => sum + (m.ratingDelta ?? 0), 0);

  return (
    <>
      <div class="sheet rank-card">
        <div class="rank-top">
          <RankBadge index={p.index} size={86} />
          <div>
            <p class="muted" style={{ margin: 0 }}>{t('ui.yourRank')}</p>
            <h2 style={{ margin: 0 }}>{p.tier.name}</h2>
            <p style={{ margin: '2px 0 0' }}><strong>{rating}</strong> rating{me?.place ? `, #${me.place} of ${me.total} ranked players` : ''}</p>
            {placementText(me?.games) && <p class="placement-tag"><span>{placementText(me?.games)}</span> <small class="muted">{t('rank.placementNote')}</small></p>}
          </div>
        </div>
        <div class="bar rank-bar" role="progressbar" aria-valuenow={Math.round(p.share * 100)} aria-valuemax={100} aria-label={t('ui.progressToTheNextRank')}>
          <i style={{ width: `${p.share * 100}%` }} />
        </div>
        <p class="muted small-note" style={{ marginTop: 6 }}>{p.next ? `${p.toNext} more rating to reach ${p.next.name}.` : 'The highest rank. Stay on top.'}</p>
        <div class="rank-stats">
          <div><strong>{me?.games ?? ranked.length}</strong><span>{t('ui.matches')}</span></div>
          <div><strong>{wins}–{losses}</strong><span>{t('ui.wonLost')}</span></div>
          <div><strong>{wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0}%</strong><span>{t('ui.winRate')}</span></div>
          <div><strong>{streak > 0 ? `${streak} won` : streak < 0 ? `${-streak} lost` : '—'}</strong><span>{t('ui.streak')}</span></div>
          <div><strong>{change >= 0 ? '+' : ''}{change}</strong><span>{t('ui.last10')}</span></div>
        </div>
      </div>
      <div class="grid-2">
        <div class="sheet">
          <h3>{t('ui.rankedMatches')}</h3>
          {matches === null ? <p>{t('ui.loading')}</p> : <MatchList matches={ranked.slice(0, 15)} empty="No ranked matches yet. Your first one is a click away." />}
        </div>
        <div>
          <RankLadder here={p.index} />
          <div class="sheet">
            <h3>{t('ui.topPlayers')}</h3>
            {top === null ? <p>{t('ui.loading')}</p> : top.length === 0 ? <p class="muted">{t('ui.nobodyHasPlayedRankedYet')}</p> : (
              <ol class="top-list">
                {top.map((r) => (
                  <li class={r.name === auth.username ? 'me' : ''}>
                    <a href={`#/player/${encodeURIComponent(r.name)}`}>{r.name}</a>
                    <small class="muted rank-inline"><RankBadge index={RANKS.findIndex((x) => x.name === rankFor(r.rating))} size={18} /> {rankFor(r.rating)}, {r.rating}</small>
                  </li>
                ))}
              </ol>
            )}
            <a class="btn small" href="#/leaderboard">{t('ui.fullLeaderboard')}</a>
          </div>
        </div>
      </div>
    </>
  );
}
