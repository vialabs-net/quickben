import { ConflictError, QuickbenError, ValidationError } from "@quickben/core";

import { issuesToErrors } from "./form-data";

import type { ErrorState } from "./form-state";

const fixFields = "Check the highlighted fields.";

/** Form state for a failed save or delete. Errors that are not Quickben errors are logged. */
export function toFormState(error: unknown, fieldNames: readonly string[]): ErrorState {
  if (error instanceof ValidationError) {
    const { fieldErrors, formError } = issuesToErrors(error.issues, fieldNames);
    return { status: "error", message: formError ?? fixFields, fieldErrors };
  }
  if (error instanceof ConflictError) {
    const field = error.field;
    if (field && fieldNames.includes(field)) {
      return {
        status: "error",
        message: fixFields,
        fieldErrors: { [field]: "This value is already taken" },
      };
    }
    return { status: "error", message: error.message, fieldErrors: {} };
  }
  if (error instanceof QuickbenError) {
    return { status: "error", message: error.message, fieldErrors: {} };
  }
  console.error("[quickben] Unexpected error in admin action", error);
  return { status: "error", message: "Something went wrong. Try again.", fieldErrors: {} };
}

/** Form state for errors found before calling the local API. */
export function fieldErrorsState(fieldErrors: Record<string, string>): ErrorState {
  return { status: "error", message: fixFields, fieldErrors };
}
