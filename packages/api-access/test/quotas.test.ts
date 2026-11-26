import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createQuotaLimiter,
  memoryQuotaStore,
  quotaHeaders,
  redisQuotaStore,
  type QuotaResult,
  type QuotaStore,
} from "../src";

import { FakeRedis } from "./fake-redis";

const MINUTE = 60_000;

function clock(iso: string) {
  let now = new Date(iso);
  return {
    now: () => now,
    set: (next: string) => {
      now = new Date(next);
    },
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

function setup(iso = "2026-11-26T12:00:30Z") {
  const c = clock(iso);
  const store = memoryQuotaStore({ now: c.now });
  const limiter = createQuotaLimiter({
    store,
    now: c.now,
    windows: [
      { name: "minute", kind: "fixed", ms: MINUTE },
      { name: "month", kind: "calendar-month" },
    ],
  });
  return { c, store, limiter };
}

const byName = (r: QuotaResult, name: string) => r.windows.find((w) => w.name === name);

describe("createQuotaLimiter", () => {
  it("counts requests and reports remaining and reset", async () => {
    const { limiter } = setup();
    const r = await limiter.consume("key1", { limits: { minute: 3, month: 100 } });
    expect(r).toMatchObject({ allowed: true, enforced: true, exceeded: [], retryAfterSec: null });
    expect(byName(r, "minute")).toEqual({
      name: "minute",
      limit: 3,
      used: 1,
      remaining: 2,
      resetAt: new Date("2026-11-26T12:01:00Z"),
    });
    expect(byName(r, "month")?.resetAt).toEqual(new Date("2026-12-01T00:00:00Z"));
  });

  it("refuses over the limit and does not count the refused request", async () => {
    const { limiter } = setup();
    const limits = { minute: 2, month: 100 };
    await limiter.consume("k", { limits });
    await limiter.consume("k", { limits });
    const refused = await limiter.consume("k", { limits });
    expect(refused.allowed).toBe(false);
    expect(refused.exceeded).toEqual(["minute"]);
    expect(refused.retryAfterSec).toBe(30);
    expect(byName(refused, "minute")?.used).toBe(2);
    expect(byName(refused, "month")?.used).toBe(2);
    const peek = await limiter.peek("k", limits);
    expect(byName(peek, "month")?.used).toBe(2);
  });

  it("refuses a cost larger than the room left", async () => {
    const { limiter } = setup();
    await limiter.consume("k", { limits: { minute: 10 }, cost: 8 });
    const r = await limiter.consume("k", { limits: { minute: 10 }, cost: 3 });
    expect(r.allowed).toBe(false);
    expect(byName(r, "minute")?.used).toBe(8);
    expect((await limiter.consume("k", { limits: { minute: 10 }, cost: 2 })).allowed).toBe(true);
  });

  it("counts past the limit when enforce is false", async () => {
    const { limiter } = setup();
    let r: QuotaResult | undefined;
    for (let i = 0; i < 5; i++) {
      r = await limiter.consume("k", { limits: { minute: 3 }, enforce: false });
    }
    expect(r).toMatchObject({ allowed: true, enforced: false, exceeded: ["minute"] });
    expect(r && byName(r, "minute")).toMatchObject({ used: 5, remaining: 0 });
  });

  it("treats null and missing limits as unlimited but still counts", async () => {
    const { limiter } = setup();
    for (let i = 0; i < 4; i++) await limiter.consume("k", { limits: { minute: null } });
    const r = await limiter.consume("k", { limits: {} });
    expect(r.allowed).toBe(true);
    expect(byName(r, "minute")).toMatchObject({ limit: null, used: 5, remaining: null });
  });

  it("keeps subjects separate", async () => {
    const { limiter } = setup();
    await limiter.consume("a", { limits: { minute: 1 } });
    expect((await limiter.consume("a", { limits: { minute: 1 } })).allowed).toBe(false);
    expect((await limiter.consume("b", { limits: { minute: 1 } })).allowed).toBe(true);
  });

  it("starts a new fixed window after it resets", async () => {
    const { c, limiter } = setup();
    await limiter.consume("k", { limits: { minute: 1 } });
    expect((await limiter.consume("k", { limits: { minute: 1 } })).allowed).toBe(false);
    c.advance(30_000);
    const r = await limiter.consume("k", { limits: { minute: 1 } });
    expect(r.allowed).toBe(true);
    expect(byName(r, "minute")?.used).toBe(1);
    expect(byName(r, "month")?.used).toBe(2);
  });

  it("uses the latest reset of the exceeded windows for retryAfterSec", async () => {
    const { limiter } = setup("2026-11-30T23:59:00Z");
    await limiter.consume("k", { limits: { minute: 1, month: 1 } });
    const r = await limiter.consume("k", { limits: { minute: 1, month: 1 } });
    expect(r.exceeded).toEqual(["minute", "month"]);
    expect(r.retryAfterSec).toBe(60);
  });

  it("resets a calendar-month window at midnight in its time zone", async () => {
    // Chile is on UTC-3 in December 2026.
    const c = clock("2026-12-01T02:59:59Z");
    const limiter = createQuotaLimiter({
      store: memoryQuotaStore({ now: c.now }),
      now: c.now,
      windows: [{ name: "month", kind: "calendar-month", timeZone: "America/Santiago" }],
    });
    const limits = { month: 1 };
    const first = await limiter.consume("k", { limits });
    expect(byName(first, "month")?.resetAt).toEqual(new Date("2026-12-01T03:00:00Z"));
    const refused = await limiter.consume("k", { limits });
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSec).toBe(1);
    c.set("2026-12-01T03:00:00Z");
    const next = await limiter.consume("k", { limits });
    expect(next.allowed).toBe(true);
    expect(byName(next, "month")).toMatchObject({
      used: 1,
      resetAt: new Date("2027-01-01T03:00:00Z"),
    });
  });

  it("computes month resets across a DST change", async () => {
    const c = clock("2026-03-15T12:00:00Z");
    const limiter = createQuotaLimiter({
      store: memoryQuotaStore({ now: c.now }),
      now: c.now,
      windows: [{ name: "month", kind: "calendar-month", timeZone: "America/New_York" }],
    });
    // March starts on EST (UTC-5), April on EDT (UTC-4).
    const r = await limiter.peek("k", {});
    expect(byName(r, "month")?.resetAt).toEqual(new Date("2026-04-01T04:00:00Z"));
    c.set("2026-12-15T12:00:00Z");
    const dec = await limiter.peek("k", {});
    expect(byName(dec, "month")?.resetAt).toEqual(new Date("2027-01-01T05:00:00Z"));
  });

  it("peek reports without counting", async () => {
    const { limiter } = setup();
    await limiter.consume("k", { limits: { minute: 2 } });
    const p1 = await limiter.peek("k", { minute: 2 });
    expect(p1).toMatchObject({ allowed: true, retryAfterSec: null });
    expect(byName(p1, "minute")?.used).toBe(1);
    await limiter.consume("k", { limits: { minute: 2 } });
    const p2 = await limiter.peek("k", { minute: 2 });
    expect(p2).toMatchObject({ allowed: false, exceeded: ["minute"], retryAfterSec: 30 });
  });

  it("undoes the count when another request took the last slot", async () => {
    const inner = memoryQuotaStore();
    // The first read sees 0; the counter already holds 1 from a concurrent request.
    let reads = 0;
    const store: QuotaStore = {
      get: async (key) => (reads++ === 0 ? 0 : inner.get(key)),
      incr: (key, by, at) => inner.incr(key, by, at),
    };
    const limiter = createQuotaLimiter({
      store,
      windows: [{ name: "minute", kind: "fixed", ms: MINUTE }],
    });
    const now = new Date();
    const key = JSON.stringify([
      "k",
      "minute",
      String(Math.floor(now.getTime() / MINUTE) * MINUTE),
    ]);
    await inner.incr(key, 1, new Date(now.getTime() + MINUTE));
    const r = await limiter.consume("k", { limits: { minute: 1 } });
    expect(r.allowed).toBe(false);
    expect(byName(r, "minute")?.used).toBe(1);
    expect(await inner.get(key)).toBe(1);
  });

  it("validates windows and cost", async () => {
    const store = memoryQuotaStore();
    expect(() =>
      createQuotaLimiter({ store, windows: [{ name: "m", kind: "fixed", ms: 0 }] }),
    ).toThrow(TypeError);
    expect(() =>
      createQuotaLimiter({
        store,
        windows: [
          { name: "m", kind: "fixed", ms: 1000 },
          { name: "m", kind: "fixed", ms: 2000 },
        ],
      }),
    ).toThrow(/Duplicate/);
    expect(() =>
      createQuotaLimiter({ store, windows: [{ name: "", kind: "fixed", ms: 1000 }] }),
    ).toThrow(TypeError);
    expect(() =>
      createQuotaLimiter({
        store,
        windows: [{ name: "m", kind: "calendar-month", timeZone: "Nowhere/Nope" }],
      }),
    ).toThrow(RangeError);
    const limiter = createQuotaLimiter({ store, windows: [] });
    await expect(limiter.consume("k", { limits: {}, cost: -1 })).rejects.toThrow(TypeError);
    await expect(limiter.consume("k", { limits: {}, cost: 0.5 })).rejects.toThrow(/integer/);
    await expect(limiter.consume("k", { limits: {}, cost: Number.NaN })).rejects.toThrow(TypeError);
    expect((await limiter.consume("k", { limits: {}, cost: 0 })).allowed).toBe(true);
  });

  it("keeps subject and window apart in store keys", async () => {
    const c = clock("2026-11-26T12:00:30Z");
    const limiter = createQuotaLimiter({
      store: memoryQuotaStore({ now: c.now }),
      now: c.now,
      windows: [
        { name: "b:c", kind: "fixed", ms: MINUTE },
        { name: "c", kind: "fixed", ms: MINUTE },
      ],
    });
    await limiter.consume("a", { limits: { "b:c": 1 } });
    const other = await limiter.consume("a:b", { limits: { c: 1 } });
    expect(other.allowed).toBe(true);
    expect(byName(other, "c")?.used).toBe(1);
  });
});

describe("memoryQuotaStore", () => {
  it("expires counters", async () => {
    const c = clock("2026-01-01T00:00:00Z");
    const store = memoryQuotaStore({ now: c.now });
    expect(await store.incr("a", 2, new Date("2026-01-01T00:00:10Z"))).toBe(2);
    expect(await store.get("a")).toBe(2);
    c.advance(10_000);
    expect(await store.get("a")).toBe(0);
    expect(await store.incr("a", 1, new Date("2026-01-01T00:01:00Z"))).toBe(1);
  });

  it("drops expired counters as it writes", async () => {
    const c = clock("2026-01-01T00:00:00Z");
    const store = memoryQuotaStore({ now: c.now });
    for (let i = 0; i < 1000; i++)
      await store.incr(`k${String(i)}`, 1, new Date(c.now().getTime() + 1));
    c.advance(5);
    await store.incr("fresh", 1, new Date(c.now().getTime() + 1000));
    expect(await store.get("k0")).toBe(0);
    expect(await store.get("fresh")).toBe(1);
  });
});

describe("redisQuotaStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects a non-integer increment in every store", async () => {
    const at = new Date(Date.now() + 1000);
    await expect(memoryQuotaStore().incr("x", 0.5, at)).rejects.toThrow(/integer/);
    await expect(redisQuotaStore(new FakeRedis()).incr("x", 0.5, at)).rejects.toThrow(/integer/);
    expect(await memoryQuotaStore().incr("x", -2, at)).toBe(-2);
  });

  it("counts and sets the expiry in one EVAL", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-26T12:00:30Z") });
    const redis = new FakeRedis();
    const store = redisQuotaStore(redis);
    const at = new Date("2026-11-26T12:01:00Z");
    expect(await store.incr("x", 2, at)).toBe(2);
    expect(await store.incr("x", 3, at)).toBe(5);
    expect(redis.strings.get("qb:quota:x")).toBe("5");
    expect(redis.expiry.get("qb:quota:x")).toBe(at.getTime());
    expect(redis.calls.filter((c) => c === "eval")).toHaveLength(2);
    expect(redis.calls).not.toContain("incrby");
    expect(await store.get("x")).toBe(5);
    expect(await store.get("missing")).toBe(0);
    vi.setSystemTime(at);
    expect(await store.get("x")).toBe(0);
  });

  it("uses the prefix and ignores non-numeric values", async () => {
    const redis = new FakeRedis();
    const store = redisQuotaStore(redis, { prefix: "app:" });
    await redis.set("app:bad", "oops");
    expect(await store.get("bad")).toBe(0);
    await store.incr("n", 1, new Date(Date.now() + 1000));
    expect(redis.strings.has("app:n")).toBe(true);
  });

  it("works with the limiter", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-26T12:00:30Z") });
    const redis = new FakeRedis();
    const limiter = createQuotaLimiter({
      store: redisQuotaStore(redis),
      windows: [{ name: "minute", kind: "fixed", ms: MINUTE }],
    });
    await limiter.consume("k", { limits: { minute: 1 } });
    const refused = await limiter.consume("k", { limits: { minute: 1 } });
    expect(refused.allowed).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect((await limiter.consume("k", { limits: { minute: 1 } })).allowed).toBe(true);
  });
});

describe("quotaHeaders", () => {
  it("writes headers for windows with a limit", async () => {
    const c = clock("2026-11-26T12:00:30Z");
    const limiter = createQuotaLimiter({
      store: memoryQuotaStore({ now: c.now }),
      now: c.now,
      windows: [
        { name: "per_minute", kind: "fixed", ms: MINUTE },
        { name: "month", kind: "calendar-month" },
      ],
    });
    const ok = await limiter.consume("k", { limits: { per_minute: 1 } });
    expect(quotaHeaders(ok)).toEqual({
      "X-RateLimit-Limit-Per-Minute": "1",
      "X-RateLimit-Remaining-Per-Minute": "0",
      "X-RateLimit-Reset-Per-Minute": String(Date.parse("2026-11-26T12:01:00Z") / 1000),
    });
    const refused = await limiter.consume("k", { limits: { per_minute: 1, month: 10 } });
    expect(quotaHeaders(refused)).toMatchObject({
      "X-RateLimit-Limit-Month": "10",
      "X-RateLimit-Remaining-Month": "9",
      "X-RateLimit-Reset-Month": String(Date.parse("2026-12-01T00:00:00Z") / 1000),
      "Retry-After": "30",
    });
  });
});
