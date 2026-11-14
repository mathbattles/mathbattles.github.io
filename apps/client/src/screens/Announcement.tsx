import { useEffect, useState } from 'preact/hooks';
import { gameConfig, subscribeGameConfig } from '../gameConfig';
import { Icon } from './Icons';

const DISMISSED = 'mathbattles.announcementSeen';

/** The admin's site-wide announcement, across the top of every page until dismissed. */
export function Announcement() {
  const [, force] = useState(0);
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISSED) ?? '';
    } catch {
      return '';
    }
  });
  useEffect(() => subscribeGameConfig(() => force((n) => n + 1)), []);
  const text = gameConfig.announcement;
  if (!text || hidden === text) return null;
  return (
    <div class="announcement" role="status">
      <Icon name="megaphone" />
      <span>{text}</span>
      <button
        class="small plain"
        aria-label="Hide this announcement"
        onClick={() => {
          setHidden(text);
          try {
            sessionStorage.setItem(DISMISSED, text);
          } catch {
            /* Storage may be blocked; it just shows again next time. */
          }
        }}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
