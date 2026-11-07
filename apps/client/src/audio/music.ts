import { BEATS_PER_BAR, TRACKS, composeBar, midiToHz, type NoteEvent } from './compose';
import { audioContext, musicBus } from './engine';

export { TRACKS };

/** Instruments and mixing for the background music. Works with live or offline audio contexts. */
export class MusicMixer {
  readonly input: GainNode;
  private reverb: ConvolverNode;
  private noiseGain: GainNode;
  private noiseSrc: AudioBufferSourceNode | null = null;

  constructor(private ctx: BaseAudioContext, destination: AudioNode) {
    // Mastering, following the focus-music guidance: cut rumble below 30 Hz, soften
    // the harsh 2-5 kHz range a little, roll off the very top, and keep peaks gentle.
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 30;
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 3500;
    presence.Q.value = 0.8;
    presence.gain.value = -3;
    const top = ctx.createBiquadFilter();
    top.type = 'lowpass';
    top.frequency.value = 14000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.05;
    comp.release.value = 0.4;
    this.input = ctx.createGain();
    this.input.gain.value = 0.9;
    this.input.connect(highpass).connect(presence).connect(top).connect(comp).connect(destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.input);

    // A faint, steady bed of brown noise that covers small sounds around the player.
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 700;
    this.noiseGain.connect(noiseFilter).connect(this.input);
  }

  /** A soft room: decaying noise, nearly the same in both ears so the sound stays narrow. */
  private impulse(seconds: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    const left = buf.getChannelData(0);
    const right = buf.getChannelData(1);
    let lowL = 0;
    let lowR = 0;
    for (let i = 0; i < len; i++) {
      const decay = Math.pow(1 - i / len, 3.2);
      const shared = Math.random() * 2 - 1;
      // Smoothing darkens the tail, like a warm room rather than a bright hall.
      lowL += ((shared * 0.8 + (Math.random() * 2 - 1) * 0.2) - lowL) * 0.35;
      lowR += ((shared * 0.8 + (Math.random() * 2 - 1) * 0.2) - lowR) * 0.35;
      left[i] = lowL * decay;
      right[i] = lowR * decay;
    }
    return buf;
  }

  startNoise(at: number): void {
    if (this.noiseSrc) return;
    const rate = this.ctx.sampleRate;
    const len = rate * 6;
    const buf = this.ctx.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    // Blend the end into the start so the loop has no click.
    const blend = Math.floor(rate * 0.25);
    for (let i = 0; i < blend; i++) {
      const k = i / blend;
      data[i] = data[i]! * k + data[len - blend + i]! * (1 - k);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = (len - blend) / rate;
    src.connect(this.noiseGain);
    src.start(at);
    // About -35 dBFS: felt more than heard.
    this.noiseGain.gain.setValueAtTime(0, at);
    this.noiseGain.gain.linearRampToValueAtTime(0.02, at + 6);
    this.noiseSrc = src;
  }

  stopNoise(at: number): void {
    this.noiseGain.gain.cancelScheduledValues(at);
    this.noiseGain.gain.setTargetAtTime(0, at, 0.3);
    this.noiseSrc?.stop(at + 2);
    this.noiseSrc = null;
  }

  /** Plays one note at a time on the audio clock. */
  play(ev: NoteEvent, barStart: number, beat: number): void {
    const t = barStart + ev.at * beat;
    const dur = ev.dur * beat;
    if (ev.voice === 'pad') this.pad(ev.midi, t, dur, ev.vel);
    else if (ev.voice === 'piano') this.piano(ev.midi, t, ev.vel);
    else if (ev.voice === 'bass') this.bass(ev.midi, t, dur, ev.vel);
    else this.bell(ev.midi, t, ev.vel);
  }

  private send(node: AudioNode, dry: number, wet: number): void {
    const d = this.ctx.createGain();
    d.gain.value = dry;
    node.connect(d).connect(this.input);
    const w = this.ctx.createGain();
    w.gain.value = wet;
    node.connect(w).connect(this.reverb);
  }

  /** Warm strings of sound: two slightly detuned saws through a dark filter, slow in and out. */
  private pad(midi: number, t: number, dur: number, vel: number): void {
    const c = this.ctx;
    const f = midiToHz(midi);
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(500, t);
    filter.frequency.linearRampToValueAtTime(900, t + dur * 0.5);
    filter.frequency.linearRampToValueAtTime(600, t + dur);
    filter.Q.value = 0.5;
    const env = c.createGain();
    const attack = 1.8;
    const release = 2.6;
    const peak = 0.045 * vel;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + attack);
    env.gain.setValueAtTime(peak, t + dur);
    env.gain.linearRampToValueAtTime(0, t + dur + release);
    filter.connect(env);
    this.send(env, 0.7, 0.6);
    for (const [cents, pan] of [[-7, -0.15], [7, 0.15]] as const) {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = cents;
      const p = c.createStereoPanner();
      p.pan.value = pan;
      osc.connect(p).connect(filter);
      osc.start(t);
      osc.stop(t + dur + release + 0.1);
    }
  }

  /** A soft, felted piano: a few sine partials, a quick start and a long fade. */
  private piano(midi: number, t: number, vel: number): void {
    const c = this.ctx;
    const f = midiToHz(midi);
    const env = c.createGain();
    const peak = 0.13 * vel;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.012);
    env.gain.exponentialRampToValueAtTime(peak * 0.35, t + 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
    const tone = c.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    env.connect(tone);
    this.send(tone, 0.6, 0.75);
    for (const [mult, level, decay] of [[1, 1, 3.6], [2, 0.32, 1.6], [3, 0.1, 0.8]] as const) {
      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * mult;
      const g = c.createGain();
      g.gain.setValueAtTime(level, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      osc.connect(g).connect(env);
      osc.start(t);
      osc.stop(t + 3.7);
    }
  }

  /** A deep sine with a quiet octave above it, so small speakers still carry it. */
  private bass(midi: number, t: number, dur: number, vel: number): void {
    const c = this.ctx;
    const f = midiToHz(midi);
    const env = c.createGain();
    const peak = 0.07 * vel;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.8);
    env.gain.setValueAtTime(peak, t + dur - 0.4);
    env.gain.linearRampToValueAtTime(0, t + dur + 1);
    this.send(env, 1, 0.05);
    for (const [mult, level] of [[1, 1], [2, 0.18]] as const) {
      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * mult;
      const g = c.createGain();
      g.gain.value = level;
      osc.connect(g).connect(env);
      osc.start(t);
      osc.stop(t + dur + 1.1);
    }
  }

  /** A struck glass: a pure tone plus out-of-tune overtones that fade fast. */
  private bell(midi: number, t: number, vel: number): void {
    const c = this.ctx;
    const f = midiToHz(midi);
    const env = c.createGain();
    const peak = 0.05 * vel;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
    this.send(env, 0.35, 1);
    for (const [mult, level, decay] of [[1, 1, 4.5], [2.76, 0.28, 1.4], [5.4, 0.1, 0.6]] as const) {
      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * mult;
      const g = c.createGain();
      g.gain.setValueAtTime(level, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      osc.connect(g).connect(env);
      osc.start(t);
      osc.stop(t + 4.6);
    }
  }
}

/** Schedules bars a few seconds ahead, which keeps timing steady even if the page is busy. */
const LOOKAHEAD = 3;

class MusicPlayer {
  private mixer: MusicMixer | null = null;
  private timer = 0;
  private track = 0;
  private bar = 0;
  private nextBar = 0;
  private playing = false;
  /** -1 plays every track in turn. */
  private repeat = -1;

  get current(): number {
    return this.track;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** Starts from a track's beginning: a given one on repeat, or -1 for all in order. */
  play(choice: number): void {
    this.repeat = choice;
    const next = choice >= 0 ? choice : this.track;
    if (this.playing && next === this.track && choice === -1) return;
    this.stop();
    this.track = next;
    this.bar = 0;
    this.start();
  }

  /** Continues where it left off. */
  start(): void {
    if (this.playing) return;
    const ctx = audioContext();
    const out = musicBus();
    if (!ctx || !out) return;
    this.mixer ??= new MusicMixer(ctx, out);
    this.playing = true;
    this.nextBar = ctx.currentTime + 0.2;
    this.mixer.input.gain.cancelScheduledValues(ctx.currentTime);
    this.mixer.input.gain.setTargetAtTime(0.9, ctx.currentTime, 0.4);
    this.mixer.startNoise(ctx.currentTime);
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 250);
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    const ctx = audioContext();
    if (ctx && this.mixer) {
      // Notes already scheduled keep playing but fade out under the master level.
      this.mixer.input.gain.cancelScheduledValues(ctx.currentTime);
      this.mixer.input.gain.setTargetAtTime(0, ctx.currentTime, 0.35);
      this.mixer.stopNoise(ctx.currentTime);
      // Old notes must not carry on once music resumes, so start the next one fresh.
      const old = this.mixer;
      this.mixer = null;
      window.setTimeout(() => old.input.disconnect(), 6000);
    }
  }

  private tick(): void {
    const ctx = audioContext();
    if (!ctx || !this.mixer) return;
    // After a long pause in a hidden tab, skip ahead rather than playing a pile of notes at once.
    if (this.nextBar < ctx.currentTime) this.nextBar = ctx.currentTime + 0.1;
    while (this.nextBar < ctx.currentTime + LOOKAHEAD) {
      const track = TRACKS[this.track]!;
      const beat = 60 / track.bpm;
      for (const ev of composeBar(track, this.bar)) this.mixer.play(ev, this.nextBar, beat);
      this.nextBar += beat * BEATS_PER_BAR;
      this.bar++;
      if (this.bar >= track.bars) {
        this.bar = 0;
        if (this.repeat < 0) this.track = (this.track + 1) % TRACKS.length;
        // A short breath between tracks while the last chord rings out.
        this.nextBar += beat * 2;
      }
    }
  }
}

export const music = new MusicPlayer();
