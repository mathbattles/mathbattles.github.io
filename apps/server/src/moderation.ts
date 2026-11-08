// Short starter lists. Reports cover what they miss.
// Long, unambiguous words are blocked anywhere inside a word.
const BLOCKED_ANYWHERE = ['fuck', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'asshole', 'pussy', 'motherf', 'dickhead', 'wanker'];
// Short words appear inside innocent words ("Skysurfer", "Slutsky"), so these must match exactly.
const BLOCKED_EXACT = ['retard', 'whore', 'slut', 'kys', 'dick', 'cock', 'fag', 'rape', 'ass', 'bastard', 'porn', 'sex', 'twat'];

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
  // Stretched spellings ("fuuuck") are checked with repeated letters squeezed down too.
  const squeeze = (t: string) => t.replace(/(.)\1+/g, '$1');
  const squeezed = squeeze(n);
  for (const form of [n, squeezed]) {
    if (BLOCKED_ANYWHERE.some((b) => form.includes(b) || form.includes(squeeze(b)))) return true;
    if (BLOCKED_EXACT.some((b) => form === b || form === `${b}s`)) return true;
  }
  return false;
}

// Control and formatting characters, direction overrides, and blank-looking letters.
const INVISIBLE = /[\p{Cc}\p{Cf}ᅟᅠ⠀ㅤﾠ]/gu;

function strip(text: string): string {
  return text.replace(INVISIBLE, '');
}

export function cleanChat(text: string, max = 140): string {
  const t = strip(text).trim().replace(/\s{3,}/g, '  ').slice(0, max);
  return t
    .split(/(\s+)/)
    .map((w) => (isBlocked(w) ? '#'.repeat(w.length) : w))
    .join('');
}

export function cleanName(name: unknown): string {
  const t = strip(String(name ?? '')).trim().slice(0, 16);
  if (!t || isBlockedName(t)) return `Player${Math.floor(Math.random() * 9000) + 1000}`;
  return t;
}

/** Names have no reliable word breaks, so check the whole name and each part of it. */
export function isBlockedName(name: string): boolean {
  return isBlocked(name) || name.split(/[\s_]+/).some(isBlocked);
}
