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
}
