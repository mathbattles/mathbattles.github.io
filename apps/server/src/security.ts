/** Shared security helpers for the worker: headers, origin rules, and log scrubbing. */

/**
 * Headers on every API answer. Nothing from the API may be cached anywhere, since answers can
 * belong to one signed-in player, and browsers must not guess content types or embed it.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'cache-control': 'no-store, private, max-age=0',
  pragma: 'no-cache',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The web addresses allowed to call the API from a browser. Local development pages are only
 * accepted by a worker that is itself running locally, never by the deployed one.
 */
export function allowedOrigins(configured: string, requestUrl: string): string[] {
  const list = configured.split(',').map((s) => s.trim()).filter(Boolean);
  const host = new URL(requestUrl).hostname;
  if (LOCAL_HOSTS.has(host)) list.push('http://localhost:5173', 'http://127.0.0.1:5173');
  return list.filter((o) => {
    // Production never trusts a local page, even if one is listed by mistake.
    if (LOCAL_HOSTS.has(host)) return true;
    try {
      return !LOCAL_HOSTS.has(new URL(o).hostname);
    } catch {
      return false;
    }
  });
}

/** True when a request comes from an allowed page, or from no page at all (a script or app). */
export function originOk(origins: string[], req: Request): boolean {
  const origin = req.headers.get('origin');
  return !origin || origins.includes(origin);
}

const SECRET_PATTERNS: [RegExp, string][] = [
  // Login tokens (JWTs).
  [/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '[token]'],
  [/(bearer\s+)[\w.~+/=-]+/gi, '$1[token]'],
  // Google API keys and GitHub tokens.
  [/AIza[\w-]{30,}/g, '[api-key]'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, '[github-token]'],
  [/github_pat_[A-Za-z0-9_]{20,}/g, '[github-token]'],
  // Password, token and secret fields in JSON or query strings.
  [/("?(?:password|passwd|idToken|token|secret|session|otp|code)"?\s*[:=]\s*)("[^"]*"|[^\s,&}]+)/gi, '$1"[hidden]"'],
  // Email addresses.
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
];

/** Removes anything secret or personal from text before it's logged. */
export function scrub(value: unknown): string {
  let text: string;
  if (value instanceof Error) text = `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
  else if (typeof value === 'string') text = value;
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  for (const [pattern, replacement] of SECRET_PATTERNS) text = text.replace(pattern, replacement);
  return text.slice(0, 2000);
}

/** The only way the worker logs errors, so nothing secret can reach the logs. */
export function logError(label: string, error?: unknown): void {
  console.error(label, error === undefined ? '' : scrub(error));
}

/** A random id that can't be guessed: a version 4 UUID. */
export function newId(): string {
  return crypto.randomUUID();
}

/** Hex SHA-256, used so only hashes of session tokens are ever stored. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
