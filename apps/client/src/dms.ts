/** Which direct message chats are open, and which are minimized. Up to three at a time. */
export interface OpenChat {
  name: string;
  minimized: boolean;
}

export const MAX_OPEN_CHATS = 3;
const KEY = 'mathbattles.openChats';
const listeners = new Set<() => void>();

function load(): OpenChat[] {
  try {
    const list = JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as OpenChat[];
    return Array.isArray(list) ? list.filter((c) => typeof c?.name === 'string').slice(0, MAX_OPEN_CHATS) : [];
  } catch {
    return [];
  }
}

let chats: OpenChat[] = load();

function save(next: OpenChat[]): void {
  chats = next;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(chats));
  } catch {
    /* no storage */
  }
  listeners.forEach((l) => l());
}

export function openChats(): OpenChat[] {
  return chats;
}

export function subscribeChats(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Opens a chat, or brings an open one back up. Returns false when three are already open. */
export function openChat(name: string): boolean {
  const lc = name.toLowerCase();
  if (chats.some((c) => c.name.toLowerCase() === lc)) {
    save(chats.map((c) => (c.name.toLowerCase() === lc ? { ...c, minimized: false } : c)));
    return true;
  }
  if (chats.length >= MAX_OPEN_CHATS) return false;
  save([...chats, { name, minimized: false }]);
  return true;
}

export function closeChat(name: string): void {
  save(chats.filter((c) => c.name !== name));
}

export function toggleMinimized(name: string): void {
  save(chats.map((c) => (c.name === name ? { ...c, minimized: !c.minimized } : c)));
}
