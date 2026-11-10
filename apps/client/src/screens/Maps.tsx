import { MAP_LIMITS, PLANE_H, PLANE_W, Rng, SOLDIER_R, TEAM_RING, cleanMap, generateCircles, spawnBlocked, type Circle, type MapDef, type MapSpawn, type MatchState } from '@mathbattles/sim';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useAuth } from '../auth';
import { deleteMap, getMap, newMapId, playMapNext, saveMap, savedMaps, type SavedMap } from '../maps';
import { countMapPlay, deleteSharedMap, fetchMap, listMaps, publishMap, type SharedMap } from '../net/api';
import { drawObstacle, obstacleStyle } from '../render/obstacles';
import { Stage, THEMES } from '../render/stage';
import { cosmeticValue, profile } from '../store';
import { go, sound } from '../util';
import { TopBar, useProfile } from './Shared';
import { t } from '../i18n';

/** A small picture of a map, drawn in the player's own obstacle design. */
export function MapPreview({ map }: { map: MapDef }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const c = canvas.getContext('2d')!;
    const theme = THEMES[profile.theme];
    const k = canvas.width / PLANE_W;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.strokeStyle = theme.grid;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(canvas.width / 2, 0);
    c.lineTo(canvas.width / 2, canvas.height);
    c.moveTo(0, canvas.height / 2);
    c.lineTo(canvas.width, canvas.height / 2);
    c.stroke();
    c.setTransform(k, 0, 0, k, 0, 0);
    const style = obstacleStyle(cosmeticValue('obstacle'));
    map.circles.forEach((o, i) => drawObstacle(c, style, o.x, o.y, o.r, i));
    for (const s of map.spawns) {
      c.fillStyle = s.team === 2 ? theme.team2 : theme.team1;
      c.beginPath();
      c.arc(s.x, s.y, SOLDIER_R * 1.4, 0, Math.PI * 2);
      c.fill();
    }
  }, [map]);
  return <canvas class="map-preview" ref={ref} width={220} height={Math.round((220 * PLANE_H) / PLANE_W)} aria-hidden="true" />;
}

const blankMap = (): MapDef => ({ name: 'My map', circles: [], spawns: [] });

/** Builds a pretend match so the editor can draw the map exactly as a real match would. */
function boardFor(map: MapDef): MatchState {
  // Each spawn is one player's soldier: blue spawns in blue, red in red.
  const players = map.spawns.map((sp, id) => ({
    id: `spawn-${id}`, name: '', team: sp.team, soldierId: id, color: sp.team === 2 ? TEAM_RING[2] : TEAM_RING[1],
    connected: true, locked: false, kills: 0, deaths: 0, shots: 0, bestCombo: 0,
  }));
  const soldiers = map.spawns.map((s, id) => ({ id, playerId: `spawn-${id}`, x: s.x, y: s.y, alive: true, angle: 0 }));
  return {
    config: { kind: 'teams', mode: 'fn', seed: 0 },
    players, soldiers, circles: map.circles, holes: [], round: 1, over: false, winner: null, log: [],
  } as unknown as MatchState;
}

type Tool = 'rock' | 'blue' | 'red' | 'erase';
type Grab = { what: 'rock' | 'spawn'; index: number; mode: 'move' | 'size'; dx: number; dy: number } | null;

/** Draw your own map: place rocks, size them, and choose where each team starts. */
export function MapEditor({ id }: { id?: string }) {
  useProfile();
  const existing = id ? getMap(id) : undefined;
  const [entry, setEntry] = useState<SavedMap>(() => existing ?? { id: id ?? newMapId(), map: blankMap(), updatedAt: Date.now() });
  const [tool, setTool] = useState<Tool>('rock');
  const [size, setSize] = useState(40);
  const [picked, setPicked] = useState<number | null>(null);
  const [undo, setUndo] = useState<MapDef[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage | null>(null);
  const grab = useRef<Grab>(null);
  const auth = useAuth();
  const map = entry.map;

  useEffect(() => {
    const s = new Stage(canvas.current!, 1.5);
    s.themeId = profile.theme;
    s.setRockStyle(cosmeticValue('obstacle'));
    s.start();
    stage.current = s;
    const sizer = new ResizeObserver(() => s.resize());
    sizer.observe(canvas.current!);
    return () => {
      sizer.disconnect();
      s.stop();
    };
  }, []);

  // Redraw the board, and the selection ring on top, whenever the map changes.
  useEffect(() => {
    stage.current?.sync(boardFor(map));
    const o = overlay.current;
    if (!o) return;
    const c = o.getContext('2d')!;
    c.setTransform(o.width / PLANE_W, 0, 0, o.height / PLANE_H, 0, 0);
    c.clearRect(0, 0, PLANE_W, PLANE_H);
    const rock = picked !== null ? map.circles[picked] : undefined;
    if (rock) {
      c.strokeStyle = '#ff4d7e';
      c.lineWidth = 2.5;
      c.setLineDash([6, 5]);
      c.beginPath();
      c.arc(rock.x, rock.y, rock.r + 4, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = '#ff4d7e';
      c.beginPath();
      c.arc(rock.x + rock.r + 4, rock.y, 5, 0, Math.PI * 2);
      c.fill();
    }
    for (const s of map.spawns) {
      if (!spawnBlocked(s, map.circles)) continue;
      c.strokeStyle = '#ff4d7e';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(s.x - 9, s.y - 9);
      c.lineTo(s.x + 9, s.y + 9);
      c.moveTo(s.x + 9, s.y - 9);
      c.lineTo(s.x - 9, s.y + 9);
      c.stroke();
    }
  }, [map, picked]);

  const change = (next: MapDef, remember = true) => {
    if (remember) setUndo((u) => [...u.slice(-40), map]);
    setEntry((e) => ({ ...e, map: next }));
  };

  const point = (e: PointerEvent) => {
    const r = overlay.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * PLANE_W, y: ((e.clientY - r.top) / r.height) * PLANE_H };
  };
  const rockAt = (p: { x: number; y: number }) => {
    for (let i = map.circles.length - 1; i >= 0; i--) {
      const c = map.circles[i]!;
      if (Math.hypot(c.x - p.x, c.y - p.y) <= c.r) return i;
    }
    return -1;
  };
  const spawnAt = (p: { x: number; y: number }) => map.spawns.findIndex((s) => Math.hypot(s.x - p.x, s.y - p.y) <= SOLDIER_R + 6);
  const clampX = (v: number) => Math.round(Math.max(0, Math.min(PLANE_W, v)));
  const clampY = (v: number) => Math.round(Math.max(0, Math.min(PLANE_H, v)));

  const down = (e: PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = point(e);
    const sp = spawnAt(p);
    const rk = rockAt(p);
    const sel = picked !== null ? map.circles[picked] : undefined;
    if (tool === 'erase') {
      if (sp >= 0) change({ ...map, spawns: map.spawns.filter((_, i) => i !== sp) });
      else if (rk >= 0) {
        change({ ...map, circles: map.circles.filter((_, i) => i !== rk) });
        setPicked(null);
      }
      return;
    }
    // The handle on the selected rock's edge resizes it.
    if (sel && Math.abs(Math.hypot(sel.x - p.x, sel.y - p.y) - (sel.r + 4)) < 9) {
      setUndo((u) => [...u.slice(-40), map]);
      grab.current = { what: 'rock', index: picked!, mode: 'size', dx: 0, dy: 0 };
      return;
    }
    if (sp >= 0) {
      setUndo((u) => [...u.slice(-40), map]);
      grab.current = { what: 'spawn', index: sp, mode: 'move', dx: map.spawns[sp]!.x - p.x, dy: map.spawns[sp]!.y - p.y };
      return;
    }
    if (tool === 'rock') {
      if (rk >= 0) {
        setPicked(rk);
        setSize(map.circles[rk]!.r);
        setUndo((u) => [...u.slice(-40), map]);
        grab.current = { what: 'rock', index: rk, mode: 'move', dx: map.circles[rk]!.x - p.x, dy: map.circles[rk]!.y - p.y };
        return;
      }
      if (map.circles.length >= MAP_LIMITS.circles) return setNote(`A map can have up to ${MAP_LIMITS.circles} rocks.`);
      change({ ...map, circles: [...map.circles, { x: clampX(p.x), y: clampY(p.y), r: size }] });
      setPicked(map.circles.length);
      sound('click', profile.muted);
      return;
    }
    const team = tool === 'blue' ? 1 : 2;
    if (map.spawns.filter((s) => s.team === team).length >= MAP_LIMITS.spawnsPerTeam) return setNote(`Each team can have up to ${MAP_LIMITS.spawnsPerTeam} starting spots.`);
    const spawn: MapSpawn = { x: Math.round(Math.max(SOLDIER_R, Math.min(PLANE_W - SOLDIER_R, p.x))), y: Math.round(Math.max(SOLDIER_R, Math.min(PLANE_H - SOLDIER_R, p.y))), team };
    change({ ...map, spawns: [...map.spawns, spawn] });
    sound('click', profile.muted);
  };
  const move = (e: PointerEvent) => {
    const g = grab.current;
    if (!g) return;
    const p = point(e);
    if (g.what === 'spawn') {
      const spawns = map.spawns.map((s, i) => (i === g.index ? { ...s, x: Math.round(Math.max(SOLDIER_R, Math.min(PLANE_W - SOLDIER_R, p.x + g.dx))), y: Math.round(Math.max(SOLDIER_R, Math.min(PLANE_H - SOLDIER_R, p.y + g.dy))) } : s));
      change({ ...map, spawns }, false);
    } else {
      const circles = map.circles.map((c, i) => {
        if (i !== g.index) return c;
        if (g.mode === 'size') {
          const r = Math.round(Math.max(MAP_LIMITS.minR, Math.min(MAP_LIMITS.maxR, Math.hypot(c.x - p.x, c.y - p.y) - 4)));
          setSize(r);
          return { ...c, r };
        }
        return { ...c, x: clampX(p.x + g.dx), y: clampY(p.y + g.dy) };
      });
      change({ ...map, circles }, false);
    }
  };
  const up = () => {
    grab.current = null;
  };

  const setPickedSize = (r: number) => {
    setSize(r);
    if (picked !== null && map.circles[picked]) change({ ...map, circles: map.circles.map((c, i) => (i === picked ? { ...c, r } : c)) }, false);
  };
  const randomRocks = () => {
    const rng = new Rng((Math.random() * 2 ** 31) >>> 0);
    const circles: Circle[] = generateCircles(rng).slice(0, MAP_LIMITS.circles).map((c) => ({ x: c.x, y: c.y, r: Math.max(MAP_LIMITS.minR, Math.min(MAP_LIMITS.maxR, c.r)) }));
    change({ ...map, circles });
    setPicked(null);
  };
  const mirror = () => {
    // Copies the left half onto the right, so both teams get the same field.
    const left = map.circles.filter((c) => c.x < PLANE_W / 2);
    const circles = [...left, ...left.map((c) => ({ ...c, x: PLANE_W - c.x }))].slice(0, MAP_LIMITS.circles);
    const blue = map.spawns.filter((s) => s.team === 1);
    const spawns = [...blue, ...blue.map((s) => ({ ...s, x: PLANE_W - s.x, team: 2 as const }))];
    change({ ...map, circles, spawns });
    setPicked(null);
  };
  const save = (silent = false) => {
    const clean = cleanMap(map);
    if (!clean) return setNote("This map couldn't be saved. Try removing a few things.");
    saveMap({ ...entry, map: clean });
    if (!silent) setNote('Saved on this device.');
    return clean;
  };
  const play = () => {
    const clean = save(true);
    if (!clean) return;
    playMapNext(clean);
    go('/local');
  };
  const share = async () => {
    const clean = save(true);
    if (!clean) return;
    setBusy(true);
    const r = await publishMap(clean);
    setBusy(false);
    if (r.error) return setNote(r.error);
    saveMap({ ...entry, map: clean, code: r.data!.code });
    setEntry((e) => ({ ...e, code: r.data!.code }));
    const link = `${location.origin}${location.pathname}#/map/${r.data!.code}`;
    void navigator.clipboard?.writeText(link).catch(() => {});
    setNote(`Shared as ${r.data!.code}. The link is copied, so you can paste it anywhere.`);
  };

  const sel = picked !== null ? map.circles[picked] : undefined;
  const blue = map.spawns.filter((s) => s.team === 1).length;
  const red = map.spawns.filter((s) => s.team === 2).length;
  return (
    <div class="page">
      <TopBar title={t('ui.mapEditor')} />
      <div class="editor-layout">
        <div class="sheet editor-field">
          <div class="editor-canvas">
            <canvas ref={canvas} width={770} height={450} aria-hidden="true" />
            <canvas
              ref={overlay}
              class={`editor-overlay tool-${tool}`}
              width={770}
              height={450}
              role="img"
              aria-label={`Map with ${map.circles.length} rocks, ${blue} blue and ${red} red starting spots.`}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
            />
          </div>
          <p class="muted small-note" style={{ marginTop: 6 }}>
            {tool === 'rock' ? 'Click to place a rock. Drag a rock to move it, or drag the pink dot on its edge to resize it.'
              : tool === 'erase' ? 'Click a rock or a starting spot to remove it.'
              : `Click to add a ${tool} starting spot. Drag one to move it. Teams without spots start in random places.`}
          </p>
        </div>
        <div class="sheet editor-tools">
          <label class="stack-label">Name
            <input type="text" maxLength={MAP_LIMITS.name} value={map.name} onInput={(e) => change({ ...map, name: (e.target as HTMLInputElement).value }, false)} />
          </label>
          <div class="row" role="group" aria-label={t('ui.tool')}>
            {(['rock', 'blue', 'red', 'erase'] as Tool[]).map((t) => (
              <button class={`small ${tool === t ? 'on' : ''}`} aria-pressed={tool === t} onClick={() => { setTool(t); if (t !== 'rock') setPicked(null); }}>
                {t === 'rock' ? 'Rocks' : t === 'blue' ? 'Blue start' : t === 'red' ? 'Red start' : 'Erase'}
              </button>
            ))}
          </div>
          <label class="slider">{sel ? 'Selected rock size' : 'New rock size'}: {size}
            <input type="range" min={MAP_LIMITS.minR} max={MAP_LIMITS.maxR} value={size} style={{ '--val': `${((size - MAP_LIMITS.minR) / (MAP_LIMITS.maxR - MAP_LIMITS.minR)) * 100}%` }}
              onInput={(e) => setPickedSize(Number((e.target as HTMLInputElement).value))} />
          </label>
          <div class="row">
            {sel && <button class="small" onClick={() => { change({ ...map, circles: map.circles.filter((_, i) => i !== picked) }); setPicked(null); }}>{t('ui.deleteRock')}</button>}
            <button class="small" disabled={!undo.length} onClick={() => { setEntry((e) => ({ ...e, map: undo[undo.length - 1]! })); setUndo((u) => u.slice(0, -1)); setPicked(null); }}>{t('ui.undo')}</button>
            <button class="small" onClick={randomRocks}>{t('ui.randomRocks')}</button>
            <button class="small" onClick={mirror}>{t('ui.mirrorLeftToRight')}</button>
            <button class="small" onClick={() => { change(blankMap()); setPicked(null); }}>{t('ui.clear')}</button>
          </div>
          <p class="muted small-note">{map.circles.length}/{MAP_LIMITS.circles} rocks. Starting spots: {blue} blue, {red} red.{map.spawns.some((s) => spawnBlocked(s, map.circles)) ? ' A crossed-out spot is inside a rock, so that soldier would be stuck.' : ''}</p>
          <div class="row editor-actions">
            <button class="primary" onClick={play}>{t('ui.playIt')}</button>
            <button onClick={() => save()}>{t('ui.save')}</button>
            <button disabled={busy || !auth.user} onClick={() => void share()}>{entry.code ? 'Share again' : 'Share'}</button>
          </div>
          {!auth.user && <p class="muted small-note">{t('ui.signInToShareMapsWith')}</p>}
          {entry.code && <p class="small-note">{t('ui.code')} <strong>{entry.code}</strong></p>}
          {note && <p class="ok small-note" role="status">{note}</p>}
          <a class="btn small" href="#/maps">{t('ui.backToMaps')}</a>
        </div>
      </div>
    </div>
  );
}

/** Your maps and everyone's shared maps, ready to play or edit. */
export function MapsPage() {
  useProfile();
  const auth = useAuth();
  const [mine, setMine] = useState<SavedMap[]>(savedMaps());
  const [shared, setShared] = useState<SharedMap[] | null | 'loading'>('loading');
  const [sort, setSort] = useState<'new' | 'popular'>('popular');
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    setShared('loading');
    void listMaps(sort).then(setShared);
  }, [sort]);

  const playShared = (m: SharedMap) => {
    void countMapPlay(m.code);
    playMapNext(m.map);
    go('/local');
  };
  const copyToMine = (m: SharedMap) => {
    const entry: SavedMap = { id: newMapId(), map: { ...m.map, name: `${m.map.name}`.slice(0, MAP_LIMITS.name) }, updatedAt: Date.now() };
    saveMap(entry);
    go(`/maps/edit/${entry.id}`);
  };
  return (
    <div class="page">
      <TopBar title={t('ui.customMaps')} />
      <p>{t('ui.drawYourOwnBattlefieldThenPlay')}</p>
      <div class="row" style={{ marginBottom: 14 }}>
        <a class="btn primary" href={`#/maps/edit/${newMapId()}`}>{t('ui.makeANewMap')}</a>
        <form class="row" onSubmit={(e) => { e.preventDefault(); if (code.trim()) go(`/map/${code.trim().toUpperCase()}`); }}>
          <input type="text" placeholder={t('ui.mapCodeLikeMAbcde')} value={code} maxLength={16} onInput={(e) => setCode((e.target as HTMLInputElement).value)} aria-label={t('ui.mapCode')} />
          <button type="submit">{t('ui.open')}</button>
        </form>
      </div>
      {note && <p class="ok" role="status">{note}</p>}
      <div class="sheet">
        <h3>{t('ui.yourMaps')}</h3>
        {mine.length === 0 ? <p class="muted">{t('ui.youHavenTMadeAMap')}</p> : (
          <div class="map-grid">
            {mine.map((m) => (
              <div class="map-card">
                <MapPreview map={m.map} />
                <strong>{m.map.name}</strong>
                <small class="muted">{m.map.circles.length} rocks{m.code ? `, shared as ${m.code}` : ''}</small>
                <div class="row">
                  <button class="small primary" onClick={() => { playMapNext(m.map); go('/local'); }}>{t('ui.play')}</button>
                  <a class="btn small" href={`#/maps/edit/${m.id}`}>{t('ui.edit')}</a>
                  <button class="small" onClick={() => {
                    deleteMap(m.id);
                    if (m.code) void deleteSharedMap(m.code);
                    setMine(savedMaps());
                    setNote(`Deleted ${m.map.name}.`);
                  }}>{t('ui.delete')}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div class="sheet">
        <div class="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>{t('ui.sharedMaps')}</h3>
          <div class="row" role="group" aria-label={t('ui.sortSharedMaps')}>
            <button class={`small ${sort === 'popular' ? 'on' : ''}`} aria-pressed={sort === 'popular'} onClick={() => setSort('popular')}>{t('ui.mostPlayed')}</button>
            <button class={`small ${sort === 'new' ? 'on' : ''}`} aria-pressed={sort === 'new'} onClick={() => setSort('new')}>{t('ui.newest')}</button>
          </div>
        </div>
        {shared === 'loading' ? <p>{t('ui.loadingMaps')}</p> : shared === null ? <p class="muted">{t('ui.sharedMapsAreOfflineRightNow')}</p> : shared.length === 0 ? <p class="muted">{t('ui.noSharedMapsYetMakeOne')}</p> : (
          <div class="map-grid" style={{ marginTop: 10 }}>
            {shared.map((m) => (
              <div class="map-card">
                <MapPreview map={m.map} />
                <strong>{m.name}</strong>
                <small class="muted">By {m.author}, played {m.plays} {m.plays === 1 ? 'time' : 'times'}</small>
                <div class="row">
                  <button class="small primary" onClick={() => playShared(m)}>{t('ui.play')}</button>
                  <button class="small" onClick={() => copyToMine(m)}>{t('ui.editACopy')}</button>
                  <a class="btn small" href={`#/map/${m.code}`}>{t('ui.share')}</a>
                </div>
              </div>
            ))}
          </div>
        )}
        {!auth.user && <p class="muted small-note" style={{ marginTop: 10 }}>{t('ui.signInToShareYourOwn')}</p>}
      </div>
    </div>
  );
}

/** One shared map, opened from a link. */
export function SharedMapScreen({ code }: { code: string }) {
  const [m, setM] = useState<SharedMap | null | 'loading'>('loading');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void fetchMap(code).then(setM);
  }, [code]);
  if (m === 'loading') return <div class="page"><TopBar title={t('ui.map')} /><p>{t('ui.loadingTheMap')}</p></div>;
  if (!m) return <div class="page"><TopBar title={t('ui.map')} /><div class="sheet"><h3>{t('ui.thatMapWasnTFound')}</h3><p>{t('ui.checkTheCodeAndTryAgain')}</p><a class="btn" href="#/maps">{t('ui.allMaps')}</a></div></div>;
  const link = `${location.origin}${location.pathname}#/map/${m.code}`;
  return (
    <div class="page">
      <TopBar title={m.name} />
      <div class="sheet shared-map">
        <MapPreview map={m.map} />
        <p>{t('ui.by')} <strong>{m.author}</strong>. Played {m.plays} {m.plays === 1 ? 'time' : 'times'}. Code <strong>{m.code}</strong>.</p>
        <div class="row">
          <button class="primary" onClick={() => { void countMapPlay(m.code); playMapNext(m.map); go('/local'); }}>{t('ui.playIt')}</button>
          <button onClick={() => { void navigator.clipboard?.writeText(link).then(() => setCopied(true)).catch(() => {}); }}>{copied ? 'Link copied' : 'Copy link'}</button>
          <button onClick={() => { const entry: SavedMap = { id: newMapId(), map: m.map, updatedAt: Date.now() }; saveMap(entry); go(`/maps/edit/${entry.id}`); }}>{t('ui.editACopy')}</button>
          <a class="btn" href="#/maps">{t('ui.allMaps')}</a>
        </div>
      </div>
    </div>
  );
}
