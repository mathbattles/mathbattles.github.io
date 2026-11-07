import { describe, expect, it } from 'vitest';
import { applyKey } from '../src/screens/MathKeys';

const type = (value: string, caret: number, key: Parameters<typeof applyKey>[3]) => applyKey(value, caret, caret, key);

describe('math keys', () => {
  it('types at the cursor, not just at the end', () => {
    expect(type('x/3', 0, { label: '2', insert: '2' })).toEqual({ value: '2x/3', caret: 1 });
    expect(type('x3', 1, { label: '/', insert: '/' })).toEqual({ value: 'x/3', caret: 2 });
  });

  it('puts the cursor inside a function’s brackets', () => {
    const out = type('4*', 2, { label: 'sin', insert: 'sin()', back: 1 });
    expect(out).toEqual({ value: '4*sin()', caret: 6 });
    // Typing x goes inside, then ) steps over the bracket that's already there.
    const x = type(out.value, out.caret, { label: 'x', insert: 'x' });
    expect(x).toEqual({ value: '4*sin(x)', caret: 7 });
    expect(type(x.value, x.caret, { label: ')', insert: ')' })).toEqual({ value: '4*sin(x)', caret: 8 });
  });

  it('deletes one character, an empty bracket pair together, or a selection', () => {
    expect(type('x/34', 4, { label: '⌫', action: 'delete' })).toEqual({ value: 'x/3', caret: 3 });
    expect(type('sin()', 4, { label: '⌫', action: 'delete' })).toEqual({ value: 'sin', caret: 3 });
    expect(type('x', 0, { label: '⌫', action: 'delete' })).toEqual({ value: 'x', caret: 0 });
    expect(applyKey('x/34', 1, 4, { label: '⌫', action: 'delete' })).toEqual({ value: 'x', caret: 1 });
  });

  it('moves the cursor and clears', () => {
    expect(type('x/3', 3, { label: '◀', action: 'left' }).caret).toBe(2);
    expect(type('x/3', 0, { label: '◀', action: 'left' }).caret).toBe(0);
    expect(type('x/3', 3, { label: '▶', action: 'right' }).caret).toBe(3);
    expect(type('x/3', 1, { label: 'Clear', action: 'clear' })).toEqual({ value: '', caret: 0 });
  });

  it('never goes past the 200-character limit', () => {
    const long = 'x'.repeat(199);
    expect(type(long, 199, { label: 'sqrt', insert: 'sqrt()', back: 1 }).value).toHaveLength(200);
  });
});
