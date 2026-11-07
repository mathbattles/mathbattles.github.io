import { Component, render, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import './styles.css';
import { initAuth, setAnalyticsConsent } from './auth';
import { profile, subscribeProfile } from './store';
import { useProfile } from './screens/Shared';
import { Menu } from './screens/Menu';
import { LocalSetup, Practice } from './screens/Local';
import { Campaign, Daily, LevelScreen, ReplayScreen } from './screens/Solo';
import { Learn, Leaderboard, Privacy, ProfileScreen, Settings, Shop } from './screens/Meta';
import { OnlineMenu, Ranked, Room } from './screens/Online';
import { SignIn } from './screens/Account';
import { PlayerScreen } from './screens/History';
import { SideNav } from './screens/SideNav';

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
    case 'daily': return <Daily />;
    case 'replay': return <ReplayScreen data={parts[1] ?? ''} />;
    case 'online': return <OnlineMenu />;
    // Whether a room is ranked depends only on its code, however the link was written.
    case 'room':
    case 'ranked':
      if (!parts[1]) return parts[0] === 'ranked' ? <Ranked /> : <OnlineMenu />;
      return <Room key={parts[1]} code={parts[1]} ranked={parts[1].toUpperCase().startsWith('R-')} />;
    case 'learn': return <Learn />;
    case 'shop': return <Shop />;
    case 'profile': return <ProfileScreen />;
    case 'signin': return <SignIn />;
    case 'player': return <PlayerScreen name={decodeSafe(parts[1] ?? '')} />;
    case 'settings': return <Settings />;
    case 'leaderboard': return <Leaderboard />;
    case 'privacy': return <Privacy />;
    default:
      return <div class="page"><h2>That page doesn't exist</h2><a class="btn" href="#/">Go to the menu</a></div>;
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
            <h2>Something went wrong on this page</h2>
            <p>Your progress is safe. Go back to the menu and try again.</p>
            <a class="btn primary" href="#/">Back to menu</a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function Consent() {
  useProfile();
  if (profile.analytics !== 'unset') return null;
  return (
    <div class="sheet consent" role="dialog" aria-label="Analytics choice">
      <p>Allow anonymous usage stats? They help improve the game. You can change this in Settings.</p>
      <div class="row">
        <button onClick={() => setAnalyticsConsent(false)}>Don't allow</button>
        <button onClick={() => setAnalyticsConsent(true)}>Allow</button>
      </div>
    </div>
  );
}

const FADE_OUT_MS = 130;

function App() {
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
    </>
  );
}

function applyDesign(): void {
  document.documentElement.dataset.theme = profile.theme;
}
applyDesign();
subscribeProfile(applyDesign);

render(<App />, document.getElementById('app')!);
void initAuth();
