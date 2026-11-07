import type { ComponentChildren } from 'preact';

interface Tab {
  path: string;
  label: string;
}

/** Hand-drawn icons, in the same ink as the rest of the game. They animate when a section is hovered. */
function PlayIcon() {
  return (
    <svg class="nav-icon icon-play" viewBox="0 0 32 32" aria-hidden="true">
      <path class="arrow" d="M9.5 5.5c-.8 0-1.3.6-1.3 1.4l.5 18.4c0 1 1 1.6 1.9 1.1l15.6-9.1c.9-.5.9-1.7 0-2.3L10.7 5.8c-.4-.2-.8-.3-1.2-.3Z" />
    </svg>
  );
}

function GraphIcon() {
  return (
    <svg class="nav-icon icon-graph" viewBox="0 0 32 32" aria-hidden="true">
      <path class="axes" d="M6.5 4.5c.2 7.500-.1 15.200 0 21 6.800.2 14.100-.1 21 .1" />
      <path class="curve" pathLength="1" d="M7 21.500c3.500.5 4.500-13.500 8.500-13.500s3.500 10 6.500 10 3-6.500 5-8.500" />
      <circle class="dot" cx="27" cy="9.500" r="2.100" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg class="nav-icon icon-gear" viewBox="0 0 32 32" aria-hidden="true">
      <g class="gear">
        <path class="teeth" d="M13.800 3.500h4.400l.8 3.500 2.300 1 3.100-1.900 3.100 3.100-1.900 3.100 1 2.300 3.500.8v4.400l-3.500.8-1 2.300 1.900 3.100-3.100 3.100-3.100-1.900-2.300 1-.8 3.500h-4.400l-.8-3.500-2.300-1-3.100 1.900-3.100-3.100 1.900-3.100-1-2.300-3.500-.8v-4.400l3.500-.8 1-2.300-1.900-3.100 3.100-3.100 3.100 1.900 2.300-1Z" />
        <circle class="hole" cx="16" cy="16" r="4" />
      </g>
    </svg>
  );
}

const SECTIONS: { name: string; icon: () => ComponentChildren; tone: string; tabs: Tab[] }[] = [
  {
    name: 'Play',
    icon: PlayIcon,
    tone: 'var(--green)',
    tabs: [
      { path: '/online', label: 'Play Online' },
      { path: '/ranked', label: 'Ranked' },
      { path: '/local', label: 'Bots and Friends' },
    ],
  },
  {
    name: 'Practice',
    icon: GraphIcon,
    tone: 'var(--blue)',
    tabs: [
      { path: '/practice', label: 'Free Play' },
      { path: '/daily', label: 'Daily Challenge' },
      { path: '/learn', label: 'Learn' },
      { path: '/campaign', label: 'Campaign' },
    ],
  },
  {
    name: 'Misc',
    icon: GearIcon,
    tone: 'var(--violet)',
    tabs: [
      { path: '/shop', label: 'Shop' },
      { path: '/leaderboard', label: 'Leaderboard' },
      { path: '/profile', label: 'Profile' },
      { path: '/settings', label: 'Settings' },
    ],
  },
];

function isActive(tab: string, path: string): boolean {
  if (tab === '/') return path === '/';
  if (tab === '/online') return path.startsWith('/online') || path.startsWith('/room');
  if (tab === '/campaign') return path.startsWith('/campaign') || path.startsWith('/level');
  if (tab === '/leaderboard') return path.startsWith('/leaderboard') || path.startsWith('/player');
  return path.startsWith(tab);
}

/** The left tab bar on larger screens. Phones use the menu page's tiles instead. */
export function SideNav({ path }: { path: string }) {
  return (
    <nav class="sidenav" aria-label="Main">
      <a class="brand" href="#/">MathBattles.io</a>
      <a class={`tab home ${path === '/' ? 'active' : ''}`} href="#/" aria-current={path === '/' ? 'page' : undefined}>Home</a>
      {SECTIONS.map((s) => {
        const open = s.tabs.some((t) => isActive(t.path, path));
        const Icon = s.icon;
        return (
          <section class={`nav-section ${open ? 'open' : ''}`} style={{ '--tone': s.tone }} aria-label={s.name}>
            <h2 class="nav-title">
              <Icon />
              <span>{s.name}</span>
            </h2>
            {s.tabs.map((t) => {
              const active = isActive(t.path, path);
              return (
                <a class={`tab ${active ? 'active' : ''}`} href={`#${t.path}`} aria-current={active ? 'page' : undefined}>
                  {t.label}
                </a>
              );
            })}
          </section>
        );
      })}
    </nav>
  );
}
