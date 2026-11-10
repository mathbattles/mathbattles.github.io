import { Rng } from './rng';

/** The first four players get these, in order. Everyone after gets a random colour. */
export const PALETTE = [
  { name: 'Blue', hex: '#2b50e8' },
  { name: 'Red', hex: '#ee3a57' },
  { name: 'Green', hex: '#1f9e4a' },
  { name: 'Yellow', hex: '#e8a400' },
] as const;

/** Colours players can pick on a shared device, beyond the first four. */
export const PICKABLE_COLORS = [
  ...PALETTE.map((p) => p.hex),
  '#8a3ff0', // purple
  '#ff7a1a', // orange
  '#12a6b8', // teal
  '#e83fb4', // pink
  '#7a5230', // brown
  '#5c6b7a', // slate
];

/** Ring colours that show which side a player is on in team matches. */
export const TEAM_RING = { 1: '#2b50e8', 2: '#ee3a57' } as const;

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
}

function hueOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function hslHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * One colour per player: chosen colours are kept when they're free, then the palette in order,
 * then random hues from the seed, each as far as possible from the hues already in use.
 */
export function assignColors(wanted: (string | undefined)[], seed: number): string[] {
  const rng = new Rng((seed ^ 0x5bd1e995) >>> 0);
  const used = new Set<string>();
  const out: (string | undefined)[] = wanted.map((w) => {
    if (isHexColor(w) && !used.has(w.toLowerCase())) {
      used.add(w.toLowerCase());
      return w.toLowerCase();
    }
    return undefined;
  });
  let next = 0;
  for (let i = 0; i < out.length; i++) {
    if (out[i]) continue;
    while (next < PALETTE.length && used.has(PALETTE[next]!.hex)) next++;
    if (next < PALETTE.length) {
      out[i] = PALETTE[next]!.hex;
      used.add(out[i]!);
      next++;
      continue;
    }
    const hues = [...used].map(hueOf);
    let best = 0;
    let bestGap = -1;
    for (let k = 0; k < 24; k++) {
      const h = rng.next() * 360;
      const gap = Math.min(...hues.map((u) => hueGap(u, h)));
      if (gap > bestGap) {
        bestGap = gap;
        best = h;
      }
    }
    const color = hslHex(best, 0.72, 0.42 + rng.next() * 0.1);
    out[i] = color;
    used.add(color);
  }
  return out as string[];
}

/** Mixes two colours half and half, for beams made by two shots. */
export function mixColors(a: string, b: string): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round((((pa >> shift) & 255) + ((pb >> shift) & 255)) / 2).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}
