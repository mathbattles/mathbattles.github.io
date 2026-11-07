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

let audio: AudioContext | null = null;

type SoundKind = 'fire' | 'boom' | 'kill' | 'turn' | 'tick' | 'go' | 'win' | 'lose' | 'click';

function tone(ctx: AudioContext, type: OscillatorType, from: number, to: number, dur: number, vol: number, delay = 0): void {
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain).connect(ctx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.start(t);
  osc.stop(t + dur);
}

function noise(ctx: AudioContext, dur: number, vol: number, cutoff: number): void {
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
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start();
}

export function sound(kind: SoundKind, muted: boolean): void {
  if (muted) return;
  try {
    audio ??= new AudioContext();
    const c = audio;
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
        tone(c, 'sine', 500, 720, 0.05, 0.05);
        break;
    }
  } catch {
    /* sound is optional */
  }
}
