import { ACHIEVEMENTS, COSMETICS, SEASON, levelFromXp, questsFor, seasonLevel, utcDayNumber } from '@mathbattles/sim';
import { useEffect, useState } from 'preact/hooks';
import { useAuth } from '../auth';
import { LEVELS } from '../content/campaign';
import { adminData, adminDeleteReport, type AdminData } from '../net/api';
import { addSeasonXp, profile, saveProfile } from '../store';
import { TopBar, useProfile } from './Shared';

export const ADMIN_USERNAME = 'bobblyionized';

export function isAdminName(name: string | null | undefined): boolean {
  return !!name && name.toLowerCase() === ADMIN_USERNAME;
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

  const load = () => {
    void adminData().then((r) => {
      setServer(r.data ?? null);
      setError(r.error ?? '');
    });
  };
  useEffect(() => {
    if (allowed) load();
  }, [allowed]);

  if (!auth.ready) return <div class="page"><TopBar title="Admin" /><p>Checking your account.</p></div>;
  if (!allowed) return <div class="page"><TopBar title="Admin" /><div class="sheet"><p>This page is only for the game's owner.</p><a class="btn" href="#/">Back to the menu</a></div></div>;

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
          <button class="small" onClick={load}>Refresh</button>
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
                        <td><button class="small" onClick={() => void adminDeleteReport(r.id).then(load)}>Clear</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
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
