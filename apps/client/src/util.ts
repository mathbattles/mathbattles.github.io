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
  | 'click' | 'hover' | 'toggle' | 'page' | 'buy' | 'equip' | 'error' | 'slide' | 'open' | 'close' | 'key';

let out: AudioNode | null = null;

function tone(ctx: AudioContext, type: OscillatorType, from: number, to: number, dur: number, vol: number, delay = 0): void {
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain).connect(out ?? ctx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.start(t);
  osc.stop(t + dur);
}

function noise(ctx: AudioContext, dur: number, vol: number, cutoff: number, delay = 0): void {
  const size = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / size);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const gain = ctx.createGain();
  gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(out ?? ctx.destination);
  src.start(ctx.currentTime + delay);
}

export function sound(kind: SoundKind, muted: boolean): void {
  if (muted) return;
  try {
    const c = audioContext();
    if (!c) return;
    out = sfxBus();
    switch (kind) {
      case 'fire':
        tone(c, 'sawtooth', 220, 880, 0.16, 0.08);
        noise(c, 0.12, 0.08, 2600);
        break;
      case 'boom':
        tone(c, 'sine', 150, 36, 0.4, 0.28);
        noise(c, 0.45, 0.28, 1100);
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
        // A soft pencil tap.
        tone(c, 'triangle', 640, 430, 0.06, 0.06);
        noise(c, 0.025, 0.035, 4200);
        break;
      case 'hover':
        tone(c, 'sine', 1180, 1260, 0.035, 0.018);
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
        noise(c, 0.018, 0.03, 5200);
        break;
    }
  } catch {
    /* sound is optional */
  }
}
