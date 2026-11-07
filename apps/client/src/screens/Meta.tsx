import { ACHIEVEMENTS, COSMETICS, levelFromXp, rankFor, type Cosmetic, type CosmeticKind } from '@mathbattles/sim';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { authState, setAnalyticsConsent, useAuth } from '../auth';
import { fetchLeaderboard, serverReachable, type LeaderRow } from '../net/api';
import { runDemo } from '../render/demo';
import { drawHat } from '../render/doodles';
import { drawObstacle, obstacleStyle } from '../render/obstacles';
import { Stage, THEMES, drawBlast, strokeTrail, type ThemeId } from '../render/stage';
import { buy, cosmeticValue, equip, profile, saveProfile } from '../store';
import { AccountPanel } from './Account';
import { MyHistory } from './History';
import { TopBar, useProfile } from './Shared';
import { QuestsPanel, SeasonPass } from './Season';
import { sound } from '../util';
import { TRACKS } from '../audio/compose';

const INK = '#2b2f7a';

/** The small picture on each shop card. */
export function ItemThumb({ item }: { item: Cosmetic }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const c = canvas.getContext('2d')!;
    c.clearRect(0, 0, canvas.width, canvas.height);
    if (item.kind === 'hat') {
      c.save();
      c.translate(70, 54);
      c.scale(2.6, 2.6);
      c.fillStyle = '#ffffff';
      c.strokeStyle = INK;
      c.lineWidth = 2.2;
      c.beginPath();
      c.arc(0, 0, 7, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.fillStyle = INK;
      c.beginPath();
      c.arc(2.6, -1.5, 1.3, 0, Math.PI * 2);
      c.arc(-0.8, -1.5, 1.3, 0, Math.PI * 2);
      c.fill();
      drawHat(c, item.value, 0, -6, INK);
      c.restore();
    } else if (item.kind === 'trail') {
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i <= 120; i++) {
        xs.push(14 + i);
        ys.push(40 + Math.sin(i / 16) * 20);
      }
      strokeTrail(c, xs, ys, xs.length, '#2b50e8', item.value, true);
    } else if (item.kind === 'blast') {
      drawBlast(c, 70, 40, 12, 0.2, '#ee3a57', item.value);
    } else if (item.kind === 'obstacle') {
      const style = obstacleStyle(item.value);
      drawObstacle(c, style, 34, 44, 26, 0);
      drawObstacle(c, style, 88, 32, 22, 1);
      drawObstacle(c, style, 116, 58, 14, 2);
    } else {
      c.fillStyle = INK;
      c.font = '600 15px "Shantell Sans", sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(item.value || 'No title', 70, 40, 130);
    }
  }, [item.id]);
  return <canvas ref={ref} width={140} height={80} aria-hidden="true" />;
}

/** Tries an item on in a live scene, before buying it. */
function ShopPreview({ item }: { item: Cosmetic }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [full, setFull] = useState(false);
  const fullRef = useRef(false);
  const apply = (stage: Stage) => {
    const value = (kind: CosmeticKind) => (item.kind === kind ? item.value : cosmeticValue(kind));
    stage.looks = { a: { hat: value('hat'), trail: value('trail'), blast: value('blast') } };
    stage.setRockStyle(value('obstacle'));
  };
  useEffect(() => {
    const stage = new Stage(ref.current!, 1.5);
    stage.themeId = profile.theme;
    stageRef.current = stage;
    apply(stage);
    stage.start();
    const stopDemo = runDemo(stage, { rocks: 6, gapMs: 500 });
    // The canvas changes size when going full screen, and the drawing should stay sharp.
    const sizer = new ResizeObserver(() => stage.resize());
    sizer.observe(ref.current!);
    return () => {
      sizer.disconnect();
      stopDemo();
      stage.stop();
    };
  }, []);
  useEffect(() => {
    if (stageRef.current) apply(stageRef.current);
  }, [item.id]);
  // Attached before the next paint, so an Escape pressed right away still closes the view.
  useLayoutEffect(() => {
    fullRef.current = full;
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exitFull(); };
    // Leaving the browser's full screen (Esc, or the browser's own control) also leaves this view.
    const onChange = () => { if (!document.fullscreenElement && fullRef.current) exitFull(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onChange);
    document.documentElement.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onChange);
      document.documentElement.classList.remove('no-scroll');
    };
  }, [full]);
  const enterFull = () => {
    setFull(true);
    sound('open', profile.muted);
    // The real browser full screen where it exists; the page-filling view works everywhere else.
    fullRef.current = true;
    boxRef.current?.requestFullscreen?.()
      // The view may have been closed while the browser was still switching to full screen.
      .then(() => { if (!fullRef.current && document.fullscreenElement) void document.exitFullscreen().catch(() => {}); })
      .catch(() => {});
  };
  const exitFull = () => {
    if (!fullRef.current) return;
    fullRef.current = false;
    setFull(false);
    sound('close', profile.muted);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  };
  const title = item.kind === 'title' ? item.value : COSMETICS.find((c) => c.id === profile.equipped.title)?.value;
  return (
    <div ref={boxRef} class={`sheet shop-preview ${full ? 'full' : ''}`} aria-label={`Preview of ${item.name}`} role={full ? 'dialog' : undefined} aria-modal={full ? true : undefined}>
      <div class="preview-head">
        <h3>Previewing: {item.name}</h3>
        <button class="small" data-sfx="none" onClick={full ? exitFull : enterFull} aria-pressed={full}>
          {full ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>
      <canvas ref={ref} width={770} height={450} aria-hidden="true" />
      <p class="preview-name"><strong>{profile.name}</strong>{title ? `, ${title}` : ''}</p>
    </div>
  );
}

const KIND_NAMES: Record<CosmeticKind, string> = { hat: 'Hats', trail: 'Shot trails', obstacle: 'Obstacles', blast: 'Kill effects', title: 'Titles' };

/** Cheapest first. Items that can only be earned have no price, so they go last. */
function shopOrder(items: Cosmetic[]): Cosmetic[] {
  const price = (c: Cosmetic) => (c.earn ? Infinity : c.cost);
  return items.slice().sort((a, b) => price(a) - price(b));
}

export function Shop() {
  useProfile();
  const [error, setError] = useState('');
  const [previewId, setPreviewId] = useState('obstacle-candy');
  const previewing = COSMETICS.find((c) => c.id === previewId) ?? COSMETICS[0]!;
  const item = (c: Cosmetic) => {
    const owned = profile.owned.includes(c.id);
    const on = profile.equipped[c.kind] === c.id;
    return (
      <div class={`item ${previewId === c.id ? 'previewing' : ''}`}>
        <ItemThumb item={c} />
        <strong>{c.name}</strong>
        <button class={`small ${previewId === c.id ? 'on' : ''}`} aria-label={`Preview ${c.name}`} aria-pressed={previewId === c.id} onClick={() => setPreviewId(c.id)}>Preview</button>
        {owned ? (
          <button class="small" data-sfx="none" disabled={on} onClick={() => { equip(c.id); sound('equip', profile.muted); }}>{on ? 'Equipped' : 'Equip'}</button>
        ) : c.season ? (
          <span class="muted small-note">Season {c.season.id} pass, level {c.season.level}</span>
        ) : c.earn ? (
          <span class="muted small-note">Earn: {ACHIEVEMENTS.find((a) => a.id === c.earn)?.detail}</span>
        ) : (
          <button
            class="small"
            data-sfx="none"
            onClick={() => {
              const problem = buy(c.id);
              setError(problem ?? '');
              sound(problem ? 'error' : 'buy', profile.muted);
            }}
          >Buy for {c.cost} Sparks</button>
        )}
      </div>
    );
  };
  return (
    <div class="page">
      <TopBar title="Shop" />
      <p>Season pass rewards aren't sold here: earn them on your profile's season pass, and find them in your Inventory. Everything here is cosmetic. All functions and modes are free to every player. Obstacle designs change what you see, and everyone else sees their own. Kill effects play where your shot knocks someone out.</p>
      {error && <p class="error" role="alert">{error}</p>}
      <div class="shop-layout">
        <ShopPreview item={previewing} />
        <div class="shop-items">
          {(Object.keys(KIND_NAMES) as CosmeticKind[]).map((k) => (
            <div class="sheet">
              <h3>{KIND_NAMES[k]}</h3>
              <div class="shop">{shopOrder(COSMETICS.filter((c) => c.kind === k && !c.season)).map(item)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ProfileScreen() {
  useProfile();
  const auth = useAuth();
  const lv = levelFromXp(profile.xp);
  const title = COSMETICS.find((c) => c.id === profile.equipped.title)?.value;
  const [name, setName] = useState(profile.name);
  // The name can change after sign-in finishes, and a stale box must not write it back.
  useEffect(() => setName(profile.name), [profile.name]);
  return (
    <div class="page">
      <TopBar title="Profile" />
      <div class="grid-2">
        <div class="sheet">
          <h3>{profile.name}{title ? `, ${title}` : ''}</h3>
          {auth.username ? (
            <p>Your name is your username.</p>
          ) : (
            <label>Name{' '}
              <input
                style={{ width: 170 }}
                value={name}
                maxLength={16}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
                onBlur={() => {
                  const next = name.trim().slice(0, 16);
                  if (next && next !== profile.name) {
                    profile.name = next;
                    saveProfile();
                  }
                }}
              />
            </label>
          )}
          <p style={{ marginTop: 10, marginBottom: 4 }}>Level {lv.level}: {lv.into} of {lv.need} XP</p>
          <div class="bar" role="progressbar" aria-valuenow={lv.into} aria-valuemax={lv.need} aria-label="Progress to next level"><i style={{ width: `${(lv.into / lv.need) * 100}%` }} /></div>
          <p style={{ marginTop: 10 }}>{profile.wins} wins in {profile.matches} matches. {profile.kills} hits. Best shot: {profile.bestCombo} hits.</p>
        </div>
        <div class="sheet">
          <h3>Account</h3>
          <AccountPanel />
        </div>
      </div>
      <SeasonPass />
      <QuestsPanel />
      <div class="sheet">
        <h3>Match history</h3>
        <MyHistory />
      </div>
      <div class="sheet">
        <h3>Achievements ({profile.achievements.length} of {ACHIEVEMENTS.length})</h3>
        <table>
          <tbody>
            {ACHIEVEMENTS.map((a) => {
              const has = profile.achievements.includes(a.id);
              return (
                <tr class={has ? 'ok' : 'muted'}>
                  <td><strong>{a.name}</strong></td>
                  <td>{a.detail}</td>
                  <td>{has ? 'Done' : `${a.reward} Sparks`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Settings() {
  useProfile();
  const setTheme = (t: ThemeId) => { profile.theme = t; saveProfile(); };
  return (
    <div class="page">
      <TopBar title="Settings" />
      <div class="sheet">
        <h3>UI design</h3>
        <p>Changes the look of the whole game. It doesn't affect how anything plays.</p>
        <div class="designs" role="group" aria-label="UI design">
          {(Object.keys(THEMES) as ThemeId[]).map((t) => (
            <button
              class={`design ${profile.theme === t ? 'on' : ''}`}
              aria-pressed={profile.theme === t}
              onClick={() => setTheme(t)}
            >
              <span class="swatch" style={{ '--sw-page': THEMES[t].swatch.page, '--sw-line': THEMES[t].swatch.line, '--sw-ink': THEMES[t].swatch.ink }} />
              <span class="label">{THEMES[t].name}</span>
            </button>
          ))}
        </div>
      </div>
      <div class="sheet">
        <h3>Sound and music</h3>
        <div class="sound-grid">
          <label class="check"><input type="checkbox" checked={profile.muted} onChange={(e) => { profile.muted = (e.target as HTMLInputElement).checked; saveProfile(); }} /> Mute sound effects</label>
          <label class="slider">Effects volume
            <input type="range" min={0} max={1} step={0.05} value={profile.sfxVolume} disabled={profile.muted} style={{ '--val': `${profile.sfxVolume * 100}%` }}
              onInput={(e) => { profile.sfxVolume = Number((e.target as HTMLInputElement).value); saveProfile(); }} />
          </label>
          <label class="check"><input type="checkbox" checked={profile.music} onChange={(e) => { profile.music = (e.target as HTMLInputElement).checked; saveProfile(); }} /> Play music</label>
          <label class="slider">Music volume
            <input type="range" min={0} max={1} step={0.05} value={profile.musicVolume} disabled={!profile.music} style={{ '--val': `${profile.musicVolume * 100}%` }}
              onInput={(e) => { profile.musicVolume = Number((e.target as HTMLInputElement).value); saveProfile(); }} />
          </label>
        </div>
        <p style={{ marginTop: 12, marginBottom: 6 }}>Music: three calm tracks made for focus.</p>
        <div class="row" role="group" aria-label="Music track">
          <button class={profile.musicTrack === -1 ? 'on' : ''} aria-pressed={profile.musicTrack === -1} onClick={() => { profile.musicTrack = -1; saveProfile(); }}>All, in order</button>
          {TRACKS.map((t, i) => (
            <button class={profile.musicTrack === i ? 'on' : ''} aria-pressed={profile.musicTrack === i} onClick={() => { profile.musicTrack = i; saveProfile(); }}>{t.name}</button>
          ))}
        </div>
      </div>
      <div class="sheet">
        <h3>Math keyboard</h3>
        <p>On-screen keys for typing functions, with x, powers, brackets and sin in easy reach. While they're showing, your phone's keyboard stays closed so the field stays in view.</p>
        <div class="row" role="group" aria-label="Math keyboard">
          {([['auto', 'Automatic'], ['on', 'Always'], ['off', 'Never']] as const).map(([v, label]) => (
            <button class={profile.mathKeys === v ? 'on' : ''} aria-pressed={profile.mathKeys === v} onClick={() => { profile.mathKeys = v; saveProfile(); }}>{label}</button>
          ))}
        </div>
        <p class="muted" style={{ marginTop: 8 }}>Automatic shows them on touch screens.</p>
      </div>
      <div class="sheet">
        <h3>Chat</h3>
        <label class="check"><input type="checkbox" checked={profile.chatOff} onChange={(e) => { profile.chatOff = (e.target as HTMLInputElement).checked; saveProfile(); }} /> Hide chat</label>
      </div>
      <div class="sheet">
        <h3>Analytics</h3>
        <p>Anonymous usage stats help improve the game. They're off unless you allow them.</p>
        <div class="row">
          <button class={profile.analytics === 'yes' ? 'on' : ''} onClick={() => setAnalyticsConsent(true)}>Allow</button>
          <button class={profile.analytics !== 'yes' ? 'on' : ''} onClick={() => setAnalyticsConsent(false)}>Don't allow</button>
        </div>
      </div>
    </div>
  );
}

export function Leaderboard() {
  const [rows, setRows] = useState<LeaderRow[] | null | 'loading'>('loading');
  useEffect(() => { void fetchLeaderboard().then(setRows); }, []);
  return (
    <div class="page">
      <TopBar title="Leaderboard" />
      <div class="sheet">
        {rows === 'loading' ? <p>Loading the ladder.</p> : rows === null ? <p>The leaderboard is offline right now. Try again soon.</p> : rows.length === 0 ? <p>Nobody has played ranked yet. <a href="#/ranked">Be the first</a>.</p> : (
          <div class="table-wrap"><table>
            <thead><tr><th>Place</th><th>Player</th><th>Rank</th><th>Rating</th></tr></thead>
            <tbody>{rows.map((r, i) => <tr><td>{i + 1}</td><td><a href={`#/player/${encodeURIComponent(r.name)}`}>{r.name}</a></td><td>{rankFor(r.rating)}</td><td>{r.rating}</td></tr>)}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

export function Privacy() {
  return (
    <div class="page">
      <TopBar title="Privacy" />
      <div class="sheet legal">
        <p class="muted small-note">Last updated November 2026.</p>
        <h3>Playing as a guest</h3>
        <p>You can play without an account. Guest progress, settings and match history stay in this browser. Online matches pass your game name, chat messages and shots through our server while you play.</p>
        <h3>If you make an account</h3>
        <p>We store your username, your game progress (levels, Sparks, items, stars, season pass), your ranked rating, your last 100 matches, your friends list and party, which room you're in while the game is open (shown only to your friends), and maps you choose to share. A login ID links these to you.</p>
        <p>Your password goes to our sign-in provider, Google Firebase. We never store it. An email address or Google account is optional, and is only used for signing in and resetting your password.</p>
        <h3>Children</h3>
        <p>Accounts are only for players 13 and older, and we ask before making one. We keep only whether you're 13 or older, on your own device, never your birth date. Players under 13 can play as guests, with online chat and analytics turned off. If you think a child under 13 has made an account, contact us below and we'll delete it.</p>
        <h3>Chat and reports</h3>
        <p>Chat messages aren't saved. Reports you send about chat are kept for up to 90 days for review, then deleted.</p>
        <h3>Analytics</h3>
        <p>Anonymous usage stats load only if you allow them in <a href="#/settings">Settings</a>, and never for players under 13. We don't use session recording, advertising, or tracking across other sites. Fonts and other files are served from this site, not from third parties.</p>
        <h3>Your choices</h3>
        <p>You can delete your account at any time from your profile. That removes your username, progress, rating, match history, friends, party and shared maps from our server.</p>
        <h3>Contact, and copyright</h3>
        <p>For privacy questions, deletion requests, or to report content that infringes your copyright (such as a shared map or a username), open an issue at <a href="https://github.com/mathbattles/mathbattles.github.io/issues" target="_blank" rel="noopener noreferrer">github.com/mathbattles/mathbattles.github.io/issues</a>, or report a security problem privately from that repository's Security tab.</p>
      </div>
    </div>
  );
}

export { serverReachable, authState };
