import { ConflictError, QuickbenError, ValidationError } from "@quickben/core";

import type { ErrorCode } from "@quickben/core";

/** Codes in error responses: the core codes plus a few that only exist at the HTTP layer. */
export type HttpErrorCode =
  ErrorCode | "METHOD_NOT_ALLOWED" | "PAYLOAD_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE" | "INTERNAL";

/** Body of every error response. */
export interface ErrorBody {
  error: {
    code: HttpErrorCode;
    message: string;
    /** `{ issues }` for `VALIDATION`, `{ field }` for `CONFLICT`, else `null`. */
    details: Record<string, unknown> | null;
  };
}

/** An error raised by the HTTP layer itself, such as an unsupported method. */
export class HttpError extends Error {
  readonly code: HttpErrorCode;
  readonly status: number;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: HttpErrorCode,
    message: string,
    headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function details(error: QuickbenError): Record<string, unknown> | null {
  if (error instanceof ValidationError) return { issues: error.issues };
  if (error instanceof ConflictError) return { field: error.field ?? null };
  return null;
}

/**
 * Turn any thrown value into a JSON error response. Quickben errors with a 4xx status keep
 * their code, message and status. Other errors, including server-side ones such as
 * `ConfigError`, become `500 INTERNAL` with a generic message and are logged.
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json(
      { error: { code: error.code, message: error.message, details: null } },
      error.status,
      error.headers,
    );
  }
  if (error instanceof QuickbenError && error.status < 500) {
    return json(
      { error: { code: error.code, message: error.message, details: details(error) } },
      error.status,
    );
  }
  console.error("[quickben] Unexpected error in route handler", error);
  return json(
    { error: { code: "INTERNAL", message: "Internal server error", details: null } },
    500,
  );
}

/** JSON response that is never cached: results depend on the user. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", ...headers },
  });
}
