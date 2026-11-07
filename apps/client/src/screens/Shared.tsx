import { levelFromXp } from '@mathbattles/sim';
import { useEffect, useState } from 'preact/hooks';
import { useAuth } from '../auth';
import { profile, subscribeProfile } from '../store';

export function useProfile(): void {
  const [, force] = useState(0);
  useEffect(() => subscribeProfile(() => force((n) => n + 1)), []);
}

export function TopBar({ title, home }: { title?: string; home?: boolean }) {
  useProfile();
  const auth = useAuth();
  const lv = levelFromXp(profile.xp);
  return (
    <div class="topbar">
      {!home && <a class="btn small" href="#/">Menu</a>}
      {title && <h2 style={{ margin: 0 }}>{title}</h2>}
      <span class="spacer" />
      {auth.ready && !auth.user && <a class="btn small" href="#/signin">Sign in</a>}
      <a href="#/profile"><strong>{profile.name}</strong></a>
      <span>Level {lv.level}</span>
      <span class="sparks">{profile.sparks} Sparks</span>
    </div>
  );
}
