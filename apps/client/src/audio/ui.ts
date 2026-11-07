import { profile, subscribeProfile } from '../store';
import { sound } from '../util';
import { setVolumes, unlockAudio } from './engine';
import { music } from './music';

const INTERACTIVE = 'button, a[href], .btn, summary, select, [role="tab"], [role="option"]';
const HOVERABLE = `${INTERACTIVE}, .item, .tile`;

/**
 * Sounds for the whole interface, added once at the page level so every screen gets them,
 * and the music, which follows the player's settings.
 * An element with data-sfx="none" plays its own sound instead of the general click.
 */
export function initAudioUi(): void {
  let unlocked = false;
  let started = false;
  let lastTrack = profile.musicTrack;

  const applySettings = () => {
    setVolumes(profile.muted ? 0 : profile.sfxVolume, profile.musicVolume);
    if (!unlocked) return;
    const want = profile.music && !document.hidden;
    if (want && (!started || profile.musicTrack !== lastTrack)) {
      started = true;
      lastTrack = profile.musicTrack;
      music.play(profile.musicTrack);
    } else if (want) {
      music.start();
    } else {
      music.stop();
    }
  };
  applySettings();
  subscribeProfile(applySettings);
  document.addEventListener('visibilitychange', applySettings);

  // Browsers only allow sound after the player interacts with the page.
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    unlockAudio();
    applySettings();
  };

  const quiet = (el: Element) => !!el.closest('[data-sfx="none"]') || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true';

  document.addEventListener('pointerdown', (e) => {
    unlock();
    const el = (e.target as Element | null)?.closest?.(INTERACTIVE);
    if (el && !quiet(el)) sound('click', profile.muted);
  }, true);

  document.addEventListener('keydown', (e) => {
    unlock();
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if ((e.key === 'Enter' || e.key === ' ') && target.matches(INTERACTIVE) && !quiet(target)) {
      sound('click', profile.muted);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && target.matches('input[type="text"], input:not([type]), input[type="search"], input[type="password"], input[type="email"], textarea')) {
      sound('key', profile.muted);
    }
  }, true);

  let hovered: Element | null = null;
  let lastHover = 0;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = (e.target as Element | null)?.closest?.(HOVERABLE) ?? null;
    if (el === hovered) return;
    hovered = el;
    const now = performance.now();
    if (el && !(el as HTMLButtonElement).disabled && now - lastHover > 70) {
      lastHover = now;
      sound('hover', profile.muted);
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.type === 'checkbox' || el.type === 'radio') sound('toggle', profile.muted);
  });

  let lastSlide = 0;
  document.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const now = performance.now();
    if (el.type === 'range' && now - lastSlide > 70) {
      lastSlide = now;
      sound('slide', profile.muted);
    }
  });

  window.addEventListener('hashchange', () => sound('page', profile.muted));
}
