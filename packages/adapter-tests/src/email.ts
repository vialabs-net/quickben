import { describe, expect, it, vi } from "vitest";

import type { EmailAdapter, EmailApiKey, EmailMessage } from "@quickben/core";

/** One recorded provider request. */
export interface RecordedEmailRequest {
  url: string;
  init: RequestInit;
  /** Request headers, lowercase names. */
  headers: Record<string, string>;
  /** The parsed JSON body. */
  body: unknown;
}

/** Options the contract suite passes to {@link EmailContractHarness.create}. */
export interface EmailContractOptions {
  apiKey: EmailApiKey;
  from?: string;
  fetch: typeof fetch;
  timeoutMs?: number;
}

/** How the suite drives one email adapter. No real network calls: `fetch` is a mock. */
export interface EmailContractHarness {
  create(options: EmailContractOptions): EmailAdapter;
  /** The provider's answer to an accepted message. */
  accepted(): Response;
  /** The provider's error answer carrying `message`. */
  rejected(status: number, message: string): Response;
  /** Where the adapter put the idempotency key in a request. */
  idempotencyKeyOf(request: RecordedEmailRequest): string | undefined;
}

const API_KEY = "test-api-key-0123456789";

const message: EmailMessage = {
  to: ["Ada <ada@example.com>", "bob@example.com"],
  subject: "Your receipt",
  html: "<p>Thanks</p>",
  text: "Thanks",
};

function urlOf(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

type Answer = (init: RequestInit) => Response | Promise<Response>;

function recorder(answer: Answer) {
  const requests: RecordedEmailRequest[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const headers = Object.fromEntries(
      [...new Headers(init.headers).entries()].map(([name, value]) => [name.toLowerCase(), value]),
    );
    const body: unknown = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    requests.push({ url: urlOf(input), init, headers, body });
    return answer(init);
  });
  return { requests, fetch: fetch as unknown as typeof globalThis.fetch, calls: fetch };
}

/**
 * The shared suite every email adapter runs:
 *
 * ```ts
 * runEmailContractTests({ create: (o) => fooEmail(o), accepted, rejected, idempotencyKeyOf });
 * ```
 */
export function runEmailContractTests(harness: EmailContractHarness): void {
  const make = (answer: Answer, options: Partial<EmailContractOptions> = {}) => {
    const rec = recorder(answer);
    const email = harness.create({
      apiKey: API_KEY,
      from: "Acme <no-reply@acme.test>",
      fetch: rec.fetch,
      ...options,
    });
    return { ...rec, email };
  };

  describe("email adapter contract", () => {
    it("sends a message with the API key and returns sent", async () => {
      const { email, requests } = make(() => harness.accepted());
      const result = await email.send(message);
      expect(result).toMatchObject({ status: "sent", provider: email.name });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.init.method).toBe("POST");
      expect(requests[0]?.headers.authorization).toBe(`Bearer ${API_KEY}`);
      expect(requests[0]?.headers["content-type"]).toContain("application/json");
    });

    it("passes the idempotency key", async () => {
      const { email, requests } = make(() => harness.accepted());
      await email.send({ ...message, idempotencyKey: "notice-42" });
      const [request] = requests;
      expect(request && harness.idempotencyKeyOf(request)).toBe("notice-42");
    });

    it("reads the API key on each send from a getter", async () => {
      let key = "first-key";
      const { email, requests } = make(() => harness.accepted(), { apiKey: () => key });
      await email.send(message);
      key = "second-key";
      await email.send(message);
      expect(requests.map((request) => request.headers.authorization)).toEqual([
        "Bearer first-key",
        "Bearer second-key",
      ]);
    });

    it("is not configured without an API key or a sender, and sends nothing", async () => {
      for (const options of [{ apiKey: undefined }, { apiKey: " " }, { from: undefined }]) {
        const { email, calls } = make(() => harness.accepted(), options);
        expect(await email.send(message)).toMatchObject({ status: "not_configured" });
        expect(calls).not.toHaveBeenCalled();
      }
    });

    it("lets the message sender replace the default", async () => {
      const { email, requests } = make(() => harness.accepted(), { from: undefined });
      const result = await email.send({ ...message, from: "ops@acme.test" });
      expect(result.status).toBe("sent");
      expect(JSON.stringify(requests[0]?.body)).toContain("ops@acme.test");
    });

    it("fails invalid messages before any request", async () => {
      const { email, calls } = make(() => harness.accepted());
      for (const bad of [
        { ...message, to: "not-an-address" },
        { ...message, from: "Acme" },
        { ...message, html: undefined, text: undefined },
      ]) {
        expect(await email.send(bad)).toMatchObject({ status: "failed", retryable: false });
      }
      expect(calls).not.toHaveBeenCalled();
    });

    it("surfaces the provider error and does not retry client errors", async () => {
      const { email } = make(() => harness.rejected(422, "The from domain is not verified"));
      const result = await email.send(message);
      expect(result).toMatchObject({ status: "failed", retryable: false, statusCode: 422 });
      expect(result.status === "failed" && result.detail).toContain(
        "The from domain is not verified",
      );
    });

    it.each([429, 500, 503])("marks %i as retryable", async (status) => {
      const { email } = make(() => harness.rejected(status, "Try later"));
      expect(await email.send(message)).toMatchObject({
        status: "failed",
        retryable: true,
        statusCode: status,
      });
    });

    it("does not throw on network errors or timeouts", async () => {
      const down = make(() => Promise.reject(new TypeError("fetch failed")));
      expect(await down.email.send(message)).toMatchObject({ status: "failed", retryable: true });
      // Like `fetch`, the mock rejects when the adapter's timeout aborts the request.
      const slow = make(
        (init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init.signal;
            if (!signal) return;
            signal.addEventListener("abort", () => {
              reject(signal.reason as Error);
            });
          }),
        { timeoutMs: 5 },
      );
      const result = await Promise.race([
        slow.email.send(message),
        new Promise((resolve) => {
          setTimeout(() => {
            resolve("hung");
          }, 1000);
        }),
      ]);
      expect(result).toMatchObject({ status: "failed", retryable: true });
    });

    it("keeps the API key out of the detail", async () => {
      const { email } = make(() => harness.rejected(401, `Invalid API key ${API_KEY}`));
      const result = await email.send(message);
      expect(result.status).toBe("failed");
      expect(JSON.stringify(result)).not.toContain(API_KEY);
    });
  });
}
