import { ACHIEVEMENTS, COSMETICS, levelFromXp, rankFor, type Cosmetic, type CosmeticKind } from '@mathbattles/sim';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { authState, setAnalyticsConsent, useAuth } from '../auth';
import { fetchLeaderboard, serverReachable, type LeaderRow } from '../net/api';
import { runDemo } from '../render/demo';
import { drawHat } from '../render/doodles';
import { drawObstacle, obstacleStyle } from '../render/obstacles';
import { Stage, THEMES, drawBlast, strokeTrail, type ThemeId } from '../render/stage';
import { UI_SCALE_MAX, UI_SCALE_MIN, buy, cosmeticValue, equip, profile, saveProfile, setUiScale } from '../store';
import { Dropdown } from './Dropdown';
import { LANGS, browserLang, isLang, setLanguage, t, useLang } from '../i18n';
import { AccountPanel } from './Account';
import { MyHistory } from './History';
import { TopBar, useProfile } from './Shared';
import { SeasonSummary } from './Season';
import { sound } from '../util';
import { TRACKS } from '../audio/compose';

const INK = '#2b2f7a';

/** The small picture on each shop card. */
export function ItemThumb({ item }: { item: Cosmetic }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    // Drawn in a 140 by 80 space, but at the size it really shows on screen, so large
    // previews stay sharp instead of being a small picture stretched up.
    const paint = () => {
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    const shown = canvas.clientWidth || 140;
    const k = Math.min(8, Math.max(1, (shown / 140) * dpr));
    const w = Math.round(140 * k);
    const h = Math.round(80 * k);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const c = canvas.getContext('2d')!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.setTransform(k, 0, 0, k, 0, 0);
    c.imageSmoothingQuality = 'high';
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
    };
    paint();
    let last = canvas.clientWidth;
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (canvas.clientWidth !== last) {
        last = canvas.clientWidth;
        paint();
      }
    });
    watch?.observe(canvas);
    // Fonts may load after the first paint; titles are redrawn once they are ready.
    void document.fonts?.ready.then(() => paint());
    return () => watch?.disconnect();
  }, [item.id]);
  return <canvas class="item-thumb" ref={ref} width={140} height={80} aria-hidden="true" />;
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
        <button class={`small ${previewId === c.id ? 'on' : ''}`} aria-label={`Preview ${c.name}`} aria-pressed={previewId === c.id} onClick={() => setPreviewId(c.id)}>{t('ui.preview')}</button>
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
      <TopBar title={t('nav.cosmetics')} />
      <p>{t('ui.seasonPassRewardsArenTSold')}</p>
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
      <TopBar title={t('ui.profile')} />
      <div class="grid-2">
        <div class="sheet">
          <h3>{profile.name}{title ? `, ${title}` : ''}</h3>
          {auth.username ? (
            <p>{t('ui.yourNameIsYourUsername')}</p>
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
          <div class="bar" role="progressbar" aria-valuenow={lv.into} aria-valuemax={lv.need} aria-label={t('ui.progressToNextLevel')}><i style={{ width: `${(lv.into / lv.need) * 100}%` }} /></div>
          <p style={{ marginTop: 10 }}>{profile.wins} wins in {profile.matches} matches. {profile.kills} hits. Best shot: {profile.bestCombo} hits.</p>
        </div>
        <div class="sheet">
          <h3>{t('ui.account')}</h3>
          <AccountPanel />
        </div>
      </div>
      <SeasonSummary />
      <div class="sheet">
        <h3>{t('ui.matchHistory')}</h3>
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
  useLang();
  const setTheme = (id: ThemeId) => { profile.theme = id; saveProfile(); };
  const lang = isLang(profile.language) ? profile.language : '';
  const pct = Math.round(profile.uiScale * 100);
  return (
    <div class="page">
      <TopBar title={t('settings.title')} />
      <div class="sheet">
        <h3>{t('settings.language')}</h3>
        <span class="dd-field">
          <Dropdown
            label={t('settings.language')}
            value={lang}
            onChange={(v) => {
              profile.language = v;
              saveProfile();
              void setLanguage(isLang(v) ? v : browserLang());
            }}
            options={[{ value: '', label: t('settings.languageAuto') }, ...LANGS.map((l) => ({ value: l.id, label: l.name }))]}
          />
        </span>
        <p class="muted small-note" style={{ marginTop: 8 }}>{t('settings.languageNote')}</p>
      </div>
      <div class="sheet">
        <h3>{t('settings.uiSize')}</h3>
        <p>{t('settings.uiSizeHint')}</p>
        <div class="ui-scale-row">
          <label class="slider">{t('settings.uiSize')}
            <input
              type="range"
              min={UI_SCALE_MIN}
              max={UI_SCALE_MAX}
              step={0.05}
              value={profile.uiScale}
              aria-valuetext={`${pct}%`}
              style={{ '--val': `${((profile.uiScale - UI_SCALE_MIN) / (UI_SCALE_MAX - UI_SCALE_MIN)) * 100}%` }}
              onInput={(e) => setUiScale(Number((e.target as HTMLInputElement).value))}
            />
          </label>
          <output class="ui-scale-value" aria-live="polite">{pct}%</output>
          <button class="small" disabled={pct === 100} onClick={() => setUiScale(1)}>{t('settings.reset')}</button>
        </div>
        <p class="muted small-note">{t('settings.uiSizeKeys')}</p>
        <h4 style={{ marginTop: 14 }}>{t('settings.gameText')}</h4>
        <p class="muted small-note" style={{ marginTop: 0 }}>{t('settings.gameTextHint')}</p>
        <div class="row" role="group" aria-label={t('settings.gameText')}>
          {(['small', 'normal', 'large'] as const).map((v) => (
            <button class={profile.gameText === v ? 'on' : ''} aria-pressed={profile.gameText === v} onClick={() => { profile.gameText = v; saveProfile(); }}>
              {t(`settings.gameText.${v}`)}
            </button>
          ))}
        </div>
      </div>
      <div class="sheet">
        <h3>{t('settings.design')}</h3>
        <p>{t('settings.designHint')}</p>
        <div class="designs" role="group" aria-label={t('settings.design')}>
          {(Object.keys(THEMES) as ThemeId[]).map((id) => (
            <button
              class={`design ${profile.theme === id ? 'on' : ''}`}
              aria-pressed={profile.theme === id}
              onClick={() => setTheme(id)}
            >
              <span class="swatch" style={{ '--sw-page': THEMES[id].swatch.page, '--sw-line': THEMES[id].swatch.line, '--sw-ink': THEMES[id].swatch.ink }} />
              <span class="label">{t(`theme.${id}`)}</span>
            </button>
          ))}
        </div>
      </div>
      <div class="sheet">
        <h3>{t('settings.sound')}</h3>
        <div class="sound-grid">
          <label class="check"><input type="checkbox" checked={profile.muted} onChange={(e) => { profile.muted = (e.target as HTMLInputElement).checked; saveProfile(); }} /> {t('settings.mute')}</label>
          <label class="slider">{t('settings.sfxVolume')}
            <input type="range" min={0} max={1} step={0.05} value={profile.sfxVolume} disabled={profile.muted} style={{ '--val': `${profile.sfxVolume * 100}%` }}
              onInput={(e) => { profile.sfxVolume = Number((e.target as HTMLInputElement).value); saveProfile(); }} />
          </label>
          <label class="check"><input type="checkbox" checked={profile.music} onChange={(e) => { profile.music = (e.target as HTMLInputElement).checked; saveProfile(); }} /> {t('settings.music')}</label>
          <label class="slider">{t('settings.musicVolume')}
            <input type="range" min={0} max={1} step={0.05} value={profile.musicVolume} disabled={!profile.music} style={{ '--val': `${profile.musicVolume * 100}%` }}
              onInput={(e) => { profile.musicVolume = Number((e.target as HTMLInputElement).value); saveProfile(); }} />
          </label>
        </div>
        <p style={{ marginTop: 12, marginBottom: 6 }}>{t('settings.musicTracks', { count: TRACKS.length })}</p>
        <div class="row" role="group" aria-label={t('settings.musicTrack')}>
          <button class={profile.musicTrack === -1 ? 'on' : ''} aria-pressed={profile.musicTrack === -1} onClick={() => { profile.musicTrack = -1; saveProfile(); }}>{t('settings.allInOrder')}</button>
          {TRACKS.map((tr, i) => (
            <button class={profile.musicTrack === i ? 'on' : ''} aria-pressed={profile.musicTrack === i} onClick={() => { profile.musicTrack = i; saveProfile(); }}>{tr.name}</button>
          ))}
        </div>
      </div>
      <div class="sheet">
        <h3>{t('settings.mathKeys')}</h3>
        <p>{t('settings.mathKeysHint')}</p>
        <div class="row" role="group" aria-label={t('settings.mathKeys')}>
          {(['auto', 'on', 'off'] as const).map((v) => (
            <button class={profile.mathKeys === v ? 'on' : ''} aria-pressed={profile.mathKeys === v} onClick={() => { profile.mathKeys = v; saveProfile(); }}>{t(`settings.mathKeys.${v}`)}</button>
          ))}
        </div>
        <p class="muted" style={{ marginTop: 8 }}>{t('settings.mathKeysAuto')}</p>
      </div>
      <div class="sheet">
        <h3>{t('settings.chat')}</h3>
        <label class="check"><input type="checkbox" checked={profile.chatOff} onChange={(e) => { profile.chatOff = (e.target as HTMLInputElement).checked; saveProfile(); }} /> {t('settings.hideChat')}</label>
      </div>
      <div class="sheet">
        <h3>{t('settings.analytics')}</h3>
        <p>{t('settings.analyticsHint')}</p>
        <div class="row">
          <button class={profile.analytics === 'yes' ? 'on' : ''} onClick={() => setAnalyticsConsent(true)}>{t('settings.allow')}</button>
          <button class={profile.analytics !== 'yes' ? 'on' : ''} onClick={() => setAnalyticsConsent(false)}>{t('settings.dontAllow')}</button>
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
      <TopBar title={t('ui.leaderboard')} />
      <div class="sheet">
        {rows === 'loading' ? <p>{t('ui.loadingTheLadder')}</p> : rows === null ? <p>{t('ui.theLeaderboardIsOfflineRightNow')}</p> : rows.length === 0 ? <p>{t('ui.nobodyHasPlayedRankedYet')} <a href="#/ranked">{t('ui.beTheFirst')}</a>.</p> : (
          <div class="table-wrap"><table>
            <thead><tr><th>{t('ui.place')}</th><th>{t('ui.player')}</th><th>{t('ui.rank')}</th><th>{t('ui.rating')}</th></tr></thead>
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
      <TopBar title={t('ui.privacy')} />
      <div class="sheet legal">
        <p class="muted small-note">{t('ui.lastUpdatedNovember2026')}</p>
        <h3>{t('ui.playingAsAGuest')}</h3>
        <p>{t('ui.youCanPlayWithoutAnAccount')}</p>
        <h3>{t('ui.ifYouMakeAnAccount')}</h3>
        <p>{t('ui.weStoreYourUsernameYourGame')}</p>
        <p>{t('ui.yourPasswordGoesToOurSign')}</p>
        <h3>{t('ui.children')}</h3>
        <p>{t('ui.accountsAreOnlyForPlayers13')}</p>
        <h3>{t('ui.chatAndReports')}</h3>
        <p>{t('ui.chatInGameRoomsIsnT')}</p>
        <h3>{t('ui.analytics')}</h3>
        <p>{t('ui.anonymousUsageStatsLoadOnlyIf')} <a href="#/settings">{t('ui.settings')}</a>, and never for players under 13. We don't use session recording, advertising, or tracking across other sites. Fonts and other files are served from this site, not from third parties.</p>
        <h3>{t('ui.yourChoices')}</h3>
        <p>{t('ui.youCanDeleteYourAccountAt')}</p>
        <h3>{t('ui.contactAndCopyright')}</h3>
        <p>{t('ui.forPrivacyQuestionsDeletionRequestsOr')} <a href="https://github.com/mathbattles/mathbattles.github.io/issues" target="_blank" rel="noopener noreferrer">{t('ui.githubComMathbattlesMathbattlesGithubIo')}</a>, or report a security problem privately from that repository's Security tab.</p>
      </div>
    </div>
  );
}

export { serverReachable, authState };
