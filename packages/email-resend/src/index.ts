/**
 * Transactional email through Resend's REST API (`POST /emails`), with `fetch`. No SDK.
 */
import {
  isEmailResult,
  isRetryableStatus,
  prepareEmail,
  resolveEmailApiKey,
  sendEmailRequest,
} from "@quickben/core";

import type { EmailAdapter, EmailApiKey, EmailResult, PreparedEmail } from "@quickben/core";

/** Default API root. */
export const RESEND_URL = "https://api.resend.com";

/** Options of {@link resendEmail}. */
export interface ResendEmailOptions {
  /** API key (`re_…`), or a function that returns it. Missing or empty: `not_configured`. */
  apiKey: EmailApiKey;
  /** Default sender, such as `Acme <no-reply@acme.com>`. A message's `from` wins. */
  from?: string;
  /** API root. Default {@link RESEND_URL}. Must be `https://` unless `allowHttp` is set. */
  baseUrl?: string;
  /** Allow an `http://` `baseUrl`, for a local test server. Default `false`. */
  allowHttp?: boolean;
  /** Default: the global `fetch`. */
  fetch?: typeof fetch;
  /** Milliseconds to wait for Resend. Default `10000`. */
  timeoutMs?: number;
}

/** The JSON body of `POST /emails` for a prepared message. */
export function resendBody(email: PreparedEmail): Record<string, unknown> {
  const texts = (list: PreparedEmail["to"]) => list.map((address) => address.text);
  const tags = Object.entries(email.tags).map(([name, value]) => ({ name, value }));
  return {
    from: email.from.text,
    to: texts(email.to),
    ...(email.cc.length ? { cc: texts(email.cc) } : {}),
    ...(email.bcc.length ? { bcc: texts(email.bcc) } : {}),
    ...(email.replyTo.length ? { reply_to: texts(email.replyTo) } : {}),
    subject: email.subject,
    ...(email.html === undefined ? {} : { html: email.html }),
    ...(email.text === undefined ? {} : { text: email.text }),
    ...(Object.keys(email.headers).length ? { headers: email.headers } : {}),
    ...(tags.length ? { tags } : {}),
  };
}

/** Printable ASCII, no space at either end: survives an HTTP header unchanged. */
const headerSafe = /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/;

function withoutTrailingSlash(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
}

interface ResendAnswer {
  id?: unknown;
  name?: unknown;
  message?: unknown;
}

async function readAnswer(response: Response): Promise<EmailResult> {
  const body = (await response.json().catch(() => ({}))) as ResendAnswer;
  if (response.ok) {
    return { status: "sent", provider: "resend", id: typeof body.id === "string" ? body.id : null };
  }
  const name = typeof body.name === "string" ? body.name : undefined;
  const text = typeof body.message === "string" ? body.message : "no message";
  return {
    status: "failed",
    provider: "resend",
    detail: `Resend answered ${[response.status, name].filter(Boolean).join(" ")}: ${text}`,
    // Another request with the same idempotency key is still running: try again later.
    retryable: isRetryableStatus(response.status) || name === "concurrent_idempotent_requests",
    statusCode: response.status,
  };
}

/**
 * Send email through Resend. `idempotencyKey` goes in the `Idempotency-Key` header: Resend
 * keeps it 24 hours and answers a retry with the first email instead of sending it again.
 */
export function resendEmail(options: ResendEmailOptions): EmailAdapter {
  const url = `${withoutTrailingSlash(options.baseUrl ?? RESEND_URL)}/emails`;
  return {
    name: "resend",
    async send(message) {
      const apiKey = await resolveEmailApiKey(options.apiKey);
      if (!apiKey) {
        return { status: "not_configured", provider: "resend", detail: "No Resend API key." };
      }
      const email = prepareEmail("resend", message, options);
      if (isEmailResult(email)) return email;
      if (email.idempotencyKey !== undefined && !headerSafe.test(email.idempotencyKey)) {
        return {
          status: "failed",
          provider: "resend",
          detail:
            "The idempotency key goes in an HTTP header: use printable ASCII without leading or trailing spaces.",
          retryable: false,
        };
      }
      return sendEmailRequest({
        provider: "resend",
        url,
        init: {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            ...(email.idempotencyKey ? { "Idempotency-Key": email.idempotencyKey } : {}),
          },
          body: JSON.stringify(resendBody(email)),
        },
        fetch: options.fetch,
        timeoutMs: options.timeoutMs,
        allowHttp: options.allowHttp,
        secret: apiKey,
        read: readAnswer,
      });
    },
  };
}
