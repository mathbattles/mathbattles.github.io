/** One audio context for the whole game, with separate volume controls for effects and music. */

let ctx: AudioContext | null = null;
let sfx: GainNode | null = null;
let musicOut: GainNode | null = null;
let sfxLevel = 0.8;
let musicLevel = 0.45;

/** Volume sliders feel even when the level is squared. */
const curve = (v: number) => Math.max(0, Math.min(1, v)) ** 2;

export function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    // 32 kHz covers everything the game plays (the music is filtered above 14 kHz) for about
    // a third less audio work, and a slightly larger buffer means fewer wake-ups.
    try {
      ctx = new Ctor({ sampleRate: 32000, latencyHint: 'balanced' });
    } catch {
      ctx = new Ctor();
    }
    sfx = ctx.createGain();
    sfx.gain.value = curve(sfxLevel) * 1.25;
    sfx.connect(ctx.destination);
    musicOut = ctx.createGain();
    musicOut.gain.value = curve(musicLevel);
    musicOut.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Where sound effects connect. */
export function sfxBus(): GainNode | null {
  audioContext();
  return sfx;
}

/** Where music connects. */
export function musicBus(): GainNode | null {
  audioContext();
  return musicOut;
}

export function setVolumes(effects: number, music: number): void {
  sfxLevel = effects;
  musicLevel = music;
  if (!ctx || !sfx || !musicOut) return;
  const t = ctx.currentTime;
  sfx.gain.setTargetAtTime(curve(effects) * 1.25, t, 0.05);
  musicOut.gain.setTargetAtTime(curve(music), t, 0.15);
}

/** Browsers start audio suspended until the player clicks or presses a key. */
export function unlockAudio(): void {
  const c = audioContext();
  if (c && c.state === 'suspended') void c.resume().catch(() => {});
}
