import { describe, expect, it, vi } from "vitest";

import { currentRequest, getQuickben, getRequestContext, getUser, singleton } from "../src";

import { editor, makeConfig } from "./fixtures";

const incoming = new Headers();
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(incoming),
  cookies: () =>
    Promise.resolve({ getAll: () => [...jar].map(([name, value]) => ({ name, value })) }),
}));
const connection = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("next/server", () => ({ connection }));

describe("singleton", () => {
  it("creates a value once per key", () => {
    const create = vi.fn(() => ({ n: 1 }));
    const first = singleton("test-key", create);
    expect(singleton("test-key", create)).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("getQuickben", () => {
  it("caches one instance per config", async () => {
    const config = makeConfig();
    const qb = await getQuickben(config);
    expect(await getQuickben(config)).toBe(qb);
    expect(await getQuickben(makeConfig())).not.toBe(qb);
  });

  it("drops a failed init so the next call retries", async () => {
    const config = makeConfig();
    const init = vi
      .spyOn(config.db, "init")
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue();
    await expect(getQuickben(config)).rejects.toThrow("down");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(getQuickben(config)).resolves.toBeDefined();
    expect(init).toHaveBeenCalledTimes(2);
  });
});

describe("request helpers", () => {
  it("build a request from next/headers and resolve the user", async () => {
    incoming.set("host", "example.test");
    incoming.set("x-quickben-user", editor);
    const req = await currentRequest();
    expect(req.url).toBe("http://example.test/");
    const config = makeConfig();
    expect(await getUser(config)).toMatchObject({ id: "e1", roles: ["editor"] });
    const ctx = await getRequestContext({ ...config, auth: undefined });
    expect(ctx.user).toBeNull();
    expect(connection).toHaveBeenCalled();
  });

  it("takes cookies from the cookie store, including ones set in this request", async () => {
    incoming.set("cookie", "stale=1");
    jar.set("session", "a b;c");
    jar.set("theme", "dark");
    expect((await currentRequest()).headers.get("cookie")).toBe("session=a%20b%3Bc; theme=dark");
    jar.clear();
    expect((await currentRequest()).headers.get("cookie")).toBeNull();
  });

  it("honours forwarded headers", async () => {
    incoming.set("x-forwarded-host", "public.example");
    incoming.set("x-forwarded-proto", "https");
    expect((await currentRequest()).url).toBe("https://public.example/");
    incoming.delete("x-forwarded-host");
    incoming.delete("x-forwarded-proto");
    incoming.delete("host");
    expect((await currentRequest()).url).toBe("http://localhost/");
  });
});
