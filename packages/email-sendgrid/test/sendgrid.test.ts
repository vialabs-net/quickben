import { runEmailContractTests } from "@quickben/adapter-tests";
import { describe, expect, it, vi } from "vitest";

import { SENDGRID_EU_URL, sendgridEmail } from "../src";

const accepted = () => new Response(null, { status: 202, headers: { "X-Message-Id": "sg_msg_1" } });

runEmailContractTests({
  create: (options) => sendgridEmail(options),
  accepted,
  rejected: (status, message) =>
    Response.json({ errors: [{ message, field: "from", help: null }] }, { status }),
  idempotencyKeyOf: (request) =>
    (request.body as { custom_args?: Record<string, string> }).custom_args?.idempotency_key,
});

function setup(answer: () => Response = accepted) {
  const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(answer()));
  const email = sendgridEmail({
    apiKey: "SG.test",
    from: "Acme <no-reply@acme.test>",
    fetch,
  });
  const body = () =>
    JSON.parse(fetch.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
  return { email, fetch, body };
}

describe("sendgridEmail", () => {
  it("posts the v3 Mail Send body and maps 202 to sent", async () => {
    const { email, fetch, body } = setup();
    const result = await email.send({
      to: ["Ada <ada@example.com>", "bob@example.com"],
      cc: "c@example.com",
      bcc: "b@example.com",
      replyTo: "Support <support@acme.test>",
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
      headers: { "List-Unsubscribe": "<mailto:u@acme.test>" },
      idempotencyKey: "notice-1",
      tags: { kind: "receipt" },
    });
    expect(result).toEqual({ status: "sent", provider: "sendgrid", id: "sg_msg_1" });
    expect(fetch.mock.calls[0]?.[0]).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(body()).toEqual({
      personalizations: [
        {
          to: [{ email: "ada@example.com", name: "Ada" }, { email: "bob@example.com" }],
          cc: [{ email: "c@example.com" }],
          bcc: [{ email: "b@example.com" }],
        },
      ],
      from: { email: "no-reply@acme.test", name: "Acme" },
      reply_to: { email: "support@acme.test", name: "Support" },
      subject: "Hello",
      content: [
        { type: "text/plain", value: "Hi" },
        { type: "text/html", value: "<p>Hi</p>" },
      ],
      headers: { "List-Unsubscribe": "<mailto:u@acme.test>" },
      custom_args: { kind: "receipt", idempotency_key: "notice-1" },
    });
  });

  it("uses reply_to_list for several reply-to addresses", async () => {
    const { email, body } = setup();
    await email.send({
      to: "a@example.com",
      replyTo: ["r1@acme.test", "r2@acme.test"],
      subject: "S",
      html: "<b>T</b>",
    });
    expect(body()).toMatchObject({
      reply_to_list: [{ email: "r1@acme.test" }, { email: "r2@acme.test" }],
      content: [{ type: "text/html", value: "<b>T</b>" }],
    });
    expect(body()).not.toHaveProperty("reply_to");
    expect(body()).not.toHaveProperty("custom_args");
  });

  it("joins every error message", async () => {
    const { email } = setup(() =>
      Response.json(
        { errors: [{ message: "Bad from", field: "from.email" }, { message: "Bad subject" }, {}] },
        { status: 400 },
      ),
    );
    expect(await email.send({ to: "a@example.com", subject: "S", text: "T" })).toMatchObject({
      status: "failed",
      retryable: false,
      statusCode: 400,
      detail: "SendGrid answered 400: Bad from (from.email); Bad subject",
    });
  });

  it("handles error answers without JSON and sent answers without an id", async () => {
    const message = { to: "a@example.com", subject: "S", text: "T" };
    expect(
      await setup(() => new Response("oops", { status: 503 })).email.send(message),
    ).toMatchObject({
      status: "failed",
      retryable: true,
      detail: "SendGrid answered 503: no message",
    });
    expect(await setup(() => new Response(null, { status: 202 })).email.send(message)).toEqual({
      status: "sent",
      provider: "sendgrid",
      id: null,
    });
  });

  it("refuses an http base URL unless allowHttp is set", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(accepted()));
    const message = { to: "b@example.com", subject: "S", text: "T" };
    const options = {
      apiKey: "SG.k",
      from: "a@acme.test",
      baseUrl: "http://localhost:4010",
      fetch,
    };
    expect(await sendgridEmail(options).send(message)).toMatchObject({
      status: "failed",
      provider: "sendgrid",
      retryable: false,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(await sendgridEmail({ ...options, allowHttp: true }).send(message)).toMatchObject({
      status: "sent",
    });
    expect(fetch).toHaveBeenCalledWith("http://localhost:4010/v3/mail/send", expect.anything());
  });

  it("uses the EU API root", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(accepted()));
    await sendgridEmail({
      apiKey: "k",
      from: "a@acme.test",
      baseUrl: SENDGRID_EU_URL,
      fetch,
    }).send({ to: "b@example.com", subject: "S", text: "T" });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.eu.sendgrid.com/v3/mail/send",
      expect.anything(),
    );
  });
});
