import type { RedisLike } from "./redis";

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  delete(keys: string[]): Promise<void>;
  /** Adds `key` to `tag`. The tag lives at least `ttlSec` from now. */
  addToTag(tag: string, key: string, ttlSec: number): Promise<void>;
  keysForTag(tag: string): Promise<string[]>;
  /** Removes the tag. Does not delete its keys. */
  clearTag(tag: string): Promise<void>;
}

export interface CacheStats {
  hits: number;
  misses: number;
  /** Keys removed by `invalidateTag` and `delete`. */
  invalidations: number;
}

/** In-process cache store, for tests and one server. */
export function memoryCacheStore(opts: { now?: () => Date } = {}): CacheStore {
  const now = () => (opts.now ? opts.now().getTime() : Date.now());
  const values = new Map<string, { value: string; expiresAt: number }>();
  const tags = new Map<string, { keys: Set<string>; expiresAt: number }>();
  const liveTag = (tag: string) => {
    const entry = tags.get(tag);
    if (entry && entry.expiresAt <= now()) {
      tags.delete(tag);
      return undefined;
    }
    return entry;
  };
  return {
    get(key) {
      const entry = values.get(key);
      if (!entry) return Promise.resolve(null);
      if (entry.expiresAt <= now()) {
        values.delete(key);
        return Promise.resolve(null);
      }
      return Promise.resolve(entry.value);
    },
    set(key, value, ttlSec) {
      values.set(key, { value, expiresAt: now() + ttlSec * 1000 });
      return Promise.resolve();
    },
    delete(keys) {
      for (const key of keys) values.delete(key);
      return Promise.resolve();
    },
    addToTag(tag, key, ttlSec) {
      const expiresAt = now() + ttlSec * 1000;
      const entry = liveTag(tag);
      if (entry) {
        entry.keys.add(key);
        entry.expiresAt = Math.max(entry.expiresAt, expiresAt);
      } else {
        tags.set(tag, { keys: new Set([key]), expiresAt });
      }
      return Promise.resolve();
    },
    keysForTag(tag) {
      return Promise.resolve([...(liveTag(tag)?.keys ?? [])]);
    },
    clearTag(tag) {
      tags.delete(tag);
      return Promise.resolve();
    },
  };
}

/**
 * Cache store on Redis. Values are `${prefix}v:${key}`; tags are sets at `${prefix}t:${tag}`
 * (default prefix `qb:cache:`). A tag expires when its longest-lived key does.
 */
export function redisCacheStore(redis: RedisLike, opts: { prefix?: string } = {}): CacheStore {
  const prefix = opts.prefix ?? "qb:cache:";
  const valueKey = (key: string) => `${prefix}v:${key}`;
  const tagKey = (tag: string) => `${prefix}t:${tag}`;
  const tagExpiryKey = (tag: string) => `${prefix}te:${tag}`;
  return {
    async get(key) {
      return redis.get(valueKey(key));
    },
    async set(key, value, ttlSec) {
      await redis.set(valueKey(key), value, "PX", Math.max(1, Math.round(ttlSec * 1000)));
    },
    async delete(keys) {
      if (keys.length > 0) await redis.del(...keys.map(valueKey));
    },
    async addToTag(tag, key, ttlSec) {
      // PEXPIRE would shorten the tag when a short-lived key follows a long-lived one,
      // so the tag's expiry time is kept in a second key and only moves forward.
      const now = Date.now();
      const previous = Number((await redis.get(tagExpiryKey(tag))) ?? 0) || 0;
      const expiresAt = Math.max(previous, now + Math.max(1, Math.round(ttlSec * 1000)));
      await redis.sadd(tagKey(tag), key);
      await redis.pexpire(tagKey(tag), expiresAt - now);
      if (expiresAt > previous) {
        await redis.set(tagExpiryKey(tag), String(expiresAt), "PX", expiresAt - now);
      }
    },
    async keysForTag(tag) {
      return redis.smembers(tagKey(tag));
    },
    async clearTag(tag) {
      await redis.del(tagKey(tag), tagExpiryKey(tag));
    },
  };
}

export interface Cache {
  getOrLoad<T>(
    key: string,
    ttlSec: number,
    loader: () => Promise<T>,
    opts?: { tags?: string[] },
  ): Promise<{ value: T; hit: boolean }>;
  /** Deletes every key with this tag. Returns how many keys it deleted. */
  invalidateTag(tag: string): Promise<number>;
  delete(key: string): Promise<void>;
  /** Counters for this process since `createCache`. */
  stats(): CacheStats;
}

interface Pending {
  promise: Promise<unknown>;
  tags: string[];
  stale: boolean;
}

/**
 * Read-through cache. Values are stored as JSON, so a `Date` comes back as a string on a hit.
 * Keys and tags are prefixed with `namespace`. Concurrent calls for one key share one loader
 * call. When `enabled` is false (or returns false) every call runs the loader and nothing is
 * counted. Store errors are passed to `onError` and the loader result is returned.
 */
export function createCache(opts: {
  store: CacheStore;
  namespace: string;
  enabled?: boolean | (() => boolean);
  onError?: (error: unknown) => void;
}): Cache {
  const { store, namespace } = opts;
  const onError = opts.onError ?? (() => undefined);
  const isEnabled = () =>
    typeof opts.enabled === "function" ? opts.enabled() : (opts.enabled ?? true);
  const fullKey = (key: string) => `${namespace}:${key}`;
  const fullTag = (tag: string) => `${namespace}:${tag}`;
  const counters: CacheStats = { hits: 0, misses: 0, invalidations: 0 };
  const pending = new Map<string, Pending>();

  const read = async (key: string): Promise<{ found: boolean; value?: unknown }> => {
    try {
      const raw = await store.get(key);
      return raw === null ? { found: false } : { found: true, value: JSON.parse(raw) };
    } catch (error) {
      onError(error);
      return { found: false };
    }
  };

  const write = async (key: string, value: unknown, ttlSec: number, tags: string[]) => {
    try {
      await store.set(key, JSON.stringify(value), ttlSec);
      await Promise.all(tags.map((tag) => store.addToTag(fullTag(tag), key, ttlSec)));
    } catch (error) {
      onError(error);
    }
  };

  const load = async <T>(
    key: string,
    ttlSec: number,
    loader: () => Promise<T>,
    entry: Pending,
  ): Promise<T> => {
    try {
      const value = await loader();
      const cacheable = (value as unknown) !== undefined;
      if (cacheable && !entry.stale) await write(key, value, ttlSec, entry.tags);
      return value;
    } finally {
      if (pending.get(key) === entry) pending.delete(key);
    }
  };

  return {
    async getOrLoad<T>(
      key: string,
      ttlSec: number,
      loader: () => Promise<T>,
      loadOpts: { tags?: string[] } = {},
    ): Promise<{ value: T; hit: boolean }> {
      if (!isEnabled()) return { value: await loader(), hit: false };
      const k = fullKey(key);
      const cached = await read(k);
      if (cached.found) {
        counters.hits += 1;
        return { value: cached.value as T, hit: true };
      }
      counters.misses += 1;
      const running = pending.get(k);
      if (running) return { value: (await running.promise) as T, hit: false };
      const entry: Pending = {
        promise: Promise.resolve(),
        tags: loadOpts.tags ?? [],
        stale: false,
      };
      entry.promise = load(k, ttlSec, loader, entry);
      pending.set(k, entry);
      return { value: (await entry.promise) as T, hit: false };
    },

    async invalidateTag(tag) {
      for (const [key, entry] of pending) {
        if (entry.tags.includes(tag)) {
          entry.stale = true;
          pending.delete(key);
        }
      }
      const t = fullTag(tag);
      const keys = await store.keysForTag(t);
      await store.delete(keys);
      await store.clearTag(t);
      counters.invalidations += keys.length;
      return keys.length;
    },

    async delete(key) {
      const k = fullKey(key);
      const entry = pending.get(k);
      if (entry) {
        entry.stale = true;
        pending.delete(k);
      }
      await store.delete([k]);
      counters.invalidations += 1;
    },

    stats() {
      return { ...counters };
    },
  };
}
