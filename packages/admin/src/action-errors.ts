import { ConflictError, QuickbenError, ValidationError } from "@quickben/core";

import { issuesToErrors } from "./form-data";

import type { ErrorState } from "./form-state";
import type { AdminI18n } from "./i18n/translator";

/** Form state for a failed save or delete. Errors that are not Quickben errors are logged. */
export function toFormState(
  error: unknown,
  fieldNames: readonly string[],
  i18n: AdminI18n,
): ErrorState {
  const fixFields = i18n.t("error.fixFields");
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
        fieldErrors: { [field]: i18n.t("error.taken") },
      };
    }
    return { status: "error", message: error.message, fieldErrors: {} };
  }
  if (error instanceof QuickbenError) {
    return { status: "error", message: error.message, fieldErrors: {} };
  }
  console.error("[quickben] Unexpected error in admin action", error);
  return { status: "error", message: i18n.t("error.unexpected"), fieldErrors: {} };
}

/** Form state for errors found before calling the local API. */
export function fieldErrorsState(fieldErrors: Record<string, string>, i18n: AdminI18n): ErrorState {
  return { status: "error", message: i18n.t("error.fixFields"), fieldErrors };
}
