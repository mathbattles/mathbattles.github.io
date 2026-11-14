import { ACHIEVEMENTS, COSMETICS, SEASON, levelFromXp, questsFor, seasonLevel, utcDayNumber } from '@mathbattles/sim';
import { useEffect, useState } from 'preact/hooks';
import { useAuth } from '../auth';
import { LEVELS } from '../content/campaign';
import qrcode from 'qrcode-generator';
import { adminData, adminDeleteReport, adminLogout, adminMfaSetup, adminMfaStatus, adminMfaVerify, adminSession, type AdminData } from '../net/api';
import { signOutUser } from '../auth';
import { addSeasonXp, profile, saveProfile } from '../store';
import { TopBar, useProfile } from './Shared';
import { AdminTools, sanction } from './AdminTools';
import { Icon } from './Icons';

export const ADMIN_USERNAME = 'bobblyionized';

export function isAdminName(name: string | null | undefined): boolean {
  return !!name && name.toLowerCase() === ADMIN_USERNAME;
}

/** A QR code for the authenticator app, drawn as crisp squares. */
function Qr({ text }: { text: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const cells: string[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) cells.push(`M${x + 4} ${y + 4}h1v1h-1z`);
  return (
    <svg class="mfa-qr" viewBox={`0 0 ${n + 8} ${n + 8}`} role="img" aria-label="QR code for your authenticator app">
      <rect width={n + 8} height={n + 8} fill="#fff" />
      <path d={cells.join('')} fill="#000" />
    </svg>
  );
}

/**
 * The admin page asks for a code from an authenticator app before anything else. The first
 * visit sets the app up; after that, setup is locked and only codes work.
 */
function MfaGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [status, setStatus] = useState<'loading' | 'setup' | 'code' | 'error'>('loading');
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [reauth, setReauth] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void adminMfaStatus().then((r) => {
      if (r.error) {
        setError(r.error);
        setStatus('error');
      } else setStatus(r.data!.active ? 'code' : 'setup');
    });
  }, []);
  const begin = async () => {
    setBusy(true);
    const r = await adminMfaSetup();
    setBusy(false);
    setReauth(!!r.reauth);
    if (r.error) return setError(r.error);
    setError('');
    setSetup(r.data!);
  };
  const verify = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    const r = await adminMfaVerify(code);
    setBusy(false);
    setCode('');
    setReauth(!!r.reauth);
    if (r.error) return setError(r.error);
    onUnlocked();
  };
  return (
    <div class="sheet mfa">
      <h3>Two-step verification</h3>
      {status === 'loading' && <p>Checking.</p>}
      {status === 'error' && <p class="error" role="alert">{error}</p>}
      {status === 'setup' && !setup && (
        <>
          <p>The admin page needs a code from an authenticator app (like Google Authenticator, Microsoft Authenticator, or 1Password) every time. Set it up once here. After that, it can't be changed from the website.</p>
          <button class="primary" disabled={busy} onClick={() => void begin()}>Set up my authenticator app</button>
        </>
      )}
      {setup && (
        <>
          <p>1. In your authenticator app, add an account and scan this code.</p>
          <Qr text={setup.uri} />
          <p class="small-note">Can't scan? Enter this key instead: <code class="mfa-key">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code></p>
          <p>2. Type the 6-digit code it shows.</p>
        </>
      )}
      {(status === 'code' || setup) && (
        <form class="row" onSubmit={(e) => void verify(e)}>
          <input type="text" inputMode="numeric" autocomplete="one-time-code" maxLength={6} pattern="[0-9]{6}" placeholder="123456" aria-label="Six-digit code" value={code}
            onInput={(e) => setCode((e.target as HTMLInputElement).value.replace(/\D/g, ''))} />
          <button class="primary" disabled={busy || code.length !== 6}>Unlock</button>
        </form>
      )}
      {status !== 'error' && error && <p class="error" role="alert">{error}</p>}
      {reauth && <button onClick={() => void signOutUser().then(() => { location.hash = '#/signin'; })}>Sign out so I can sign back in</button>}
    </div>
  );
}

/** Tools for the game's owner. The page only opens for that account, and the server checks too. */
export function Admin() {
  useProfile();
  const auth = useAuth();
  const [server, setServer] = useState<AdminData | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [xp, setXp] = useState('1000');
  const [sparks, setSparks] = useState('1000');
  const [seasonXp, setSeasonXp] = useState('1000');
  const allowed = auth.ready && isAdminName(auth.username);
  const [unlocked, setUnlocked] = useState(() => !!adminSession());

  const load = () => {
    void adminData().then((r) => {
      if (r.mfa) return setUnlocked(false);
      setServer(r.data ?? null);
      setError(r.error ?? '');
    });
  };
  useEffect(() => {
    if (allowed && unlocked) load();
  }, [allowed, unlocked]);
  // The two-step session lasts 30 minutes; after that, a new code is needed.
  useEffect(() => {
    if (!unlocked) return;
    const t = setInterval(() => { if (!adminSession()) setUnlocked(false); }, 15_000);
    return () => clearInterval(t);
  }, [unlocked]);

  if (!auth.ready) return <div class="page"><TopBar title="Admin" /><p>Checking your account.</p></div>;
  if (!allowed) return <div class="page"><TopBar title="Admin" /><div class="sheet"><p>This page is only for the game's owner.</p><a class="btn" href="#/">Back to the menu</a></div></div>;
  if (!unlocked) return <div class="page narrow"><TopBar title="Admin" /><MfaGate onUnlocked={() => setUnlocked(true)} /></div>;

  const done = (text: string) => {
    saveProfile();
    setNote(text);
  };
  const num = (v: string) => Math.max(0, Math.min(10_000_000, Math.floor(Number(v) || 0)));
  const sl = seasonLevel(profile.seasonXp);

  return (
    <div class="page">
      <TopBar title="Admin" />
      {note && <p class="ok" role="status">{note}</p>}
      <div class="grid-2">
        <div class="sheet">
          <h3>Your progress</h3>
          <p class="muted small-note">Level {levelFromXp(profile.xp).level} ({profile.xp} XP), {profile.sparks} Sparks, season level {sl.level} ({profile.seasonXp} season XP).</p>
          <div class="admin-row">
            <label>Player XP <input type="text" inputMode="numeric" value={xp} onInput={(e) => setXp((e.target as HTMLInputElement).value)} /></label>
            <button onClick={() => { profile.xp += num(xp); done(`Added ${num(xp)} XP.`); }}>Add</button>
          </div>
          <div class="admin-row">
            <label>Sparks <input type="text" inputMode="numeric" value={sparks} onInput={(e) => setSparks((e.target as HTMLInputElement).value)} /></label>
            <button onClick={() => { profile.sparks += num(sparks); done(`Added ${num(sparks)} Sparks.`); }}>Add</button>
          </div>
          <div class="admin-row">
            <label>Season XP <input type="text" inputMode="numeric" value={seasonXp} onInput={(e) => setSeasonXp((e.target as HTMLInputElement).value)} /></label>
            <button onClick={() => { addSeasonXp(num(seasonXp)); done(`Added ${num(seasonXp)} season XP.`); }}>Add</button>
          </div>
          <div class="row" style={{ marginTop: 10 }}>
            <button onClick={() => { addSeasonXp(SEASON.levels * SEASON.xpPerLevel - profile.seasonXp); done('Season pass maxed, with every reward.'); }}>Max the season pass</button>
            <button onClick={() => { profile.seasonXp = 0; profile.seasonPaid = []; done('Season pass reset. Items you got stay yours.'); }}>Reset the season pass</button>
          </div>
        </div>
        <div class="sheet">
          <h3>Unlocks</h3>
          <div class="row">
            <button onClick={() => { for (const c of COSMETICS) if (!profile.owned.includes(c.id)) profile.owned.push(c.id); done('Every cosmetic unlocked.'); }}>Unlock every cosmetic</button>
            <button onClick={() => { for (const a of ACHIEVEMENTS) if (!profile.achievements.includes(a.id)) profile.achievements.push(a.id); done('Every achievement marked done (no Sparks paid).'); }}>Finish every achievement</button>
            <button onClick={() => { for (const l of LEVELS) profile.stars[l.id] = 3; done('Every campaign level has 3 stars.'); }}>3-star the campaign</button>
          </div>
          <h3 style={{ marginTop: 14 }}>Quests</h3>
          <div class="row">
            <button onClick={() => {
              for (const q of questsFor(utcDayNumber(Date.now()))) profile.questProgress[q.id] = Math.max(0, q.goal - 1);
              done('Every quest is one step from done. Play a match to finish them.');
            }}>Set quests one step from done</button>
            <button onClick={() => { profile.questProgress = {}; profile.questsPaid = []; done('Quest progress cleared.'); }}>Reset quests</button>
          </div>
        </div>
      </div>
      <div class="sheet">
        <div class="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Server</h3>
          <span class="row">
            <button class="small" onClick={load}>Refresh</button>
            <button class="small" onClick={() => void adminLogout().then(() => setUnlocked(false))}>Lock admin page</button>
          </span>
        </div>
        {error && <p class="error" role="alert">{error}</p>}
        {server && (
          <>
            <div class="rank-stats admin-stats">
              {Object.entries(server.stats).map(([k, v]) => (
                <div><strong>{v.toLocaleString()}</strong><span>{STAT_NAMES[k] ?? k}</span></div>
              ))}
            </div>
            <h3 style={{ marginTop: 14 }}>Chat reports</h3>
            {server.reports.length === 0 ? <p class="muted">No reports.</p> : (
              <div class="table-wrap">
                <table>
                  <thead><tr><th>When</th><th>Room</th><th>Player</th><th>Message</th><th /></tr></thead>
                  <tbody>
                    {server.reports.map((r) => (
                      <tr>
                        <td>{new Date(r.created_at).toLocaleString()}</td>
                        <td>{r.code}</td>
                        <td>{r.reported}</td>
                        <td>{r.text}</td>
                        <td class="row">
                          <button class="small" onClick={() => void adminDeleteReport(r.id).then(load)}>Clear</button>
                          {r.reported && <button class="small" onClick={() => void sanction(r.reported!, 'mute', `Chat report: ${String(r.text ?? '').slice(0, 80)}`, 1).then((x) => setNote(x.error ?? `${r.reported} muted for a day.`))}><Icon name="mute" /> Mute 1 day</button>}
                          {r.reported && <button class="small" onClick={() => void sanction(r.reported!, 'ban', `Chat report: ${String(r.text ?? '').slice(0, 80)}`, 7).then((x) => setNote(x.error ?? `${r.reported} banned for a week.`))}><Icon name="ban" /> Ban 7 days</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
      <AdminTools />
    </div>
  );
}

const STAT_NAMES: Record<string, string> = {
  accounts: 'Accounts',
  synced: 'Synced profiles',
  rankedPlayers: 'Ranked players',
  online: 'Online now',
  openRooms: 'Active rooms',
  matchesToday: 'Matches, last 24h',
  maps: 'Shared maps',
  friendships: 'Friendships',
};
