import type { NetSession } from './session';

/**
 * Keeps the room you're sitting in open while you look at other pages before the match starts.
 * The Room screen gets its connection from here instead of owning it, so leaving the page no
 * longer leaves the room. Leaving for real (the Leave button, joining another room, the room
 * closing) lets it go.
 */
interface Held {
  code: string;
  watch: boolean;
  ranked: boolean;
  session: NetSession;
}

let held: Held | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let unsub: (() => void) | null = null;

export function subscribeRoom(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The room being held, if any. */
export function heldRoom(): Readonly<Held> | null {
  return held;
}

/** The connection for this room: the one already open, or a new one (closing any other room). */
export function holdRoom(code: string, opts: { watch: boolean; ranked: boolean }, make: () => NetSession): NetSession {
  const key = code.toUpperCase();
  if (held && held.code === key && held.watch === opts.watch && held.session.status !== 'closed') return held.session;
  releaseRoom();
  const session = make();
  held = { code: key, watch: opts.watch, ranked: opts.ranked, session };
  unsub = session.subscribe(emit);
  emit();
  return session;
}

/** Leaves the held room for real. */
export function releaseRoom(): void {
  if (!held) return;
  const h = held;
  held = null;
  unsub?.();
  unsub = null;
  h.session.dispose();
  emit();
}

/**
 * Called when the Room screen goes away. Only a room lobby you're sitting in stays open; a match
 * in progress, a ranked room, or a room you were watching is left as before.
 */
export function roomScreenClosed(session: NetSession): void {
  if (!held || held.session !== session) return;
  if (held.watch || held.ranked || session.status !== 'lobby') releaseRoom();
}
