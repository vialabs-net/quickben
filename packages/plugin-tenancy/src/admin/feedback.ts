import { ConflictError, ValidationError } from "@quickben/core";

import { OrganizationError, TenancyRuleError } from "../tenant";

import type { QuickbenError } from "@quickben/core";

/** Success messages of the tenancy admin, by the code in `?toast=`. */
export const toastMessages = {
  invited: "Invitation created",
  "member-updated": "Member updated",
  "member-removed": "Member removed",
  "organization-saved": "Organization saved",
  "organization-created": "Organization created",
} as const;

/** Error messages of the tenancy admin, by the code in `?error=`. */
export const errorMessages = {
  unauthorized: "Sign in again to continue.",
  forbidden: "You are not allowed to do that.",
  "not-found": "That item does not exist or you cannot see it.",
  invalid: "Some values are not valid. Check the form and try again.",
  "invalid-slug": "Use lowercase letters, digits and -, e.g. acme-inc.",
  "slug-taken": "That slug is already used by another organization.",
  "already-member": "That person is already a member or has an invitation.",
  conflict: "That value is already used.",
  "organization-none": "Choose an organization first.",
  "organization-ambiguous": "You belong to several organizations. Choose one.",
  "organization-not-member": "You are not a member of that organization.",
  "organization-unknown": "That organization does not exist.",
  "organization-suspended": "That organization is suspended.",
  "last-owner": "An organization needs at least one active owner. Make someone else owner first.",
  "own-role": "You cannot change your own role or status. Ask another owner or admin.",
  "own-membership":
    "You cannot remove your own owner or admin membership. Ask another owner or admin.",
  "higher-role": "Only a higher role can manage that role.",
  "platform-only": "Only platform staff can change modules or status.",
  failed: "The change could not be saved.",
} as const;

export type ToastCode = keyof typeof toastMessages;
export type FeedbackErrorCode = keyof typeof errorMessages;

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

function lookup(messages: Readonly<Record<string, string>>, code: unknown): string | undefined {
  return typeof code === "string" && Object.hasOwn(messages, code) ? messages[code] : undefined;
}

/** The fixed message for a `?toast=` code. Unknown codes give `undefined`. */
export function toastMessage(code: unknown): string | undefined {
  return lookup(toastMessages, code);
}

/** The fixed message for an `?error=` code. Unknown codes give `undefined`. */
export function errorMessage(code: unknown): string | undefined {
  return lookup(errorMessages, code);
}
