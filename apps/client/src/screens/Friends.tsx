import { useEffect, useState } from 'preact/hooks';
import { useAuth } from '../auth';
import { dismissInvite, friendAction, inviteToRoom, partyAction } from '../net/api';
import { currentRoom, refreshSocial, social, subscribeSocial } from '../social';
import { go, sound } from '../util';
import { profile } from '../store';
import { TopBar } from './Shared';
import { Icon } from './Icons';
import { ChatWindow, useOpenChats } from './Chat';
import { MAX_OPEN_CHATS, openChat } from '../dms';
import { t } from '../i18n';
import { FadeText } from './Notices';

export function useSocial() {
  const [, force] = useState(0);
  useEffect(() => subscribeSocial(() => force((n) => n + 1)), []);
  return social;
}

/** Friends, requests and your party, all in one place. */
export function Friends() {
  const auth = useAuth();
  const s = useSocial();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [lastRoom] = useState(() => sessionStorage.getItem('mathbattles.lastRoom'));
  // Removing a friend takes two clicks, so it can't happen by accident.
  const [removing, setRemoving] = useState<string | null>(null);
  useEffect(() => {
    void refreshSocial();
  }, []);

  if (!auth.ready) return <div class="page"><TopBar title={t('ui.friends')} /><p>{t('ui.checkingYourAccount')}</p></div>;
  if (!auth.user || !auth.username) {
    return (
      <div class="page">
        <TopBar title={t('ui.friends')} />
        <div class="sheet">
          <p>{t('ui.makeAFreeAccountToAdd')}</p>
          <a class="btn primary" href="#/signin">{t('ui.signInOrCreateAnAccount')}</a>
        </div>
      </div>
    );
  }
  const run = async (task: Promise<{ data?: { message?: string }; error?: string }>, ok?: string) => {
    setError('');
    setNote('');
    const r = await task;
    if (r.error) {
      setError(r.error);
      sound('error', profile.muted);
    } else {
      setNote(r.data?.message ?? ok ?? '');
      sound('toggle', profile.muted);
    }
    await refreshSocial();
  };
  const state = s.state;
  const chats = useOpenChats();
  const startChat = (name: string) => {
    if (!openChat(name)) {
      setError(`You can have ${MAX_OPEN_CHATS} chats open at once. Close one to open another.`);
      sound('error', profile.muted);
      return;
    }
    setError('');
    sound('open', profile.muted);
    // Bring the chats into view on small screens, where they sit above the lists.
    requestAnimationFrame(() => document.querySelector('.chats')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };
  const room = currentRoom() ?? lastRoom;
  const party = state?.party ?? null;
  const online = state?.friends.filter((f) => f.online) ?? [];
  const offline = state?.friends.filter((f) => !f.online) ?? [];

  return (
    <div class="page">
      <TopBar title={t('ui.friends')} />
      <FadeText text={error} />
      {note && <p class="ok" role="status">{note}</p>}
      {chats.length > 0 && (
        <div class="sheet chats-sheet">
          <h3>{t('ui.messages')} <small class="muted">{chats.length}/{MAX_OPEN_CHATS} open</small></h3>
          <div class={`chats count-${chats.length}`}>
            {chats.map((c) => (
              <ChatWindow key={c.name} chat={c} online={!!state?.friends.find((f) => f.name.toLowerCase() === c.name.toLowerCase())?.online} />
            ))}
          </div>
        </div>
      )}
      <div class="grid-2">
        <div>
          <div class="sheet">
            <h3>{t('ui.addAFriend')}</h3>
            <form class="row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void run(friendAction('request', name.trim())).then(() => setName('')); }}>
              <input type="text" placeholder={t('ui.theirUsername')} maxLength={16} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-label={t('ui.usernameToAdd')} />
              <button class="primary" type="submit" disabled={!name.trim()}>{t('ui.sendRequest')}</button>
            </form>
            <p class="muted small-note" style={{ marginTop: 6 }}>{t('ui.yourUsernameIs')} <strong>{auth.username}</strong>{t('ui.shareItSoFriendsCanAdd')}</p>
          </div>
          {!!state?.incoming.length && (
            <div class="sheet">
              <h3>{t('ui.friendRequests')}</h3>
              {state.incoming.map((n) => (
                <div class="friend-row">
                  <strong>{n}</strong>
                  <span class="row">
                    <button class="small primary" onClick={() => void run(friendAction('accept', n), `You and ${n} are now friends.`)}>{t('ui.accept')}</button>
                    <button class="small" onClick={() => void run(friendAction('decline', n))}>{t('ui.decline')}</button>
                  </span>
                </div>
              ))}
            </div>
          )}
          <div class="sheet">
            <h3>Friends {state ? <small class="muted">{online.length} online</small> : null}</h3>
            {!state ? <p>{s.error || 'Loading your friends.'}</p> : state.friends.length === 0 ? <p class="muted">{t('ui.noFriendsYetAddSomeoneBy')}</p> : (
              <>
                {[...online, ...offline].map((f) => (
                  <div class={`friend-row ${f.online ? 'on' : ''}`}>
                    <span class="friend-name">
                      <i class="dot" aria-hidden="true" />
                      <a href={`#/player/${encodeURIComponent(f.name)}`}>{f.name}</a>
                      <small class="muted">{!f.online ? 'Offline' : f.room ? (f.inMatch ? 'In a match' : 'In a room') : 'Online'}</small>
                      <button class="small chat-button" aria-label={`Chat with ${f.name}${state.unread?.[f.name] ? `, ${state.unread[f.name]} unread` : ''}`} onClick={() => startChat(f.name)}>
                        Chat{state.unread?.[f.name] ? <span class="badge">{state.unread[f.name]}</span> : null}
                      </button>
                    </span>
                    <span class="row">
                      {f.online && f.room && !f.inMatch && !f.room.startsWith('R-') && <a class="btn small primary" href={`#/room/${f.room}`}>{t('ui.join')}</a>}
                      {f.online && f.room && f.inMatch && <a class="btn small watch-friend" href={`#/watch/${f.room}`} aria-label={t('friends.watchName', { name: f.name })}><Icon name="eye" /> {t('ui.watch')}</a>}
                      {room && f.online && f.room !== room && <button class="small" onClick={() => void run(inviteToRoom(f.name, room))}>{t('ui.invite')}</button>}
                      {party?.isLeader !== false && f.online && !party?.members.some((m) => m.name === f.name) && (
                        <button class="small" onClick={() => void run(party ? partyAction('invite', { name: f.name }) : partyAction('create').then(() => partyAction('invite', { name: f.name })))}>{t('ui.partyUp')}</button>
                      )}
                      {removing === f.name ? (
                        <>
                          <button class="small danger" onClick={() => { setRemoving(null); void run(friendAction('remove', f.name), `Removed ${f.name}.`); }}>{t('ui.yesRemove')}</button>
                          <button class="small plain" onClick={() => setRemoving(null)}>{t('ui.keep')}</button>
                        </>
                      ) : <button class="small plain" onClick={() => setRemoving(f.name)}>{t('ui.remove')}</button>}
                    </span>
                  </div>
                ))}
              </>
            )}
            {!!state?.outgoing.length && (
              <p class="muted small-note" style={{ marginTop: 8 }}>
                Waiting for: {state.outgoing.map((n, i) => (
                  <span>{i ? ', ' : ''}{n} <button class="plain small" onClick={() => void run(friendAction('cancel', n))}>{t('ui.cancel')}</button></span>
                ))}
              </p>
            )}
          </div>
        </div>
        <div>
          <div class="sheet">
            <h3>{t('ui.party')}</h3>
            {!party ? (
              <>
                <p>{t('ui.aPartyMovesTogetherWhenThe')}</p>
                <button class="primary" onClick={() => void run(partyAction('create'), 'Party started. Invite friends to it.')}>{t('ui.startAParty')}</button>
              </>
            ) : (
              <>
                <p>{party.isLeader ? 'You lead this party. Join or make a room, and your party follows you in.' : `${party.leader} leads this party. You'll follow them into rooms.`}</p>
                <ul class="party-list">
                  {party.members.map((m) => (
                    <li class={m.online ? 'on' : ''}>
                      <i class="dot" aria-hidden="true" />
                      <strong>{m.name}</strong>{m.leader ? <small class="muted"> {t('ui.leader')}</small> : null}
                      {party.isLeader && !m.leader && <button class="small plain" onClick={() => void run(partyAction('kick', { name: m.name }))}>{t('ui.remove')}</button>}
                    </li>
                  ))}
                </ul>
                {party.room && !party.isLeader && currentRoom() !== party.room && <a class="btn primary" href={`#/room/${party.room}`}>{t('ui.joinYourPartySRoom')}</a>}
                <div class="row" style={{ marginTop: 10 }}>
                  {party.isLeader && <button onClick={() => go('/online')}>{t('ui.findARoom')}</button>}
                  <button onClick={() => void run(partyAction('leave'), 'You left the party.')}>{t('ui.leaveParty')}</button>
                </div>
              </>
            )}
          </div>
          {!room && <p class="muted small-note">{t('ui.tipJoinARoomFirstAnd')}</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * Invitations that pop up wherever you are, and the party follow: when your party leader
 * moves into a room, you're taken there too, unless you're busy in a game.
 */
export function InviteToasts() {
  const s = useSocial();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [followed, setFollowed] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  // Remembers unread counts already seen, so only new messages pop up.
  const seenUnread = useState<Record<string, number>>({})[0];
  const [newFrom, setNewFrom] = useState<string | null>(null);
  useEffect(() => {
    const unread = s.state?.unread ?? {};
    const onFriends = location.hash.startsWith('#/friends');
    for (const [name, n] of Object.entries(unread)) {
      if (n > (seenUnread[name] ?? 0) && !onFriends) {
        setNewFrom(name);
        sound('chatReceive', profile.muted);
      }
    }
    for (const k of Object.keys(seenUnread)) delete seenUnread[k];
    Object.assign(seenUnread, unread);
  }, [JSON.stringify(s.state?.unread ?? {})]);
  const state = s.state;
  const party = state?.party;

  useEffect(() => {
    const room = currentRoom();
    if (room) sessionStorage.setItem('mathbattles.lastRoom', room);
    if (!party || party.isLeader || !party.room || party.room === followed) return;
    if (room === party.room) return;
    // Don't pull someone out of a game, a lesson, or the map editor.
    const busy = /^#\/(room|ranked|watch|local|practice|level|learn|replay|maps\/edit)/.test(location.hash);
    if (busy) return;
    setFollowed(party.room);
    sound('turn', profile.muted);
    go(`/room/${party.room}`);
  }, [party?.room, party?.isLeader]);

  const invites = (state?.invites ?? []).filter((i) => !hidden.has(i.id));
  const messageToast = newFrom && !location.hash.startsWith('#/friends') ? (
    <div class="toast sheet">
      <p>{t('ui.newMessageFrom')} <strong>{newFrom}</strong>.</p>
      <div class="row">
        <button class="small primary" onClick={() => { openChat(newFrom); setNewFrom(null); go('/friends'); }}>{t('ui.open')}</button>
        <button class="small" onClick={() => setNewFrom(null)}>{t('ui.later')}</button>
      </div>
    </div>
  ) : null;
  if (problem) {
    return (
      <div class="toasts" role="region" aria-label={t('ui.invitations')}>
        <div class="toast sheet"><p class="error">{problem}</p><button class="small" onClick={() => setProblem('')}>{t('ui.ok')}</button></div>
      </div>
    );
  }
  if (!invites.length && !messageToast) return null;
  const close = (id: string) => {
    setHidden(new Set([...hidden, id]));
    void dismissInvite(id);
  };
  return (
    <div class="toasts" role="region" aria-label={t('ui.invitations')}>
      {messageToast}
      {invites.slice(0, 3).map((i) => (
        <div class="toast sheet">
          <p><strong>{i.from}</strong> {i.kind === 'party' ? 'invited you to their party.' : 'invited you to play.'}</p>
          <div class="row">
            <button class="small primary" onClick={() => {
              setHidden(new Set([...hidden, i.id]));
              if (i.kind === 'party') {
                // Joining uses the invite, and the server clears it afterwards.
                void partyAction('join', { id: i.target }).then((r) => {
                  if (r.error) setProblem(r.error);
                  void refreshSocial();
                });
              } else {
                close(i.id);
                go(`/room/${i.target}`);
              }
            }}>{i.kind === 'party' ? 'Join party' : 'Join'}</button>
            <button class="small" onClick={() => close(i.id)}>{t('ui.notNow')}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
