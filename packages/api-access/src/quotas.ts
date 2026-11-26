import type { RedisLike } from "./redis";

export type QuotaWindowSpec =
  | { name: string; kind: "fixed"; ms: number }
  | { name: string; kind: "calendar-month"; timeZone?: string };

export interface QuotaWindowState {
  name: string;
  /** null when the window has no limit. */
  limit: number | null;
  used: number;
  /** null when the window has no limit. */
  remaining: number | null;
  resetAt: Date;
}

export interface QuotaResult {
  allowed: boolean;
  /** false when the call used `enforce: false`. */
  enforced: boolean;
  /** Names of the windows over their limit. */
  exceeded: string[];
  windows: QuotaWindowState[];
  /** Seconds until every exceeded window resets. null when allowed. */
  retryAfterSec: number | null;
}

export interface QuotaStore {
  /** Adds `by` (may be negative) to the counter and sets it to expire at `expireAt`. Returns the new value. */
  incr(key: string, by: number, expireAt: Date): Promise<number>;
  /** Current value; 0 when missing or expired. */
  get(key: string): Promise<number>;
}

/**
 * In-process quota store, for tests and one server. Pass the limiter's `now` when you
 * give the limiter one, so expiry uses the same clock.
 */
export function memoryQuotaStore(opts: { now?: () => Date } = {}): QuotaStore {
  const clock = opts.now ?? (() => new Date());
  const counters = new Map<string, { value: number; expireAt: number }>();
  let writes = 0;
  const sweep = (now: number) => {
    for (const [key, entry] of counters) if (entry.expireAt <= now) counters.delete(key);
  };
  const live = (key: string, now: number) => {
    const entry = counters.get(key);
    return entry && entry.expireAt > now ? entry : undefined;
  };
  return {
    incr(key, by, expireAt) {
      const now = clock().getTime();
      writes += 1;
      if (writes % 1000 === 0) sweep(now);
      const value = (live(key, now)?.value ?? 0) + by;
      counters.set(key, { value, expireAt: expireAt.getTime() });
      return Promise.resolve(value);
    },
    get(key) {
      return Promise.resolve(live(key, clock().getTime())?.value ?? 0);
    },
  };
}

/** Quota store on Redis. Keys are `${prefix}${key}` (default prefix `qb:quota:`). */
export function redisQuotaStore(redis: RedisLike, opts: { prefix?: string } = {}): QuotaStore {
  const prefix = opts.prefix ?? "qb:quota:";
  return {
    async incr(key, by, expireAt) {
      const value = await redis.incrby(prefix + key, by);
      await redis.pexpireat(prefix + key, expireAt.getTime());
      return value;
    },
    async get(key) {
      const raw = await redis.get(prefix + key);
      const value = raw === null ? 0 : Number(raw);
      return Number.isFinite(value) ? value : 0;
    },
  };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock fields of `ms` in `timeZone`. `month` is 1-12. */
function zonedFields(ms: number, timeZone: string) {
  const fields: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(ms)) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  return {
    year: fields.year ?? 1970,
    month: fields.month ?? 1,
    day: fields.day ?? 1,
    hour: fields.hour ?? 0,
    minute: fields.minute ?? 0,
    second: fields.second ?? 0,
  };
}

/** Milliseconds to add to UTC to get the wall clock in `timeZone` at instant `ms`. */
function zoneOffset(ms: number, timeZone: string): number {
  const f = zonedFields(ms, timeZone);
  const wall = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return wall - (ms - (((ms % 1000) + 1000) % 1000));
}

/** UTC instant of 00:00 on day 1 of `month0` (0-based, may overflow) of `year` in `timeZone`. */
function monthStart(year: number, month0: number, timeZone: string): number {
  const wall = Date.UTC(year, month0, 1);
  const first = wall - zoneOffset(wall, timeZone);
  const second = wall - zoneOffset(first, timeZone);
  return first === second ? first : second;
}

interface Period {
  id: string;
  resetAt: Date;
}

function periodOf(spec: QuotaWindowSpec, now: Date): Period {
  if (spec.kind === "fixed") {
    const start = Math.floor(now.getTime() / spec.ms) * spec.ms;
    return { id: String(start), resetAt: new Date(start + spec.ms) };
  }
  const timeZone = spec.timeZone ?? "UTC";
  const { year, month } = zonedFields(now.getTime(), timeZone);
  return {
    id: `${String(year)}-${String(month).padStart(2, "0")}`,
    resetAt: new Date(monthStart(year, month, timeZone)),
  };
}

function validateWindows(windows: QuotaWindowSpec[]): void {
  const names = new Set<string>();
  for (const spec of windows) {
    if (!spec.name) throw new TypeError("Quota window name is required.");
    if (names.has(spec.name)) throw new TypeError(`Duplicate quota window "${spec.name}".`);
    names.add(spec.name);
    if (spec.kind === "fixed") {
      if (!Number.isInteger(spec.ms) || spec.ms <= 0) {
        throw new TypeError(`Quota window "${spec.name}": ms must be a positive integer.`);
      }
    } else {
      // Throws RangeError for an unknown time zone.
      formatter(spec.timeZone ?? "UTC");
    }
  }
}

function retryAfter(states: QuotaWindowState[], exceeded: string[], now: Date): number {
  let latest = now.getTime();
  for (const state of states) {
    if (exceeded.includes(state.name)) latest = Math.max(latest, state.resetAt.getTime());
  }
  return Math.max(1, Math.ceil((latest - now.getTime()) / 1000));
}

function state(name: string, limit: number | null, used: number, resetAt: Date): QuotaWindowState {
  return {
    name,
    limit,
    used,
    remaining: limit === null ? null : Math.max(0, limit - used),
    resetAt,
  };
}

/**
 * Counts requests per subject in each window. `limits` maps a window name to its limit for
 * this call; null or missing means no limit (the window still counts).
 */
export function createQuotaLimiter(opts: {
  store: QuotaStore;
  windows: QuotaWindowSpec[];
  now?: () => Date;
}): {
  consume(
    subject: string,
    opts: { limits: Record<string, number | null>; cost?: number; enforce?: boolean },
  ): Promise<QuotaResult>;
  peek(subject: string, limits: Record<string, number | null>): Promise<QuotaResult>;
} {
  validateWindows(opts.windows);
  const { store, windows } = opts;
  const clock = opts.now ?? (() => new Date());

  const resolve = (subject: string, limits: Record<string, number | null>, now: Date) =>
    windows.map((spec) => {
      const period = periodOf(spec, now);
      return {
        name: spec.name,
        key: `${subject}:${spec.name}:${period.id}`,
        resetAt: period.resetAt,
        limit: limits[spec.name] ?? null,
      };
    });

  const refused = (
    resolved: ReturnType<typeof resolve>,
    used: number[],
    exceeded: string[],
    now: Date,
  ): QuotaResult => {
    const states = resolved.map((w, i) => state(w.name, w.limit, used[i] ?? 0, w.resetAt));
    return {
      allowed: false,
      enforced: true,
      exceeded,
      windows: states,
      retryAfterSec: retryAfter(states, exceeded, now),
    };
  };

  return {
    async consume(subject, { limits, cost = 1, enforce = true }) {
      if (!Number.isFinite(cost) || cost < 0) {
        throw new TypeError("Quota cost must be a non-negative number.");
      }
      const now = clock();
      const resolved = resolve(subject, limits, now);
      const over = (used: number[]) =>
        resolved.filter((w, i) => w.limit !== null && (used[i] ?? 0) > w.limit).map((w) => w.name);

      if (enforce) {
        // Refuse without writing when the current counts already leave no room.
        const before = await Promise.all(resolved.map((w) => store.get(w.key)));
        const early = over(before.map((u) => u + cost));
        if (early.length > 0) return refused(resolved, before, early, now);
      }

      const after = await Promise.all(resolved.map((w) => store.incr(w.key, cost, w.resetAt)));
      const exceeded = over(after);
      if (enforce && exceeded.length > 0) {
        // Another request took the room between the read and the write: undo this one.
        const undone = await Promise.all(resolved.map((w) => store.incr(w.key, -cost, w.resetAt)));
        return refused(resolved, undone, exceeded, now);
      }
      return {
        allowed: true,
        enforced: enforce,
        exceeded,
        windows: resolved.map((w, i) => state(w.name, w.limit, after[i] ?? 0, w.resetAt)),
        retryAfterSec: null,
      };
    },

    async peek(subject, limits) {
      const now = clock();
      const resolved = resolve(subject, limits, now);
      const used = await Promise.all(resolved.map((w) => store.get(w.key)));
      const exceeded = resolved
        .filter((w, i) => w.limit !== null && (used[i] ?? 0) >= w.limit)
        .map((w) => w.name);
      if (exceeded.length > 0) return refused(resolved, used, exceeded, now);
      return {
        allowed: true,
        enforced: true,
        exceeded,
        windows: resolved.map((w, i) => state(w.name, w.limit, used[i] ?? 0, w.resetAt)),
        retryAfterSec: null,
      };
    },
  };
}

/** "day" → "Day", "per_minute" → "Per-Minute". */
function headerName(window: string): string {
  return window
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}

/**
 * Response headers for a quota result: `X-RateLimit-Limit-<Window>`,
 * `X-RateLimit-Remaining-<Window>` and `X-RateLimit-Reset-<Window>` (unix seconds) for each
 * window with a limit, and `Retry-After` when refused.
 */
export function quotaHeaders(result: QuotaResult): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const w of result.windows) {
    if (w.limit === null) continue;
    const name = headerName(w.name);
    headers[`X-RateLimit-Limit-${name}`] = String(w.limit);
    headers[`X-RateLimit-Remaining-${name}`] = String(w.remaining ?? 0);
    headers[`X-RateLimit-Reset-${name}`] = String(Math.ceil(w.resetAt.getTime() / 1000));
  }
  if (!result.allowed && result.retryAfterSec !== null) {
    headers["Retry-After"] = String(result.retryAfterSec);
  }
  return headers;
}
