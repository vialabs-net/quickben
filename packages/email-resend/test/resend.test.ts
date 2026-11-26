import { runEmailContractTests } from "@quickben/adapter-tests";
import { describe, expect, it, vi } from "vitest";

import { resendEmail } from "../src";

runEmailContractTests({
  create: (options) => resendEmail(options),
  accepted: () => Response.json({ id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" }),
  rejected: (status, message) =>
    Response.json({ statusCode: status, name: "validation_error", message }, { status }),
  idempotencyKeyOf: (request) => request.headers["idempotency-key"],
});

function setup(answer: () => Response = () => Response.json({ id: "em_1" })) {
  const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(answer()));
  const email = resendEmail({
    apiKey: "re_test",
    from: "Acme <no-reply@acme.test>",
    fetch,
  });
  const body = () =>
    JSON.parse(fetch.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
  return { email, fetch, body };
}

describe("resendEmail", () => {
  it("posts the Resend body to /emails", async () => {
    const { email, fetch, body } = setup();
    const result = await email.send({
      to: "Ada <ada@example.com>",
      cc: ["c@example.com"],
      bcc: "b@example.com",
      replyTo: "support@acme.test",
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
      headers: { "List-Unsubscribe": "<mailto:u@acme.test>" },
      tags: { kind: "receipt" },
    });
    expect(result).toEqual({ status: "sent", provider: "resend", id: "em_1" });
    expect(fetch.mock.calls[0]?.[0]).toBe("https://api.resend.com/emails");
    expect(body()).toEqual({
      from: "Acme <no-reply@acme.test>",
      to: ["Ada <ada@example.com>"],
      cc: ["c@example.com"],
      bcc: ["b@example.com"],
      reply_to: ["support@acme.test"],
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
      headers: { "List-Unsubscribe": "<mailto:u@acme.test>" },
      tags: [{ name: "kind", value: "receipt" }],
    });
  });

  it("leaves out empty parts and the idempotency header", async () => {
    const { email, fetch, body } = setup();
    await email.send({ to: "a@example.com", subject: "S", text: "T" });
    expect(Object.keys(body())).toEqual(["from", "to", "subject", "text"]);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).has("idempotency-key")).toBe(false);
  });

  it("uses a custom base URL", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(Response.json({ id: "x" })));
    await resendEmail({
      apiKey: "k",
      from: "a@acme.test",
      baseUrl: "https://resend.proxy.test/",
      fetch,
    }).send({ to: "b@example.com", subject: "S", text: "T" });
    expect(fetch).toHaveBeenCalledWith("https://resend.proxy.test/emails", expect.anything());
  });

  it("refuses an http base URL unless allowHttp is set", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(Response.json({ id: "x" })));
    const message = { to: "b@example.com", subject: "S", text: "T" };
    const options = {
      apiKey: "re_k",
      from: "a@acme.test",
      baseUrl: "http://localhost:4010",
      fetch,
    };
    const refused = await resendEmail(options).send(message);
    expect(refused).toMatchObject({ status: "failed", provider: "resend", retryable: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(await resendEmail({ ...options, allowHttp: true }).send(message)).toMatchObject({
      status: "sent",
    });
    expect(fetch).toHaveBeenCalledWith("http://localhost:4010/emails", expect.anything());
  });

  it.each(["通知-42", " lead", "trail ", "tab\tkey", "é"])(
    "refuses idempotency key %j that a header cannot carry",
    async (idempotencyKey) => {
      const { email, fetch } = setup();
      const result = await email.send({
        to: "a@example.com",
        subject: "S",
        text: "T",
        idempotencyKey,
      });
      expect(result).toMatchObject({ status: "failed", provider: "resend", retryable: false });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("sends ordinary idempotency keys unchanged", async () => {
    const { email, fetch } = setup();
    await email.send({
      to: "a@example.com",
      subject: "S",
      text: "T",
      idempotencyKey: "order 42/a:b",
    });
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("idempotency-key")).toBe(
      "order 42/a:b",
    );
  });

  it("retries a concurrent idempotent request, not an invalid one", async () => {
    const answer = (name: string) => () =>
      Response.json({ statusCode: 409, name, message: "m" }, { status: 409 });
    const message = { to: "a@example.com", subject: "S", text: "T", idempotencyKey: "k" };
    expect(await setup(answer("concurrent_idempotent_requests")).email.send(message)).toMatchObject(
      { status: "failed", retryable: true },
    );
    expect(await setup(answer("invalid_idempotent_request")).email.send(message)).toMatchObject({
      status: "failed",
      retryable: false,
      detail: "Resend answered 409 invalid_idempotent_request: m",
    });
  });

  it("handles answers without JSON or without an id", async () => {
    const empty = await setup(() => new Response("", { status: 200 })).email.send({
      to: "a@example.com",
      subject: "S",
      text: "T",
    });
    expect(empty).toEqual({ status: "sent", provider: "resend", id: null });
    const html = await setup(() => new Response("<html>", { status: 502 })).email.send({
      to: "a@example.com",
      subject: "S",
      text: "T",
    });
    expect(html).toMatchObject({
      status: "failed",
      retryable: true,
      detail: "Resend answered 502: no message",
    });
  });
});
