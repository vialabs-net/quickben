/**
 * The Redis commands the Redis stores use. An ioredis client (the one bullmq uses) satisfies it.
 */
export interface RedisLike {
  incrby(key: string, by: number): Promise<number>;
  pexpireat(key: string, ms: number): Promise<number>;
  get(key: string): Promise<string | null>;
  // Matches ioredis overloads such as `set(key, value, "EX", seconds)`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set(key: string, value: string, ...args: any[]): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  pexpire(key: string, ms: number): Promise<number>;
  /** `EVAL script numKeys key... arg...`. The stores use it for atomic updates. */
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

/** INCRBY and PEXPIREAT in one step. KEYS[1] counter, ARGV[1] increment, ARGV[2] expiry (unix ms). */
export const QUOTA_INCR_SCRIPT = `local v = redis.call("INCRBY", KEYS[1], ARGV[1])
redis.call("PEXPIREAT", KEYS[1], ARGV[2])
return v`;

/**
 * SADD, then extend the set's TTL to ARGV[2] ms unless it already lives longer.
 * KEYS[1] tag set, ARGV[1] member, ARGV[2] TTL in ms.
 */
export const TAG_ADD_SCRIPT = `redis.call("SADD", KEYS[1], ARGV[1])
local ttl = tonumber(ARGV[2])
if redis.call("PTTL", KEYS[1]) < ttl then
  redis.call("PEXPIRE", KEYS[1], ttl)
end
return 1`;

/** A TypeError unless `by` is a safe integer. Redis INCRBY takes integers only. */
export function integerIncrementError(by: number): TypeError | undefined {
  return Number.isSafeInteger(by)
    ? undefined
    : new TypeError(`Quota increment must be an integer, got ${String(by)}.`);
}
