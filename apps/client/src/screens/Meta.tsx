import { ACHIEVEMENTS, COSMETICS, levelFromXp, rankFor, type AbilityId, type Cosmetic, type CosmeticKind } from '@mathbattles/sim';
import { useEffect, useRef, useState } from 'preact/hooks';
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

const INK = '#2b2f7a';

/** The small picture on each shop card. */
function ItemThumb({ item }: { item: Cosmetic }) {
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
      drawBlast(c, 70, 40, 16, 0.3, '#ee3a57', item.value);
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
  const stageRef = useRef<Stage | null>(null);
  const apply = (stage: Stage) => {
    const value = (kind: CosmeticKind) => (item.kind === kind ? item.value : cosmeticValue(kind));
    stage.looks = { a: { hat: value('hat'), trail: value('trail'), blast: value('blast') } };
    stage.setRockStyle(value('obstacle'));
  };
  useEffect(() => {
    const stage = new Stage(ref.current!);
    stage.themeId = profile.theme;
    stageRef.current = stage;
    apply(stage);
    stage.start();
    const stopDemo = runDemo(stage, { rocks: 6, gapMs: 500 });
    return () => {
      stopDemo();
      stage.stop();
    };
  }, []);
  useEffect(() => {
    if (stageRef.current) apply(stageRef.current);
  }, [item.id]);
  const title = item.kind === 'title' ? item.value : COSMETICS.find((c) => c.id === profile.equipped.title)?.value;
  return (
    <div class="sheet shop-preview" aria-label={`Preview of ${item.name}`}>
      <h3>Previewing: {item.name}</h3>
      <canvas ref={ref} width={770} height={450} aria-hidden="true" />
      <p class="preview-name"><strong>{profile.name}</strong>{title ? `, ${title}` : ''}</p>
    </div>
  );
}

const KIND_NAMES: Record<CosmeticKind, string> = { hat: 'Hats', trail: 'Shot trails', obstacle: 'Obstacles', blast: 'Explosions', title: 'Titles' };

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
          <button class="small" disabled={on} onClick={() => equip(c.id)}>{on ? 'Equipped' : 'Equip'}</button>
        ) : c.earn ? (
          <span class="muted small-note">Earn: {ACHIEVEMENTS.find((a) => a.id === c.earn)?.detail}</span>
        ) : (
          <button class="small" onClick={() => setError(buy(c.id) ?? '')}>Buy for {c.cost} Sparks</button>
        )}
      </div>
    );
  };
  return (
    <div class="page">
      <TopBar title="Shop" />
      <p>Everything here is cosmetic. All functions and modes are free to every player. Obstacle designs change what you see, and everyone else sees their own.</p>
      {error && <p class="error" role="alert">{error}</p>}
      <div class="shop-layout">
        <ShopPreview item={previewing} />
        <div class="shop-items">
          {(Object.keys(KIND_NAMES) as CosmeticKind[]).map((k) => (
            <div class="sheet">
              <h3>{KIND_NAMES[k]}</h3>
              <div class="shop">{COSMETICS.filter((c) => c.kind === k).map(item)}</div>
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
          <h3>Mastery</h3>
          <p>Function {Math.floor(profile.mastery.fn / 10)}. y′ {Math.floor(profile.mastery.ode1 / 10)}. y″ {Math.floor(profile.mastery.ode2 / 10)}. Each level takes 10 hits in that mode.</p>
        </div>
        <div class="sheet">
          <h3>Account</h3>
          <AccountPanel />
        </div>
      </div>
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
  const setAbility = (a: AbilityId) => { profile.ability = a; saveProfile(); };
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
        <h3>Ability for matches that use them</h3>
        <div class="row">
          <button class={profile.ability === 'teleport' ? 'on' : ''} onClick={() => setAbility('teleport')}>Teleport</button>
          <button class={profile.ability === 'missile' ? 'on' : ''} onClick={() => setAbility('missile')}>Missile</button>
        </div>
        <p class="muted" style={{ marginTop: 8 }}>Each enemy hit adds 1 charge. Using an ability costs 2. Teleport moves your soldier a short way, and you still shoot. Missile triples your next blast, which also hits soldiers inside it.</p>
      </div>
      <div class="sheet">
        <h3>Sound and chat</h3>
        <div class="row">
          <label><input type="checkbox" checked={profile.muted} onChange={(e) => { profile.muted = (e.target as HTMLInputElement).checked; saveProfile(); }} /> Mute sound</label>
          <label><input type="checkbox" checked={profile.chatOff} onChange={(e) => { profile.chatOff = (e.target as HTMLInputElement).checked; saveProfile(); }} /> Hide chat</label>
        </div>
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
          <table>
            <thead><tr><th>Place</th><th>Player</th><th>Rank</th><th>Rating</th></tr></thead>
            <tbody>{rows.map((r, i) => <tr><td>{i + 1}</td><td><a href={`#/player/${encodeURIComponent(r.name)}`}>{r.name}</a></td><td>{rankFor(r.rating)}</td><td>{r.rating}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function Learn() {
  return (
    <div class="page">
      <TopBar title="Learn" />
      <div class="sheet">
        <h3>How a shot works</h3>
        <p>The field runs from x = -25 to 25 and y of about -14.6 to 14.6. In team matches you always see your team on the left, and your shot travels right.</p>
        <p>In <code>y =</code> mode, the game adds a constant so your curve passes through your soldier. Typing <code>x+5</code> and <code>x</code> gives the same shot, so only the shape matters.</p>
        <p>A shot passes through every soldier it touches, teammates included, and stops at a rock, the edge of the field, or an invalid value. It carves a small hole where it ends.</p>
      </div>
      <div class="grid-2">
        <div class="sheet">
          <h3>What you can type</h3>
          <table><tbody>
            <tr><td><code>+ - * / ^</code></td><td>Math. <code>2x</code> also works.</td></tr>
            <tr><td><code>sin cos tan</code></td><td>Trig, in radians</td></tr>
            <tr><td><code>sqrt abs</code></td><td>Square root, absolute value</td></tr>
            <tr><td><code>ln log exp</code></td><td>Natural log, base-10 log, e to the x</td></tr>
            <tr><td><code>pi e</code></td><td>Constants</td></tr>
            <tr><td><code>y</code>, <code>y'</code></td><td>Only in the y′ and y″ modes</td></tr>
          </tbody></table>
        </div>
        <div class="sheet">
          <h3>Why did my shot explode?</h3>
          <p><strong>Invalid value:</strong> <code>sqrt(x)</code> fails at negative x, and you stand at negative x. Use <code>sqrt(abs(x))</code>.</p>
          <p><strong>A jump:</strong> a sudden break in the curve ends the shot. Use a smooth step instead.</p>
          <p><strong>Too long:</strong> <code>sin(100*x)</code> uses up its length quickly. Lower the frequency.</p>
          <p><strong>Off the field:</strong> <code>x^2</code> reaches 100 at x = 10. Scale it: <code>x^2/50</code>.</p>
        </div>
      </div>
      <div class="sheet">
        <h3>Tricks</h3>
        <table><tbody>
          <tr><td><code>a/(1+exp(-k*(x-b)))</code></td><td>Smooth step of height a at x = b. Larger k makes it sharper. Add several together to climb walls.</td></tr>
          <tr><td><code>a*sin(x/b)</code></td><td>Weave through a row of targets. a sets height and b sets width.</td></tr>
          <tr><td><code>-(x-b)^2/c</code></td><td>Arc over a rock with the peak at x = b.</td></tr>
          <tr><td><code>a*abs(x-b)</code></td><td>Change direction sharply at x = b.</td></tr>
          <tr><td><code>y' = -y/3</code></td><td>Drifts toward y = 0 wherever you start.</td></tr>
          <tr><td><code>y'' = -0.1</code></td><td>Gravity. Raise your angle and lob over cover.</td></tr>
          <tr><td><code>y'' = -y'/4</code></td><td>Drag. The shot flattens out as it flies.</td></tr>
        </tbody></table>
      </div>
      <a class="btn primary" href="#/practice">Try these in Practice</a>
    </div>
  );
}

export function Privacy() {
  return (
    <div class="page">
      <TopBar title="Privacy" />
      <div class="sheet">
        <p>You can play without an account. Guest progress stays in this browser.</p>
        <p>If you make an account, we store your username, your game progress, and a login ID. Your password goes to our sign-in provider, Google Firebase, and we never save it. An email or Google account is optional and is only used for signing in and resetting your password.</p>
        <p>Online matches pass your game name, chat messages, and shots through our server. Reports you send about chat are stored for review.</p>
        <p>You can delete your account at any time from your profile. Anonymous analytics load only if you allow them in <a href="#/settings">Settings</a>.</p>
      </div>
    </div>
  );
}

export { serverReachable, authState };
