import { savedMaps, takePendingMap } from '../maps';
import type { MapDef } from '@mathbattles/sim';
import { Dropdown } from './Dropdown';
import {
  BOT_LEVELS,
  BOT_NAMES,
  COSMETICS,
  PALETTE,
  PICKABLE_COLORS,
  createSolo,
  generateCircles,
  isOnWinningSide,
  matchRecordFor,
  placeSoldiers,
  Rng,
  type BotLevel,
  type MatchKind,
  type MatchState,
  type PlayerSetup,
  type ShotMode,
  type SoloDef,
} from '@mathbattles/sim';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { authState } from '../auth';
import { LocalSession, SoloSession } from '../game/session';
import { recordMatchHistory } from '../history';
import { TopBar } from './Shared';
import { ownedAbilities, profile, recordMatch } from '../store';
import { go, modeName, sound } from '../util';
import { GameView, winnerText } from './GameView';
import { MapCodeBox } from './MapCode';
import { Icon } from './Icons';
import { bestReplayLink, copyText, replayCode, replayId, shortReplayUrl } from '../replayLinks';
import { t, useLang } from '../i18n';

interface SeatDraft {
  name: string;
  team: 1 | 2;
  kind: 'human' | BotLevel;
  /** A colour this player picked, or none for the palette order. */
  color?: string;
}

/** The end of a match. The replay link is made only when asked for, then copied. */
export function ResultCard(props: {
  state: MatchState;
  viewer?: string;
  rewards?: { xp: number; sparks: number; levelUp: boolean } | null;
  onAgain?: () => void;
  /** The match's replay data. */
  replay?: string;
  /** A short id the server already saved, for online matches. */
  replayId?: string;
  children?: preact.ComponentChildren;
}) {
  useLang();
  const [copyState, setCopyState] = useState<'' | 'making' | 'copied' | 'long' | 'failed'>('');
  const copy = async () => {
    if (!props.replay && !props.replayId) return;
    setCopyState('making');
    const link = props.replayId ? { url: shortReplayUrl(props.replayId), short: true } : await bestReplayLink(props.replay!);
    const ok = await copyText(link.url);
    setCopyState(!ok ? 'failed' : link.short ? 'copied' : 'long');
    sound(ok ? 'toggle' : 'error', profile.muted);
  };
  const watch = async () => {
    const id = props.replayId ?? (props.replay ? await replayId(props.replay) : null);
    if (id) go(`/r/${id}`);
    else if (props.replay) go(`/replay/${props.replay}`);
  };
  const title = winnerText(props.state, props.viewer);
  const tone = title === t('game.youLose') ? 'lose' : title === t('game.youWin') ? 'win' : '';
  return (
    <div class={`sheet result-card ${tone}`}>
      <h2>{title}</h2>
      {props.rewards && (
        <p>{t('result.earned', { sparks: props.rewards.sparks, xp: props.rewards.xp })}{props.rewards.levelUp ? ` ${t('result.levelUp')}` : ''}</p>
      )}
      {props.children}
      <div class="row">
        {props.onAgain && <button class="primary" onClick={props.onAgain}>{t('result.again')}</button>}
        {(props.replay || props.replayId) && (
          <button onClick={() => void copy()} disabled={copyState === 'making'}>{copyState === 'making' ? t('result.makingLink') : t('result.copyLink')}</button>
        )}
        {(props.replay || props.replayId) && <button onClick={() => void watch()}>{t('result.watchReplay')}</button>}
        <a class="btn" href="#/">{t('result.menu')}</a>
      </div>
      {copyState === 'copied' && <p class="ok small-note" role="status">{t('result.copied')}</p>}
      {copyState === 'long' && <p class="muted small-note" role="status">{t('result.copiedLong')}</p>}
      {copyState === 'failed' && <p class="error small-note" role="alert">{t('result.copyFailed')}</p>}
    </div>
  );
}

export function LocalSetup() {
  const [kind, setKind] = useState<MatchKind>('teams');
  useLang();
  const [mode, setMode] = useState<ShotMode>('fn');
  const [picking, setPicking] = useState<number | null>(null);
  const [rocks, setRocks] = useState<'mixed' | 'circles'>('mixed');
  // A map chosen in the editor or the maps page arrives here, ready to play.
  const [map, setMap] = useState<MapDef | null>(() => takePendingMap());
  const maps = savedMaps();
  const [seats, setSeats] = useState<SeatDraft[]>([
    { name: profile.name, team: 1, kind: 'human' },
    { name: BOT_NAMES[0]!, team: 2, kind: 'normal' },
  ]);
  const [playing, setPlaying] = useState<null | { config: Parameters<typeof makeSession>[0]; key: number }>(null);

  const update = (i: number, patch: Partial<SeatDraft>) => setSeats(seats.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const valid = kind === 'ffa' ? seats.length >= 2 : seats.some((s) => s.team === 1) && seats.some((s) => s.team === 2);

  if (playing) {
    return <LocalGame key={playing.key} config={playing.config} onAgain={() => setPlaying({ ...playing, key: playing.key + 1 })} />;
  }

  return (
    <div class="page">
      <TopBar title={t('ui.localMatch')} />
      <div class="sheet">
        <div class="grid-2">
          <div>
            <h3>{t('ui.rules')}</h3>
            <div class="row" role="group" aria-label={t('ui.matchType')} style={{ marginBottom: 10 }}>
              <button class={kind === 'teams' ? 'on' : ''} onClick={() => setKind('teams')}>{t('ui.teams')}</button>
              <button class={kind === 'ffa' ? 'on' : ''} onClick={() => setKind('ffa')}>{t('ui.freeForAll')}</button>
            </div>
            <div class="row" style={{ marginBottom: 10 }}>
              <span class="dd-field">Map{' '}
                <Dropdown
                  label={t('ui.map')}
                  value={map ? (maps.find((m) => m.map.name === map.name && m.map.circles.length === map.circles.length)?.id ?? 'chosen') : 'random'}
                  onChange={(v) => setMap(v === 'random' ? null : v === 'chosen' ? map : maps.find((m) => m.id === v)?.map ?? null)}
                  options={[
                    { value: 'random', label: t('ui.randomMap') },
                    ...(map && !maps.some((m) => m.map.name === map.name && m.map.circles.length === map.circles.length) ? [{ value: 'chosen', label: map.name }] : []),
                    ...maps.map((m) => ({ value: m.id, label: m.map.name })),
                  ]}
                />
              </span>
              {!map && (
                <span class="dd-field">{t('rocks.label')}{' '}
                  <Dropdown label={t('rocks.label')} value={rocks} onChange={setRocks} options={[{ value: 'mixed', label: t('rocks.mixed') }, { value: 'circles', label: t('rocks.circles') }]} />
                </span>
              )}
            </div>
            <MapCodeBox current={map} onLoad={(m) => setMap(m)} />
          </div>
          <div>
            <h3>{t('ui.players')}</h3>
            {seats.map((s, i) => (
              <>
              <div class="row seat-row" style={{ marginBottom: 6 }}>
                <button
                  class="swatch-button"
                  style={{ background: seatColor(seats, i) ?? 'transparent' }}
                  aria-label={t('local.pickColor', { name: s.name })}
                  aria-expanded={picking === i}
                  onClick={() => setPicking(picking === i ? null : i)}
                >{seatColor(seats, i) ? '' : '?'}</button>
                <input aria-label={t('ui.playerName')} style={{ width: 120 }} value={s.name} maxLength={16} onInput={(e) => update(i, { name: (e.target as HTMLInputElement).value })} />
                <Dropdown
                  label={t('ui.whoPlays')}
                  value={s.kind}
                  onChange={(k) => update(i, { kind: k as SeatDraft['kind'] })}
                  options={[{ value: 'human', label: t('ui.person') }, ...(Object.keys(BOT_LEVELS) as BotLevel[]).map((l) => ({ value: l, label: BOT_LEVELS[l].label + ' bot' }))]}
                />
                {kind === 'teams' && (
                  <button class={`small team-${s.team}`} onClick={() => update(i, { team: s.team === 1 ? 2 : 1 })}>{s.team === 1 ? 'Blue' : 'Red'}</button>
                )}
                {seats.length > 2 && <button class="small" aria-label={`Remove ${s.name}`} onClick={() => setSeats(seats.filter((_, j) => j !== i))}>{t('ui.remove')}</button>}
              </div>
              {picking === i && (
                <div class="color-picker" role="group" aria-label={t('local.pickColor', { name: s.name })}>
                  {PICKABLE_COLORS.map((c) => {
                    const taken = seats.some((o, j) => j !== i && seatColor(seats, j) === c);
                    return (
                      <button
                        class={`swatch-button ${seatColor(seats, i) === c ? 'on' : ''}`}
                        style={{ background: c }}
                        disabled={taken}
                        aria-label={taken ? t('local.colorTaken') : c}
                        aria-pressed={seatColor(seats, i) === c}
                        onClick={() => { update(i, { color: c }); setPicking(null); }}
                      />
                    );
                  })}
                  <button class="small plain" onClick={() => { update(i, { color: undefined }); setPicking(null); }}>{t('local.colorAuto')}</button>
                </div>
              )}
              </>
            ))}
            {seats.length < 10 && (
              <button class="small" onClick={() => setSeats([...seats, { name: BOT_NAMES[seats.length % BOT_NAMES.length]!, team: seats.length % 2 ? 2 : 1, kind: 'normal' }])}>{t('ui.addPlayer')}</button>
            )}
          </div>
        </div>
      </div>
      {!valid && <p class="error">{t('ui.eachTeamNeedsAtLeastOne')}</p>}
      {seats.filter((s) => s.kind === 'human').length > 1 && <p class="muted small-note">{t('local.passAndLock')}</p>}
      <button class="primary" disabled={!valid} onClick={() => setPlaying({ key: 1, config: { kind, mode, seats, map, rocks } })}>{t('ui.startMatch')}</button>
    </div>
  );
}

/** The colour a seat will play in: their pick, or the next palette colour nobody picked. */
function seatColor(seats: SeatDraft[], i: number): string | undefined {
  if (seats[i]?.color) return seats[i]!.color;
  const picked = new Set(seats.map((s) => s.color).filter(Boolean));
  let k = 0;
  for (let j = 0; j <= i; j++) {
    if (seats[j]!.color) continue;
    while (k < PALETTE.length && picked.has(PALETTE[k]!.hex)) k++;
    if (j === i) return PALETTE[k]?.hex;
    k++;
  }
  return undefined;
}

function makeSession(c: { kind: MatchKind; mode: ShotMode; seats: SeatDraft[]; map?: MapDef | null; rocks?: 'mixed' | 'circles' }) {
  const setups: PlayerSetup[] = c.seats.map((s, i) => ({
    id: `p${i}`,
    name: s.name.trim() || `Player ${i + 1}`,
    team: s.team,
    isBot: s.kind !== 'human',
    botLevel: s.kind !== "human" ? s.kind : undefined,
    ...(s.color ? { color: s.color } : {}),
  }));
  return new LocalSession({ kind: c.kind, mode: c.mode, seed: (Math.random() * 2 ** 31) >>> 0, rockShapes: c.rocks ?? 'mixed', ...(c.map ? { map: c.map } : {}) }, setups, { abilities: ownedAbilities() });
}

function LocalGame(props: { config: Parameters<typeof makeSession>[0]; onAgain: () => void }) {
  const session = useMemo(() => makeSession(props.config), []);
  const [over, setOver] = useState<MatchState | null>(null);
  const [rewards, setRewards] = useState<ReturnType<typeof recordMatch> | null>(null);
  const hasBots = props.config.seats.some((s) => s.kind !== 'human');
  const humans = props.config.seats.filter((s) => s.kind === 'human').length;

  useEffect(() => {
    session.onOver = (state) => {
      setOver(state);
      const human = humans === 1 ? state.players.find((p) => !p.isBot)?.id ?? null : null;
      const at = Date.now();
      // History keeps a short replay id when the server can save one, or the replay itself.
      void replayId(replayCode(state, session.setups)).then((id) => recordMatchHistory(
        matchRecordFor(state, session.setups, human, { id: `local-${state.config.seed}-${at}`, at, kind: humans === 1 ? 'bots' : 'shared', ...(id ? { replayId: id } : {}) }),
        authState.token,
      ));
      if (humans === 1) {
        const me = state.players.find((p) => !p.isBot)!;
        const beaten = state.players.filter((p) => p.isBot).map((p) => String(p.botLevel));
        const hardest = beaten.includes('genius') ? 'genius' : beaten[0];
        setRewards(recordMatch({
          won: isOnWinningSide(state, me.id),
          kills: me.kills,
          bestCombo: me.bestCombo,
          online: false,
          mode: state.config.mode,
          beatBotLevel: hasBots ? hardest : undefined,
        }));
      }
    };
  }, []);

  const viewer = humans === 1 ? session.state.players.find((p) => !p.isBot)?.id : undefined;
  const code = useMemo(() => (over ? replayCode(over, session.setups) : undefined), [over]);
  return (
    <GameView
      session={session}
      header={<a class="btn small" href="#/">{t('ui.quit')}</a>}
      result={over ? <ResultCard state={over} viewer={viewer} rewards={rewards} onAgain={props.onAgain} replay={code} /> : null}
    />
  );
}

export function randomPractice(mode: ShotMode, seed: number, map?: MapDef | null): SoloDef {
  const rng = new Rng(seed);
  if (map) {
    // A shared map: you start on the first blue spot, and targets stand on the red ones.
    const blue = map.spawns.filter((s) => s.team === 1);
    const red = map.spawns.filter((s) => s.team === 2);
    const slots = [{ side: 0 as const }, ...Array.from({ length: Math.max(2, red.length) }, () => ({ side: 1 as const }))];
    const fixed = [blue[0], ...red];
    const placed = placeSoldiers(rng, map.circles, slots, fixed);
    return { mode, shooter: placed.spots[0]!, enemies: placed.spots.slice(1), circles: placed.circles, kind: 'ffa' };
  }
  const placed = placeSoldiers(rng, generateCircles(rng, 'mixed', seed), [{ side: 0 }, { side: 1 }, { side: 1 }]);
  return { mode, shooter: placed.spots[0]!, enemies: placed.spots.slice(1), circles: placed.circles, kind: 'ffa' };
}

export function Practice() {
  const [mode, setMode] = useState<ShotMode>('fn');
  const [key, setKey] = useState(1);
  const [practiceMap, setPracticeMap] = useState<MapDef | null>(null);
  const [showCode, setShowCode] = useState(false);
  const session = useMemo(() => {
    const seed = (Math.random() * 2 ** 31) >>> 0;
    let n = seed;
    // Free Play: unlimited energy, so every owned ability can be practised.
    const practice = (s: number) => ({ ...randomPractice(mode, s, practiceMap), abilities: ownedAbilities(), freeEnergy: true });
    return new SoloSession(practice(seed), { endless: () => practice(++n) });
  }, [mode, key, practiceMap]);
  return (
    <GameView
      key={`${mode}-${key}`}
      session={session}
      header={
        <span class="row">
          <a class="btn small" href="#/">{t('ui.menu')}</a>
          <button class="small" onClick={() => { setPracticeMap(null); setKey(key + 1); }}>{t('ui.newMap')}</button>
          <button class={`small ${showCode ? 'on' : ''}`} aria-expanded={showCode} onClick={() => setShowCode(!showCode)}><Icon name="code" /> {t('mapcode.label')}</button>
        </span>
      }
      extraSide={showCode ? <div class="mini"><h3>{t('mapcode.label')}</h3><MapCodeBox current={practiceMap} onLoad={(m) => { setPracticeMap(m); setKey(key + 1); }} /></div> : undefined}
      soloInfo="No timer. The dotted line shows your whole shot. Clear all the targets for a new map."
    />
  );
}

void COSMETICS;
void createSolo;
