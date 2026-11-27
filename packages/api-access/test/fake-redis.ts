import { QUOTA_INCR_SCRIPT, TAG_ADD_SCRIPT } from "../src/redis";

import type { RedisLike } from "../src";

/**
 * In-memory Redis with the commands in `RedisLike`. Expiry uses `Date.now()`. `eval` runs a
 * JavaScript copy of each known script, so `redis.test.ts` checks the Lua on a real server.
 */
export class FakeRedis implements RedisLike {
  readonly strings = new Map<string, string>();
  readonly sets = new Map<string, Set<string>>();
  readonly expiry = new Map<string, number>();
  readonly calls: string[] = [];

  private alive(key: string): boolean {
    const at = this.expiry.get(key);
    if (at !== undefined && at <= Date.now()) {
      this.strings.delete(key);
      this.sets.delete(key);
      this.expiry.delete(key);
    }
    return this.strings.has(key) || this.sets.has(key);
  }

  incrby(key: string, by: number): Promise<number> {
    this.calls.push("incrby");
    if (!Number.isInteger(by)) {
      return Promise.reject(new Error("ERR value is not an integer or out of range"));
    }
    const current = this.alive(key) ? Number(this.strings.get(key)) : 0;
    const value = current + by;
    this.strings.set(key, String(value));
    return Promise.resolve(value);
  }

  pexpireat(key: string, ms: number): Promise<number> {
    this.calls.push("pexpireat");
    if (!this.alive(key)) return Promise.resolve(0);
    this.expiry.set(key, ms);
    return Promise.resolve(1);
  }

  pexpire(key: string, ms: number): Promise<number> {
    this.calls.push("pexpire");
    return this.pexpireat(key, Date.now() + ms);
  }

  get(key: string): Promise<string | null> {
    this.calls.push("get");
    return Promise.resolve(this.alive(key) ? (this.strings.get(key) ?? null) : null);
  }

  set(key: string, value: string, ...args: unknown[]): Promise<unknown> {
    this.calls.push("set");
    this.strings.set(key, value);
    this.expiry.delete(key);
    const [mode, amount] = args;
    if (mode === "PX") this.expiry.set(key, Date.now() + Number(amount));
    if (mode === "EX") this.expiry.set(key, Date.now() + Number(amount) * 1000);
    return Promise.resolve("OK");
  }

  del(...keys: string[]): Promise<number> {
    this.calls.push("del");
    let removed = 0;
    for (const key of keys) {
      if (this.alive(key)) removed += 1;
      this.strings.delete(key);
      this.sets.delete(key);
      this.expiry.delete(key);
    }
    return Promise.resolve(removed);
  }

  sadd(key: string, ...members: string[]): Promise<number> {
    this.calls.push("sadd");
    if (!this.alive(key)) this.sets.set(key, new Set());
    const set = this.sets.get(key) ?? new Set<string>();
    const before = set.size;
    for (const m of members) set.add(m);
    this.sets.set(key, set);
    return Promise.resolve(set.size - before);
  }

  smembers(key: string): Promise<string[]> {
    this.calls.push("smembers");
    return Promise.resolve(this.alive(key) ? [...(this.sets.get(key) ?? [])] : []);
  }

  pttl(key: string): number {
    if (!this.alive(key)) return -2;
    const at = this.expiry.get(key);
    return at === undefined ? -1 : at - Date.now();
  }

  /** Runs without yielding, like a script on a real server. */
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown> {
    this.calls.push("eval");
    const key = String(args[0] ?? "");
    const argv = args.slice(numKeys);
    if (script === QUOTA_INCR_SCRIPT) {
      const by = Number(argv[0]);
      if (!Number.isInteger(by)) {
        return Promise.reject(new Error("ERR value is not an integer or out of range"));
      }
      const value = (this.alive(key) ? Number(this.strings.get(key)) : 0) + by;
      this.strings.set(key, String(value));
      this.expiry.set(key, Number(argv[1]));
      return Promise.resolve(value);
    }
    if (script === TAG_ADD_SCRIPT) {
      if (!this.alive(key)) this.sets.set(key, new Set());
      this.sets.get(key)?.add(String(argv[0]));
      const ttl = Number(argv[1]);
      if (this.pttl(key) < ttl) this.expiry.set(key, Date.now() + ttl);
      return Promise.resolve(1);
    }
    return Promise.reject(new Error("FakeRedis: unknown script"));
  }
}
