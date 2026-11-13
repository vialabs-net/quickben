import { ConflictError, ValidationError } from "@quickben/core";

import { RendererUnavailableError } from "../pdf";
import { NoDraftError, TemplateIssuesError } from "../service";

import type { TemplateIssue } from "../content";

/** Success messages of the brand page, by the code in `?toast=`. */
export const toastMessages = {
  "brand-saved": "Brand saved",
} as const;

/** Error messages, by code. */
export const errorMessages = {
  unauthorized: "Sign in again to continue.",
  forbidden: "You are not allowed to do that.",
  "not-found": "That item does not exist or you cannot see it.",
  invalid: "Some values are not valid. Check the form and try again.",
  "invalid-logo": "The logo must be a PNG, JPEG or WebP image of at most 512 KB.",
  "invalid-font":
    "Fonts must be woff2 files of at most 512 KB. Upload a font before choosing Custom.",
  "invalid-color": "Use colors like #1d4ed8.",
  issues: "Not published: fix the marked problems first.",
  "no-draft": "There is no draft to publish.",
  conflict: "Someone else changed this template. Reload the page.",
  organization: "Choose an organization first.",
  "pdf-unavailable": "The PDF renderer is not available.",
  failed: "The change could not be saved.",
} as const;

export type FeedbackErrorCode = keyof typeof errorMessages;
export type ToastCode = keyof typeof toastMessages;

const fieldCodes: Readonly<Record<string, FeedbackErrorCode>> = {
  organization: "organization",
  logo: "invalid-logo",
  customFont: "invalid-font",
  font: "invalid-font",
  primaryColor: "invalid-color",
  accentColor: "invalid-color",
};

function validationCode(error: ValidationError): FeedbackErrorCode {
  for (const issue of error.issues) {
    const field = issue.path.split(".")[0] ?? "";
    const code = Object.hasOwn(fieldCodes, field) ? fieldCodes[field] : undefined;
    if (code) return code;
  }
  return "invalid";
}

/** The error code for an error thrown by a templates admin action. */
export function errorCode(error: unknown): FeedbackErrorCode {
  if (error instanceof TemplateIssuesError) return "issues";
  if (error instanceof NoDraftError) return "no-draft";
  if (error instanceof RendererUnavailableError) return "pdf-unavailable";
  if (error instanceof ConflictError) return "conflict";
  if (error instanceof ValidationError) return validationCode(error);
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case "UNAUTHORIZED":
      return "unauthorized";
    case "FORBIDDEN":
      // Tenancy's OrganizationError is a 403 too.
      return (error as { reason?: unknown }).reason === undefined ? "forbidden" : "organization";
    case "NOT_FOUND":
      return "not-found";
    default:
      return "failed";
  }
}

/** Template issues of a refused publish. */
export function issuesOf(error: unknown): TemplateIssue[] {
  return error instanceof TemplateIssuesError ? error.templateIssues.map((i) => ({ ...i })) : [];
}

function lookup(messages: Readonly<Record<string, string>>, code: unknown): string | undefined {
  return typeof code === "string" && Object.hasOwn(messages, code) ? messages[code] : undefined;
}

/** The fixed message for a `?toast=` code. */
export function toastMessage(code: unknown): string | undefined {
  return lookup(toastMessages, code);
}

/** The fixed message for an error code. */
export function errorMessage(code: unknown): string | undefined {
  return lookup(errorMessages, code);
}
