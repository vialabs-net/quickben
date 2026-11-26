import { TAG_ADD_SCRIPT, type RedisLike } from "./redis";

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

const SWEEP_EVERY = 1000;

/** In-process cache store, for tests and one server. Expired entries are removed every 1000 writes. */
export function memoryCacheStore(opts: { now?: () => Date } = {}): CacheStore {
  const now = () => (opts.now ? opts.now().getTime() : Date.now());
  const values = new Map<string, { value: string; expiresAt: number }>();
  const tags = new Map<string, { keys: Set<string>; expiresAt: number }>();
  let writes = 0;
  const sweep = () => {
    writes += 1;
    if (writes % SWEEP_EVERY !== 0) return;
    const t = now();
    for (const [key, entry] of values) if (entry.expiresAt <= t) values.delete(key);
    for (const [tag, entry] of tags) if (entry.expiresAt <= t) tags.delete(tag);
  };
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
      sweep();
      values.set(key, { value, expiresAt: now() + ttlSec * 1000 });
      return Promise.resolve();
    },
    delete(keys) {
      for (const key of keys) values.delete(key);
      return Promise.resolve();
    },
    addToTag(tag, key, ttlSec) {
      sweep();
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

const ttlMs = (ttlSec: number) => Math.max(1, Math.round(ttlSec * 1000));

/**
 * Cache store on Redis. Values are `${prefix}v:${key}`; tags are sets at `${prefix}t:${tag}`
 * (default prefix `qb:cache:`). `addToTag` runs in one EVAL and only extends a tag's TTL, so a
 * tag lives as long as its longest-lived key.
 */
export function redisCacheStore(redis: RedisLike, opts: { prefix?: string } = {}): CacheStore {
  const prefix = opts.prefix ?? "qb:cache:";
  const valueKey = (key: string) => `${prefix}v:${key}`;
  const tagKey = (tag: string) => `${prefix}t:${tag}`;
  return {
    async get(key) {
      return redis.get(valueKey(key));
    },
    async set(key, value, ttlSec) {
      await redis.set(valueKey(key), value, "PX", ttlMs(ttlSec));
    },
    async delete(keys) {
      if (keys.length > 0) await redis.del(...keys.map(valueKey));
    },
    async addToTag(tag, key, ttlSec) {
      await redis.eval(TAG_ADD_SCRIPT, 1, tagKey(tag), key, ttlMs(ttlSec));
    },
    async keysForTag(tag) {
      return redis.smembers(tagKey(tag));
    },
    async clearTag(tag) {
      await redis.del(tagKey(tag));
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

interface Load {
  key: string;
  tags: string[];
  promise: Promise<unknown>;
  /** Set by `invalidateTag` or `delete` while the load runs. A stale load does not stay stored. */
  stale: boolean;
}

/**
 * Read-through cache. Values are stored as JSON, so a `Date` comes back as a string on a hit.
 * Store keys and tags are `JSON.stringify([namespace, key])` and `JSON.stringify([namespace, tag])`.
 * Concurrent calls for one key in this process share one loader call. When `enabled` is false
 * (or returns false) every call runs the loader and nothing is counted. Store errors are passed
 * to `onError` and the loader result is returned.
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
  const fullKey = (key: string) => JSON.stringify([namespace, key]);
  const fullTag = (tag: string) => JSON.stringify([namespace, tag]);
  const counters: CacheStats = { hits: 0, misses: 0, invalidations: 0 };
  /** The load new callers for a key join. */
  const pending = new Map<string, Load>();
  /** Every load still running, including stale ones. */
  const running = new Set<Load>();
  /** The load whose `store.set` for a key finished last, while it is still running. */
  const lastWriter = new Map<string, Load>();

  const read = async (key: string): Promise<{ found: boolean; value?: unknown }> => {
    try {
      const raw = await store.get(key);
      return raw === null ? { found: false } : { found: true, value: JSON.parse(raw) };
    } catch (error) {
      onError(error);
      return { found: false };
    }
  };

  /** Deletes the load's value unless a later load has written the key since. */
  const retract = async (load: Load) => {
    if (lastWriter.get(load.key) !== load) return;
    try {
      await store.delete([load.key]);
    } catch (error) {
      onError(error);
    }
  };

  // A function, so TypeScript does not narrow `stale` across awaits.
  const isStale = (load: Load) => load.stale;

  const publish = async (load: Load, value: unknown, ttlSec: number) => {
    if (isStale(load)) return;
    try {
      await store.set(load.key, JSON.stringify(value), ttlSec);
    } catch (error) {
      onError(error);
      return;
    }
    lastWriter.set(load.key, load);
    if (isStale(load)) {
      await retract(load);
      return;
    }
    try {
      await Promise.all(load.tags.map((tag) => store.addToTag(fullTag(tag), load.key, ttlSec)));
    } catch (error) {
      // Without its tags the value could not be invalidated.
      onError(error);
      await retract(load);
      return;
    }
    // Invalidated while the tags were written: the tag may hold the key again.
    if (isStale(load)) await retract(load);
  };

  const run = async <T>(load: Load, ttlSec: number, loader: () => Promise<T>): Promise<T> => {
    try {
      const value = await loader();
      if ((value as unknown) !== undefined) await publish(load, value, ttlSec);
      return value;
    } finally {
      running.delete(load);
      if (pending.get(load.key) === load) pending.delete(load.key);
      if (lastWriter.get(load.key) === load) lastWriter.delete(load.key);
    }
  };

  /** Marks matching loads stale. Returns the keys they have already written. */
  const markStale = (match: (load: Load) => boolean): string[] => {
    const written: string[] = [];
    for (const load of running) {
      if (!match(load)) continue;
      load.stale = true;
      if (pending.get(load.key) === load) pending.delete(load.key);
      if (lastWriter.get(load.key) === load) written.push(load.key);
    }
    return written;
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
      const shared = pending.get(k);
      if (shared) return { value: (await shared.promise) as T, hit: false };
      const load: Load = {
        key: k,
        tags: loadOpts.tags ?? [],
        promise: Promise.resolve(),
        stale: false,
      };
      pending.set(k, load);
      running.add(load);
      // The loader starts after the load is registered, so a synchronous throw is cleaned up too.
      load.promise = Promise.resolve().then(() => run(load, ttlSec, loader));
      return { value: (await load.promise) as T, hit: false };
    },

    async invalidateTag(tag) {
      // A running load may have written its value but not yet its tags.
      const written = markStale((load) => load.tags.includes(tag));
      const t = fullTag(tag);
      const keys = [...new Set([...(await store.keysForTag(t)), ...written])];
      await store.delete(keys);
      await store.clearTag(t);
      counters.invalidations += keys.length;
      return keys.length;
    },

    async delete(key) {
      const k = fullKey(key);
      markStale((load) => load.key === k);
      await store.delete([k]);
      counters.invalidations += 1;
    },

    stats() {
      return { ...counters };
    },
  };
}
