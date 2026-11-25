/**
 * Transactional email through SendGrid's v3 Mail Send API (`POST /v3/mail/send`), with
 * `fetch`. No SDK.
 */
import {
  isEmailResult,
  isRetryableStatus,
  prepareEmail,
  resolveEmailApiKey,
  sendEmailRequest,
} from "@quickben/core";

import type {
  EmailAdapter,
  EmailApiKey,
  EmailResult,
  ParsedEmailAddress,
  PreparedEmail,
} from "@quickben/core";

/** Default API root. */
export const SENDGRID_URL = "https://api.sendgrid.com";
/** API root of the EU region (accounts created as EU data residency). */
export const SENDGRID_EU_URL = "https://api.eu.sendgrid.com";
/** The `custom_args` key that carries the message's idempotency key. */
export const SENDGRID_IDEMPOTENCY_ARG = "idempotency_key";

/** Options of {@link sendgridEmail}. */
export interface SendGridEmailOptions {
  /** API key (`SG.…`) with Mail Send access, or a function that returns it. */
  apiKey: EmailApiKey;
  /** Default sender, such as `Acme <no-reply@acme.com>`. A message's `from` wins. */
  from?: string;
  /** API root. Default {@link SENDGRID_URL}; {@link SENDGRID_EU_URL} for EU accounts. */
  baseUrl?: string;
  /** Default: the global `fetch`. */
  fetch?: typeof fetch;
  /** Milliseconds to wait for SendGrid. Default `10000`. */
  timeoutMs?: number;
}

const person = (address: ParsedEmailAddress) =>
  address.name ? { email: address.address, name: address.name } : { email: address.address };

/** The JSON body of `POST /v3/mail/send` for a prepared message. */
export function sendgridBody(email: PreparedEmail): Record<string, unknown> {
  const customArgs: Record<string, string> = { ...email.tags };
  if (email.idempotencyKey) customArgs[SENDGRID_IDEMPOTENCY_ARG] = email.idempotencyKey;
  const content = [
    // SendGrid requires text/plain before text/html.
    ...(email.text === undefined ? [] : [{ type: "text/plain", value: email.text }]),
    ...(email.html === undefined ? [] : [{ type: "text/html", value: email.html }]),
  ];
  const [replyTo, ...moreReplyTo] = email.replyTo;
  return {
    personalizations: [
      {
        to: email.to.map(person),
        ...(email.cc.length ? { cc: email.cc.map(person) } : {}),
        ...(email.bcc.length ? { bcc: email.bcc.map(person) } : {}),
      },
    ],
    from: person(email.from),
    ...(replyTo && moreReplyTo.length === 0 ? { reply_to: person(replyTo) } : {}),
    ...(moreReplyTo.length ? { reply_to_list: email.replyTo.map(person) } : {}),
    subject: email.subject,
    content,
    ...(Object.keys(email.headers).length ? { headers: email.headers } : {}),
    ...(Object.keys(customArgs).length ? { custom_args: customArgs } : {}),
  };
}

function withoutTrailingSlash(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
}

interface SendGridAnswer {
  errors?: { message?: unknown; field?: unknown }[];
}

async function readAnswer(response: Response): Promise<EmailResult> {
  if (response.ok) {
    return { status: "sent", provider: "sendgrid", id: response.headers.get("x-message-id") };
  }
  const body = (await response.json().catch(() => ({}))) as SendGridAnswer;
  const messages = (Array.isArray(body.errors) ? body.errors : [])
    .map((error) => {
      const text = typeof error.message === "string" ? error.message : "";
      const field = typeof error.field === "string" && error.field ? ` (${error.field})` : "";
      return text ? `${text}${field}` : "";
    })
    .filter(Boolean);
  return {
    status: "failed",
    provider: "sendgrid",
    detail: `SendGrid answered ${response.status}: ${messages.join("; ") || "no message"}`,
    retryable: isRetryableStatus(response.status),
    statusCode: response.status,
  };
}

/**
 * Send email through SendGrid. SendGrid has no idempotency header: a retry after a lost answer
 * can send the message twice. The key goes in `custom_args.idempotency_key`, so it shows in the
 * Activity feed and in Event Webhook payloads, where duplicates can be traced.
 */
export function sendgridEmail(options: SendGridEmailOptions): EmailAdapter {
  const url = `${withoutTrailingSlash(options.baseUrl ?? SENDGRID_URL)}/v3/mail/send`;
  return {
    name: "sendgrid",
    async send(message) {
      const apiKey = await resolveEmailApiKey(options.apiKey);
      if (!apiKey) {
        return { status: "not_configured", provider: "sendgrid", detail: "No SendGrid API key." };
      }
      const email = prepareEmail("sendgrid", message, options);
      if (isEmailResult(email)) return email;
      return sendEmailRequest({
        provider: "sendgrid",
        url,
        init: {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(sendgridBody(email)),
        },
        fetch: options.fetch,
        timeoutMs: options.timeoutMs,
        secret: apiKey,
        read: readAnswer,
      });
    },
  };
}
