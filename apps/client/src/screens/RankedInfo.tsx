import { RANKS, START_RATING, rankFor, type MatchRecord } from '@mathbattles/sim';
import { useEffect, useState } from 'preact/hooks';
import { useAuth } from '../auth';
import { loadHistory } from '../history';
import { fetchLeaderboard, myRanked, type LeaderRow } from '../net/api';
import { MatchList } from './History';

/** Where a rating sits: its tier, the next tier, and how far along it is. */
export function tierProgress(rating: number) {
  const index = RANKS.reduce((best, r, i) => (rating >= r.min ? i : best), 0);
  const tier = RANKS[index]!;
  const next = RANKS[index + 1];
  const floor = index === 0 ? Math.min(rating, 800) : tier.min;
  const share = next ? Math.max(0, Math.min(1, (rating - floor) / (next.min - floor))) : 1;
  return { index, tier, next, share, toNext: next ? next.min - rating : 0 };
}

/** A small hand-drawn badge for a tier, coloured from bronze up to gold. */
export function RankBadge({ index, size = 64 }: { index: number; size?: number }) {
  const colors = ['#b5835a', '#a7b0ba', '#5fb0e8', '#57d977', '#b57bff', '#ff9838', '#ff4d7e', '#ffd33d'];
  const fill = colors[Math.min(index, colors.length - 1)]!;
  const points = Math.min(index + 3, 8);
  const star = Array.from({ length: points * 2 }, (_, i) => {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 13 : 22;
    return `${32 + Math.cos(a) * r},${32 + Math.sin(a) * r}`;
  }).join(' ');
  return (
    <svg class="rank-badge" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="29" fill={fill} stroke="currentColor" stroke-width="3" />
      <polygon points={star} fill="#ffffff" fill-opacity="0.85" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
    </svg>
  );
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
            <p class="muted" style={{ margin: 0 }}>Your rank</p>
            <h2 style={{ margin: 0 }}>{p.tier.name}</h2>
            <p style={{ margin: '2px 0 0' }}><strong>{rating}</strong> rating{me?.place ? `, #${me.place} of ${me.total} ranked players` : ''}</p>
          </div>
        </div>
        <div class="bar rank-bar" role="progressbar" aria-valuenow={Math.round(p.share * 100)} aria-valuemax={100} aria-label="Progress to the next rank">
          <i style={{ width: `${p.share * 100}%` }} />
        </div>
        <p class="muted small-note" style={{ marginTop: 6 }}>{p.next ? `${p.toNext} more rating to reach ${p.next.name}.` : 'The highest rank. Stay on top.'}</p>
        <div class="rank-stats">
          <div><strong>{me?.games ?? ranked.length}</strong><span>Matches</span></div>
          <div><strong>{wins}–{losses}</strong><span>Won–lost</span></div>
          <div><strong>{wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0}%</strong><span>Win rate</span></div>
          <div><strong>{streak > 0 ? `${streak} won` : streak < 0 ? `${-streak} lost` : '—'}</strong><span>Streak</span></div>
          <div><strong>{change >= 0 ? '+' : ''}{change}</strong><span>Last 10</span></div>
        </div>
      </div>
      <div class="grid-2">
        <div class="sheet">
          <h3>Ranked matches</h3>
          {matches === null ? <p>Loading.</p> : <MatchList matches={ranked.slice(0, 15)} empty="No ranked matches yet. Your first one is a click away." />}
        </div>
        <div>
          <div class="sheet">
            <h3>Ranks</h3>
            <ol class="rank-ladder">
              {[...RANKS].reverse().map((r) => {
                const i = RANKS.indexOf(r);
                return (
                  <li class={i === p.index ? 'here' : ''}>
                    <RankBadge index={i} size={26} />
                    <span>{r.name}</span>
                    <small class="muted">{r.min > 0 ? `${r.min}+` : 'Start'}</small>
                  </li>
                );
              })}
            </ol>
          </div>
          <div class="sheet">
            <h3>Top players</h3>
            {top === null ? <p>Loading.</p> : top.length === 0 ? <p class="muted">Nobody has played ranked yet.</p> : (
              <ol class="top-list">
                {top.map((r) => (
                  <li class={r.name === auth.username ? 'me' : ''}>
                    <a href={`#/player/${encodeURIComponent(r.name)}`}>{r.name}</a>
                    <small class="muted">{rankFor(r.rating)}, {r.rating}</small>
                  </li>
                ))}
              </ol>
            )}
            <a class="btn small" href="#/leaderboard">Full leaderboard</a>
          </div>
        </div>
      </div>
    </>
  );
}
