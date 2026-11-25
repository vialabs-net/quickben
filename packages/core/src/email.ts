/**
 * Transactional email contract. Apps send through an {@link EmailAdapter}; adapters for Resend
 * and SendGrid live in their own packages. `send` never throws for provider or network errors:
 * it returns an {@link EmailResult}.
 */

/** One address or several, each `address@domain.tld` or `Name <address@domain.tld>`. */
export type EmailRecipients = string | readonly string[];

/** A message as the app gives it to {@link EmailAdapter.send}. */
export interface EmailMessage {
  /** Sender, `address@domain.tld` or `Name <address@domain.tld>`. Default: the adapter's `from`. */
  from?: string;
  to: EmailRecipients;
  cc?: EmailRecipients;
  bcc?: EmailRecipients;
  replyTo?: EmailRecipients;
  /** One line. */
  subject: string;
  /** At least one of `html` and `text`. */
  html?: string;
  text?: string;
  /** Extra MIME headers, such as `List-Unsubscribe`. */
  headers?: Readonly<Record<string, string>>;
  /**
   * Same key, same email: a retry does not send it twice when the provider supports it
   * (Resend). Up to 256 characters.
   */
  idempotencyKey?: string;
  /**
   * Key-value labels the provider returns in webhooks and logs (Resend `tags`, SendGrid
   * `custom_args`). Keys and values: ASCII letters, digits, `_` and `-`.
   */
  tags?: Readonly<Record<string, string>>;
}

/**
 * Result of {@link EmailAdapter.send}.
 *
 * - `sent`: the provider accepted the message. `id` is its message id when it returns one.
 * - `not_configured`: no API key or no sender. Nothing was sent.
 * - `failed`: the message is invalid, or the provider or the network failed. `retryable` is
 *   `true` for timeouts, network errors, 408, 425, 429 and 5xx.
 */
export type EmailResult =
  | { readonly status: "sent"; readonly provider: string; readonly id: string | null }
  | { readonly status: "not_configured"; readonly provider: string; readonly detail: string }
  | {
      readonly status: "failed";
      readonly provider: string;
      readonly detail: string;
      readonly retryable: boolean;
      /** HTTP status of the provider answer, when there was one. */
      readonly statusCode?: number;
    };

/** Sends email. Adapters take the final message: rewrite it in a wrapper if you need to. */
export interface EmailAdapter {
  /** Adapter name for results and messages, e.g. `resend`. */
  readonly name: string;
  /** Send one message. Never throws for provider or network errors. */
  send(message: EmailMessage): Promise<EmailResult>;
}

/** An address split in its parts. `text` is the trimmed input. */
export interface ParsedEmailAddress {
  readonly address: string;
  readonly name: string | undefined;
  readonly text: string;
}

/** A checked message: what adapters turn into a provider request. */
export interface PreparedEmail {
  readonly from: ParsedEmailAddress;
  readonly to: readonly ParsedEmailAddress[];
  readonly cc: readonly ParsedEmailAddress[];
  readonly bcc: readonly ParsedEmailAddress[];
  readonly replyTo: readonly ParsedEmailAddress[];
  readonly subject: string;
  readonly html: string | undefined;
  readonly text: string | undefined;
  readonly headers: Readonly<Record<string, string>>;
  readonly idempotencyKey: string | undefined;
  readonly tags: Readonly<Record<string, string>>;
}

const addressPart = /^[^\s"(),:;<>@[\\\]]+$/;
const headerNamePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const tagPattern = /^[\w-]{1,256}$/;
const lineBreak = /[\r\n]/;

/** `local@domain.tld`: one `@`, no spaces or special characters, a dot in the domain. */
function isBareAddress(address: string): boolean {
  const parts = address.split("@");
  if (parts.length !== 2) return false;
  const [local = "", domain = ""] = parts;
  const labels = domain.split(".");
  return (
    addressPart.test(local) &&
    labels.length >= 2 &&
    labels.every((label) => label !== "" && addressPart.test(label))
  );
}

const orUndefined = (value: string | undefined): string | undefined =>
  value === "" ? undefined : value;

/**
 * Split `address@domain.tld` or `Name <address@domain.tld>` (the name may be quoted). `null`
 * when it is not a valid address.
 */
export function parseEmailAddress(value: string | undefined | null): ParsedEmailAddress | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || lineBreak.test(text)) return null;
  let address = text;
  let name: string | undefined;
  if (text.endsWith(">")) {
    const open = text.lastIndexOf("<");
    if (open < 0) return null;
    address = text.slice(open + 1, -1).trim();
    name = text.slice(0, open).trim();
    if (name.includes("<") || name.includes(">")) return null;
    if (name.length >= 2 && name.startsWith('"') && name.endsWith('"')) {
      name = name.slice(1, -1).trim();
    }
  }
  if (!isBareAddress(address)) return null;
  return { address, name: orUndefined(name), text };
}

/** Whether `value` is a valid sender: `address@domain.tld` or `Name <address@domain.tld>`. */
export function isValidEmailAddress(value: string | undefined | null): boolean {
  return parseEmailAddress(value) !== null;
}

/** Whether a provider answer with this HTTP status is worth retrying. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function list(value: EmailRecipients | undefined): readonly string[] {
  if (value === undefined) return [];
  return typeof value === "string" ? [value] : value;
}

/** Defaults of {@link prepareEmail}. */
export interface PrepareEmailDefaults {
  /** Sender when the message has none. */
  from?: string;
}

type Recipients = Record<"to" | "cc" | "bcc" | "replyTo", ParsedEmailAddress[]>;

/** Parsed recipients, with `problem` set when one is invalid or there is no `to`. */
function parseRecipients(message: EmailMessage): { recipients: Recipients; problem?: string } {
  const recipients: Recipients = { to: [], cc: [], bcc: [], replyTo: [] };
  for (const key of ["to", "cc", "bcc", "replyTo"] as const) {
    for (const value of list(message[key])) {
      const address = parseEmailAddress(value);
      if (!address) return { recipients, problem: `Invalid ${key} address "${value}".` };
      recipients[key].push(address);
    }
  }
  return recipients.to.length === 0
    ? { recipients, problem: "No recipient: set `to`." }
    : { recipients };
}

/** The problem with the subject, body, headers, key or tags, or `null`. */
function contentProblem(message: EmailMessage): string | null {
  const subject = typeof message.subject === "string" ? message.subject.trim() : "";
  if (!subject) return "No subject.";
  if (lineBreak.test(subject)) return "The subject must be one line.";
  if (!message.html && !message.text) return "No body: set `html` or `text`.";
  for (const [name, value] of Object.entries(message.headers ?? {})) {
    if (!headerNamePattern.test(name) || typeof value !== "string" || lineBreak.test(value)) {
      return `Invalid header "${name}".`;
    }
  }
  const key = message.idempotencyKey;
  if (key !== undefined && (!key || key.length > 256 || lineBreak.test(key))) {
    return "The idempotency key must have 1 to 256 characters on one line.";
  }
  for (const [name, value] of Object.entries(message.tags ?? {})) {
    if (!tagPattern.test(name) || typeof value !== "string" || !tagPattern.test(value)) {
      return `Invalid tag "${name}": use ASCII letters, digits, "_" and "-".`;
    }
  }
  return null;
}

/**
 * Check a message and fill the defaults. Returns the prepared message, or a `not_configured`
 * result (no sender) or a `failed` result (invalid message) for `provider`. Adapters call it
 * before any request.
 */
export function prepareEmail(
  provider: string,
  message: EmailMessage,
  defaults: PrepareEmailDefaults = {},
): PreparedEmail | Exclude<EmailResult, { status: "sent" }> {
  const invalid = (detail: string) =>
    ({ status: "failed", provider, detail, retryable: false }) as const;
  const fromText = message.from ?? defaults.from;
  if (!fromText?.trim()) {
    return { status: "not_configured", provider, detail: "No sender: set `from`." };
  }
  const from = parseEmailAddress(fromText);
  if (!from) return invalid(`Invalid sender "${fromText}".`);
  const { recipients, problem: recipientProblem } = parseRecipients(message);
  if (recipientProblem) return invalid(recipientProblem);
  const problem = contentProblem(message);
  if (problem) return invalid(problem);
  return {
    from,
    ...recipients,
    subject: message.subject.trim(),
    html: orUndefined(message.html),
    text: orUndefined(message.text),
    headers: { ...message.headers },
    idempotencyKey: message.idempotencyKey,
    tags: { ...message.tags },
  };
}

/** Whether {@link prepareEmail} returned a result instead of a message. */
export function isEmailResult(value: PreparedEmail | EmailResult): value is EmailResult {
  return "status" in value;
}

/**
 * An API key, or a function that returns it on each send (to read it from a secret store or a
 * connection). Empty or missing means not configured.
 */
export type EmailApiKey =
  string | undefined | (() => string | undefined | Promise<string | undefined>);

/** The trimmed API key, or `undefined`. A throwing getter counts as missing. */
export async function resolveEmailApiKey(apiKey: EmailApiKey): Promise<string | undefined> {
  try {
    const value = typeof apiKey === "function" ? await apiKey() : apiKey;
    return orUndefined(value?.trim());
  } catch {
    return undefined;
  }
}

/** Input of {@link sendEmailRequest}. */
export interface EmailRequest {
  provider: string;
  url: string;
  init: Omit<RequestInit, "signal">;
  /** Default: the global `fetch`. */
  fetch?: typeof fetch;
  /** Default `10000`. */
  timeoutMs?: number;
  /** Removed from any detail text. */
  secret: string;
  /** Turn the provider answer into a result. Thrown errors become `failed`. */
  read(response: Response): Promise<EmailResult>;
}

const MAX_DETAIL = 500;

/**
 * Make the provider request with a timeout and turn every outcome into an {@link EmailResult}:
 * network errors and timeouts are retryable failures, and the API key never appears in
 * `detail`.
 */
export async function sendEmailRequest(request: EmailRequest): Promise<EmailResult> {
  const clean = (result: EmailResult): EmailResult =>
    result.status === "sent"
      ? result
      : {
          ...result,
          detail: (request.secret
            ? result.detail.split(request.secret).join("[redacted]")
            : result.detail
          ).slice(0, MAX_DETAIL),
        };
  const doFetch = request.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await doFetch(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(request.timeoutMs ?? 10_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return clean({
      status: "failed",
      provider: request.provider,
      detail: timedOut ? `${request.provider} did not answer in time.` : String(error),
      retryable: true,
    });
  }
  try {
    return clean(await request.read(response));
  } catch (error) {
    return clean({
      status: "failed",
      provider: request.provider,
      detail: `Unreadable ${request.provider} answer (${response.status}): ${String(error)}`,
      retryable: isRetryableStatus(response.status),
      statusCode: response.status,
    });
  }
}

/** A message kept by {@link memoryEmail}. */
export interface MemoryEmailMessage extends PreparedEmail {
  readonly id: string;
}

/** In-memory email with its outbox exposed. */
export interface MemoryEmail extends EmailAdapter {
  /** Sent messages, oldest first. Set `length = 0` to clear. */
  readonly messages: MemoryEmailMessage[];
}

/** Options of {@link memoryEmail}. */
export interface MemoryEmailOptions {
  /** Default sender. */
  from?: string;
}

/**
 * Keep messages in memory instead of sending them: for tests and demos. A repeated
 * `idempotencyKey` returns the first message's id and is not kept again.
 */
export function memoryEmail(options: MemoryEmailOptions = {}): MemoryEmail {
  const messages: MemoryEmailMessage[] = [];
  let counter = 0;
  return {
    name: "memory",
    messages,
    send(message) {
      const prepared = prepareEmail("memory", message, options);
      if (isEmailResult(prepared)) return Promise.resolve(prepared);
      const earlier = prepared.idempotencyKey
        ? messages.find((sent) => sent.idempotencyKey === prepared.idempotencyKey)
        : undefined;
      if (earlier) return Promise.resolve({ status: "sent", provider: "memory", id: earlier.id });
      counter += 1;
      const id = `memory-${counter}`;
      messages.push({ ...prepared, id });
      return Promise.resolve({ status: "sent", provider: "memory", id });
    },
  };
}

/**
 * An adapter that sends nothing and answers `not_configured`: for apps where email is off,
 * such as no provider set in the environment.
 */
export function disabledEmail(detail = "Email is not configured."): EmailAdapter {
  return {
    name: "disabled",
    send: () => Promise.resolve({ status: "not_configured", provider: "disabled", detail }),
  };
}
