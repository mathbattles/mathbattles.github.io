import { applyAction, decodeReplay, replayIsOld, replayStart, roundsOf, type Replay } from '@mathbattles/sim';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { ReplaySession } from '../game/session';
import { t, useLang } from '../i18n';
import { fetchReplay } from '../net/api';
import { themedColor } from '../render/stage';
import { copyText, replayId, shortReplayUrl, longReplayUrl } from '../replayLinks';
import { profile } from '../store';
import { sound } from '../util';
import { Dropdown } from './Dropdown';
import { GameView, winnerText } from './GameView';
import { TopBar } from './Shared';

const SPEEDS = [0.5, 1, 2, 4];

/** Re-renders when the replay moves on. */
function useSession(session: ReplaySession): void {
  const [, force] = useState(0);
  useEffect(() => session.subscribe(() => force((n) => n + 1)), [session]);
}

/** Splits "abc?r=5" into the data and the round to open at. */
export function splitRound(text: string): { data: string; round: number } {
  const [data = '', query = ''] = text.split('?');
  const r = Number(new URLSearchParams(query).get('r'));
  return { data, round: Number.isInteger(r) && r > 0 ? r : 1 };
}

/** Opens a short replay link: fetches the replay behind the id, then plays it. */
export function ShortReplay({ id: raw }: { id: string }) {
  useLang();
  const { data: id, round } = splitRound(raw);
  const [code, setCode] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setCode(undefined);
    void fetchReplay(id).then((r) => {
      if (live) setCode(r?.code ?? null);
    });
    return () => {
      live = false;
    };
  }, [id]);
  if (code === undefined) return <div class="page"><TopBar title={t('replay.title')} /><p>{t('replay.loading')}</p></div>;
  if (code === null) {
    return (
      <div class="page">
        <TopBar title={t('replay.title')} />
        <div class="sheet">
          <h2>{t('replay.notFound')}</h2>
          <p>{t('replay.notFoundHint')}</p>
          <a class="btn primary" href="#/">{t('result.menu')}</a>
        </div>
      </div>
    );
  }
  return <ReplayScreen data={code} id={id} startRound={round} />;
}

export function ReplayScreen({ data: raw, id, startRound }: { data: string; id?: string; startRound?: number }) {
  useLang();
  const split = splitRound(raw);
  const data = split.data;
  const start = startRound ?? split.round;
  const replay = useMemo<Replay | null>(() => decodeReplay(data), [data]);
  const [key, setKey] = useState(1);
  const session = useMemo(() => {
    if (!replay) return null;
    try {
      return new ReplaySession(replay, key === 1 ? start : 1);
    } catch {
      return null; // A hand-edited replay can describe a match that can't exist.
    }
  }, [replay, key]);
  if (!session) {
    const old = replayIsOld(data);
    return (
      <div class="page">
        <TopBar title={t('replay.title')} />
        <div class="sheet">
          <h2>{old ? t('replay.oldTitle') : t('replay.broken')}</h2>
          <p>{old ? t('replay.oldHint') : t('replay.brokenHint')}</p>
          <a class="btn primary" href="#/">{t('result.menu')}</a>
        </div>
      </div>
    );
  }
  return (
    <GameView
      key={key}
      session={session}
      header={<span class="row"><a class="btn small" href="#/profile">{t('game.back')}</a><strong>{t('replay.title')}</strong></span>}
      result={<ReplayControls session={session} code={data} id={id} onAgain={() => setKey(key + 1)} />}
      extraSide={<ReplayRounds session={session} />}
    />
  );
}

/** Play, pause, speed, round jumps, frame steps, follow, share, and download. */
function ReplayControls({ session, code, id, onAgain }: { session: ReplaySession; code: string; id?: string; onAgain: () => void }) {
  useSession(session);
  const [note, setNote] = useState('');
  const total = session.totalRounds;
  const shown = session.roundShown;
  const state = session.state;

  // Kill ticks on the scrubber: which rounds had knockouts.
  const killRounds = useMemo(() => {
    try {
      const st = replayStart(session.replay);
      for (const a of session.replay.actions) if (!st.over) applyAction(st, a);
      return roundsOf(st).map((r, i) => (r.kills.length ? i + 1 : 0)).filter(Boolean);
    } catch {
      return [] as number[];
    }
  }, [session]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === ' ') {
        e.preventDefault();
        session.setPlaying(!session.playing);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        session.prevRound();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        session.nextRound();
      } else if (e.key === ',') {
        session.stepFrame(-1);
      } else if (e.key === '.') {
        session.stepFrame(1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        session.seekRound(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        session.seekRound(total);
      } else if (['1', '2', '3', '4'].includes(e.key)) {
        session.setSpeed(SPEEDS[Number(e.key) - 1]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session, total]);

  const share = async () => {
    setNote(t('result.makingLink'));
    const sid = id ?? (await replayId(code));
    const url = sid ? shortReplayUrl(sid, shown > 1 ? shown : undefined) : longReplayUrl(code, shown > 1 ? shown : undefined);
    const ok = await copyText(url);
    setNote(ok ? (sid ? t('replay.shareCopied', { n: shown }) : t('result.copiedLong')) : t('result.copyFailed'));
    sound(ok ? 'toggle' : 'error', profile.muted);
  };
  const download = () => {
    const blob = new Blob([code], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mathbattles-replay-${id ?? 'match'}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const done = session.finished && state.over;
  const standings = [...state.players].filter((p) => !p.passive).sort((a, b) => b.kills - a.kills);
  return (
    <div class="sheet replay-controls">
      <div class="replay-transport row" role="group" aria-label={t('replay.controls')}>
        <button class="small" onClick={() => session.seekRound(0)} aria-label={t('replay.start')} title={t('replay.start')}>⏮</button>
        <button class="small" onClick={() => session.prevRound()} aria-label={t('replay.prev')} title={t('replay.prev')}>◀</button>
        <button class="small" onClick={() => session.stepFrame(-1)} disabled={!session.busy} aria-label={t('replay.frameBack')} title={t('replay.frameBack')}>‹</button>
        <button class="primary small play" onClick={() => session.setPlaying(!session.playing)} aria-label={session.playing ? t('replay.pause') : t('replay.play')}>
          {session.playing ? t('replay.pause') : t('replay.play')}
        </button>
        <button class="small" onClick={() => session.stepFrame(1)} disabled={!session.busy} aria-label={t('replay.frameNext')} title={t('replay.frameNext')}>›</button>
        <button class="small" onClick={() => session.nextRound()} aria-label={t('replay.next')} title={t('replay.next')}>▶</button>
        <button class="small" onClick={() => session.seekRound(total)} aria-label={t('replay.end')} title={t('replay.end')}>⏭</button>
        <span class="replay-progress" aria-live="polite">{t('replay.roundOf', { n: shown, total })}</span>
      </div>
      <div class="replay-scrub">
        <div class="ticks" aria-hidden="true">
          {killRounds.map((n) => <i style={{ left: `${total > 1 ? ((n - 1) / total) * 100 : 0}%` }} title={t('game.roundN', { n })} />)}
        </div>
        <input
          type="range"
          min={0}
          max={total}
          step={1}
          value={Math.max(0, shown - 1)}
          aria-label={t('replay.scrub')}
          onInput={(e) => session.seekRound(Number((e.target as HTMLInputElement).value))}
        />
      </div>
      <div class="row replay-options">
        <span class="row" role="group" aria-label={t('replay.speed')}>
          {SPEEDS.map((s) => (
            <button class={`small ${session.speed === s ? 'on' : ''}`} aria-pressed={session.speed === s} onClick={() => session.setSpeed(s)}>{s}×</button>
          ))}
        </span>
        <span class="dd-field">{t('replay.follow')}{' '}
          <Dropdown
            label={t('replay.follow')}
            value={session.follow ?? ''}
            onChange={(v) => session.setFollow(v || null)}
            options={[{ value: '', label: t('replay.followNone') }, ...state.players.filter((p) => !p.passive).map((p) => ({ value: p.id, label: p.name }))]}
          />
        </span>
      </div>
      <div class="row">
        <button class="small" onClick={() => void share()}>{t('replay.share')}</button>
        <button class="small" onClick={download}>{t('replay.download')}</button>
      </div>
      {note && <p class="muted small-note" role="status">{note}</p>}
      <p class="muted small-note keys-help">{t('replay.keys')}</p>
      {done && (
        <div class="replay-end">
          <h3>{winnerText(state)}</h3>
          <ol class="standings">
            {standings.map((p) => (
              <li><i class="swatch" style={{ background: themedColor(p.color, profile.theme) }} aria-hidden="true" />{p.name} <span class="muted">{t('replay.kills', { count: p.kills })}</span></li>
            ))}
          </ol>
          <button class="primary small" onClick={onAgain}>{t('replay.watchAgain')}</button>
        </div>
      )}
    </div>
  );
}

/** Every round of the replay, played or not. Choosing one jumps there. */
function ReplayRounds({ session }: { session: ReplaySession }) {
  useSession(session);
  const replay = session.replay;
  const played = roundsOf(session.state);
  const nameOf = (id: string) => replay.setups.find((s) => s.id === id)?.name ?? id;
  const colorOf = (id: string) => themedColor(session.state.players.find((p) => p.id === id)?.color ?? '#2b50e8', profile.theme);
  const rounds = replay.actions.filter((a) => a.a === 'r') as Extract<Replay['actions'][number], { a: 'r' }>[];
  const shown = session.roundShown;
  const [copied, setCopied] = useState('');
  return (
    <div class="mini replay-rounds">
      <h3>{t('replay.rounds')}</h3>
      <ol class="shots">
        {rounds.map((r, i) => (
          <li class={i + 1 === shown ? 'current' : ''}>
            <button class="shot round-entry" onClick={() => { session.seekRound(i); session.setPlaying(true); }}>
              <span class="num">{t('game.roundN', { n: i + 1 })}</span>
              {r.shots.length === 0 && <span class="muted">{t('game.noShots')}</span>}
              {r.shots.map((s) => (
                <span class="body">
                  <span class="shooter" style={{ color: colorOf(s.p) }}>{nameOf(s.p)}</span>
                  <code>{s.e}</code>
                  {played[i] && played[i]!.shots.find((x) => x.playerId === s.p)?.hits.length ? (
                    <span class="hits">{t('game.hits', { count: played[i]!.shots.find((x) => x.playerId === s.p)!.hits.length })}</span>
                  ) : null}
                </span>
              ))}
            </button>
            <span class="copy-fns">
              {r.shots.map((s) => (
                <button class="plain small" onClick={() => { void copyText(s.e); setCopied(s.e); sound('toggle', profile.muted); }} aria-label={t('replay.copyFn', { expr: s.e })}>
                  {t('replay.copy')}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ol>
      {copied && <p class="muted small-note" role="status">{t('replay.copiedFn', { expr: copied })}</p>}
    </div>
  );
}
