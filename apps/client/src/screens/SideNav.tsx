import type { ComponentChildren } from 'preact';
import { useAuth } from '../auth';
import { isAdminName } from './Admin';
import { useSocial } from './Friends';
import { t } from '../i18n';

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

function ShopIcon() {
  return (
    <svg class="nav-icon icon-shop" viewBox="0 0 32 32" aria-hidden="true">
      <path class="bag" d="M6.200 11.800c6.600-.3 13.200.2 19.700-.1l-1.600 14.600c-5.500.3-11 0-16.500.2z" />
      <path class="handle" d="M11.400 11.600c-.4-4.300 1.800-6.900 4.700-6.900s5.200 2.500 4.600 6.900" />
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

/** Built when drawn, so the labels follow the chosen language. */
const sectionList = (): { id: string; name: string; icon: () => ComponentChildren; tone: string; tabs: Tab[] }[] => [
  {
    id: 'play',
    name: t('nav.play'),
    icon: PlayIcon,
    tone: 'var(--green)',
    tabs: [
      { path: '/online', label: t('ui.playOnline2') },
      { path: '/ranked', label: t('ui.ranked') },
      { path: '/local', label: t('ui.botsAndFriends') },
      { path: '/friends', label: t('ui.friends') },
    ],
  },
  {
    id: 'practice',
    name: t('nav.practice'),
    icon: GraphIcon,
    tone: 'var(--blue)',
    tabs: [
      { path: '/practice', label: t('ui.freePlay') },
      { path: '/learn', label: t('ui.learn') },
      { path: '/campaign', label: t('ui.campaign') },
      { path: '/maps', label: t('ui.customMaps2') },
    ],
  },
  {
    id: 'shop',
    name: t('nav.shop'),
    icon: ShopIcon,
    tone: 'var(--orange)',
    tabs: [
      { path: '/shop', label: t('nav.cosmetics') },
      { path: '/abilities', label: t('nav.abilities') },
      { path: '/inventory', label: t('ui.inventory') },
    ],
  },
  {
    id: 'misc',
    name: t('nav.misc'),
    icon: GearIcon,
    tone: 'var(--violet)',
    tabs: [
      { path: '/season', label: t('nav.season') },
      { path: '/leaderboard', label: t('ui.leaderboard') },
      { path: '/profile', label: t('ui.profile') },
      { path: '/settings', label: t('ui.settings') },
    ],
  },
];

function isActive(tab: string, path: string): boolean {
  if (tab === '/') return path === '/';
  if (tab === '/shop') return path.startsWith('/shop') || path.startsWith('/cosmetics');
  if (tab === '/online') return path.startsWith('/online') || path.startsWith('/room') || path.startsWith('/watch');
  if (tab === '/maps') return path.startsWith('/maps') || path.startsWith('/map/');
  if (tab === '/campaign') return path.startsWith('/campaign') || path.startsWith('/level');
  if (tab === '/leaderboard') return path.startsWith('/leaderboard') || path.startsWith('/player');
  return path.startsWith(tab);
}

/** The left tab bar on larger screens. Phones use the menu page's tiles instead. */
export function SideNav({ path }: { path: string }) {
  const auth = useAuth();
  const social = useSocial();
  const waiting = Object.values(social.state?.unread ?? {}).reduce((a, b) => a + b, 0) + (social.state?.incoming.length ?? 0);
  // The admin page shows up only for the game's owner.
  const all = sectionList();
  const sections = isAdminName(auth.username)
    ? all.map((s) => (s.id === 'misc' ? { ...s, tabs: [...s.tabs, { path: '/admin', label: t('ui.admin') }] } : s))
    : all;
  return (
    <nav class="sidenav" aria-label={t('ui.main')}>
      <a class="brand" href="#/">{t('ui.mathbattlesIo')}</a>
      <a class={`tab home ${path === '/' ? 'active' : ''}`} href="#/" aria-current={path === '/' ? 'page' : undefined}>{t('ui.home')}</a>
      {sections.map((s) => {
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
                  {t.path === '/friends' && waiting > 0 && <span class="badge" aria-label={`${waiting} waiting`}>{waiting}</span>}
                </a>
              );
            })}
          </section>
        );
      })}
    </nav>
  );
}
