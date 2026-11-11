import { cleanMap, type MapDef } from '@mathbattles/sim';
import { useState } from 'preact/hooks';
import { t, useLang } from '../i18n';
import { fetchMap } from '../net/api';
import { profile } from '../store';
import { sound } from '../util';
import { Icon } from './Icons';
import { MapPreview } from './Maps';

/** Type a shared map's code (like M-ABCDE) to play it. Shows the map once it's found. */
export function MapCodeBox({ onLoad, disabled, current }: { onLoad: (map: MapDef, code: string) => void; disabled?: boolean; current?: MapDef | null }) {
  useLang();
  const [code, setCode] = useState('');
  const [state, setState] = useState<'' | 'loading' | 'error'>('');
  const load = async () => {
    const c = code.trim().toUpperCase();
    if (!/^M-[A-Z0-9]{4,8}$/.test(c)) {
      setState('error');
      sound('error', profile.muted);
      return;
    }
    setState('loading');
    const found = await fetchMap(c);
    const map = found ? cleanMap(found.map) : null;
    if (!map) {
      setState('error');
      sound('error', profile.muted);
      return;
    }
    setState('');
    setCode('');
    sound('equip', profile.muted);
    onLoad(map, c);
  };
  return (
    <div class="map-code">
      <form class="row map-code-row" onSubmit={(e) => { e.preventDefault(); void load(); }}>
        <Icon name="code" />
        <input
          type="text"
          value={code}
          maxLength={10}
          placeholder={t('mapcode.placeholder')}
          aria-label={t('mapcode.label')}
          disabled={disabled}
          onInput={(e) => { setCode((e.target as HTMLInputElement).value); setState(''); }}
        />
        <button class="small" type="submit" disabled={disabled || !code.trim() || state === 'loading'}>
          {state === 'loading' ? t('mapcode.loading') : t('mapcode.load')}
        </button>
      </form>
      {state === 'error' && <p class="error small-note" role="alert">{t('mapcode.notFound')}</p>}
      {current && (
        <div class="map-code-preview">
          <MapPreview map={current} />
          <small class="muted">{current.name}</small>
        </div>
      )}
    </div>
  );
}
