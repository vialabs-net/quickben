import { QuickbenError } from "@quickben/core";

/** Why a connection or credential cannot be used or tested. */
export type ConnectionErrorReason =
  | "disabled"
  | "unknown-provider"
  | "no-credential"
  | "no-secret"
  | "wrong-kind"
  | "not-testable"
  | "pick-provider"
  | "not-llm"
  | "no-model";

/**
 * A connection or credential cannot be used as asked (HTTP 400). `reason` tells the UI what to
 * do next.
 */
export class ConnectionError extends QuickbenError {
  readonly reason: ConnectionErrorReason;

  constructor(reason: ConnectionErrorReason, message: string) {
    super("VALIDATION", message);
    this.name = "ConnectionError";
    this.reason = reason;
  }
}
