import { Component, render, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import './styles.css';
import { initAuth, setAnalyticsConsent } from './auth';
import { applyUiScale, profile, setUiScale, subscribeProfile } from './store';
import { browserLang, currentLang, isLang, setLanguage, useLang, t } from './i18n';
import { useProfile } from './screens/Shared';
import { Menu } from './screens/Menu';
import { LocalSetup, Practice } from './screens/Local';
import { Campaign, LevelScreen, ReplayScreen, ShortReplay } from './screens/Solo';
import { Leaderboard, Privacy, ProfileScreen, Settings, Shop } from './screens/Meta';
import { OnlineMenu, Ranked, Room } from './screens/Online';
import { SignIn } from './screens/Account';
import { Learn } from './screens/Learn';
import { PlayerScreen } from './screens/History';
import { SideNav } from './screens/SideNav';
import { initAudioUi } from './audio/ui';
import { Inventory } from './screens/Inventory';
import { Admin } from './screens/Admin';
import { Friends, InviteToasts } from './screens/Friends';
import { MapEditor, MapsPage, SharedMapScreen } from './screens/Maps';
import { initSocial } from './social';

// Another site could frame the game to trick clicks. If it's framed, break out of the frame.
if (window.top !== window.self) {
  try {
    window.top!.location.href = window.self.location.href;
  } catch {
    document.documentElement.innerHTML = '';
  }
}

// Interface size and language apply before anything is drawn, and follow later changes,
// such as signing in on a device with a different saved language.
applyUiScale();
const wantedLang = () => (isLang(profile.language) ? profile.language : browserLang());
void setLanguage(wantedLang());
subscribeProfile(() => {
  applyUiScale();
  if (wantedLang() !== currentLang()) void setLanguage(wantedLang());
});
// In a match, Ctrl with minus, plus or 0 changes the interface size instead of the page zoom.
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || !document.body.classList.contains('in-game')) return;
  if (e.key === '-' || e.key === '_') setUiScale(profile.uiScale - 0.05);
  else if (e.key === '=' || e.key === '+') setUiScale(profile.uiScale + 0.05);
  else if (e.key === '0') setUiScale(1);
  else return;
  e.preventDefault();
});

function route(): string {
  return location.hash.replace(/^#/, '') || '/';
}

function decodeSafe(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function Router({ path }: { path: string }) {
  const parts = path.split('/').filter(Boolean);
  switch (parts[0]) {
    case undefined: return <Menu />;
    case 'local': return <LocalSetup />;
    case 'practice': return <Practice />;
    case 'campaign': return <Campaign />;
    case 'level': return <LevelScreen id={parts[1] ?? ''} />;
    case 'replay': return <ReplayScreen key={parts[1]} data={parts[1] ?? ''} />;
    // Short replay links: the server keeps the replay, the link holds an 8-character id.
    case 'r': return <ShortReplay key={parts[1]} id={parts[1] ?? ''} />;
    case 'online': return <OnlineMenu />;
    // Whether a room is ranked depends only on its code, however the link was written.
    case 'room':
    case 'ranked':
      if (!parts[1]) return parts[0] === 'ranked' ? <Ranked /> : <OnlineMenu />;
      return <Room key={parts[1]} code={parts[1]} ranked={parts[1].toUpperCase().startsWith('R-')} />;
    case 'watch':
      if (!parts[1]) return <OnlineMenu />;
      return <Room key={`watch-${parts[1]}`} code={parts[1]} watch ranked={parts[1].toUpperCase().startsWith('R-')} />;
    case 'learn': return <Learn lessonId={parts[1]} />;
    case 'shop': return <Shop />;
    case 'inventory': return <Inventory />;
    case 'admin': return <Admin />;
    case 'friends': return <Friends />;
    case 'maps': return parts[1] === 'edit' ? <MapEditor key={parts[2] ?? 'new'} id={parts[2]} /> : <MapsPage />;
    case 'map': return <SharedMapScreen code={decodeSafe(parts[1] ?? '')} />;
    case 'profile': return <ProfileScreen />;
    case 'signin': return <SignIn />;
    case 'player': return <PlayerScreen name={decodeSafe(parts[1] ?? '')} />;
    case 'settings': return <Settings />;
    case 'leaderboard': return <Leaderboard />;
    case 'privacy': return <Privacy />;
    default:
      return <div class="page"><h2>{t('ui.thatPageDoesnTExist')}</h2><a class="btn" href="#/">{t('ui.goToTheMenu')}</a></div>;
  }
}

/** One broken page shouldn't blank the whole game. */
class ErrorBoundary extends Component<{ children: ComponentChildren }, { failed: boolean }> {
  override state = { failed: false };
  override componentDidCatch(error: unknown): void {
    console.error('Page failed', error);
    this.setState({ failed: true });
  }
  render() {
    if (this.state.failed) {
      return (
        <div class="page">
          <div class="sheet">
            <h2>{t('ui.somethingWentWrongOnThisPage')}</h2>
            <p>{t('ui.yourProgressIsSafeGoBack')}</p>
            <a class="btn primary" href="#/">{t('ui.backToMenu')}</a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function Consent() {
  useProfile();
  if (profile.analytics !== 'unset' || profile.ageBand === 'child') return null;
  return (
    <div class="sheet consent" role="dialog" aria-label={t('ui.analyticsChoice')}>
      <p>{t('ui.allowAnonymousUsageStatsTheyHelp')}</p>
      <div class="row">
        <button onClick={() => setAnalyticsConsent(false)}>{t('ui.donTAllow')}</button>
        <button onClick={() => setAnalyticsConsent(true)}>{t('ui.allow')}</button>
      </div>
    </div>
  );
}

const FADE_OUT_MS = 130;

function App() {
  // Every screen re-renders in the new language at once.
  useLang();
  const [path, setPath] = useState(route());
  const [leaving, setLeaving] = useState(false);
  const timer = useRef(0);
  useEffect(() => {
    const on = () => {
      const next = route();
      clearTimeout(timer.current);
      if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        setPath(next);
        window.scrollTo(0, 0);
        return;
      }
      // Fade the old page out, swap, then the new page fades itself in.
      setLeaving(true);
      timer.current = window.setTimeout(() => {
        setPath(route());
        setLeaving(false);
        window.scrollTo(0, 0);
      }, FADE_OUT_MS);
    };
    window.addEventListener('hashchange', on);
    // The address may have changed before this listener existed.
    setPath(route());
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('hashchange', on);
    };
  }, []);
  return (
    <>
      <div class="shell">
        <SideNav path={path} />
        <main class="content">
          <div class={`route ${leaving ? 'leaving' : ''}`} key={path}>
            <ErrorBoundary>
              <Router path={path} />
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <Consent />
      <InviteToasts />
    </>
  );
}

function applyDesign(): void {
  document.documentElement.dataset.theme = profile.theme;
}
applyDesign();
subscribeProfile(applyDesign);
initAudioUi();
initSocial();

render(<App />, document.getElementById('app')!);
void initAuth();
