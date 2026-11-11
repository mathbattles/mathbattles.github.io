import { useEffect, useState } from 'preact/hooks';
import { Icon } from './Icons';

/** Short messages that fade in, stay a moment, then fade out: errors and quick confirmations. */
export interface Notice {
  id: number;
  text: string;
  kind: 'error' | 'ok' | 'info';
  leaving: boolean;
}

let notices: Notice[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const SHOW_MS = 3800;
const FADE_MS = 450;

/** Shows a short message. The same text again just restarts its timer. */
export function notify(text: string, kind: Notice['kind'] = 'error'): void {
  if (!text) return;
  const same = notices.find((n) => n.text === text && !n.leaving);
  const id = same?.id ?? nextId++;
  if (!same) notices = [...notices.slice(-3), { id, text, kind, leaving: false }];
  emit();
  const key = `t${id}`;
  clearTimeout((timers as Record<string, number>)[key]);
  (timers as Record<string, number>)[key] = window.setTimeout(() => {
    notices = notices.map((n) => (n.id === id ? { ...n, leaving: true } : n));
    emit();
    window.setTimeout(() => {
      notices = notices.filter((n) => n.id !== id);
      emit();
    }, FADE_MS);
  }, SHOW_MS);
}
const timers: Record<string, number> = {};

/** The stack of notices, near the top of the screen. */
export function Notices() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  if (!notices.length) return null;
  return (
    <div class="notices" aria-live="polite">
      {notices.map((n) => (
        <div class={`notice ${n.kind} ${n.leaving ? 'leaving' : ''}`} role={n.kind === 'error' ? 'alert' : 'status'} key={n.id}>
          <Icon name={n.kind === 'error' ? 'close' : 'check'} />
          <span>{n.text}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * An inline message that fades out instead of vanishing when its text is cleared.
 * It keeps showing the last text while it fades.
 */
export function FadeText({ text, kind = 'error' }: { text: string; kind?: 'error' | 'ok' }) {
  const [shown, setShown] = useState(text);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (text) {
      setShown(text);
      setLeaving(false);
      return;
    }
    if (!shown) return;
    setLeaving(true);
    const id = window.setTimeout(() => {
      setShown('');
      setLeaving(false);
    }, FADE_MS);
    return () => clearTimeout(id);
  }, [text]);
  if (!shown) return null;
  return <p class={`${kind} fade-text ${leaving ? 'leaving' : ''}`} role={kind === 'error' ? 'alert' : 'status'}>{shown}</p>;
}
