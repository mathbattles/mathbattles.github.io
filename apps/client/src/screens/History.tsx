import { rankFor, replayIsOld, type MatchRecord } from '@mathbattles/sim';
import { useEffect, useState } from 'preact/hooks';
import { useAuth } from '../auth';
import { loadHistory } from '../history';
import { fetchPlayer, type PlayerPage } from '../net/api';
import { modeName } from '../util';
import { TopBar } from './Shared';
import { t } from '../i18n';

const RESULT_TEXT = { win: 'Won', loss: 'Lost', draw: 'Draw', none: 'Played' } as const;
const KIND_TEXT = { bots: 'Vs bots', online: 'Online', ranked: 'Ranked', shared: 'Same device' } as const;

function when(at: number): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** A list of past matches, each one watchable like a chess game. */
export function MatchList({ matches, empty }: { matches: MatchRecord[]; empty: string }) {
  if (matches.length === 0) return <p class="muted">{empty}</p>;
  return (
    <ul class="matches">
      {matches.map((m) => (
        <li class={`match ${m.result}`}>
          <span class="result">{RESULT_TEXT[m.result] ?? 'Played'}</span>
          <span class="who-played">
            <strong>{m.opponents.length ? `vs ${m.opponents.slice(0, 3).join(', ')}${m.opponents.length > 3 ? ` and ${m.opponents.length - 3} more` : ''}` : 'Match'}</strong>
            <small class="muted">
              {KIND_TEXT[m.kind] ?? 'Match'}, {modeName(m.mode)}, {m.shots} {m.shots === 1 ? 'shot' : 'shots'}, {m.kills} {m.kills === 1 ? 'hit' : 'hits'}, {when(m.at)}
            </small>
          </span>
          {m.ratingDelta !== undefined && <span class="rating-change">{m.ratingDelta >= 0 ? '+' : ''}{m.ratingDelta}</span>}
          {m.replayId ? <a class="btn small" href={`#/r/${m.replayId}`}>{t('ui.watch')}</a> : m.replay && !replayIsOld(m.replay) ? <a class="btn small" href={`#/replay/${m.replay}`}>{t('ui.watch')}</a> : m.replay ? <span class="muted small-note" title={t('ui.thisMatchWasPlayedBeforeRounds')}>{t('ui.olderVersion')}</span> : <span class="muted small-note">{t('ui.noReplay')}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Your own history, on your profile. */
export function MyHistory() {
  const auth = useAuth();
  const [matches, setMatches] = useState<MatchRecord[] | null>(null);
  useEffect(() => {
    if (!auth.ready) return;
    let live = true;
    void loadHistory(auth.token).then((list) => {
      if (live) setMatches(list);
    });
    return () => {
      live = false;
    };
  }, [auth.ready, auth.user?.uid]);
  if (matches === null) return <p>{t('ui.loadingYourMatches')}</p>;
  return <MatchList matches={matches} empty="No matches yet. Play bots or go online, and they'll appear here to watch again." />;
}

/** Anyone's public page, linked from the leaderboard. */
export function PlayerScreen({ name }: { name: string }) {
  const [page, setPage] = useState<PlayerPage | null | 'loading'>('loading');
  useEffect(() => {
    void fetchPlayer(name).then(setPage);
  }, [name]);
  return (
    <div class="page">
      <TopBar title={page !== 'loading' && page ? page.name : 'Player'} />
      {page === 'loading' ? (
        <p>{t('ui.loadingThisPlayer')}</p>
      ) : !page ? (
        <div class="sheet">
          <h3>{t('ui.noPlayerFound')}</h3>
          <p>There's no player called {name}, or the server can't be reached right now.</p>
          <a class="btn" href="#/leaderboard">{t('ui.openTheLeaderboard')}</a>
        </div>
      ) : (
        <>
          <div class="sheet">
            <h3>{rankFor(page.rating)}</h3>
            <p>Rating {page.rating}. {page.games} ranked {page.games === 1 ? 'match' : 'matches'} played.</p>
          </div>
          <div class="sheet">
            <h3>{t('ui.recentMatches')}</h3>
            <MatchList matches={page.matches} empty="No matches played yet." />
          </div>
        </>
      )}
    </div>
  );
}
