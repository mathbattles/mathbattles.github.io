/** Returns true when this key has gone over its limit for the current time window. */
export async function overLimit(db: D1Database, key: string, max: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const cutoff = now - windowMs;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN window_start < ? THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END
       RETURNING count`,
    )
    .bind(key, now, cutoff, cutoff, now)
    .first<{ count: number }>();
  return (row?.count ?? 0) > max;
}

/** The caller's address, or null for local development, which isn't limited. */
export function callerIp(req: Request): string | null {
  const ip = req.headers.get('cf-connecting-ip');
  if (!ip || ip === '127.0.0.1' || ip === '::1') return null;
  return ip;
}

/** Allows short bursts from one connection and refills steadily. */
export class MessageBucket {
  private tokens: number;
  private last: number;

  constructor(private readonly burst: number, private readonly perSecond: number, now: number) {
    this.tokens = burst;
    this.last = now;
  }

  take(now: number): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
