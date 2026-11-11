import { savedMaps } from '../maps';
import { Dropdown } from './Dropdown';
import { BOT_LEVELS, MAX_PLAYERS, isOnWinningSide, matchRecordFor, type BotLevel, type MatchKind, type MatchState, type ShotMode } from '@mathbattles/sim';
import { replayCode } from '../replayLinks';
import { ROUND_SECONDS } from '@mathbattles/sim';
import { Icon } from './Icons';
import { MapCodeBox } from './MapCode';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { authState, useAuth } from '../auth';
import { NetSession } from '../game/session';
import { recordMatchHistory } from '../history';
import { WS_URL, createRoom, listRooms, reportChat, serverReachable, type RoomInfo } from '../net/api';
import { cosmeticValue, profile, recordMatch, ownedAbilities } from '../store';
import { go, modeName } from '../util';
import { GameView } from './GameView';
import { ResultCard } from './Local';
import { TopBar, useProfile } from './Shared';
import { RankLadder, RankedInfo } from './RankedInfo';
import { RankChange } from './RankChange';
import { t } from '../i18n';
import { FadeText } from './Notices';

const UNAVAILABLE = "Online play isn't reachable right now. Bots, the campaign, and Free Play still work.";

export function OnlineMenu() {
  const [rooms, setRooms] = useState<RoomInfo[] | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    const load = async () => {
      const ok = await serverReachable();
      if (!live) return;
      setOnline(ok);
      if (ok) setRooms(await listRooms());
    };
    void load();
    const t = setInterval(load, 8000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const make = async (isPublic: boolean) => {
    const r = await createRoom(isPublic);
    if (r) go(`/room/${r.code}`);
    else setError(UNAVAILABLE);
  };

  return (
    <div class="page">
      <TopBar title={t('ui.playOnline')} />
      {online === false && <p class="error" role="alert">{UNAVAILABLE}</p>}
      <FadeText text={error} />
      <div class="grid-2">
        <div class="sheet">
          <h3>{t('ui.startARoom')}</h3>
          <div class="row">
            <button class="primary" disabled={!online} onClick={() => void make(true)}>{t('ui.createPublicRoom')}</button>
            <button disabled={!online} onClick={() => void make(false)}>{t('ui.createPrivateRoom')}</button>
          </div>
          <h3 style={{ marginTop: 16 }}>{t('ui.joinWithACode')}</h3>
          <form class="row" onSubmit={(e) => { e.preventDefault(); if (code.trim()) go(`/room/${code.trim().toUpperCase()}`); }}>
            <input aria-label={t('ui.roomCode')} value={code} maxLength={8} placeholder={t('ui.abcd')} onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
            <button disabled={!online || !code.trim()}>{t('ui.join')}</button>
          </form>
        </div>
        <div class="sheet">
          <h3>{t('ui.publicRooms')}</h3>
          {online === null ? <p>{t('ui.lookingForRooms')}</p> : !rooms?.length ? <p class="muted">{t('ui.noRoomsRightNowCreateOne')}</p> : rooms.map((r) => (
            <div class="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <span>{r.kind === 'ffa' ? 'Free-for-all' : 'Teams'}, {r.players}/{MAX_PLAYERS}{r.inLobby === 0 ? ', match in progress' : ''}</span>
              <span class="row">
                {r.inLobby !== 0 && <a class="btn small" href={`#/room/${r.code}`}>{t('ui.join')}</a>}
                <a class="btn small" href={`#/watch/${r.code}`}>{t('ui.watch')}</a>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Ranked rooms need the login token, which takes a moment to load after a page refresh. */
export function Room(props: { code: string; ranked?: boolean; watch?: boolean }) {
  const auth = useAuth();
  if (props.ranked && !auth.ready) {
    return <div class="page"><TopBar title={t('ui.rankedMatch')} /><p>{t('ui.checkingYourAccount')}</p></div>;
  }
  return <RoomInner {...props} />;
}

function RoomInner({ code, ranked, watch }: { code: string; ranked?: boolean; watch?: boolean }) {
  useProfile();
  const session = useMemo(() => new NetSession(`${WS_URL}/room/${encodeURIComponent(code)}`, {
    t: 'join',
    name: profile.name,
    token: profile.guestToken,
    idToken: authState.token,
    hat: cosmeticValue('hat'),
    abilities: ownedAbilities(),
    ...(watch ? { spectate: true } : {}),
  }), [code, watch]);
  const [, force] = useState(0);
  const [finished, setOver] = useState<MatchState | null>(null);
  const [rewards, setRewards] = useState<ReturnType<typeof recordMatch> | null>(null);
  const [chatText, setChatText] = useState('');
  const [reported, setReported] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = session.subscribe(() => force((n) => n + 1));
    // The server may have answered before this listener existed.
    force((n) => n + 1);
    session.onOver = (state) => {
      setOver(state);
      const me = state.players.find((p) => p.id === session.you);
      // Signed-in players' matches are saved by the server. Guests keep theirs on this device.
      if (!authState.user && !watch) {
        void recordMatchHistory(
          matchRecordFor(state, session.setups, me?.id ?? null, { id: `${code.toUpperCase()}-${state.config.seed}`, at: Date.now(), kind: 'online', ...(session.replayId ? { replayId: session.replayId } : {}) }),
          null,
        );
      }
      if (me) {
        setRewards(recordMatch({ won: isOnWinningSide(state, me.id), kills: me.kills, bestCombo: me.bestCombo, online: true, mode: state.config.mode }));
      }
    };
    return () => {
      unsub();
      session.dispose();
    };
  }, [session]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [session.chat.length]);

  const sendChat = (e: Event) => {
    e.preventDefault();
    if (chatText.trim()) session.sendChat(chatText.trim());
    setChatText('');
  };

  const chatPanel = profile.ageBand === 'child' ? (
    <div class="mini"><h3>{t('ui.chat')}</h3><p class="muted small-note" style={{ margin: 0 }}>{t('ui.chatIsOffForPlayersUnder')}</p></div>
  ) : profile.chatOff || watch ? null : (
    <div class="mini chat-panel">
      <h3>{t('ui.chat')}</h3>
      <div class="chatlog" ref={chatRef} aria-live="polite">
        {session.chat.filter((l) => !l.fromId || !session.muted.has(l.fromId)).map((l) => (
          <div class={l.system ? 'sys' : ''}>
            {l.system ? l.text : <><strong>{l.from}:</strong> {l.text}</>}
            {!l.system && l.fromId !== session.you && (
              <>
                {' '}
                <button class="plain small" onClick={() => { if (l.fromId) session.muted.add(l.fromId); force((n) => n + 1); }}>{t('ui.mute')}</button>
                <button class="plain small" onClick={() => { void reportChat(session.code, l.from, l.text); setReported(true); }}>{t('ui.report')}</button>
              </>
            )}
          </div>
        ))}
      </div>
      {reported && <p class="ok">{t('ui.reportSent')}</p>}
      <p class="muted chat-hint" style={{ margin: '6px 0 0', fontSize: '.85rem' }}>{t('ui.typeSkipToVoteForA')}</p>
      <form class="row" onSubmit={sendChat} style={{ marginTop: 6 }}>
        <input aria-label={t('ui.chatMessage')} style={{ flex: 1, width: 80 }} value={chatText} maxLength={140} onInput={(e) => setChatText((e.target as HTMLInputElement).value)} />
        <button class="small">{t('ui.send')}</button>
      </form>
    </div>
  );

  if (session.status === 'closed') {
    return (
      <div class="page">
        <TopBar />
        <div class="sheet">
          <h2>{ranked ? 'Ranked match unavailable' : "Can't join this room"}</h2>
          <p>{session.error}</p>
          <a class="btn primary" href={ranked ? '#/ranked' : '#/online'}>{ranked ? 'Back to ranked' : 'Back to rooms'}</a>
        </div>
      </div>
    );
  }

  if (session.status === 'playing' && session.state) {
    // A result from the previous match in this room must not show during the next one.
    const over = session.state.over ? finished : null;
    const replay = over && !session.replayId ? replayCode(over, session.setups) : undefined;
    return (
      <GameView
        session={session}
        keepSession
        notice={session.error}
        header={<span class="row"><a class="btn small" href={ranked ? '#/ranked' : '#/online'}>{t('ui.leave')}</a>{watch && <span class="watch-tag">{t('ui.watching')}</span>}{session.spectators > 0 && <span class="muted small-note">{session.spectators} watching</span>}</span>}
        hideOthersShots={!(session.settings?.showFunctions ?? false)}
        spectator={watch}
        extraSide={chatPanel}
        result={over ? (
          <ResultCard state={over} viewer={session.you} rewards={rewards} replay={replay} replayId={session.replayId}>
            {session.ratings?.[session.you] ? <RankChange change={session.ratings[session.you]!} /> : session.ratingDelta !== undefined && <p>Rating {session.ratingDelta >= 0 ? '+' : ''}{session.ratingDelta}</p>}
            {!ranked && !watch && (
              <p class="row rematch-row">
                <button class={session.rematchVotes.includes(session.you) ? 'on' : 'primary'} disabled={session.rematchVotes.includes(session.you)} onClick={() => session.rematch()}>
                  <Icon name="replay" /> {t('rematch.button')}
                </button>
                <small class="muted">{t('rematch.votes', { n: session.rematchVotes.length, total: session.seats.filter((s) => !s.isBot && s.connected).length })}</small>
              </p>
            )}
            <p class="muted">{ranked ? 'Queue again from the Ranked screen.' : 'The room returns to the lobby in a moment.'}</p>
          </ResultCard>
        ) : null}
      />
    );
  }

  const me = session.seats.find((s) => s.id === session.you);
  const isHost = session.host === session.you;
  const st = session.settings;
  const set = (p: Partial<NonNullable<typeof st>>) => session.send({ t: 'settings', settings: p });

  return (
    <div class="page">
      <TopBar title={session.ranked ? 'Ranked match' : `Room ${session.code || code}`} />
      {watch && <p class="watching" role="status">{t('ui.youReWatchingThisRoomThe')} <a href={`#/room/${code}`}>{t('ui.joinInstead')}</a></p>}
      {session.status === 'connecting' && <p>{t('ui.connecting')}</p>}
      <FadeText text={session.error} />
      {st && (
        <div class="grid-2">
          <div class="sheet">
            <h3>{t('ui.players')}</h3>
            {session.seats.map((s) => (
              <div class="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <span class={`team-${s.team}`}>
                  <strong>{s.name}</strong>{s.isBot ? ' (bot)' : ''}{s.id === session.host ? ', host' : ''}{!s.connected ? ', reconnecting' : ''}
                </span>
                <span class="row">
                  {s.ready || s.isBot ? <span class="ok">{t('ui.ready')}</span> : <span class="muted">{t('ui.notReady')}</span>}
                  {isHost && s.id !== session.you && <button class="small" onClick={() => session.send({ t: 'removeSeat', id: s.id })}>{t('ui.remove')}</button>}
                </span>
              </div>
            ))}
            {!session.ranked && (
              <>
                <div class="row" style={{ marginTop: 10 }}>
                  {st.kind === 'teams' && me && (
                    <button class={`team-${me.team}`} onClick={() => session.send({ t: 'team', team: me.team === 1 ? 2 : 1 })}>Switch to {me.team === 1 ? 'red' : 'blue'}</button>
                  )}
                  <button class={me?.ready ? 'on' : ''} onClick={() => session.send({ t: 'ready', ready: !me?.ready })}>{me?.ready ? 'Ready' : 'Mark ready'}</button>
                </div>
                {isHost && (
                  <div class="row" style={{ marginTop: 10 }}>
                    <button class="primary" onClick={() => session.send({ t: 'start' })}>{t('ui.startMatch')}</button>
                  </div>
                )}
                {!isHost && <p class="muted" style={{ marginTop: 10 }}>{t('ui.theHostStartsTheMatch')}</p>}
                <p class="muted" style={{ marginTop: 10 }}>{t('ui.shareThisCodeToInvitePeople')} <strong>{session.code}</strong></p>
              </>
            )}
            {session.ranked && <p class="muted">{t('ui.theMatchStartsWhenBothPlayers')}</p>}
          </div>
          {!session.ranked && (
            <div class="sheet">
              <h3>Rules{isHost ? '' : ' (host chooses)'}</h3>
              <div class="row" style={{ marginBottom: 8 }}>
                {(['teams', 'ffa'] as MatchKind[]).map((k) => (
                  <button class={st.kind === k ? 'on' : ''} disabled={!isHost} onClick={() => set({ kind: k })}>{k === 'teams' ? 'Teams' : 'Free-for-all'}</button>
                ))}
              </div>
              <div class="row">
                <span class="dd-field">Map{' '}
                  {isHost ? (
                    <Dropdown
                      label={t('ui.map')}
                      value={st.map ? (savedMaps().find((m) => m.map.name === st.map!.name)?.id ?? 'chosen') : 'random'}
                      onChange={(v) => set({ map: v === 'random' ? null : v === 'chosen' ? st.map : savedMaps().find((m) => m.id === v)?.map ?? null })}
                      options={[
                        { value: 'random', label: t('ui.randomMap') },
                        ...(st.map && !savedMaps().some((m) => m.map.name === st.map!.name) ? [{ value: 'chosen', label: st.map.name }] : []),
                        ...savedMaps().map((m) => ({ value: m.id, label: m.map.name })),
                      ]}
                    />
                  ) : <strong>{st.map?.name ?? 'Random map'}</strong>}
                </span>
                <span class="dd-field">{t('timer.label')}{' '}
                  <Dropdown
                    label={t('timer.label')}
                    disabled={!isHost}
                    value={st.roundSeconds ?? 45}
                    onChange={(v) => set({ roundSeconds: v })}
                    options={ROUND_SECONDS.map((n) => ({ value: n, label: t('timer.seconds', { n }) }))}
                  />
                </span>
                {!st.map && (
                  <span class="dd-field">{t('rocks.label')}{' '}
                    <Dropdown label={t('rocks.label')} disabled={!isHost} value={st.rockShapes ?? 'mixed'} onChange={(v) => set({ rockShapes: v })} options={[{ value: 'mixed', label: t('rocks.mixed') }, { value: 'circles', label: t('rocks.circles') }]} />
                  </span>
                )}
                {isHost && (
                  <span class="dd-field">{t('lobby.addBot')}{' '}
                    <Dropdown label={t('ui.botLevel')} value={null} placeholder={t('ui.chooseLevel')} onChange={(level) => session.send({ t: 'addBot', level })} options={(Object.keys(BOT_LEVELS) as BotLevel[]).map((l) => ({ value: l, label: BOT_LEVELS[l].label }))} />
                  </span>
                )}
                <label class="check"><input type="checkbox" disabled={!isHost} checked={st.showFunctions} onChange={(e) => set({ showFunctions: (e.target as HTMLInputElement).checked })} /> {t('ui.showEveryoneSFunctions')}</label>
              </div>
              {isHost && <MapCodeBox current={st.map ?? null} onLoad={(m) => set({ map: m })} />}
            </div>
          )}
          {chatPanel}
        </div>
      )}
    </div>
  );
}

export function Ranked() {
  useProfile();
  const auth = useAuth();
  const [searching, setSearching] = useState(false);
  const [waited, setWaited] = useState(0);
  const [error, setError] = useState('');
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => () => ws.current?.close(), []);
  useEffect(() => {
    if (!searching) return;
    const t = setInterval(() => setWaited((w) => w + 1), 1000);
    return () => clearInterval(t);
  }, [searching]);

  const queue = () => {
    setError('');
    setWaited(0);
    setSearching(true);
    const sock = new WebSocket(`${WS_URL}/match`);
    ws.current = sock;
    sock.onopen = () => sock.send(JSON.stringify({ token: authState.token, name: profile.name }));
    sock.onmessage = (e) => {
      const m = JSON.parse(e.data as string) as { t: string; code?: string; message?: string };
      if (m.t === 'matched' && m.code) {
        matched = true;
        go(`/ranked/${m.code}`);
      }
      if (m.t === 'error') {
        setError(m.message ?? 'Matchmaking failed. Try again.');
        setSearching(false);
      }
    };
    let matched = false;
    const lost = () => {
      if (matched || ws.current !== sock) return;
      ws.current = null;
      setError("The ranked queue isn't reachable right now. Try again soon.");
      setSearching(false);
    };
    sock.onerror = lost;
    sock.onclose = lost;
  };
  const cancel = () => {
    const sock = ws.current;
    ws.current = null;
    sock?.close();
    setSearching(false);
  };

  return (
    <div class="page">
      <TopBar title={t('ui.ranked')} />
      <div class="sheet">
        <p>{t('ui.oneOnOneOneSoldierEach')}</p>
        {!auth.ready ? (
          <p>{t('ui.checkingYourAccount')}</p>
        ) : !auth.user ? (
          <>
            <p>{t('ui.makeAFreeAccountSoYour')}</p>
            <a class="btn primary" href="#/signin">{t('ui.signInOrCreateAnAccount')}</a>
          </>
        ) : searching ? (
          <div class="row">
            <span>Looking for an opponent ({waited}s)</span>
            <button onClick={cancel}>{t('ui.cancel2')}</button>
          </div>
        ) : (
          <button class="primary" onClick={queue}>{t('ui.findAMatch')}</button>
        )}
        <FadeText text={error} />
      </div>
      {auth.ready && auth.user && <RankedInfo />}
      {auth.ready && !auth.user && <RankLadder />}
    </div>
  );
}
