import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ShotMode } from '@mathbattles/sim';
import { profile } from '../store';
import { sound } from '../util';
import { useProfile } from './Shared';

const touchQuery = globalThis.matchMedia?.('(pointer: coarse)');

/**
 * Whether the on-screen math keys are in use, and whether the player switched to the
 * phone's own keyboard instead. Automatic means touch screens get them.
 */
export function useMathKeys(): { on: boolean; typing: boolean; setTyping: (t: boolean) => void } {
  useProfile();
  const [touch, setTouch] = useState(!!touchQuery?.matches);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const change = (e: MediaQueryListEvent) => setTouch(e.matches);
    touchQuery?.addEventListener?.('change', change);
    return () => touchQuery?.removeEventListener?.('change', change);
  }, []);
  const setting = profile.mathKeys ?? 'auto';
  const on = setting === 'on' || (setting === 'auto' && touch);
  return { on, typing: on && typing, setTyping };
}

interface Key {
  label: string;
  /** What the key types. Function keys add their brackets and put the cursor inside. */
  insert?: string;
  back?: number;
  action?: 'left' | 'right' | 'delete' | 'clear' | 'abc';
  kind?: 'num' | 'op' | 'fn' | 'var' | 'ctl';
  wide?: boolean;
  aria?: string;
}

const fn = (name: string, label = name): Key => ({ label, insert: `${name}()`, back: 1, kind: 'fn', aria: name });

function varKeys(mode: ShotMode): Key[] {
  const x: Key = { label: 'x', insert: 'x', kind: 'var' };
  if (mode === 'fn') return [x, { label: 'x²', insert: 'x^2', kind: 'var', aria: 'x squared' }, { label: 'e', insert: 'e', kind: 'var' }];
  if (mode === 'ode1') return [x, { label: 'y', insert: 'y', kind: 'var' }, { label: 'e', insert: 'e', kind: 'var' }];
  return [x, { label: 'y', insert: 'y', kind: 'var' }, { label: 'y′', insert: "y'", kind: 'var', aria: 'y prime' }];
}

function layout(mode: ShotMode): Key[][] {
  const num = (d: string): Key => ({ label: d, insert: d, kind: 'num' });
  return [
    [...varKeys(mode), { label: '^', insert: '^', kind: 'op', aria: 'to the power of' }, { label: '(', insert: '(', kind: 'op' }, { label: ')', insert: ')', kind: 'op' }],
    [num('7'), num('8'), num('9'), { label: '÷', insert: '/', kind: 'op', aria: 'divide' }, fn('sin'), fn('cos')],
    [num('4'), num('5'), num('6'), { label: '×', insert: '*', kind: 'op', aria: 'times' }, fn('tan'), fn('sqrt', '√')],
    [num('1'), num('2'), num('3'), { label: '−', insert: '-', kind: 'op', aria: 'minus' }, fn('abs'), fn('exp')],
    [num('0'), { label: '.', insert: '.', kind: 'num', aria: 'point' }, { label: 'π', insert: 'pi', kind: 'var', aria: 'pi' }, { label: '+', insert: '+', kind: 'op', aria: 'plus' }, fn('ln'), { label: '⌫', action: 'delete', kind: 'ctl', aria: 'Delete' }],
    [{ label: '◀', action: 'left', kind: 'ctl', aria: 'Move left' }, { label: '▶', action: 'right', kind: 'ctl', aria: 'Move right' }, { label: 'ABC', action: 'abc', kind: 'ctl', wide: true, aria: 'Use the phone keyboard' }, { label: 'Clear', action: 'clear', kind: 'ctl', wide: true }],
  ];
}

/** Applies one key to the text and cursor. Exported for tests. */
export function applyKey(value: string, start: number, end: number, key: Key): { value: string; caret: number } {
  if (key.action === 'left') return { value, caret: Math.max(0, start === end ? start - 1 : start) };
  if (key.action === 'right') return { value, caret: Math.min(value.length, start === end ? end + 1 : end) };
  if (key.action === 'clear') return { value: '', caret: 0 };
  if (key.action === 'delete') {
    if (start !== end) return { value: value.slice(0, start) + value.slice(end), caret: start };
    if (start === 0) return { value, caret: 0 };
    // Deleting an empty pair of brackets removes both.
    const pair = value[start - 1] === '(' && value[start] === ')';
    return { value: value.slice(0, start - 1) + value.slice(start + (pair ? 1 : 0)), caret: start - 1 };
  }
  const text = key.insert ?? '';
  // A closing bracket steps over one that's already there, instead of adding another.
  if (text === ')' && start === end && value[start] === ')') return { value, caret: start + 1 };
  const next = value.slice(0, start) + text + value.slice(end);
  return { value: next.slice(0, 200), caret: Math.min(200, start + text.length - (key.back ?? 0)) };
}

/** The on-screen math keyboard. Keys type into the given input without moving focus away. */
export function MathKeys(props: {
  input: RefObject<HTMLInputElement>;
  mode: ShotMode;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  typing: boolean;
  setTyping: (t: boolean) => void;
}) {
  const { input, mode, value, onChange, disabled, typing, setTyping } = props;
  const repeat = useRef<{ delay: number; every: number }>({ delay: 0, every: 0 });
  const latest = useRef(value);
  latest.current = value;

  const stopRepeat = () => {
    clearTimeout(repeat.current.delay);
    clearInterval(repeat.current.every);
  };
  useEffect(() => stopRepeat, []);

  const press = (key: Key) => {
    const el = input.current;
    if (!el || disabled) return;
    if (key.action === 'abc') {
      setTyping(true);
      // The phone keyboard only opens from a direct tap, so focus right away.
      el.inputMode = 'text';
      el.focus();
      return;
    }
    const start = el.selectionStart ?? latest.current.length;
    const end = el.selectionEnd ?? start;
    const out = applyKey(latest.current, start, end, key);
    if (out.value !== latest.current) onChange(out.value);
    latest.current = out.value;
    sound('key', profile.muted);
    try {
      navigator.vibrate?.(6);
    } catch {
      /* vibration is optional */
    }
    // Put the cursor back after the new text has been drawn.
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      el.setSelectionRange(out.caret, out.caret);
    });
  };

  const down = (key: Key) => (e: PointerEvent) => {
    // Keep focus, and the cursor, in the function box.
    e.preventDefault();
    press(key);
    if (key.action === 'delete' || key.action === 'left' || key.action === 'right') {
      stopRepeat();
      repeat.current.delay = window.setTimeout(() => {
        repeat.current.every = window.setInterval(() => press(key), 70);
      }, 420);
    }
  };

  if (typing) {
    return (
      <div class="mathkeys-off">
        <button
          type="button"
          class="small"
          data-sfx="none"
          onPointerDown={(e) => {
            e.preventDefault();
            setTyping(false);
            const el = input.current;
            if (el) {
              el.inputMode = 'none';
              el.blur();
              requestAnimationFrame(() => el.focus({ preventScroll: true }));
            }
          }}
        >
          Show math keys
        </button>
      </div>
    );
  }

  return (
    <div class={`mathkeys ${disabled ? 'off' : ''}`} role="group" aria-label="Math keys">
      {layout(mode).flat().map((key) => (
        <button
          type="button"
          class={`mk mk-${key.kind ?? 'num'} ${key.wide ? 'wide' : ''}`}
          data-sfx="none"
          aria-label={key.aria ?? key.label}
          disabled={disabled}
          onPointerDown={down(key)}
          onPointerUp={stopRepeat}
          onPointerLeave={stopRepeat}
          onPointerCancel={stopRepeat}
          // Keyboard users (Enter or Space on a focused key) arrive here with no pointer.
          onClick={(e) => {
            if ((e as MouseEvent).detail === 0) press(key);
          }}
        >
          {key.label}
        </button>
      ))}
    </div>
  );
}
