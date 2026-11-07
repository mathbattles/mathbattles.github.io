import { savedMaps, takePendingMap } from '../maps';
import type { MapDef } from '@mathbattles/sim';
import { Dropdown } from './Dropdown';
import {
  BOT_LEVELS,
  BOT_NAMES,
  COSMETICS,
  createSolo,
  currentPlayer,
  encodeReplay,
  generateCircles,
  isOnWinningSide,
  makeReplay,
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
import { profile, recordMatch } from '../store';
import { go, modeName } from '../util';
import { GameView, winnerText } from './GameView';

interface SeatDraft {
  name: string;
  team: 1 | 2;
  kind: 'human' | BotLevel;
}

export function ResultCard(props: { state: MatchState; viewer?: string; rewards?: { xp: number; sparks: number; levelUp: boolean } | null; onAgain?: () => void; replay?: string; children?: preact.ComponentChildren }) {
  const copy = () => {
    if (props.replay) void navigator.clipboard?.writeText(props.replay);
  };
  const title = winnerText(props.state, props.viewer);
  const tone = title === 'You lose' ? 'lose' : title === 'You win' ? 'win' : '';
  return (
    <div class={`sheet result-card ${tone}`}>
      <h2>{title}</h2>
      {props.rewards && (
        <p>You earned {props.rewards.sparks} Sparks and {props.rewards.xp} XP.{props.rewards.levelUp ? ' Level up!' : ''}</p>
      )}
      {props.children}
      <div class="row">
        {props.onAgain && <button class="primary" onClick={props.onAgain}>Play again</button>}
        {props.replay && <button onClick={copy}>Copy replay link</button>}
        <a class="btn" href="#/">Back to menu</a>
      </div>
    </div>
  );
}

export function LocalSetup() {
  const [kind, setKind] = useState<MatchKind>('teams');
  const [mode, setMode] = useState<ShotMode>('fn');
  const [soldiers, setSoldiers] = useState(1);
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
      <TopBar title="Local match" />
      <div class="sheet">
        <div class="grid-2">
          <div>
            <h3>Rules</h3>
            <div class="row" role="group" aria-label="Match type" style={{ marginBottom: 10 }}>
              <button class={kind === 'teams' ? 'on' : ''} onClick={() => setKind('teams')}>Teams</button>
              <button class={kind === 'ffa' ? 'on' : ''} onClick={() => setKind('ffa')}>Free-for-all</button>
            </div>
            <div class="row" style={{ marginBottom: 10 }}>
              <span class="dd-field">Soldiers each{' '}
                <Dropdown label="Soldiers each" value={soldiers} onChange={setSoldiers} options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} />
              </span>
              <span class="dd-field">Map{' '}
                <Dropdown
                  label="Map"
                  value={map ? (maps.find((m) => m.map.name === map.name && m.map.circles.length === map.circles.length)?.id ?? 'chosen') : 'random'}
                  onChange={(v) => setMap(v === 'random' ? null : v === 'chosen' ? map : maps.find((m) => m.id === v)?.map ?? null)}
                  options={[
                    { value: 'random', label: 'Random map' },
                    ...(map && !maps.some((m) => m.map.name === map.name && m.map.circles.length === map.circles.length) ? [{ value: 'chosen', label: map.name }] : []),
                    ...maps.map((m) => ({ value: m.id, label: m.map.name })),
                  ]}
                />
              </span>
            </div>
          </div>
          <div>
            <h3>Players</h3>
            {seats.map((s, i) => (
              <div class="row" style={{ marginBottom: 6 }}>
                <input aria-label="Player name" style={{ width: 120 }} value={s.name} maxLength={16} onInput={(e) => update(i, { name: (e.target as HTMLInputElement).value })} />
                <Dropdown
                  label="Who plays"
                  value={s.kind}
                  onChange={(k) => update(i, { kind: k as SeatDraft['kind'] })}
                  options={[{ value: 'human', label: 'Person' }, ...(Object.keys(BOT_LEVELS) as BotLevel[]).map((l) => ({ value: l, label: BOT_LEVELS[l].label + ' bot' }))]}
                />
                {kind === 'teams' && (
                  <button class={`small team-${s.team}`} onClick={() => update(i, { team: s.team === 1 ? 2 : 1 })}>{s.team === 1 ? 'Blue' : 'Red'}</button>
                )}
                {seats.length > 2 && <button class="small" aria-label={`Remove ${s.name}`} onClick={() => setSeats(seats.filter((_, j) => j !== i))}>Remove</button>}
              </div>
            ))}
            {seats.length < 10 && (
              <button class="small" onClick={() => setSeats([...seats, { name: BOT_NAMES[seats.length % BOT_NAMES.length]!, team: seats.length % 2 ? 2 : 1, kind: 'normal' }])}>Add player</button>
            )}
          </div>
        </div>
      </div>
      {!valid && <p class="error">Each team needs at least one player.</p>}
      <button class="primary" disabled={!valid} onClick={() => setPlaying({ key: 1, config: { kind, mode, soldiers, seats, map } })}>Start match</button>
    </div>
  );
}

function makeSession(c: { kind: MatchKind; mode: ShotMode; soldiers: number; seats: SeatDraft[]; map?: MapDef | null }) {
  const setups: PlayerSetup[] = c.seats.map((s, i) => ({
    id: `p${i}`,
    name: s.name.trim() || `Player ${i + 1}`,
    team: s.team,
    isBot: s.kind !== 'human',
    botLevel: s.kind !== "human" ? s.kind : undefined,
  }));
  return new LocalSession({ kind: c.kind, mode: c.mode, soldiers: c.soldiers, seed: (Math.random() * 2 ** 31) >>> 0, ...(c.map ? { map: c.map } : {}) }, setups);
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
      void recordMatchHistory(
        matchRecordFor(state, session.setups, human, { id: `local-${state.config.seed}-${Date.now()}`, at: Date.now(), kind: humans === 1 ? 'bots' : 'shared' }),
        authState.token,
      );
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
  const replayLink = over ? `${location.origin}${location.pathname}#/replay/${encodeReplay(makeReplay(over, session.setups))}` : undefined;
  return (
    <GameView
      session={session}
      header={<a class="btn small" href="#/">Quit</a>}
      result={over ? <ResultCard state={over} viewer={viewer} rewards={rewards} onAgain={props.onAgain} replay={replayLink} /> : null}
    />
  );
}

export function randomPractice(mode: ShotMode, seed: number): SoloDef {
  const rng = new Rng(seed);
  const placed = placeSoldiers(rng, generateCircles(rng), [{ side: 0 }, { side: 1 }, { side: 1 }]);
  return { mode, shooter: placed.spots[0]!, enemies: placed.spots.slice(1), circles: placed.circles };
}

export function Practice() {
  const [mode, setMode] = useState<ShotMode>('fn');
  const [key, setKey] = useState(1);
  const session = useMemo(() => {
    const seed = (Math.random() * 2 ** 31) >>> 0;
    let n = seed;
    return new SoloSession(randomPractice(mode, seed), { endless: () => randomPractice(mode, ++n) });
  }, [mode, key]);
  return (
    <GameView
      key={`${mode}-${key}`}
      session={session}
      header={
        <span class="row">
          <a class="btn small" href="#/">Menu</a>
          <button class="small" onClick={() => setKey(key + 1)}>New map</button>
        </span>
      }
      soloInfo="No timer. The dashed line shows where your shot starts. Clear all the targets for a new map."
    />
  );
}

void COSMETICS;
void createSolo;
void currentPlayer;
void go;
