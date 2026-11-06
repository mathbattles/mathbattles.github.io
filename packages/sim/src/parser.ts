import { MAX_FUNCTION_CHARS } from './constants';

/** Compiled expression: (x, y, dy) => value. May return NaN or Infinity. */
export type CompiledFn = (x: number, y: number, dy: number) => number;

export class ParseError extends Error {
  constructor(message: string, public readonly position: number) {
    super(message);
    this.name = 'ParseError';
  }
}

type Tok =
  | { t: 'num'; v: number; p: number }
  | { t: 'id'; v: string; p: number }
  | { t: 'op'; v: string; p: number };

const FUNCS: Record<string, (a: number) => number> = {
  sqrt: Math.sqrt,
  log: Math.log10,
  ln: Math.log,
  abs: Math.abs,
  sin: Math.sin,
  sen: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  tg: Math.tan,
  exp: Math.exp,
};
const CONSTS: Record<string, number> = { e: Math.E, pi: Math.PI };
const VARS = new Set(['x', 'y', "y'"]);
const IDS = ["y'", ...Object.keys(FUNCS), 'pi', 'x', 'y', 'e'].sort((a, b) => b.length - a.length);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const s = src.toLowerCase();
  while (i < s.length) {
    const c = s[i]!;
    if (c === ' ' || c === '\t') { i++; continue; }
    if ((c >= '0' && c <= '9') || c === '.' || c === ',') {
      const m = /^(\d+[.,]?\d*|[.,]\d+)/.exec(s.slice(i));
      if (!m) throw new ParseError(`"${c}" isn't a valid number`, i);
      out.push({ t: 'num', v: parseFloat(m[0].replace(',', '.')), p: i });
      i += m[0].length;
      continue;
    }
    if ('+-*/^()'.includes(c)) { out.push({ t: 'op', v: c, p: i }); i++; continue; }
    const id = IDS.find((n) => s.startsWith(n, i));
    if (id) { out.push({ t: 'id', v: id, p: i }); i += id.length; continue; }
    throw new ParseError(`"${src[i]}" isn't something I can read here`, i);
  }
  return out;
}

export interface ParseOptions {
  /** Which variables are allowed. Defaults to all of x, y, y'. */
  vars?: ReadonlyArray<'x' | 'y' | "y'">;
}

/**
 * Parses a math expression into a fast closure. Never uses eval.
 * Precedence: unary minus binds looser than ^, so -x^2 = -(x^2) and 2^-x works.
 * Implicit multiplication is allowed: 2x, 3sin(x), (x+1)(x-1).
 */
export function compile(src: string, opts: ParseOptions = {}): CompiledFn {
  if (src.length > MAX_FUNCTION_CHARS) {
    throw new ParseError(`Too long: the limit is ${MAX_FUNCTION_CHARS} characters`, MAX_FUNCTION_CHARS);
  }
  const allowed = new Set<string>(opts.vars ?? ['x', 'y', "y'"]);
  const toks = tokenize(src);
  if (toks.length === 0) throw new ParseError('Type a function first', 0);
  let pos = 0;
  const peek = () => toks[pos];
  const isOp = (v: string) => { const t = peek(); return !!t && t.t === 'op' && t.v === v; };
  const here = () => peek()?.p ?? src.length;

  function expr(): CompiledFn {
    let l = term();
    while (isOp('+') || isOp('-')) {
      const op = (toks[pos++] as Tok).v;
      const a = l, b = term();
      l = op === '+' ? (x, y, d) => a(x, y, d) + b(x, y, d) : (x, y, d) => a(x, y, d) - b(x, y, d);
    }
    return l;
  }

  function startsFactor(): boolean {
    const t = peek();
    if (!t) return false;
    if (t.t === 'num' || t.t === 'id') return true;
    return t.t === 'op' && t.v === '(';
  }

  function term(): CompiledFn {
    let l = unary();
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = (toks[pos++] as Tok).v;
        const a = l, b = unary();
        l = op === '*' ? (x, y, d) => a(x, y, d) * b(x, y, d) : (x, y, d) => a(x, y, d) / b(x, y, d);
      } else if (startsFactor()) {
        const a = l, b = power();
        l = (x, y, d) => a(x, y, d) * b(x, y, d);
      } else return l;
    }
  }

  function unary(): CompiledFn {
    if (isOp('-')) {
      pos++;
      const a = unary();
      return (x, y, d) => -a(x, y, d);
    }
    if (isOp('+')) { pos++; return unary(); }
    return power();
  }

  function power(): CompiledFn {
    const base = atom();
    if (isOp('^')) {
      pos++;
      const ex = unary(); // right associative
      return (x, y, d) => Math.pow(base(x, y, d), ex(x, y, d));
    }
    return base;
  }

  function atom(): CompiledFn {
    const t = peek();
    if (!t) throw new ParseError('The function ends too early', src.length);
    if (t.t === 'num') { pos++; const v = t.v; return () => v; }
    if (t.t === 'op') {
      if (t.v === '(') {
        pos++;
        const inner = expr();
        if (!isOp(')')) throw new ParseError('Missing )', here());
        pos++;
        return inner;
      }
      throw new ParseError(t.v === ')' ? 'Extra )' : `"${t.v}" needs a value before it`, t.p);
    }
    pos++;
    const name = t.v;
    const fn = FUNCS[name];
    if (fn) {
      const arg = unaryArg(name, t.p);
      return (x, y, d) => fn(arg(x, y, d));
    }
    const c = CONSTS[name];
    if (c !== undefined) return () => c;
    if (VARS.has(name)) {
      if (!allowed.has(name)) {
        throw new ParseError(`${name} can't be used in this mode`, t.p);
      }
      if (name === 'x') return (x) => x;
      if (name === 'y') return (_x, y) => y;
      return (_x, _y, d) => d;
    }
    throw new ParseError(`Unknown name "${name}"`, t.p);
  }

  function unaryArg(name: string, p: number): CompiledFn {
    if (!isOp('(')) throw new ParseError(`${name} needs parentheses, like ${name}(x)`, p);
    return atom();
  }

  const result = expr();
  if (pos < toks.length) {
    const t = toks[pos]!;
    throw new ParseError(t.t === 'op' && t.v === ')' ? 'Extra )' : `Unexpected "${t.v}"`, t.p);
  }
  return result;
}

export function varsForMode(mode: 'fn' | 'ode1' | 'ode2'): ReadonlyArray<'x' | 'y' | "y'"> {
  if (mode === 'fn') return ['x'];
  if (mode === 'ode1') return ['x', 'y'];
  return ['x', 'y', "y'"];
}

/** Returns an error message for an expression, or null if it parses. */
export function validate(src: string, mode: 'fn' | 'ode1' | 'ode2'): { message: string; position: number } | null {
  try {
    compile(src, { vars: varsForMode(mode) });
    return null;
  } catch (e) {
    if (e instanceof ParseError) return { message: e.message, position: e.position };
    throw e;
  }
}
