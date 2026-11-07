import { ACHIEVEMENTS, COSMETICS, type Cosmetic, type CosmeticKind } from '@mathbattles/sim';
import { useEffect, useState } from 'preact/hooks';
import { cosmeticCounts } from '../net/api';
import { equip, profile } from '../store';
import { sound } from '../util';
import { ItemThumb } from './Meta';
import { TopBar, useProfile } from './Shared';

const SECTIONS: { kind: CosmeticKind; name: string }[] = [
  { kind: 'hat', name: 'Hats' },
  { kind: 'trail', name: 'Shot trails' },
  { kind: 'blast', name: 'Kill effects' },
  { kind: 'obstacle', name: 'Obstacles' },
  { kind: 'title', name: 'Titles' },
];

type Rarity = 'starter' | 'common' | 'rare' | 'epic' | 'season' | 'mythic';

/** How special an item is, from how it's obtained. Sets its card colour. */
export function rarityOf(c: Cosmetic): Rarity {
  if (c.id === 'blast-smite') return 'mythic';
  if (c.season) return 'season';
  if (c.earn) return 'epic';
  if (c.cost === 0) return 'starter';
  return c.cost >= 450 ? 'rare' : 'common';
}

const RARITY_NAME: Record<Rarity, string> = { starter: 'Starter', common: 'Common', rare: 'Rare', epic: 'Epic', season: 'Season', mythic: 'Mythic' };

export function obtainText(c: Cosmetic): string {
  if (c.season) return `Season ${c.season.id} pass, level ${c.season.level}`;
  if (c.earn) return `Achievement: ${ACHIEVEMENTS.find((a) => a.id === c.earn)?.detail ?? 'a special challenge'}`;
  if (c.cost === 0) return 'Free for everyone';
  return `Shop, ${c.cost} Sparks`;
}

/** Everything you own, sorted into sections like a card collection. */
export function Inventory() {
  useProfile();
  const [counts, setCounts] = useState<{ players: number; counts: Record<string, number> } | null | 'loading'>('loading');
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    void cosmeticCounts().then(setCounts);
  }, []);
  const owned = COSMETICS.filter((c) => profile.owned.includes(c.id));
  const item = picked ? COSMETICS.find((c) => c.id === picked) : null;
  const countText = (c: Cosmetic) => {
    if (counts === 'loading') return 'Counting…';
    if (!counts) return 'Unknown right now';
    if (rarityOf(c) === 'starter') return 'Everyone has one';
    const n = counts.counts[c.id] ?? 0;
    return `${n.toLocaleString()} ${n === 1 ? 'player has' : 'players have'} it`;
  };
  return (
    <div class="page">
      <TopBar title="Inventory" />
      <p>You've collected <strong>{owned.length}</strong> of {COSMETICS.length} items. Choose one to see more, or to wear it.</p>
      <div class="inventory-layout">
        <div>
          {SECTIONS.map((sec) => {
            const mine = owned.filter((c) => c.kind === sec.kind);
            const all = COSMETICS.filter((c) => c.kind === sec.kind).length;
            return (
              <div class="sheet">
                <h3>{sec.name} <small class="muted">{mine.length}/{all}</small></h3>
                {mine.length === 0 ? <p class="muted">None yet. Find them in the Shop and the season pass.</p> : (
                  <div class="cards">
                    {mine.map((c) => (
                      <button
                        class={`card rarity-${rarityOf(c)} ${picked === c.id ? 'picked' : ''} ${profile.equipped[c.kind] === c.id ? 'worn' : ''}`}
                        aria-pressed={picked === c.id}
                        onClick={() => setPicked(c.id)}
                      >
                        <ItemThumb item={c} />
                        <strong>{c.name}</strong>
                        <small>{RARITY_NAME[rarityOf(c)]}</small>
                        {profile.equipped[c.kind] === c.id && <span class="worn-tag">On</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div class={`sheet card-detail ${item ? `rarity-${rarityOf(item)}` : ''}`} aria-live="polite">
          {item ? (
            <>
              <div class="detail-art"><ItemThumb item={item} /></div>
              <h3>{item.name}</h3>
              <span class={`rarity-pill rarity-${rarityOf(item)}`}>{RARITY_NAME[rarityOf(item)]}</span>
              <dl>
                <dt>Type</dt><dd>{SECTIONS.find((s) => s.kind === item.kind)?.name.replace(/s$/, '')}</dd>
                <dt>How many exist</dt><dd>{countText(item)}</dd>
                <dt>How to get it</dt><dd>{obtainText(item)}</dd>
              </dl>
              <button
                class="primary"
                disabled={profile.equipped[item.kind] === item.id}
                data-sfx="none"
                onClick={() => {
                  equip(item.id);
                  sound('equip', profile.muted);
                }}
              >
                {profile.equipped[item.kind] === item.id ? 'Wearing it' : 'Wear it'}
              </button>
            </>
          ) : (
            <p class="muted">Choose an item to see its details.</p>
          )}
        </div>
      </div>
      <p class="muted small-note">Counts include players with accounts, and update every few minutes.</p>
    </div>
  );
}
