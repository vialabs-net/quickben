/** Stable error codes. The HTTP layer maps them to status codes. */
export type ErrorCode =
  "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "CONFIG";

const statusByCode: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION: 400,
  CONFIG: 500,
};

/** One problem found while validating input. `path` is dot-separated, e.g. `tags.0`. */
export interface ValidationIssue {
  path: string;
  message: string;
}

/** Base class of every error thrown by Quickben. */
export class QuickbenError extends Error {
  /** Stable machine-readable code. */
  readonly code: ErrorCode;
  /** Suggested HTTP status for this error. */
  readonly status: number;

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "QuickbenError";
    this.code = code;
    this.status = statusByCode[code];
  }
}

/** Access was denied and there is no user. */
export class UnauthorizedError extends QuickbenError {
  constructor(message = "Authentication required", options?: ErrorOptions) {
    super("UNAUTHORIZED", message, options);
    this.name = "UnauthorizedError";
  }
}

/** Access was denied for the current user. */
export class ForbiddenError extends QuickbenError {
  constructor(message = "Access denied", options?: ErrorOptions) {
    super("FORBIDDEN", message, options);
    this.name = "ForbiddenError";
  }
}

/** The document does not exist, or the user may not read it. */
export class NotFoundError extends QuickbenError {
  constructor(message = "Document not found", options?: ErrorOptions) {
    super("NOT_FOUND", message, options);
    this.name = "NotFoundError";
  }
}

/** A unique constraint was violated. Thrown by database adapters. */
export class ConflictError extends QuickbenError {
  /** Field whose value is already taken, when known. */
  readonly field: string | undefined;

  constructor(message: string, field?: string, options?: ErrorOptions) {
    super("CONFLICT", message, options);
    this.name = "ConflictError";
    this.field = field;
  }
}

/** Input data or a query (where, sort, cursor) failed validation. */
export class ValidationError extends QuickbenError {
  /** Every problem found, in field order. */
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[], options?: ErrorOptions) {
    const first = issues[0];
    const summary = first ? `${first.path || "data"}: ${first.message}` : "Invalid data";
    super("VALIDATION", `Validation failed. ${summary}`, options);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

/** The config is invalid. Thrown by `defineConfig` and `defineCollection`. */
export class ConfigError extends QuickbenError {
  constructor(message: string, options?: ErrorOptions) {
    super("CONFIG", message, options);
    this.name = "ConfigError";
  }
}
