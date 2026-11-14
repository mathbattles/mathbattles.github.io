import { MAX_PLAYERS } from '@mathbattles/sim';
import { useEffect, useRef, useState } from 'preact/hooks';
import { heldRoom, releaseRoom, subscribeRoom } from '../game/roomHolder';
import { t } from '../i18n';
import { profile } from '../store';
import { go, sound } from '../util';
import { Icon } from './Icons';

const onRoomPage = (code: string) => {
  const m = location.hash.match(/^#\/(?:room|ranked)\/([A-Za-z0-9-]+)/);
  return !!m && m[1]!.toUpperCase() === code;
};

/**
 * While you browse other pages from a room lobby: a bar at the top that says which room you're
 * in, with a way back and a way out. When the match starts, it brings you straight back.
 */
export function RoomBar() {
  const [, force] = useState(0);
  const chatSeen = useRef(0);
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    const update = () => force((n) => n + 1);
    const unsub = subscribeRoom(update);
    window.addEventListener('hashchange', update);
    return () => {
      unsub();
      window.removeEventListener('hashchange', update);
    };
  }, []);
  const h = heldRoom();
  const session = h?.session;
  const away = !!h && !h.watch && !onRoomPage(h.code);

  useEffect(() => {
    const before = lastStatus.current;
    lastStatus.current = session?.status ?? null;
    if (!h || !session) return;
    // The match is starting (the lobby just turned into a match): back to the room, wherever you are.
    // Leaving a match that is already going, or finished, never pulls you back.
    if (before === 'lobby' && session.status === 'playing' && away && !h.watch) go(`/room/${h.code}`);
    // The room went away while you were elsewhere.
    if (session.status === 'closed' && away) releaseRoom();
  });

  // New room chat while you're away gets a sound.
  const chatLen = session?.chat.length ?? 0;
  useEffect(() => {
    if (away && chatLen > chatSeen.current && chatSeen.current > 0) sound('chatReceive', profile.muted);
    chatSeen.current = chatLen;
  }, [chatLen]);

  if (!h || !session || !away || session.status !== 'lobby') return null;
  const players = session.seats.length;
  return (
    <div class="room-bar" role="region" aria-label={t('roombar.label')}>
      <Icon name="users" />
      <span class="room-bar-text">
        {t('roombar.inRoom', { code: h.code })} <small class="muted">{t('roombar.players', { n: players, max: MAX_PLAYERS })}</small>
      </span>
      <button class="small primary" onClick={() => go(`/room/${h.code}`)}>{t('roombar.back')}</button>
      <button class="small" onClick={() => releaseRoom()}><Icon name="door" /> {t('roombar.leave')}</button>
    </div>
  );
}
