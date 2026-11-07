/**
 * In-memory attempt counters for logins and signups (one API process). A restart forgets them, which only gives an
 * attacker a few more guesses: the argon2id hash and 2FA remain the real barrier.
 */
export class Attempts {
  private readonly hits = new Map<string, number[]>();
  private lastPrune = 0;
  constructor(private readonly windowMs: number) {}

  /** Attempts for `key` inside the window. */
  count(key: string, now: number): number {
    const list = this.hits.get(key);
    if (!list) return 0;
    while (list.length && list[0]! <= now - this.windowMs) list.shift();
    return list.length;
  }

  add(key: string, now: number): number {
    this.prune(now);
    let list = this.hits.get(key);
    if (!list) this.hits.set(key, (list = []));
    list.push(now);
    if (list.length > 1000) list.shift();
    return this.count(key, now);
  }

  /** Seconds until the oldest attempt leaves the window. */
  retryAfter(key: string, now: number): number {
    const first = this.hits.get(key)?.[0];
    return first === undefined ? 0 : Math.max(1, Math.ceil((first + this.windowMs - now) / 1000));
  }

  clear(key: string): void {
    this.hits.delete(key);
  }

  private prune(now: number): void {
    if (now - this.lastPrune < this.windowMs) return;
    this.lastPrune = now;
    for (const [k, list] of this.hits) if ((list.at(-1) ?? 0) <= now - this.windowMs) this.hits.delete(k);
  }
}

/** Account locks with an increasing duration: LOGIN_LOCK_MINUTES, then x2 each time (max 24 h). */
export class Locks {
  private readonly until = new Map<string, { until: number; level: number }>();
  lockedFor(key: string, now: number): number {
    const l = this.until.get(key);
    return l && l.until > now ? Math.ceil((l.until - now) / 1000) : 0;
  }
  lock(key: string, now: number, baseMs: number): number {
    const level = (this.until.get(key)?.level ?? 0) + 1;
    const ms = Math.min(baseMs * 2 ** (level - 1), 24 * 3600_000);
    this.until.set(key, { until: now + ms, level });
    return Math.ceil(ms / 1000);
  }
  clear(key: string): void {
    this.until.delete(key);
  }
}
