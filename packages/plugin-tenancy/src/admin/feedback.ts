import { ConflictError, ValidationError } from "@quickben/core";

import { OrganizationError, TenancyRuleError } from "../tenant";

import type { TenancyT } from "./messages";
import type { QuickbenError } from "@quickben/core";

/** `?toast=` codes of the tenancy admin. Each one has the message `tenancy.toast.<code>`. */
export const toastCodes = [
  "invited",
  "member-updated",
  "member-removed",
  "organization-saved",
  "organization-created",
] as const;

/** `?error=` codes of the tenancy admin. Each one has the message `tenancy.error.<code>`. */
export const errorCodes = [
  "unauthorized",
  "forbidden",
  "not-found",
  "invalid",
  "invalid-slug",
  "slug-taken",
  "already-member",
  "conflict",
  "organization-none",
  "organization-ambiguous",
  "organization-not-member",
  "organization-unknown",
  "organization-suspended",
  "last-owner",
  "own-role",
  "own-membership",
  "higher-role",
  "platform-only",
  "failed",
] as const;

export type ToastCode = (typeof toastCodes)[number];
export type FeedbackErrorCode = (typeof errorCodes)[number];

/** The `?error=` code for an error thrown by a tenancy admin action. */
export function errorCode(error: QuickbenError): FeedbackErrorCode {
  if (error instanceof OrganizationError) return `organization-${error.reason}`;
  if (error instanceof TenancyRuleError) return error.rule;
  if (error instanceof ConflictError) {
    if (error.field === "slug") return "slug-taken";
    if (error.field === "memberKey") return "already-member";
    return "conflict";
  }
  if (error instanceof ValidationError) {
    return error.issues.some((issue) => issue.path === "slug") ? "invalid-slug" : "invalid";
  }
  switch (error.code) {
    case "UNAUTHORIZED":
      return "unauthorized";
    case "FORBIDDEN":
      return "forbidden";
    case "NOT_FOUND":
      return "not-found";
    default:
      return "failed";
  }
}

function isCode<C extends string>(codes: readonly C[], code: unknown): code is C {
  return typeof code === "string" && (codes as readonly string[]).includes(code);
}

/** The message for a `?toast=` code. Unknown codes give `undefined`. */
export function toastMessage(t: TenancyT, code: unknown): string | undefined {
  return isCode(toastCodes, code) ? t(`toast.${code}`) : undefined;
}

/** The message for an `?error=` code. Unknown codes give `undefined`. */
export function errorMessage(t: TenancyT, code: unknown): string | undefined {
  return isCode(errorCodes, code) ? t(`error.${code}`) : undefined;
}
