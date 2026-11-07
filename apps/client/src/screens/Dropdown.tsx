import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

export interface DropdownOption<T> {
  value: T;
  label: string;
}

let nextId = 0;

/**
 * A hand-drawn dropdown, used instead of the browser's own so the open list matches the game.
 * Works with the mouse, touch and keyboard: arrows move, Enter or Space picks, Escape closes.
 */
export function Dropdown<T extends string | number>(props: {
  label: string;
  value: T | null;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  /** Shown when nothing is chosen. */
  placeholder?: string;
  disabled?: boolean;
}) {
  const { label, value, options, onChange, placeholder, disabled } = props;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useRef(`dd-${++nextId}`).current;
  const current = options.find((o) => o.value === value);

  const show = () => {
    if (disabled) return;
    const at = options.findIndex((o) => o.value === value);
    setActive(at >= 0 ? at : 0);
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const pick = (i: number) => {
    const o = options[i];
    if (!o) return;
    close();
    if (o.value !== value) onChange(o.value);
  };

  // Opens upward when there isn't room below, and moves focus into the list.
  useLayoutEffect(() => {
    if (!open || !list.current || !button.current) return;
    const below = window.innerHeight - button.current.getBoundingClientRect().bottom;
    setUp(below < list.current.offsetHeight + 12 && button.current.getBoundingClientRect().top > below);
    list.current.focus();
  }, [open]);

  // A click anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);

  useEffect(() => {
    list.current?.querySelector(`#${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      show();
    }
  };
  const onListKey = (e: KeyboardEvent) => {
    const last = options.length - 1;
    if (e.key === 'ArrowDown') setActive((a) => Math.min(last, a + 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(last);
    else if (e.key === 'Enter' || e.key === ' ') pick(active);
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') close(false);
    else {
      // Typing a letter jumps to the first option starting with it.
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (e.key.length === 1 && i >= 0) setActive(i);
      return;
    }
    if (e.key !== 'Tab') e.preventDefault();
  };

  return (
    <div class={`dropdown ${open ? 'open' : ''}`} ref={root}>
      <button
        ref={button}
        type="button"
        class="dd-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onButtonKey}
      >
        <span class={current ? '' : 'dd-placeholder'}>{current?.label ?? placeholder ?? 'Choose'}</span>
        <svg class="dd-arrow" viewBox="0 0 12 8" aria-hidden="true"><path d="M1.5 1.8 6 6.2l4.5-4.4" /></svg>
      </button>
      {open && (
        <ul
          ref={list}
          id={`${id}-list`}
          class={`dd-list ${up ? 'up' : ''}`}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={onListKey}
        >
          {options.map((o, i) => (
            <li
              id={`${id}-${i}`}
              role="option"
              aria-selected={o.value === value}
              class={`${i === active ? 'active' : ''} ${o.value === value ? 'chosen' : ''}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(i)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
