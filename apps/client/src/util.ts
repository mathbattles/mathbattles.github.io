import { audioContext, sfxBus } from './audio/engine';

/** Turns a typed function into TeX for the preview. Display only: never used for the math. */
export function exprToTex(src: string): string {
  let s = src.toLowerCase().replace(/\s+/g, '').replace(/,/g, '.');
  s = s.replace(/[\\{}$%&#_~]/g, '');
  s = s.replace(/sqrt|sen|sin|cos|tan|tg|ln|log|exp|abs|pi|\*/g, (m) => {
    switch (m) {
      case 'sqrt': return '\\operatorname{sqrt}';
      case 'sen':
      case 'sin': return '\\sin ';
      case 'cos': return '\\cos ';
      case 'tg':
      case 'tan': return '\\tan ';
      case 'ln': return '\\ln ';
      case 'log': return '\\log ';
      case 'exp': return '\\exp ';
      case 'abs': return '\\operatorname{abs}';
      case 'pi': return '\\pi ';
      default: return '\\cdot ';
    }
  });
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c !== '^') {
      out += c;
      continue;
    }
    let j = i + 1;
    if (s[j] === '-') j++;
    if (s[j] === '(') {
      let depth = 0;
      let k = j;
      for (; k < s.length; k++) {
        if (s[k] === '(') depth++;
        if (s[k] === ')' && --depth === 0) break;
      }
      out += `^{${s.slice(i + 1, k + 1)}}`;
      i = k;
    } else {
      let k = j;
      while (k < s.length && /[0-9.a-z']/.test(s[k]!)) k++;
      out += `^{${s.slice(i + 1, k)}}`;
      i = k - 1;
    }
  }
  return out;
}

export function modeLabel(mode: string): string {
  return mode === 'ode1' ? "y' =" : mode === 'ode2' ? "y'' =" : 'y =';
}

export function modeName(mode: string): string {
  return mode === 'ode1' ? "First-order y'" : mode === 'ode2' ? "Second-order y''" : 'Function y';
}

export function go(path: string): void {
  location.hash = path;
}

export type SoundKind =
  | 'fire' | 'boom' | 'kill' | 'turn' | 'tick' | 'go' | 'win' | 'lose'
  | 'click' | 'hover' | 'toggle' | 'page' | 'buy' | 'equip' | 'error' | 'slide' | 'open' | 'close' | 'key'
  | 'lock' | 'unlock' | 'beam' | 'luck'
  | 'hopLaunch' | 'hopOver' | 'hopLand' | 'hopKill' | 'hopOut' | 'ricochet' | 'heavy' | 'beamCut'
  | 'energyFull' | 'energyTick' | 'abilityOpen' | 'abilitySelect' | 'noEnergy'
  | 'nav' | 'press' | 'tap' | 'dropdown' | 'choose' | 'mathkey' | 'chatSend' | 'chatReceive' | 'claim'
  | 'rankUp' | 'rankDown' | 'place' | 'rotate';

/**
 * Every sound plays with a little natural variation: a random pitch nudge, and for the most
 * common sounds one of several versions, so repeating an action never sounds identical.
 */
let pitch = 1;
let variant = 0;

let out: AudioNode | null = null;

function tone(ctx: AudioContext, type: OscillatorType, from: number, to: number, dur: number, vol: number, delay = 0): void {
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain).connect(out ?? ctx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(from * pitch, t);
  osc.frequency.exponentialRampToValueAtTime(to * pitch, t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.start(t);
  osc.stop(t + dur);
}

let noiseBuffer: AudioBuffer | null = null;

/** A burst of filtered noise that fades out. One shared second of noise serves every sound. */
function noise(ctx: AudioContext, dur: number, vol: number, cutoff: number, delay = 0): void {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff * pitch;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.linearRampToValueAtTime(0, t + dur);
  src.connect(filter).connect(gain).connect(out ?? ctx.destination);
  // A random starting point, so repeated sounds don't sound identical.
  src.start(t, Math.random() * Math.max(0, 1 - dur), dur);
}

export function sound(kind: SoundKind, muted: boolean): void {
  if (muted) return;
  try {
    const c = audioContext();
    if (!c) return;
    out = sfxBus();
    pitch = 0.94 + Math.random() * 0.12;
    variant = Math.floor(Math.random() * 4);
    switch (kind) {
      case 'fire':
        if (variant % 2 === 0) tone(c, 'sawtooth', 220, 880, 0.16, 0.08);
        else tone(c, 'square', 260, 990, 0.14, 0.06);
        noise(c, 0.12, 0.08, 2600 + variant * 250);
        break;
      case 'boom':
        tone(c, 'sine', 150 - variant * 12, 36, 0.4, 0.28);
        noise(c, 0.45 + variant * 0.05, 0.28, 1100 - variant * 120);
        break;
      case 'kill':
        tone(c, 'square', 520, 1040, 0.12, 0.08);
        tone(c, 'square', 780, 1560, 0.16, 0.07, 0.09);
        noise(c, 0.2, 0.12, 3200);
        break;
      case 'turn':
        tone(c, 'triangle', 520, 660, 0.1, 0.1);
        tone(c, 'triangle', 660, 880, 0.14, 0.1, 0.1);
        break;
      case 'tick':
        tone(c, 'square', 700, 700, 0.07, 0.06);
        break;
      case 'go':
        tone(c, 'square', 880, 1320, 0.26, 0.09);
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => tone(c, 'triangle', f, f, 0.22, 0.12, i * 0.12));
        break;
      case 'lose':
        [392, 330, 262].forEach((f, i) => tone(c, 'triangle', f, f * 0.96, 0.28, 0.1, i * 0.16));
        break;
      case 'click':
        // A soft pencil tap, in four slightly different strokes.
        if (variant === 0) tone(c, 'triangle', 640, 430, 0.06, 0.06);
        else if (variant === 1) tone(c, 'triangle', 720, 480, 0.05, 0.055);
        else if (variant === 2) tone(c, 'sine', 560, 380, 0.07, 0.07);
        else tone(c, 'triangle', 600, 520, 0.045, 0.05);
        noise(c, 0.025, 0.035, 4200);
        break;
      case 'nav':
        // Turning to another page of the notebook.
        noise(c, 0.12, 0.045, 2200 + variant * 300);
        tone(c, 'sine', 380 + variant * 40, 620 + variant * 50, 0.1, 0.03);
        break;
      case 'press':
        // A firm, bright press for main buttons.
        tone(c, 'triangle', 520 + variant * 35, 780 + variant * 50, 0.08, 0.07);
        tone(c, 'sine', 1040 + variant * 70, 1040 + variant * 70, 0.06, 0.03, 0.04);
        noise(c, 0.03, 0.03, 3600);
        break;
      case 'tap':
        // A light tap for small buttons.
        tone(c, 'sine', 900 + variant * 80, 700 + variant * 60, 0.04, 0.04);
        break;
      case 'dropdown':
        tone(c, 'sine', 420 + variant * 30, 760, 0.09, 0.045);
        noise(c, 0.06, 0.02, 3000);
        break;
      case 'choose':
        tone(c, 'triangle', 820 + variant * 60, 1100 + variant * 60, 0.06, 0.05);
        break;
      case 'mathkey':
        // Chalky clicks for the math keys, a little different each time.
        noise(c, 0.03, 0.05, 2800 + variant * 500);
        tone(c, 'square', 1200 + variant * 120, 900 + variant * 100, 0.025, 0.02);
        break;
      case 'chatSend':
        tone(c, 'sine', 600, 1200, 0.1, 0.05);
        tone(c, 'sine', 1200, 1500, 0.08, 0.035, 0.07);
        break;
      case 'chatReceive':
        tone(c, 'triangle', 1100, 900, 0.09, 0.05);
        tone(c, 'triangle', 1350, 1350, 0.1, 0.04, 0.08);
        break;
      case 'claim':
        [660, 880, 1320].forEach((f, i) => tone(c, 'triangle', f, f, 0.12, 0.07, i * 0.06));
        noise(c, 0.2, 0.03, 6000, 0.12);
        break;
      case 'rankUp':
        [523, 659, 784, 1047, 1319].forEach((f, i) => tone(c, 'triangle', f, f, 0.2, 0.1, i * 0.09));
        tone(c, 'sine', 262, 523, 0.6, 0.08);
        break;
      case 'rankDown':
        [659, 523, 440, 392].forEach((f, i) => tone(c, 'triangle', f, f * 0.98, 0.24, 0.08, i * 0.12));
        break;
      case 'place':
        // Setting a rock down in the editor.
        tone(c, 'sine', 180 + variant * 25, 90, 0.14, 0.12);
        noise(c, 0.1, 0.08, 900 + variant * 200);
        break;
      case 'rotate':
        tone(c, 'triangle', 500 + variant * 60, 760 + variant * 60, 0.07, 0.05);
        noise(c, 0.05, 0.02, 2600);
        break;
      case 'hover':
        tone(c, 'sine', 1180 + variant * 60, 1260 + variant * 70, 0.035, 0.018);
        break;
      case 'toggle':
        tone(c, 'triangle', 660, 660, 0.05, 0.05);
        tone(c, 'triangle', 990, 990, 0.07, 0.05, 0.05);
        break;
      case 'page':
        // A paper page turning.
        noise(c, 0.16, 0.05, 1900);
        tone(c, 'sine', 320, 540, 0.14, 0.025);
        break;
      case 'buy':
        tone(c, 'square', 988, 988, 0.08, 0.045);
        tone(c, 'square', 1319, 1319, 0.26, 0.045, 0.08);
        tone(c, 'triangle', 2637, 2637, 0.2, 0.02, 0.1);
        break;
      case 'equip':
        tone(c, 'triangle', 523, 784, 0.12, 0.07);
        tone(c, 'triangle', 1047, 1047, 0.12, 0.05, 0.1);
        break;
      case 'error':
        tone(c, 'square', 220, 185, 0.12, 0.04);
        tone(c, 'square', 196, 165, 0.16, 0.04, 0.13);
        break;
      case 'slide':
        tone(c, 'sine', 900, 900, 0.025, 0.02);
        break;
      case 'open':
        tone(c, 'sine', 380, 900, 0.2, 0.05);
        noise(c, 0.18, 0.025, 2600);
        break;
      case 'close':
        tone(c, 'sine', 900, 380, 0.18, 0.05);
        break;
      case 'key':
        // Typing: a few different key clacks.
        noise(c, 0.018, 0.03, [5200, 4400, 6000, 4800][variant]!);
        if (variant === 3) tone(c, 'square', 2400, 2000, 0.012, 0.008);
        break;
      case 'lock':
        // A latch clicking shut.
        noise(c, 0.03, 0.06, 3800);
        tone(c, 'square', 330, 330, 0.05, 0.05);
        tone(c, 'triangle', 660, 990, 0.1, 0.06, 0.05);
        break;
      case 'unlock':
        noise(c, 0.03, 0.05, 3000);
        tone(c, 'triangle', 990, 520, 0.1, 0.05);
        break;
      case 'beam':
        tone(c, 'sawtooth', 120, 1600, 0.5, 0.09);
        tone(c, 'square', 60, 240, 0.6, 0.08, 0.05);
        noise(c, 0.6, 0.18, 1800);
        break;
      case 'luck':
        [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(c, 'triangle', f, f, 0.18, 0.1, i * 0.07));
        break;
      case 'hopLaunch':
        // A springy boing as the soldier sets off.
        tone(c, 'sine', 180, 520, 0.18, 0.12);
        tone(c, 'triangle', 360, 900, 0.12, 0.05, 0.05);
        break;
      case 'hopOver':
        tone(c, 'sine', 300, 760, 0.16, 0.1);
        noise(c, 0.08, 0.04, 2400);
        break;
      case 'hopLand':
        tone(c, 'sine', 140, 60, 0.18, 0.18);
        noise(c, 0.14, 0.12, 900);
        break;
      case 'hopKill':
        tone(c, 'square', 440, 1320, 0.14, 0.08);
        tone(c, 'sine', 900, 300, 0.25, 0.08, 0.1);
        noise(c, 0.2, 0.12, 3000);
        break;
      case 'hopOut':
        // A falling whistle as the soldier sails off the field, then a pop.
        tone(c, 'sine', 1400, 160, 0.9, 0.08);
        noise(c, 0.12, 0.14, 2600, 0.85);
        tone(c, 'square', 260, 120, 0.12, 0.06, 0.85);
        break;
      case 'ricochet':
        tone(c, 'triangle', 1800, 2600, 0.08, 0.08);
        tone(c, 'sine', 2600, 1200, 0.22, 0.05, 0.05);
        break;
      case 'heavy':
        tone(c, 'sine', 110, 28, 0.7, 0.34);
        noise(c, 0.7, 0.32, 700);
        tone(c, 'square', 70, 40, 0.4, 0.06, 0.05);
        break;
      case 'beamCut':
        noise(c, 0.1, 0.14, 5200);
        tone(c, 'sawtooth', 2200, 600, 0.14, 0.05);
        break;
      case 'energyFull':
        [523, 784, 1047, 1568].forEach((f, i) => tone(c, 'triangle', f, f * 1.01, 0.14, 0.08, i * 0.05));
        break;
      case 'energyTick':
        tone(c, 'triangle', 880, 1320, 0.06, 0.04);
        break;
      case 'abilityOpen':
        tone(c, 'sine', 420, 840, 0.12, 0.05);
        noise(c, 0.1, 0.02, 3200);
        break;
      case 'abilitySelect':
        tone(c, 'triangle', 660, 990, 0.08, 0.07);
        tone(c, 'triangle', 990, 1480, 0.12, 0.06, 0.07);
        break;
      case 'noEnergy':
        tone(c, 'square', 200, 150, 0.16, 0.05);
        break;
    }
  } catch {
    /* sound is optional */
  }
}
