import { describe, expect, it } from 'vitest';
import { BARS_PER_CHORD, TRACKS, composeBar, layerLevels } from '../src/audio/compose';

describe('background music', () => {
  it('has six tracks at a calm focus tempo', () => {
    expect(TRACKS).toHaveLength(6);
    for (const t of TRACKS) {
      expect(t.bpm).toBeGreaterThanOrEqual(70);
      expect(t.bpm).toBeLessThanOrEqual(78);
      expect(t.chords.length).toBe(t.bass.length);
      expect(t.chords.length).toBe(t.melody.length);
    }
    expect(new Set(TRACKS.map((t) => t.name)).size).toBe(6);
  });

  it('only plays notes from each track’s key', () => {
    for (const t of TRACKS) {
      for (let bar = 0; bar < t.bars; bar++) {
        for (const ev of composeBar(t, bar)) expect(t.scale).toContain(ev.midi % 12);
      }
    }
  });

  it('changes chord every two bars and stays sparse', () => {
    for (const t of TRACKS) {
      for (let bar = 0; bar < t.bars; bar++) {
        const events = composeBar(t, bar);
        const pads = events.filter((e) => e.voice === 'pad');
        if (bar % BARS_PER_CHORD !== 0) expect(pads).toHaveLength(0);
        expect(events.filter((e) => e.voice === 'piano').length).toBeLessThanOrEqual(3);
        for (const e of events) {
          expect(e.vel).toBeGreaterThan(0);
          expect(e.vel).toBeLessThanOrEqual(1);
          expect(e.at).toBeGreaterThanOrEqual(0);
          expect(e.at).toBeLessThan(4);
        }
      }
    }
  });

  it('fades layers in and out instead of starting them suddenly', () => {
    for (const t of TRACKS) {
      expect(layerLevels(t, 0).piano).toBe(0);
      expect(layerLevels(t, 0).pad).toBeGreaterThan(0);
      expect(layerLevels(t, 20).piano).toBe(1);
      expect(layerLevels(t, t.bars - 1).pad).toBeLessThan(0.5);
      // Never more than five layers, counting the noise bed.
      const layers = Object.values(layerLevels(t, 24)).filter((v) => v > 0).length + 1;
      expect(layers).toBeLessThanOrEqual(5);
    }
  });

  it('repeats its piano phrase so the music fades into the background', () => {
    const t = TRACKS[0]!;
    const piano = (bar: number) => composeBar(t, bar).filter((e) => e.voice === 'piano').map((e) => [e.at, e.midi]);
    expect(piano(24)).toEqual(piano(16));
    expect(composeBar(t, 10)).toEqual(composeBar(t, 10));
  });
});
