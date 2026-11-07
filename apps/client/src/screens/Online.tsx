import { BOT_LEVELS, MAX_PLAYERS, encodeReplay, isOnWinningSide, makeReplay, matchRecordFor, type BotLevel, type MatchKind, type MatchState, type ShotMode } from '@mathbattles/sim';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { authState, useAuth } from '../auth';
import { NetSession } from '../game/session';
import { recordMatchHistory } from '../history';
import { WS_URL, createRoom, listRooms, reportChat, serverReachable, type RoomInfo } from '../net/api';
import { cosmeticValue, profile, recordMatch } from '../store';
import { go, modeName } from '../util';
import { GameView } from './GameView';
import { ResultCard } from './Local';
import { TopBar, useProfile } from './Shared';

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
      <TopBar title="Play online" />
      {online === false && <p class="error" role="alert">{UNAVAILABLE}</p>}
      {error && <p class="error" role="alert">{error}</p>}
      <div class="grid-2">
        <div class="sheet">
          <h3>Start a room</h3>
          <div class="row">
            <button class="primary" disabled={!online} onClick={() => void make(true)}>Create public room</button>
            <button disabled={!online} onClick={() => void make(false)}>Create private room</button>
          </div>
          <h3 style={{ marginTop: 16 }}>Join with a code</h3>
          <form class="row" onSubmit={(e) => { e.preventDefault(); if (code.trim()) go(`/room/${code.trim().toUpperCase()}`); }}>
            <input aria-label="Room code" value={code} maxLength={8} placeholder="ABCD" onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
            <button disabled={!online || !code.trim()}>Join</button>
          </form>
        </div>
        <div class="sheet">
          <h3>Public rooms</h3>
          {online === null ? <p>Looking for rooms.</p> : !rooms?.length ? <p class="muted">No open rooms. Create one and others can join.</p> : rooms.map((r) => (
            <div class="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <span>{r.kind === 'ffa' ? 'Free-for-all' : 'Teams'}, {modeName(r.mode)}, {r.players}/{MAX_PLAYERS}</span>
              <a class="btn small" href={`#/room/${r.code}`}>Join</a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Ranked rooms need the login token, which takes a moment to load after a page refresh. */
export function Room(props: { code: string; ranked?: boolean }) {
  const auth = useAuth();
  if (props.ranked && !auth.ready) {
    return <div class="page"><TopBar title="Ranked match" /><p>Checking your account.</p></div>;
  }
  return <RoomInner {...props} />;
}

function RoomInner({ code, ranked }: { code: string; ranked?: boolean }) {
  useProfile();
  const session = useMemo(() => new NetSession(`${WS_URL}/room/${encodeURIComponent(code)}`, {
    t: 'join',
    name: profile.name,
    token: profile.guestToken,
    idToken: authState.token,
    ability: profile.ability,
    hat: cosmeticValue('hat'),
  }), [code]);
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
      if (!authState.user) {
        void recordMatchHistory(
          matchRecordFor(state, session.setups, me?.id ?? null, { id: `${code.toUpperCase()}-${state.config.seed}`, at: Date.now(), kind: 'online' }),
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

  const chatPanel = profile.chatOff ? null : (
    <div class="mini">
      <h3>Chat</h3>
      <div class="chatlog" ref={chatRef} aria-live="polite">
        {session.chat.filter((l) => !l.fromId || !session.muted.has(l.fromId)).map((l) => (
          <div class={l.system ? 'sys' : ''}>
            {l.system ? l.text : <><strong>{l.from}:</strong> {l.text}</>}
            {!l.system && l.fromId !== session.you && (
              <>
                {' '}
                <button class="plain small" onClick={() => { if (l.fromId) session.muted.add(l.fromId); force((n) => n + 1); }}>Mute</button>
                <button class="plain small" onClick={() => { void reportChat(session.code, l.from, l.text); setReported(true); }}>Report</button>
              </>
            )}
          </div>
        ))}
      </div>
      {reported && <p class="ok">Report sent.</p>}
      <form class="row" onSubmit={sendChat} style={{ marginTop: 6 }}>
        <input aria-label="Chat message" style={{ flex: 1, width: 80 }} value={chatText} maxLength={140} onInput={(e) => setChatText((e.target as HTMLInputElement).value)} />
        <button class="small">Send</button>
      </form>
      <p class="muted" style={{ margin: '6px 0 0', fontSize: '.85rem' }}>Type -skip to vote for a new map.</p>
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
    const replay = over ? `${location.origin}${location.pathname}#/replay/${encodeReplay(makeReplay(over, session.setups))}` : undefined;
    return (
      <GameView
        session={session}
        keepSession
        notice={session.error}
        header={<a class="btn small" href={ranked ? '#/ranked' : '#/online'}>Leave</a>}
        hideOthersShots={!(session.settings?.showFunctions ?? false)}
        extraSide={chatPanel}
        result={over ? (
          <ResultCard state={over} viewer={session.you} rewards={rewards} replay={replay}>
            {session.ratingDelta !== undefined && <p>Rating {session.ratingDelta >= 0 ? '+' : ''}{session.ratingDelta}</p>}
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
      {session.status === 'connecting' && <p>Connecting.</p>}
      {session.error && <p class="error" role="alert">{session.error}</p>}
      {st && (
        <div class="grid-2">
          <div class="sheet">
            <h3>Players</h3>
            {session.seats.map((s) => (
              <div class="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <span class={`team-${s.team}`}>
                  <strong>{s.name}</strong>{s.isBot ? ' (bot)' : ''}{s.id === session.host ? ', host' : ''}{!s.connected ? ', reconnecting' : ''}
                </span>
                <span class="row">
                  {s.ready || s.isBot ? <span class="ok">Ready</span> : <span class="muted">Not ready</span>}
                  {isHost && s.id !== session.you && <button class="small" onClick={() => session.send({ t: 'removeSeat', id: s.id })}>Remove</button>}
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
                    <label>Add bot{' '}
                      <select aria-label="Bot level" onChange={(e) => { const el = e.target as HTMLSelectElement; if (el.value) session.send({ t: 'addBot', level: el.value }); el.value = ''; }}>
                        <option value="">Choose level</option>
                        {(Object.keys(BOT_LEVELS) as BotLevel[]).map((l) => <option value={l}>{BOT_LEVELS[l].label}</option>)}
                      </select>
                    </label>
                    <button class="primary" onClick={() => session.send({ t: 'start' })}>Start match</button>
                  </div>
                )}
                {!isHost && <p class="muted" style={{ marginTop: 10 }}>The host starts the match.</p>}
                <p class="muted" style={{ marginTop: 10 }}>Share this code to invite people: <strong>{session.code}</strong></p>
              </>
            )}
            {session.ranked && <p class="muted">The match starts when both players connect.</p>}
          </div>
          {!session.ranked && (
            <div class="sheet">
              <h3>Rules{isHost ? '' : ' (host chooses)'}</h3>
              <div class="row" style={{ marginBottom: 8 }}>
                {(['teams', 'ffa'] as MatchKind[]).map((k) => (
                  <button class={st.kind === k ? 'on' : ''} disabled={!isHost} onClick={() => set({ kind: k })}>{k === 'teams' ? 'Teams' : 'Free-for-all'}</button>
                ))}
              </div>
              <div class="row" style={{ marginBottom: 8 }}>
                {(['fn', 'ode1', 'ode2'] as ShotMode[]).map((m) => (
                  <button class={st.mode === m ? 'on' : ''} disabled={!isHost} onClick={() => set({ mode: m })}>{modeName(m)}</button>
                ))}
              </div>
              <div class="row">
                <label>Soldiers each{' '}
                  <select disabled={!isHost} value={st.soldiers} onChange={(e) => set({ soldiers: +(e.target as HTMLSelectElement).value })}>
                    {[1, 2, 3, 4].map((n) => <option value={n}>{n}</option>)}
                  </select>
                </label>
                <label><input type="checkbox" disabled={!isHost} checked={st.abilities} onChange={(e) => set({ abilities: (e.target as HTMLInputElement).checked })} /> Abilities</label>
                <label><input type="checkbox" disabled={!isHost} checked={st.showFunctions} onChange={(e) => set({ showFunctions: (e.target as HTMLInputElement).checked })} /> Show everyone's functions</label>
              </div>
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
      <TopBar title="Ranked" />
      <div class="sheet">
        <p>Ranked is one-on-one in Function mode, with one soldier each, no abilities, and no preview. Your rating changes after every match and partly resets each season.</p>
        {!auth.ready ? (
          <p>Checking your account.</p>
        ) : !auth.user ? (
          <>
            <p>Make a free account so your rating follows you.</p>
            <a class="btn primary" href="#/signin">Sign in or create an account</a>
          </>
        ) : searching ? (
          <div class="row">
            <span>Looking for an opponent ({waited}s)</span>
            <button onClick={cancel}>Cancel</button>
          </div>
        ) : (
          <button class="primary" onClick={queue}>Find a match</button>
        )}
        {error && <p class="error" role="alert">{error}</p>}
      </div>
      <a class="btn" href="#/leaderboard">View leaderboard</a>
    </div>
  );
}
