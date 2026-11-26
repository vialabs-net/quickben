import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCache, createQuotaLimiter, redisCacheStore, redisQuotaStore } from "../src";

import { RespRedis } from "./resp-redis";

// Runs the Lua scripts on a real server: QUICKBEN_TEST_REDIS_URL=redis://127.0.0.1:6379
const url = process.env.QUICKBEN_TEST_REDIS_URL;

describe.runIf(url)("Redis stores on a real server", () => {
  let redis: RespRedis;
  const prefix = `qb-test:${randomUUID()}:`;

  beforeAll(async () => {
    redis = await RespRedis.open(url ?? "");
  });

  afterAll(async () => {
    const keys = (await redis.command("KEYS", `${prefix}*`)) as string[];
    if (keys.length > 0) await redis.del(...keys);
    redis.close();
  });

  it("increments and sets the expiry in one EVAL", async () => {
    const store = redisQuotaStore(redis, { prefix });
    const at = new Date(Date.now() + 60_000);
    expect(await store.incr("q", 2, at)).toBe(2);
    expect(await store.incr("q", -1, at)).toBe(1);
    expect(await store.get("q")).toBe(1);
    const ttl = await redis.pttl(`${prefix}q`);
    expect(ttl).toBeGreaterThan(50_000);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });

  it("refuses over the limit with the limiter", async () => {
    const limiter = createQuotaLimiter({
      store: redisQuotaStore(redis, { prefix }),
      windows: [{ name: "minute", kind: "fixed", ms: 60_000 }],
    });
    const limits = { minute: 2 };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => limiter.consume("s", { limits })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(2);
    expect((await limiter.peek("s", limits)).windows[0]?.used).toBe(2);
  });

  it("keeps the longest tag TTL under concurrent additions", async () => {
    const store = redisCacheStore(redis, { prefix });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => store.addToTag("t", `k${String(i)}`, i % 2 ? 1 : 300)),
    );
    expect(await redis.pttl(`${prefix}t:t`)).toBeGreaterThan(290_000);
    expect(await store.keysForTag("t")).toHaveLength(20);
    await store.addToTag("t", "late", 1);
    expect(await redis.pttl(`${prefix}t:t`)).toBeGreaterThan(290_000);
  });

  it("caches and invalidates by tag", async () => {
    const cache = createCache({ store: redisCacheStore(redis, { prefix }), namespace: "ns" });
    await cache.getOrLoad("a", 60, () => Promise.resolve({ n: 1 }), { tags: ["v:1"] });
    expect((await cache.getOrLoad("a", 60, () => Promise.resolve({ n: 2 }))).hit).toBe(true);
    expect(await cache.invalidateTag("v:1")).toBe(1);
    expect((await cache.getOrLoad("a", 60, () => Promise.resolve({ n: 3 }))).value).toEqual({
      n: 3,
    });
  });
});
