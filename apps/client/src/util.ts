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

export function sound(kind: 'fire' | 'boom' | 'kill' | 'turn', muted: boolean): void {
  if (muted) return;
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.connect(gain).connect(audio.destination);
    const spec = {
      fire: { type: 'triangle', from: 300, to: 900, dur: 0.18, vol: 0.12 },
      boom: { type: 'sawtooth', from: 160, to: 40, dur: 0.3, vol: 0.14 },
      kill: { type: 'square', from: 620, to: 1040, dur: 0.14, vol: 0.08 },
      turn: { type: 'sine', from: 520, to: 660, dur: 0.12, vol: 0.08 },
    }[kind];
    osc.type = spec.type as OscillatorType;
    osc.frequency.setValueAtTime(spec.from, t);
    osc.frequency.exponentialRampToValueAtTime(spec.to, t + spec.dur);
    gain.gain.setValueAtTime(spec.vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + spec.dur);
    osc.start(t);
    osc.stop(t + spec.dur);
  } catch {
    /* sound is optional */
  }
}
