import { connect, type Socket } from "node:net";

import type { RedisLike } from "../src";

type Reply = string | number | null | Reply[] | Error;

/** Minimal RESP2 client implementing `RedisLike`, for tests against a real server. */
export class RespRedis implements RedisLike {
  private buffer = Buffer.alloc(0);
  private readonly waiting: { resolve: (r: Reply) => void; reject: (e: Error) => void }[] = [];

  private constructor(private readonly socket: Socket) {
    socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
  }

  static open(url: string): Promise<RespRedis> {
    const { hostname, port } = new URL(url);
    return new Promise((resolve, reject) => {
      const socket = connect(Number(port || 6379), hostname, () => {
        resolve(new RespRedis(socket));
      });
      socket.once("error", reject);
    });
  }

  close(): void {
    this.socket.end();
  }

  private drain(): void {
    for (;;) {
      const parsed = parse(this.buffer, 0);
      if (!parsed) return;
      this.buffer = this.buffer.subarray(parsed.end);
      const next = this.waiting.shift();
      if (!next) continue;
      if (parsed.value instanceof Error) next.reject(parsed.value);
      else next.resolve(parsed.value);
    }
  }

  command(...args: (string | number)[]): Promise<Reply> {
    const parts = args.map(String);
    let out = `*${String(parts.length)}\r\n`;
    for (const p of parts) out += `$${String(Buffer.byteLength(p))}\r\n${p}\r\n`;
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject });
      this.socket.write(out);
    });
  }

  incrby = (key: string, by: number) => this.command("INCRBY", key, by) as Promise<number>;
  pexpireat = (key: string, ms: number) => this.command("PEXPIREAT", key, ms) as Promise<number>;
  pexpire = (key: string, ms: number) => this.command("PEXPIRE", key, ms) as Promise<number>;
  get = (key: string) => this.command("GET", key) as Promise<string | null>;
  set = (key: string, value: string, ...args: (string | number)[]) =>
    this.command("SET", key, value, ...args) as Promise<unknown>;
  del = (...keys: string[]) => this.command("DEL", ...keys) as Promise<number>;
  sadd = (key: string, ...members: string[]) =>
    this.command("SADD", key, ...members) as Promise<number>;
  smembers = (key: string) => this.command("SMEMBERS", key) as Promise<string[]>;
  eval = (script: string, numKeys: number, ...args: (string | number)[]) =>
    this.command("EVAL", script, numKeys, ...args) as Promise<unknown>;
  pttl = (key: string) => this.command("PTTL", key) as Promise<number>;
}

function parse(buf: Buffer, start: number): { value: Reply; end: number } | null {
  const lineEnd = buf.indexOf("\r\n", start);
  if (lineEnd < 0) return null;
  const type = String.fromCodePoint(buf[start] ?? 0);
  const line = buf.toString("utf8", start + 1, lineEnd);
  const after = lineEnd + 2;
  switch (type) {
    case "+":
      return { value: line, end: after };
    case "-":
      return { value: new Error(line), end: after };
    case ":":
      return { value: Number(line), end: after };
    case "$": {
      const len = Number(line);
      if (len < 0) return { value: null, end: after };
      if (buf.length < after + len + 2) return null;
      return { value: buf.toString("utf8", after, after + len), end: after + len + 2 };
    }
    case "*": {
      const count = Number(line);
      if (count < 0) return { value: null, end: after };
      const items: Reply[] = [];
      let pos = after;
      for (let i = 0; i < count; i++) {
        const item = parse(buf, pos);
        if (!item) return null;
        items.push(item.value);
        pos = item.end;
      }
      return { value: items, end: pos };
    }
    default:
      throw new Error(`Unexpected RESP type ${type}`);
  }
}
