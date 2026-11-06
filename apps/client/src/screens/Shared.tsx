import { levelFromXp } from '@mathbattles/sim';
import { useEffect, useState } from 'preact/hooks';
import { profile, subscribeProfile } from '../store';

export function useProfile(): void {
  const [, force] = useState(0);
  useEffect(() => subscribeProfile(() => force((n) => n + 1)), []);
}

export function TopBar({ title }: { title?: string }) {
  useProfile();
  const lv = levelFromXp(profile.xp);
  return (
    <div class="topbar">
      <a class="btn small" href="#/">Menu</a>
      {title && <h2 style={{ margin: 0 }}>{title}</h2>}
      <span class="spacer" />
      <a href="#/profile"><strong>{profile.name}</strong></a>
      <span>Level {lv.level}</span>
      <span class="sparks">{profile.sparks} Sparks</span>
    </div>
  );
}
