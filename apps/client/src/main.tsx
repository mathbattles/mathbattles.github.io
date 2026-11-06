import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles.css';
import { initAuth, setAnalyticsConsent } from './auth';
import { profile } from './store';
import { useProfile } from './screens/Shared';
import { Menu } from './screens/Menu';
import { LocalSetup, Practice } from './screens/Local';
import { Campaign, Daily, LevelScreen, ReplayScreen } from './screens/Solo';
import { Learn, Leaderboard, Privacy, ProfileScreen, Settings, Shop } from './screens/Meta';
import { OnlineMenu, Ranked, Room } from './screens/Online';

function route(): string {
  return location.hash.replace(/^#/, '') || '/';
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
    case 'room': return <Room key={parts[1]} code={parts[1] ?? ''} />;
    case 'ranked': return parts[1] ? <Room key={parts[1]} code={parts[1]} ranked /> : <Ranked />;
    case 'learn': return <Learn />;
    case 'shop': return <Shop />;
    case 'profile': return <ProfileScreen />;
    case 'settings': return <Settings />;
    case 'leaderboard': return <Leaderboard />;
    case 'privacy': return <Privacy />;
    default:
      return <div class="page"><h2>That page doesn't exist</h2><a class="btn" href="#/">Go to the menu</a></div>;
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

function App() {
  const [path, setPath] = useState(route());
  useEffect(() => {
    const on = () => {
      setPath(route());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    // The address may have changed before this listener existed.
    setPath(route());
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return (
    <>
      <Router key={path} path={path} />
      <Consent />
    </>
  );
}

render(<App />, document.getElementById('app')!);
void initAuth();
