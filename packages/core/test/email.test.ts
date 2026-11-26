import { describe, expect, it, vi } from "vitest";

import {
  createQuickben,
  defineConfig,
  disabledEmail,
  isRetryableStatus,
  isValidEmailAddress,
  memoryEmail,
  parseEmailAddress,
  prepareEmail,
  resolveEmailApiKey,
  sendEmailRequest,
} from "../src";

import { testAdapter } from "./helpers";

import type { EmailMessage } from "../src";

const message: EmailMessage = {
  from: "Acme <no-reply@acme.test>",
  to: "ada@example.com",
  subject: "Hello",
  text: "Hi",
};

describe("email addresses", () => {
  it("parses plain, named and quoted addresses", () => {
    expect(parseEmailAddress(" ada@example.com ")).toEqual({
      address: "ada@example.com",
      name: undefined,
      text: "ada@example.com",
    });
    expect(parseEmailAddress("Ada Lovelace <ada@example.com>")).toMatchObject({
      address: "ada@example.com",
      name: "Ada Lovelace",
    });
    expect(parseEmailAddress('"Lovelace, Ada" <ada@example.com>')?.name).toBe("Lovelace, Ada");
    expect(parseEmailAddress("<ada@example.com>")?.name).toBeUndefined();
  });

  it.each([
    "",
    "ada",
    "ada@example",
    "ada @example.com",
    "Ada <ada>",
    "Ada <ada@example.com",
    "a@b.com\nBcc: x@y.com",
    undefined,
  ])("rejects %j", (value) => {
    expect(isValidEmailAddress(value)).toBe(false);
  });

  it("knows retryable statuses", () => {
    expect([408, 425, 429, 500, 503].every(isRetryableStatus)).toBe(true);
    expect([400, 401, 403, 404, 409, 422].some(isRetryableStatus)).toBe(false);
  });
});

describe("prepareEmail", () => {
  it("fills the default sender and lists recipients", () => {
    const prepared = prepareEmail(
      "x",
      { ...message, from: undefined, to: ["a@b.co", "B <b@b.co>"], cc: "c@b.co" },
      { from: "x@b.co" },
    );
    expect(prepared).toMatchObject({
      from: { address: "x@b.co" },
      to: [{ address: "a@b.co" }, { address: "b@b.co", name: "B" }],
      cc: [{ address: "c@b.co" }],
      bcc: [],
      replyTo: [],
      headers: {},
      tags: {},
    });
  });

  it("is not configured without a sender", () => {
    expect(prepareEmail("x", { ...message, from: undefined })).toMatchObject({
      status: "not_configured",
      provider: "x",
    });
    expect(prepareEmail("x", { ...message, from: " " })).toMatchObject({
      status: "not_configured",
    });
  });

  it.each([
    [{ from: "nope" }, "Invalid sender"],
    [{ to: [] }, "No recipient"],
    [{ to: ["a@b.co", "bad"] }, "Invalid to"],
    [{ bcc: "bad" }, "Invalid bcc"],
    [{ subject: " " }, "No subject"],
    [{ subject: "a\r\nBcc: x" }, "one line"],
    [{ text: "", html: undefined }, "No body"],
    [{ headers: { "Bad Name": "x" } }, "Invalid header"],
    [{ headers: { "X-Ok": "a\nb" } }, "Invalid header"],
    [{ idempotencyKey: "" }, "idempotency key"],
    [{ idempotencyKey: "k".repeat(257) }, "idempotency key"],
    [{ tags: { "bad tag": "x" } }, "Invalid tag"],
    [{ tags: { ok: "no spaces" } }, "Invalid tag"],
  ] as const)("fails %j", (change, detail) => {
    const result = prepareEmail("x", { ...message, ...change });
    expect(result).toMatchObject({ status: "failed", retryable: false });
    expect((result as { detail: string }).detail).toContain(detail);
  });
});

describe("memoryEmail", () => {
  it("keeps sent messages and honors idempotency keys", async () => {
    const email = memoryEmail({ from: "x@b.co" });
    const first = await email.send({ ...message, from: undefined, idempotencyKey: "k1" });
    const again = await email.send({ ...message, idempotencyKey: "k1" });
    const other = await email.send(message);
    expect(first).toEqual({ status: "sent", provider: "memory", id: "memory-1" });
    expect(again).toEqual(first);
    expect(other).toMatchObject({ id: "memory-2" });
    expect(email.messages.map((sent) => sent.from.address)).toEqual([
      "x@b.co",
      "no-reply@acme.test",
    ]);
  });

  it("returns validation failures", async () => {
    const email = memoryEmail();
    expect(await email.send({ ...message, to: "bad" })).toMatchObject({ status: "failed" });
    expect(email.messages).toEqual([]);
  });
});

describe("disabledEmail", () => {
  it("answers not_configured", async () => {
    expect(await disabledEmail("off").send(message)).toEqual({
      status: "not_configured",
      provider: "disabled",
      detail: "off",
    });
  });
});

describe("resolveEmailApiKey", () => {
  it("trims values and calls getters", async () => {
    expect(await resolveEmailApiKey(" k ")).toBe("k");
    expect(await resolveEmailApiKey("")).toBeUndefined();
    expect(await resolveEmailApiKey(undefined)).toBeUndefined();
    expect(await resolveEmailApiKey(() => Promise.resolve("g"))).toBe("g");
    expect(
      await resolveEmailApiKey(() => {
        throw new Error("vault down");
      }),
    ).toBeUndefined();
  });
});

describe("sendEmailRequest", () => {
  const base = {
    provider: "p",
    url: "https://p.test/send",
    init: { method: "POST" },
    secret: "sk_secret",
  };

  it("passes a timeout signal and returns the read result", async () => {
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(new Response("{}"));
    });
    const result = await sendEmailRequest({
      ...base,
      fetch: fetch as unknown as typeof globalThis.fetch,
      read: () => Promise.resolve({ status: "sent", provider: "p", id: "1" }),
    });
    expect(result).toEqual({ status: "sent", provider: "p", id: "1" });
    expect(fetch).toHaveBeenCalledWith("https://p.test/send", expect.anything());
  });

  it("turns network errors into retryable failures without the key", async () => {
    const result = await sendEmailRequest({
      ...base,
      fetch: () => Promise.reject(new Error("connect failed for sk_secret")),
      read: () => Promise.reject(new Error("not called")),
    });
    expect(result).toMatchObject({ status: "failed", retryable: true });
    expect(JSON.stringify(result)).not.toContain("sk_secret");
  });

  it("reports timeouts", async () => {
    const result = await sendEmailRequest({
      ...base,
      timeoutMs: 5,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason as Error);
          });
        }),
      read: () => Promise.reject(new Error("not called")),
    });
    expect(result).toMatchObject({
      status: "failed",
      retryable: true,
      detail: "p did not answer in time.",
    });
  });

  it("turns read errors into failures with the status", async () => {
    const result = await sendEmailRequest({
      ...base,
      fetch: () => Promise.resolve(new Response("x", { status: 502 })),
      read: () => Promise.reject(new Error("bad json")),
    });
    expect(result).toMatchObject({ status: "failed", retryable: true, statusCode: 502 });
  });

  it("refuses a URL that is not https without sending", async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response("{}")));
    const read = () => Promise.resolve({ status: "sent", provider: "p", id: "1" } as const);
    for (const url of ["http://p.test/send", "ftp://p.test/send", "not a url"]) {
      const result = await sendEmailRequest({
        ...base,
        url,
        fetch: fetch,
        read,
      });
      expect(result, url).toMatchObject({ status: "failed", provider: "p", retryable: false });
    }
    const ftp = await sendEmailRequest({
      ...base,
      url: "ftp://p.test/send",
      allowHttp: true,
      fetch: fetch,
      read,
    });
    expect(ftp).toMatchObject({ status: "failed", retryable: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows http with allowHttp", async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response("{}")));
    const result = await sendEmailRequest({
      ...base,
      url: "http://localhost:4010/send",
      allowHttp: true,
      fetch: fetch,
      read: () => Promise.resolve({ status: "sent", provider: "p", id: "1" }),
    });
    expect(result).toEqual({ status: "sent", provider: "p", id: "1" });
    expect(fetch).toHaveBeenCalledWith("http://localhost:4010/send", expect.anything());
  });
});

describe("config email", () => {
  it("is read back from the config", async () => {
    const email = memoryEmail();
    const qb = await createQuickben(defineConfig({ db: testAdapter(), email, collections: [] }));
    expect(qb.config.email).toBe(email);
    const none = await createQuickben(defineConfig({ db: testAdapter(), collections: [] }));
    expect(none.config.email).toBeUndefined();
  });
});
