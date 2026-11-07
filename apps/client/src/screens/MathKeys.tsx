import type { RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
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

interface FnEntry {
  label: string;
  insert: string;
  note: string;
}

const FUNCTION_LIST: { title: string; items: FnEntry[] }[] = [
  {
    title: 'Functions',
    items: [
      { label: 'sin(x)', insert: 'sin(x)', note: 'A wave between -1 and 1' },
      { label: 'cos(x)', insert: 'cos(x)', note: 'A wave that starts at its top' },
      { label: 'tan(x)', insert: 'tan(x)', note: 'Climbs and breaks, over and over' },
      { label: 'sqrt(x)', insert: 'sqrt(x)', note: 'Square root. Only works for x of 0 or more' },
      { label: 'abs(x)', insert: 'abs(x)', note: 'Distance from 0, which makes a V' },
      { label: 'exp(x)', insert: 'exp(x)', note: 'e to the power x. Grows very fast' },
      { label: 'ln(x)', insert: 'ln(x)', note: 'Natural log. Only for x above 0' },
      { label: 'log(x)', insert: 'log(x)', note: 'Log base 10. Only for x above 0' },
    ],
  },
  {
    title: 'Numbers and powers',
    items: [
      { label: 'pi', insert: 'pi', note: '3.14159…' },
      { label: 'e', insert: 'e', note: '2.71828…' },
      { label: 'x^2', insert: 'x^2', note: 'x squared' },
      { label: 'x^3', insert: 'x^3', note: 'x cubed' },
    ],
  },
  {
    title: 'Shapes to start from',
    items: [
      { label: 'x/3', insert: 'x/3', note: 'A straight line. Change 3 to aim' },
      { label: '-x^2/40', insert: '-x^2/40', note: 'An arc, to go over things' },
      { label: '5*sin(x/3)', insert: '5*sin(x/3)', note: 'A tall, wide wave' },
      { label: 'x/4+2*sin(x)', insert: 'x/4+2*sin(x)', note: 'A wave that climbs' },
      { label: 'abs(x)/2', insert: 'abs(x)/2', note: 'A sharp V turn' },
      { label: '8/(1+exp(-3*x))', insert: '8/(1+exp(-3*x))', note: 'A smooth step up' },
      { label: 'sqrt(abs(x))', insert: 'sqrt(abs(x))', note: 'A root that works on both sides' },
    ],
  },
];

/**
 * A list of every function the game understands. Choosing one types it into the box at the
 * cursor, so nobody has to remember how to spell it.
 */
export function FunctionPicker(props: { input: RefObject<HTMLInputElement>; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const { input, value, onChange, disabled } = props;
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // Opens upward when the list wouldn't fit below the button.
  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const r = root.current.getBoundingClientRect();
    setUp(window.innerHeight - r.bottom < 300 && r.top > window.innerHeight - r.bottom);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const pick = (entry: FnEntry) => {
    const el = input.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    const out = applyKey(value, start, end, { label: entry.label, insert: entry.insert });
    onChange(out.value);
    setOpen(false);
    sound('equip', profile.muted);
    requestAnimationFrame(() => {
      el?.focus({ preventScroll: true });
      el?.setSelectionRange(out.caret, out.caret);
    });
  };
  return (
    <div class={`fn-picker ${open ? 'open' : ''}`} ref={root}>
      <button type="button" class="small fn-picker-button" aria-expanded={open} aria-haspopup="dialog" disabled={disabled} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">ƒ</span> Functions
      </button>
      {open && (
        <div class={`fn-panel ${up ? 'up' : ''}`} role="dialog" aria-label="Functions you can use">
          {FUNCTION_LIST.map((group) => (
            <div class="fn-group">
              <h4>{group.title}</h4>
              <div class="fn-items">
                {group.items.map((entry) => (
                  <button type="button" class="fn-item" data-sfx="none" onClick={() => pick(entry)} aria-label={`Add ${entry.label}: ${entry.note}`}>
                    <code>{entry.label}</code>
                    <small>{entry.note}</small>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p class="muted small-note fn-tip">It goes where your cursor is. Change the numbers to aim.</p>
        </div>
      )}
    </div>
  );
}
