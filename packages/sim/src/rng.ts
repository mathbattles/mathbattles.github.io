/** Small seeded PRNG so maps, bots, and replays reproduce exactly from a seed. */
export class Rng {
  private s: number;
  private spare: number | null = null;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  gaussian(): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    let r = 0;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      r = u * u + v * v;
    } while (r === 0 || r >= 1);
    const m = Math.sqrt((-2 * Math.log(r)) / r);
    this.spare = v * m;
    return u * m;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }
}

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
