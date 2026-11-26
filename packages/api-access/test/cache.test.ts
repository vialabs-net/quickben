import { afterEach, describe, expect, it, vi } from "vitest";

import { createCache, memoryCacheStore, redisCacheStore, type CacheStore } from "../src";

import { FakeRedis } from "./fake-redis";

function stores(): [string, () => { store: CacheStore; redis?: FakeRedis }][] {
  return [
    ["memory", () => ({ store: memoryCacheStore() })],
    [
      "redis",
      () => {
        const redis = new FakeRedis();
        return { store: redisCacheStore(redis), redis };
      },
    ],
  ];
}

function deferred<T>() {
  const d = {} as { promise: Promise<T>; resolve: (value: T) => void };
  d.promise = new Promise<T>((resolve) => {
    d.resolve = resolve;
  });
  return d;
}

afterEach(() => {
  vi.useRealTimers();
});

describe.each(stores())("%s cache store", (_name, make) => {
  it("sets, gets, expires and deletes values", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-26T12:00:00Z") });
    const { store } = make();
    expect(await store.get("a")).toBeNull();
    await store.set("a", "1", 10);
    await store.set("b", "2", 10);
    expect(await store.get("a")).toBe("1");
    await store.delete(["a"]);
    await store.delete([]);
    expect(await store.get("a")).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(await store.get("b")).toBeNull();
  });

  it("tracks tags and keeps them as long as the longest key", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-26T12:00:00Z") });
    const { store } = make();
    await store.addToTag("t", "a", 100);
    await store.addToTag("t", "b", 5);
    expect((await store.keysForTag("t")).sort((x, y) => x.localeCompare(y))).toEqual(["a", "b"]);
    vi.advanceTimersByTime(50_000);
    expect((await store.keysForTag("t")).sort((x, y) => x.localeCompare(y))).toEqual(["a", "b"]);
    vi.advanceTimersByTime(50_000);
    expect(await store.keysForTag("t")).toEqual([]);
    await store.addToTag("t", "c", 5);
    expect(await store.keysForTag("t")).toEqual(["c"]);
    await store.clearTag("t");
    expect(await store.keysForTag("t")).toEqual([]);
  });
});

describe("redisCacheStore", () => {
  it("uses the prefix and SET PX", async () => {
    const redis = new FakeRedis();
    const store = redisCacheStore(redis, { prefix: "app:" });
    await store.set("k", "v", 2);
    await store.addToTag("t", "k", 2);
    expect(redis.strings.get("app:v:k")).toBe("v");
    expect(redis.sets.get("app:t:t")).toEqual(new Set(["k"]));
    expect(redis.expiry.get("app:v:k")).toBeGreaterThan(Date.now());
  });
});

describe("createCache", () => {
  it("loads once, then hits", async () => {
    const cache = createCache({ store: memoryCacheStore(), namespace: "ns" });
    const loader = vi.fn(() => Promise.resolve({ n: 1 }));
    expect(await cache.getOrLoad("k", 60, loader)).toEqual({ value: { n: 1 }, hit: false });
    expect(await cache.getOrLoad("k", 60, loader)).toEqual({ value: { n: 1 }, hit: true });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toEqual({ hits: 1, misses: 1, invalidations: 0 });
  });

  it("serializes values as JSON", async () => {
    const cache = createCache({ store: memoryCacheStore(), namespace: "ns" });
    const at = new Date("2026-01-01T00:00:00Z");
    await cache.getOrLoad("d", 60, () => Promise.resolve({ at }));
    const { value } = await cache.getOrLoad("d", 60, () => Promise.resolve({ at }));
    expect(value).toEqual({ at: "2026-01-01T00:00:00.000Z" });
  });

  it("caches null but not undefined", async () => {
    const cache = createCache({ store: memoryCacheStore(), namespace: "ns" });
    await cache.getOrLoad("n", 60, () => Promise.resolve(null));
    expect((await cache.getOrLoad("n", 60, () => Promise.resolve(1))).hit).toBe(true);
    await cache.getOrLoad("u", 60, () => Promise.resolve(undefined));
    expect(await cache.getOrLoad("u", 60, () => Promise.resolve(2))).toEqual({
      value: 2,
      hit: false,
    });
  });

  it("prefixes keys with the namespace", async () => {
    const store = memoryCacheStore();
    const a = createCache({ store, namespace: "a" });
    const b = createCache({ store, namespace: "b" });
    await a.getOrLoad("k", 60, () => Promise.resolve("A"));
    expect(await store.get("a:k")).toBe('"A"');
    expect(await b.getOrLoad("k", 60, () => Promise.resolve("B"))).toEqual({
      value: "B",
      hit: false,
    });
  });

  it("invalidates by tag", async () => {
    const redis = new FakeRedis();
    const cache = createCache({ store: redisCacheStore(redis), namespace: "ns" });
    await cache.getOrLoad("a", 60, () => Promise.resolve(1), { tags: ["vehicle:1"] });
    await cache.getOrLoad("b", 60, () => Promise.resolve(2), { tags: ["vehicle:1", "list"] });
    await cache.getOrLoad("c", 60, () => Promise.resolve(3), { tags: ["list"] });
    expect(await cache.invalidateTag("vehicle:1")).toBe(2);
    expect((await cache.getOrLoad("a", 60, () => Promise.resolve(10))).hit).toBe(false);
    expect((await cache.getOrLoad("b", 60, () => Promise.resolve(20))).hit).toBe(false);
    expect((await cache.getOrLoad("c", 60, () => Promise.resolve(30))).hit).toBe(true);
    expect(await cache.invalidateTag("vehicle:1")).toBe(0);
    expect(cache.stats().invalidations).toBe(2);
  });

  it("deletes one key", async () => {
    const cache = createCache({ store: memoryCacheStore(), namespace: "ns" });
    await cache.getOrLoad("k", 60, () => Promise.resolve(1));
    await cache.delete("k");
    expect((await cache.getOrLoad("k", 60, () => Promise.resolve(2))).value).toBe(2);
    expect(cache.stats()).toEqual({ hits: 0, misses: 2, invalidations: 1 });
  });

  it("always calls the loader when disabled", async () => {
    let enabled = false;
    const store = memoryCacheStore();
    const cache = createCache({ store, namespace: "ns", enabled: () => enabled });
    const loader = vi.fn(() => Promise.resolve(1));
    expect(await cache.getOrLoad("k", 60, loader)).toEqual({ value: 1, hit: false });
    expect(await cache.getOrLoad("k", 60, loader)).toEqual({ value: 1, hit: false });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(await store.get("ns:k")).toBeNull();
    expect(cache.stats()).toEqual({ hits: 0, misses: 0, invalidations: 0 });
    enabled = true;
    await cache.getOrLoad("k", 60, loader);
    expect((await cache.getOrLoad("k", 60, loader)).hit).toBe(true);

    const off = createCache({ store, namespace: "ns", enabled: false });
    expect((await off.getOrLoad("k", 60, () => Promise.resolve(5))).value).toBe(5);
  });

  it("shares one loader call between concurrent requests", async () => {
    const cache = createCache({ store: memoryCacheStore(), namespace: "ns" });
    const d = deferred<number>();
    const loader = vi.fn(() => d.promise);
    const p1 = cache.getOrLoad("k", 60, loader);
    const p2 = cache.getOrLoad("k", 60, loader);
    await vi.waitFor(() => {
      expect(loader).toHaveBeenCalled();
    });
    d.resolve(7);
    expect(await p1).toEqual({ value: 7, hit: false });
    expect(await p2).toEqual({ value: 7, hit: false });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not store a load that was invalidated while running", async () => {
    const cache = createCache({ store: memoryCacheStore(), namespace: "ns" });
    const d1 = deferred<number>();
    const pending = cache.getOrLoad("k", 60, () => d1.promise, {
      tags: ["t"],
    });
    await new Promise((r) => setTimeout(r, 0));
    await cache.invalidateTag("t");
    d1.resolve(1);
    expect((await pending).value).toBe(1);
    expect((await cache.getOrLoad("k", 60, () => Promise.resolve(2))).value).toBe(2);

    const d2 = deferred<number>();
    const second = cache.getOrLoad("j", 60, () => d2.promise);
    await new Promise((r) => setTimeout(r, 0));
    await cache.delete("j");
    d2.resolve(1);
    await second;
    expect((await cache.getOrLoad("j", 60, () => Promise.resolve(3))).value).toBe(3);
  });

  it("falls back to the loader when the store fails", async () => {
    const errors: unknown[] = [];
    const broken: CacheStore = {
      ...memoryCacheStore(),
      get: () => Promise.reject(new Error("down")),
      set: () => Promise.reject(new Error("down")),
    };
    const cache = createCache({
      store: broken,
      namespace: "ns",
      onError: (e) => errors.push(e),
    });
    expect(await cache.getOrLoad("k", 60, () => Promise.resolve(1))).toEqual({
      value: 1,
      hit: false,
    });
    expect(errors).toHaveLength(2);
    const quiet = createCache({ store: broken, namespace: "ns" });
    expect((await quiet.getOrLoad("k", 60, () => Promise.resolve(2))).value).toBe(2);
  });

  it("does not cache a loader that throws", async () => {
    const cache = createCache({ store: memoryCacheStore(), namespace: "ns" });
    await expect(cache.getOrLoad("k", 60, () => Promise.reject(new Error("x")))).rejects.toThrow(
      "x",
    );
    expect((await cache.getOrLoad("k", 60, () => Promise.resolve(1))).hit).toBe(false);
  });
});
