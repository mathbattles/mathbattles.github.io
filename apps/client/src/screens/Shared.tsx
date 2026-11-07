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
      {!home && <a class="btn small menu-link" href="#/">Menu</a>}
      {title && <h2 style={{ margin: 0 }}>{title}</h2>}
      <span class="spacer" />
      {auth.ready && !auth.user && <a class="btn small" href="#/signin">Sign in</a>}
      <a class="user-chip" href="#/profile">
        <svg class="face" viewBox="0 0 24 24" aria-hidden="true">
          <circle class="head" cx="12" cy="12" r="9.5" />
          <g class="eyes"><circle cx="9" cy="10.5" r="1.4" /><circle cx="15" cy="10.5" r="1.4" /></g>
          <path class="smile" d="M8 14.6q4 3.4 8 0" />
        </svg>
        <span class="name">{profile.name}</span>
      </a>
      <span>Level {lv.level}</span>
      <span class="sparks">{profile.sparks} Sparks</span>
    </div>
  );
}
