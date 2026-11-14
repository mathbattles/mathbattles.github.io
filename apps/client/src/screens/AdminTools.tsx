import { ABILITIES, type AbilityId } from '@mathbattles/sim';
import { useEffect, useState } from 'preact/hooks';
import { adminCall } from '../net/api';
import { Icon } from './Icons';
import { ABILITY_ICON } from './GameView';

/**
 * The owner's server tools: find and edit players, ban and mute, see every live room, and change
 * game settings without a redeploy. Owner-only, behind the two-step check, so it stays in English.
 */

interface PlayerRow {
  uid: string;
  name: string;
  created: number;
  rating: number;
  games: number;
  sparks: number;
  xp: number;
  items: number;
  abilities: string[];
  sanctions: { kind: 'ban' | 'mute'; reason: string; until: number }[];
}
interface SanctionRow { uid: string; name: string | null; kind: 'ban' | 'mute'; reason: string; until: number }
interface RoomRow { code: string; public: number; players: number; kind: string; mode: string; lobby: number; updated: number }
interface Settings { energyCosts: Partial<Record<AbilityId, number>>; prices: Partial<Record<AbilityId, number>>; announcement: string }
interface LogRow { id: number; at: number; action: string; target: string | null; detail: string | null }

type Tab = 'players' | 'moderation' | 'live' | 'settings' | 'log';
const TABS: { id: Tab; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { id: 'players', label: 'Players', icon: 'users' },
  { id: 'moderation', label: 'Moderation', icon: 'ban' },
  { id: 'live', label: 'Live rooms', icon: 'eye' },
  { id: 'settings', label: 'Game settings', icon: 'gear' },
  { id: 'log', label: 'Admin log', icon: 'clock' },
];

const when = (ms: number) => new Date(ms).toLocaleString();

/** Bans or mutes a player by name. Also used from the chat reports list. */
export async function sanction(name: string, kind: 'ban' | 'mute', reason: string, days: number) {
  return adminCall<{ ok: boolean; name: string; until: number }>('/api/admin/sanctions', { method: 'POST', body: JSON.stringify({ name, kind, reason, days }) });
}

export function AdminTools() {
  const [tab, setTab] = useState<Tab>('players');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const report = (r: { error?: string }, ok: string) => {
    setError(r.error ?? '');
    setNote(r.error ? '' : ok);
  };
  return (
    <div class="sheet admin-tools">
      <div class="row admin-tabs" role="tablist" aria-label="Admin tools">
        {TABS.map((x) => (
          <button role="tab" class={`tab small ${tab === x.id ? 'on' : ''}`} aria-selected={tab === x.id} onClick={() => { setTab(x.id); setNote(''); setError(''); }}>
            <Icon name={x.icon} /> {x.label}
          </button>
        ))}
      </div>
      {note && <p class="ok" role="status">{note}</p>}
      {error && <p class="error" role="alert">{error}</p>}
      {tab === 'players' && <Players report={report} />}
      {tab === 'moderation' && <Moderation report={report} />}
      {tab === 'live' && <Live report={report} />}
      {tab === 'settings' && <SettingsForm report={report} />}
      {tab === 'log' && <Log />}
    </div>
  );
}

type Report = (r: { error?: string }, ok: string) => void;

function Players({ report }: { report: Report }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PlayerRow[] | null>(null);
  const [rating, setRating] = useState<Record<string, string>>({});
  const [sparks, setSparks] = useState<Record<string, string>>({});
  const search = async (e?: Event) => {
    e?.preventDefault();
    const r = await adminCall<{ players: PlayerRow[] }>(`/api/admin/players?q=${encodeURIComponent(q.trim())}`);
    setRows(r.data?.players ?? []);
    if (r.error) report(r, '');
  };
  const act = async (uid: string, body: unknown, ok: string) => {
    const r = await adminCall(`/api/admin/players/${encodeURIComponent(uid)}`, { method: 'POST', body: JSON.stringify(body) });
    report(r, ok);
    if (!r.error) void search();
  };
  return (
    <>
      <form class="row" onSubmit={(e) => void search(e)}>
        <input type="text" placeholder="Search by username" aria-label="Search players" value={q} maxLength={32} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <button class="primary" type="submit"><Icon name="search" /> Search</button>
      </form>
      {rows && rows.length === 0 && <p class="muted">No players found.</p>}
      {rows?.map((p) => (
        <div class="admin-player">
          <div class="admin-player-head">
            <strong><a href={`#/player/${encodeURIComponent(p.name)}`}>{p.name}</a></strong>
            <small class="muted">joined {new Date(p.created).toLocaleDateString()}</small>
            {p.sanctions.map((s) => <span class={`pill ${s.kind}`}>{s.kind === 'ban' ? 'Banned' : 'Muted'} until {when(s.until)}</span>)}
          </div>
          <p class="muted small-note">Rating {p.rating} after {p.games} ranked games. {p.sparks} Sparks, {p.xp} XP, {p.items} items, abilities: {p.abilities.join(', ') || 'none'}.</p>
          <div class="admin-row">
            <label>Rating <input type="text" inputMode="numeric" value={rating[p.uid] ?? String(p.rating)} onInput={(e) => setRating({ ...rating, [p.uid]: (e.target as HTMLInputElement).value })} /></label>
            <button class="small" onClick={() => void act(p.uid, { action: 'setRating', rating: Number(rating[p.uid] ?? p.rating) }, `Rating for ${p.name} saved.`)}>Set</button>
            <button class="small" onClick={() => void act(p.uid, { action: 'resetRank' }, `${p.name}'s rank was reset.`)}>Reset rank</button>
          </div>
          <div class="admin-row">
            <label>Sparks (+/-) <input type="text" inputMode="numeric" value={sparks[p.uid] ?? '100'} onInput={(e) => setSparks({ ...sparks, [p.uid]: (e.target as HTMLInputElement).value })} /></label>
            <button class="small" onClick={() => void act(p.uid, { action: 'addSparks', sparks: Number(sparks[p.uid] ?? 100) }, `Sparks for ${p.name} changed.`)}>Apply</button>
          </div>
        </div>
      ))}
    </>
  );
}

function Moderation({ report }: { report: Report }) {
  const [rows, setRows] = useState<SanctionRow[] | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'ban' | 'mute'>('mute');
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('1');
  const load = () => void adminCall<{ sanctions: SanctionRow[] }>('/api/admin/sanctions').then((r) => setRows(r.data?.sanctions ?? []));
  useEffect(load, []);
  const submit = async (e: Event) => {
    e.preventDefault();
    const r = await sanction(name.trim(), kind, reason.trim(), Number(days));
    report(r, r.data ? `${r.data.name} is ${kind === 'ban' ? 'banned' : 'muted'} until ${when(r.data.until)}.` : '');
    if (!r.error) load();
  };
  return (
    <>
      <form class="admin-form" onSubmit={(e) => void submit(e)}>
        <label>Player <input type="text" value={name} maxLength={32} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
        <span class="row" role="group" aria-label="Type">
          <button type="button" class={`small ${kind === 'mute' ? 'on' : ''}`} aria-pressed={kind === 'mute'} onClick={() => setKind('mute')}><Icon name="mute" /> Mute chat</button>
          <button type="button" class={`small ${kind === 'ban' ? 'on' : ''}`} aria-pressed={kind === 'ban'} onClick={() => setKind('ban')}><Icon name="ban" /> Ban from matches</button>
        </span>
        <label>Reason <input type="text" value={reason} maxLength={200} onInput={(e) => setReason((e.target as HTMLInputElement).value)} /></label>
        <label>Days <input type="text" inputMode="decimal" value={days} onInput={(e) => setDays((e.target as HTMLInputElement).value)} /></label>
        <button class="primary" type="submit">Apply</button>
      </form>
      <h4>Active</h4>
      {rows === null ? <p>Loading.</p> : rows.length === 0 ? <p class="muted">Nobody is banned or muted.</p> : (
        <div class="table-wrap">
          <table>
            <thead><tr><th>Player</th><th>Type</th><th>Reason</th><th>Until</th><th /></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr>
                  <td>{s.name ?? s.uid}</td>
                  <td>{s.kind === 'ban' ? 'Ban' : 'Mute'}</td>
                  <td>{s.reason}</td>
                  <td>{when(s.until)}</td>
                  <td>
                    <button class="small" onClick={() => void adminCall(`/api/admin/sanctions/${encodeURIComponent(s.uid)}/${s.kind}`, { method: 'DELETE' }).then((r) => { report(r, 'Lifted.'); load(); })}>Lift</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Live({ report }: { report: Report }) {
  const [rows, setRows] = useState<RoomRow[] | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const load = () => void adminCall<{ rooms: RoomRow[] }>('/api/admin/live').then((r) => setRows(r.data?.rooms ?? []));
  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);
  return rows === null ? <p>Loading.</p> : rows.length === 0 ? <p class="muted">No rooms open right now.</p> : (
    <div class="table-wrap">
      <table>
        <thead><tr><th>Room</th><th>Players</th><th>Rules</th><th>State</th><th>Updated</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              <td><strong>{r.code}</strong>{r.code.startsWith('R-') ? ' (ranked)' : r.public ? ' (public)' : ''}</td>
              <td>{r.players}</td>
              <td>{r.kind}, {r.mode}</td>
              <td>{r.lobby ? 'Lobby' : 'In a match'}</td>
              <td>{new Date(r.updated).toLocaleTimeString()}</td>
              <td class="row">
                <a class="btn small" href={`#/watch/${r.code}`}><Icon name="eye" /> Watch</a>
                {closing === r.code ? (
                  <>
                    <button class="small danger" onClick={() => { setClosing(null); void adminCall(`/api/admin/rooms/${encodeURIComponent(r.code)}/close`, { method: 'POST', body: '{}' }).then((x) => { report(x, `Room ${r.code} closed.`); load(); }); }}>Yes, close</button>
                    <button class="small plain" onClick={() => setClosing(null)}>Keep</button>
                  </>
                ) : <button class="small" onClick={() => setClosing(r.code)}><Icon name="door" /> Close</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SettingsForm({ report }: { report: Report }) {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    void adminCall<{ settings: Settings }>('/api/admin/settings').then((r) => setS(r.data?.settings ?? { energyCosts: {}, prices: {}, announcement: '' }));
  }, []);
  if (!s) return <p>Loading.</p>;
  const setNum = (field: 'energyCosts' | 'prices', id: AbilityId, v: string) => {
    const next = { ...s[field] };
    if (v.trim() === '') delete next[id];
    else next[id] = Number(v);
    setS({ ...s, [field]: next });
  };
  const save = async () => {
    const r = await adminCall<{ settings: Settings }>('/api/admin/settings', { method: 'POST', body: JSON.stringify(s) });
    if (r.data) setS(r.data.settings);
    report(r, 'Settings saved. New matches and pages pick them up within a minute.');
  };
  return (
    <>
      <p class="muted small-note">Leave a box empty to use the normal value. Energy changes apply to matches that start after saving.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Ability</th><th>Energy (normal)</th><th>Sparks (normal)</th></tr></thead>
          <tbody>
            {ABILITIES.map((a) => (
              <tr>
                <td><Icon name={ABILITY_ICON[a.id]} /> {a.name}</td>
                <td><input type="text" inputMode="numeric" aria-label={`${a.name} energy`} placeholder={String(a.energy)} value={s.energyCosts[a.id] ?? ''} onInput={(e) => setNum('energyCosts', a.id, (e.target as HTMLInputElement).value)} /></td>
                <td><input type="text" inputMode="numeric" aria-label={`${a.name} price`} placeholder={String(a.price)} value={s.prices[a.id] ?? ''} onInput={(e) => setNum('prices', a.id, (e.target as HTMLInputElement).value)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label class="stack-label"><span><Icon name="megaphone" /> Announcement banner</span>
        <input type="text" maxLength={200} placeholder="Shown across the top of every page. Leave empty for none." value={s.announcement} onInput={(e) => setS({ ...s, announcement: (e.target as HTMLInputElement).value })} />
      </label>
      <button class="primary" onClick={() => void save()}>Save settings</button>
    </>
  );
}

function Log() {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  useEffect(() => {
    void adminCall<{ log: LogRow[] }>('/api/admin/log').then((r) => setRows(r.data?.log ?? []));
  }, []);
  return rows === null ? <p>Loading.</p> : rows.length === 0 ? <p class="muted">No admin changes yet.</p> : (
    <div class="table-wrap">
      <table>
        <thead><tr><th>When</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
        <tbody>
          {rows.map((r) => <tr><td>{when(r.at)}</td><td>{r.action}</td><td>{r.target}</td><td><code>{r.detail}</code></td></tr>)}
        </tbody>
      </table>
    </div>
  );
}
