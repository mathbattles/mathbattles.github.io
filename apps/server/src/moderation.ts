// A short starter list, matched on whole words after simple letter swaps. Reports cover what it misses.
const BLOCKED = ['fuck', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut', 'kys'];

function normalize(word: string): string {
  return word
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1|!/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4|@/g, 'a')
    .replace(/5|\$/g, 's')
    .replace(/[^a-z]/g, '');
}

function isBlocked(word: string): boolean {
  const n = normalize(word);
  return BLOCKED.some((b) => n === b || n === `${b}s` || n === `${b}ing` || n === `${b}er`);
}

function strip(text: string): string {
  // Removes control characters and direction overrides that can disguise text.
  return text.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '');
}

export function cleanChat(text: string): string {
  const t = strip(text).trim().slice(0, 140);
  return t
    .split(/(\s+)/)
    .map((w) => (isBlocked(w) ? '#'.repeat(w.length) : w))
    .join('');
}

export function cleanName(name: unknown): string {
  const t = strip(String(name ?? '')).trim().slice(0, 16);
  if (!t || t.split(/\s+/).some(isBlocked)) return `Player${Math.floor(Math.random() * 9000) + 1000}`;
  return t;
}

/** Catches blocked words inside a username, where no spaces separate them. */
export function isBlockedName(name: string): boolean {
  const n = normalize(name);
  return BLOCKED.some((b) => n.includes(b));
}
