import { ConflictError } from "@quickben/core";

import type { RuntimeTable } from "./tables";

interface DriverError {
  code?: unknown;
  extendedCode?: unknown;
  constraint?: unknown;
  message?: unknown;
  cause?: unknown;
}

const SQLITE_UNIQUE = new Set(["SQLITE_CONSTRAINT_UNIQUE", "SQLITE_CONSTRAINT_PRIMARYKEY"]);

/** Errors in the `cause` chain, outermost first. Drizzle wraps driver errors. */
function chain(error: unknown): DriverError[] {
  const errors: DriverError[] = [];
  let current: unknown = error;
  while (typeof current === "object" && current !== null && errors.length < 10) {
    const driverError = current as DriverError;
    errors.push(driverError);
    current = driverError.cause;
  }
  return errors;
}

/** The taken field, `""` when unknown, or `null` when `error` is not a unique violation. */
function conflictField(error: DriverError, table: RuntimeTable): string | null {
  // Postgres and PGlite: unique_violation, with the index or constraint name.
  if (error.code === "23505") {
    return typeof error.constraint === "string"
      ? (table.constraints.get(error.constraint) ?? "")
      : "";
  }
  // libSQL: SQLITE_CONSTRAINT with the extended code, message "UNIQUE constraint failed: t.c".
  const code = typeof error.extendedCode === "string" ? error.extendedCode : error.code;
  if (typeof code === "string" && SQLITE_UNIQUE.has(code)) {
    const message = typeof error.message === "string" ? error.message : "";
    const match = /constraint failed: [^.\s]+\.(\w+)/.exec(message);
    return match?.[1] ?? "";
  }
  return null;
}

/** Turn a unique violation into `ConflictError`. Other errors are returned unchanged. */
export function toConflict(error: unknown, table: RuntimeTable): unknown {
  for (const candidate of chain(error)) {
    const field = conflictField(candidate, table);
    if (field === null) continue;
    const message = field
      ? `Value of "${field}" is already taken in "${table.spec.slug}"`
      : `A unique value is already taken in "${table.spec.slug}"`;
    return new ConflictError(message, field === "" ? undefined : field, { cause: error });
  }
  return error;
}
