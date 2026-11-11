import type { JSX } from 'preact';

/**
 * The game's own icons, drawn by hand in the same ink style as the rest of the page:
 * round-capped strokes, slightly uneven lines, and the current text colour. No emoji or
 * text symbols are used as icons anywhere.
 */
export type IconName =
  | 'first' | 'prev' | 'next' | 'last' | 'frameBack' | 'frameNext' | 'play' | 'pause'
  | 'up' | 'down' | 'left' | 'right' | 'check' | 'close' | 'chevronUp' | 'chevronDown'
  | 'star' | 'starEmpty' | 'spark' | 'energy' | 'ability' | 'hop' | 'ricochet' | 'heavy'
  | 'backspace' | 'shop' | 'flag' | 'lock' | 'unlock' | 'clock' | 'skull' | 'beam' | 'out' | 'replay' | 'share' | 'download' | 'heart'
  | 'rotateLeft' | 'rotateRight' | 'code' | 'search' | 'badge';

const PATHS: Record<IconName, JSX.Element> = {
  first: <><path d="M5.2 4.8v14.4" /><path d="M18.6 5.4 8.4 12.1l10.4 6.6z" fill="currentColor" /></>,
  prev: <path d="M17.8 5.2 6.6 12l11.3 6.9z" fill="currentColor" />,
  next: <path d="M6.2 5.2 17.4 12 6.1 18.9z" fill="currentColor" />,
  last: <><path d="M18.8 4.8v14.4" /><path d="M5.4 5.4l10.2 6.7-10.4 6.6z" fill="currentColor" /></>,
  frameBack: <><path d="M14.8 6.2 9 12.1l5.9 5.8" /><path d="M19.2 6.4v11.3" /></>,
  frameNext: <><path d="M9.2 6.2 15 12.1l-5.9 5.8" /><path d="M4.8 6.4v11.3" /></>,
  play: <path d="M7.1 4.9 18.6 12.1 7 19.2z" fill="currentColor" />,
  pause: <><path d="M8.6 5.4v13.3" /><path d="M15.3 5.6v13.1" /></>,
  up: <><path d="M12.1 19.4V5.2" /><path d="M6.2 10.8 12 4.9l5.9 6" /></>,
  down: <><path d="M11.9 4.6v14.2" /><path d="M6.1 13.2 12 19.1l5.9-6" /></>,
  left: <path d="M15.4 5.4 8.6 12.1l6.9 6.6" />,
  right: <path d="M8.6 5.4l6.8 6.7-6.9 6.6" />,
  check: <path d="M4.9 12.6l4.6 4.7L19.3 6.4" />,
  close: <><path d="M6.4 6.2 17.7 17.9" /><path d="M17.6 6.3 6.3 17.6" /></>,
  chevronUp: <path d="M5.8 15.1 12 8.8l6.3 6.4" />,
  chevronDown: <path d="M5.8 8.9 12 15.2l6.3-6.4" />,
  star: <path d="M12 3.6l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z" fill="currentColor" />,
  starEmpty: <path d="M12 3.6l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z" />,
  spark: <><path d="M12 3.4c.6 4.7 3.6 7.8 8.4 8.6-4.8.7-7.8 3.8-8.4 8.6-.7-4.8-3.7-7.9-8.5-8.6 4.8-.8 7.8-3.9 8.5-8.6z" fill="currentColor" /></>,
  energy: <path d="M13.6 2.9 5.9 13.4h5.4l-1.2 7.8 8.1-10.7h-5.6z" fill="currentColor" strokeLinejoin="round" />,
  ability: <><circle cx="12" cy="12" r="7.6" /><path d="M12 7.4v9.2M7.4 12h9.2" /></>,
  hop: <><path d="M3.6 18.6c3.4-.1 4.4-9.8 8.5-9.9 4.1 0 5.1 9.8 8.4 9.9" strokeDasharray="2.2 2.6" /><circle cx="12.1" cy="6.2" r="2.6" fill="currentColor" /><path d="M8.6 20.4h7" /></>,
  ricochet: <><path d="M3.8 5.4 12 15.6l8.3-10.2" /><path d="M8.2 19.3c2.6-1.6 5.1-1.6 7.7 0" /><path d="M16.7 5.6h3.6v3.5" /></>,
  heavy: <><circle cx="12" cy="13" r="6.4" fill="currentColor" /><path d="M12 6.6V3.4" /><path d="M5.2 6.4 3.4 4.6M18.8 6.4l1.8-1.8" /></>,
  backspace: <><path d="M8.4 5.6h11.3v12.8H8.4L3.4 12z" /><path d="M11.4 9.4l5 5.2M16.4 9.4l-5 5.2" /></>,
  shop: <><path d="M4.4 9.2h15.2l-1.3 10.4H5.7z" /><path d="M8.4 9.2V7.4a3.6 3.6 0 0 1 7.2 0v1.8" /></>,
  flag: <><path d="M5.6 20.6V3.8" /><path d="M5.8 4.4c4.4-1.8 7 1.8 12.6 0v8.4c-5.6 1.8-8.2-1.8-12.6 0" /></>,
  lock: <><rect x="5.4" y="10.6" width="13.2" height="9.4" rx="2" /><path d="M8.4 10.6V8a3.6 3.6 0 0 1 7.2 0v2.6" /></>,
  unlock: <><rect x="5.4" y="10.6" width="13.2" height="9.4" rx="2" /><path d="M8.4 10.6V8a3.6 3.6 0 0 1 7-1.2" /></>,
  clock: <><circle cx="12" cy="12.4" r="8" /><path d="M12 7.6v5l3.4 2.2" /></>,
  skull: <><path d="M5.4 11.2a6.6 6.6 0 1 1 13.2 0c0 2.6-1.4 3.6-2.2 4.4v3.2H7.6v-3.2c-.8-.8-2.2-1.8-2.2-4.4z" /><circle cx="9.4" cy="11.4" r="1.3" fill="currentColor" /><circle cx="14.6" cy="11.4" r="1.3" fill="currentColor" /></>,
  beam: <><path d="M12 2.8v18.4" strokeWidth="4.4" /><path d="M7.4 12h9.2" /></>,
  out: <><path d="M4.4 4.6v14.8" /><path d="M9.4 12h10.6" /><path d="M15.8 7.8l4.3 4.2-4.3 4.2" /></>,
  replay: <><path d="M5.2 12a6.9 6.9 0 1 0 2-4.9" /><path d="M4.8 4.6v4.2H9" /></>,
  share: <><circle cx="17.6" cy="5.8" r="2.4" /><circle cx="6.4" cy="12" r="2.4" /><circle cx="17.6" cy="18.2" r="2.4" /><path d="M8.6 10.8l6.8-3.8M8.6 13.2l6.8 3.8" /></>,
  download: <><path d="M12 3.8v11.4" /><path d="M7.2 10.8 12 15.6l4.8-4.8" /><path d="M4.6 19.6h14.8" /></>,
  heart: <path d="M12 19.4c-4.6-3.2-7.8-6-7.8-9.4a4.2 4.2 0 0 1 7.8-2.2 4.2 4.2 0 0 1 7.8 2.2c0 3.4-3.2 6.2-7.8 9.4z" />,
  rotateLeft: <><path d="M6.4 9.6a6.6 6.6 0 1 1-.6 6.2" /><path d="M5.6 4.8v5h5" /></>,
  rotateRight: <><path d="M17.6 9.6a6.6 6.6 0 1 0 .6 6.2" /><path d="M18.4 4.8v5h-5" /></>,
  code: <><rect x="3.8" y="5.4" width="16.4" height="13.2" rx="2.4" /><path d="M8.4 10.2 6.4 12l2 1.8M15.6 10.2l2 1.8-2 1.8M12.8 9.6l-1.6 4.8" /></>,
  search: <><circle cx="10.6" cy="10.6" r="5.8" /><path d="M15 15l4.6 4.6" /></>,
  badge: <><path d="M12 3.4l7 2.8v5.6c0 4.4-3 7.4-7 8.8-4-1.4-7-4.4-7-8.8V6.2z" /><path d="M8.8 12l2.2 2.2 4.2-4.4" /></>,
};

export function Icon({ name, size = '1.1em', label, class: cls }: { name: IconName; size?: string | number; label?: string; class?: string }) {
  return (
    <svg
      class={`icon icon-${name}${cls ? ` ${cls}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.3"
      stroke-linecap="round"
      stroke-linejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
    >
      {PATHS[name]}
    </svg>
  );
}

/** Stars for a campaign level, drawn rather than typed. */
export function Stars({ n, label }: { n: number; label: string }) {
  return (
    <span class="stars" role="img" aria-label={label}>
      {[0, 1, 2].map((i) => <Icon name={i < n ? 'star' : 'starEmpty'} />)}
    </span>
  );
}
