/**
 * The six background tracks, written as notes. Nothing here makes sound, so it can be tested.
 *
 * The style follows published guidance for focus music: about 75 BPM, warm major keys,
 * one chord every two bars, three to five layers (soft pad, sparse piano, sub bass, plus
 * glass bells on one track), long fades between sections, and phrases that repeat
 * so the music fades into the background.
 */

export type Voice = 'pad' | 'piano' | 'bass' | 'bell';

export interface NoteEvent {
  voice: Voice;
  midi: number;
  /** Beats from the start of the bar. */
  at: number;
  /** Length in beats. */
  dur: number;
  /** 0 to 1. */
  vel: number;
}

export interface Track {
  name: string;
  bpm: number;
  /** Scale notes as MIDI pitch classes, used for the melody. */
  scale: number[];
  /** Pad voicings, one per chord, as MIDI notes. */
  chords: number[][];
  /** The low note under each chord. */
  bass: number[];
  /** Melody notes the piano may use under each chord. */
  melody: number[][];
  /** Glass bells join the piano. */
  bells: boolean;
  seed: number;
  /** Length in bars before the next track starts. */
  bars: number;
  /** How many of the piano's notes play, from 0 to 1. Lower is sparser and more spacious. */
  pianoDensity?: number;
}

export const BEATS_PER_BAR = 4;
export const BARS_PER_CHORD = 2;

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const scaleOf = (root: number) => MAJOR.map((s) => (root + s) % 12);

export const TRACKS: Track[] = [
  {
    // D major: Dmaj7, Bm7(add11), Gmaj7, A6.
    name: 'Margin Notes',
    bpm: 75,
    scale: scaleOf(2),
    chords: [[54, 57, 61, 64], [54, 57, 62, 64], [55, 59, 62, 66], [52, 57, 61, 66]],
    bass: [38, 35, 31, 33],
    melody: [[66, 69, 73, 74, 76], [66, 69, 71, 74, 76], [67, 71, 74, 76, 78], [69, 71, 73, 76, 78]],
    bells: false,
    seed: 11,
    bars: 48,
  },
  {
    // F major: Fmaj9, Am7, Dm9, Bbmaj7.
    name: 'Slow Orbit',
    bpm: 72,
    scale: scaleOf(5),
    chords: [[57, 60, 64, 67], [55, 60, 64, 69], [57, 60, 64, 65], [58, 62, 65, 69]],
    bass: [41, 33, 38, 34],
    melody: [[69, 72, 76, 77, 79], [67, 69, 72, 76, 79], [69, 72, 74, 76, 77], [69, 70, 74, 77, 79]],
    bells: false,
    seed: 23,
    bars: 48,
  },
  {
    // A major: Amaj9, F#m7, Dmaj9, Esus4(add9). Glass bells on top.
    name: 'Glass Grid',
    bpm: 78,
    scale: scaleOf(9),
    chords: [[56, 59, 61, 64], [57, 61, 64, 66], [54, 57, 61, 64], [57, 59, 64, 66]],
    bass: [33, 30, 38, 28],
    melody: [[68, 71, 73, 76, 80], [69, 73, 76, 78, 81], [66, 69, 73, 76, 78], [69, 71, 76, 78, 83]],
    bells: true,
    seed: 37,
    bars: 48,
  },
  {
    // E-flat major, warm and low: Ebmaj9, Cm7, Abmaj7, Bbsus4.
    name: 'Chalk Dust',
    bpm: 70,
    scale: scaleOf(3),
    chords: [[55, 58, 62, 65], [55, 58, 60, 63], [56, 60, 63, 67], [53, 58, 63, 65]],
    bass: [39, 36, 32, 34],
    melody: [[67, 70, 74, 75, 77], [67, 70, 72, 75, 79], [68, 72, 75, 79, 80], [70, 72, 75, 77, 82]],
    bells: false,
    seed: 51,
    bars: 48,
    pianoDensity: 0.85,
  },
  {
    // G major, brighter, with glass bells: Gmaj7, Em9, Cmaj9, D6.
    name: 'Quiet Proof',
    bpm: 76,
    scale: scaleOf(7),
    chords: [[55, 59, 62, 66], [52, 59, 62, 66], [52, 55, 59, 62], [54, 57, 59, 62]],
    bass: [43, 40, 36, 38],
    melody: [[67, 71, 74, 78, 79], [66, 67, 71, 74, 76], [64, 67, 71, 72, 76], [66, 69, 71, 74, 78]],
    bells: true,
    seed: 67,
    bars: 48,
  },
  {
    // C major, leaning on its relative minor, slow and spacious: Am9, Fmaj7, Cmaj7, G6.
    name: 'Night Shift',
    bpm: 74,
    scale: scaleOf(0),
    chords: [[55, 59, 60, 64], [53, 57, 60, 64], [52, 55, 59, 64], [55, 59, 62, 64]],
    bass: [33, 29, 36, 31],
    melody: [[64, 67, 69, 71, 72], [64, 65, 69, 72, 76], [64, 67, 71, 72, 76], [62, 64, 67, 71, 74]],
    bells: false,
    seed: 83,
    bars: 48,
    pianoDensity: 0.7,
  },
];

/** A small seeded random number generator, so each track is always the same. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rhythms for one bar of piano, in beats. Sparse on purpose. */
const RHYTHMS = [[0, 2.5], [0.5, 2], [0, 1.5, 3], [1], [0, 3], [], [0.5, 2.5], [2]];

interface Phrase {
  /** Per bar of an 8-bar phrase: [beat, melody index] pairs. */
  bars: [number, number][][];
}

const phraseCache = new Map<Track, Phrase>();

/**
 * One 8-bar piano phrase per track. It repeats through the track, with a small change
 * at the end of every other phrase, so the ear knows what's coming.
 */
function phraseFor(track: Track): Phrase {
  const cached = phraseCache.get(track);
  if (cached) return cached;
  const r = rng(track.seed);
  const bars: [number, number][][] = [];
  let idx = 2;
  for (let b = 0; b < 8; b++) {
    let rhythm = RHYTHMS[Math.floor(r() * RHYTHMS.length)]!;
    // Sparser tracks drop some notes. Tracks without a density keep their exact notes.
    const density = track.pianoDensity;
    if (density !== undefined && density < 1) rhythm = rhythm.filter((_, k) => k === 0 || r() < density);
    bars.push(rhythm.map((beat) => {
      // Small steps up or down, so the line is smooth.
      idx = Math.max(0, Math.min(4, idx + Math.floor(r() * 3) - 1));
      return [beat, idx];
    }));
  }
  // The phrase always ends on a long, settled note.
  bars[7] = [[0, 2]];
  const phrase = { bars };
  phraseCache.set(track, phrase);
  return phrase;
}

/** How loud each layer is in a bar, from 0 to 1. Layers fade in and out over several bars. */
export function layerLevels(track: Track, bar: number): Record<Voice, number> {
  const end = track.bars;
  const ramp = (from: number, len: number) => Math.max(0, Math.min(1, (bar - from + 1) / len));
  const fadeOut = (len: number) => Math.max(0, Math.min(1, (end - bar) / len));
  return {
    pad: Math.min(ramp(0, 4), fadeOut(4)),
    bass: Math.min(ramp(4, 8), fadeOut(6)),
    piano: Math.min(ramp(8, 4), fadeOut(10)),
    bell: track.bells ? Math.min(ramp(16, 8), fadeOut(12)) : 0,
  };
}

/** Every note that starts in one bar of a track. */
export function composeBar(track: Track, bar: number): NoteEvent[] {
  const events: NoteEvent[] = [];
  const level = layerLevels(track, bar);
  const chord = Math.floor(bar / BARS_PER_CHORD) % track.chords.length;
  const chordStart = bar % BARS_PER_CHORD === 0;
  const chordBeats = BEATS_PER_BAR * BARS_PER_CHORD;

  if (chordStart && level.pad > 0) {
    for (const midi of track.chords[chord]!) events.push({ voice: 'pad', midi, at: 0, dur: chordBeats, vel: 0.8 * level.pad });
  }
  if (chordStart && level.bass > 0) {
    events.push({ voice: 'bass', midi: track.bass[chord]!, at: 0, dur: chordBeats, vel: 0.85 * level.bass });
  }
  if (level.piano > 0) {
    const phrase = phraseFor(track);
    const inPhrase = bar % 8;
    const cycle = Math.floor(bar / 8);
    let notes = phrase.bars[inPhrase]!;
    // Every other phrase answers with a different last-but-one bar.
    if (cycle % 2 === 1 && inPhrase === 6) notes = notes.map(([beat, i]) => [beat, Math.min(4, i + 1)] as [number, number]);
    const pool = track.melody[chord]!;
    for (const [beat, i] of notes) {
      const accent = beat === 0 ? 1 : 0.8;
      events.push({ voice: 'piano', midi: pool[i]!, at: beat, dur: 3, vel: 0.7 * accent * level.piano });
    }
  }
  if (level.bell > 0 && bar % 2 === 1) {
    // A soft, slow figure of high chord tones, like distant glass.
    const top = track.chords[chord]!.map((m) => m + 24);
    const pick = (bar >> 1) % top.length;
    events.push({ voice: 'bell', midi: top[pick]!, at: 1, dur: 4, vel: 0.5 * level.bell });
    events.push({ voice: 'bell', midi: top[(pick + 2) % top.length]!, at: 2.5, dur: 4, vel: 0.35 * level.bell });
  }
  return events;
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
