/** The left tab bar on larger screens. Phones use the menu page's tiles instead. */
const TABS = [
  { path: '/', label: 'Home', color: 'var(--ink)' },
  { path: '/online', label: 'Play online', color: 'var(--green)' },
  { path: '/local', label: 'Bots and friends', color: 'var(--green)' },
  { path: '/campaign', label: 'Campaign', color: 'var(--blue)' },
  { path: '/daily', label: 'Daily Challenge', color: 'var(--pink)' },
  { path: '/practice', label: 'Practice', color: 'var(--green)' },
  { path: '/ranked', label: 'Ranked', color: 'var(--violet)' },
  { path: '/leaderboard', label: 'Leaderboard', color: 'var(--violet)' },
  { path: '/learn', label: 'Learn', color: 'var(--orange)' },
  { path: '/shop', label: 'Shop', color: 'var(--yellow)' },
  { path: '/profile', label: 'Profile', color: 'var(--blue)' },
  { path: '/settings', label: 'Settings', color: 'var(--ink-soft)' },
];

function isActive(tab: string, path: string): boolean {
  if (tab === '/') return path === '/';
  if (tab === '/ranked') return path.startsWith('/ranked');
  if (tab === '/online') return path.startsWith('/online') || path.startsWith('/room');
  if (tab === '/campaign') return path.startsWith('/campaign') || path.startsWith('/level');
  return path.startsWith(tab);
}

export function SideNav({ path }: { path: string }) {
  return (
    <nav class="sidenav" aria-label="Main">
      <a class="brand" href="#/">MathBattles.io</a>
      {TABS.map((t) => {
        const active = isActive(t.path, path);
        return (
          <a
            class={`tab ${active ? 'active' : ''}`}
            href={`#${t.path}`}
            aria-current={active ? 'page' : undefined}
            style={{ '--tab': t.color }}
          >
            <i aria-hidden="true" />
            {t.label}
          </a>
        );
      })}
    </nav>
  );
}
