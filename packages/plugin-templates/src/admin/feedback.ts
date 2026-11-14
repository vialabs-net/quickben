import { ConflictError, ValidationError } from "@quickben/core";

import { RendererUnavailableError } from "../pdf";
import { NoDraftError, TemplateIssuesError } from "../service";

import type { TemplateIssue } from "../content";
import type { TemplatesMessageKey } from "./messages";

/** Codes of `?toast=` after a redirect. Each has the message `toast.<code>`. */
const toastCodes = ["brand-saved"] as const;

/** Error codes. Each has the message `error.<code>`. */
const errorCodes = [
  "unauthorized",
  "forbidden",
  "not-found",
  "invalid",
  "invalid-logo",
  "invalid-font",
  "invalid-color",
  "issues",
  "no-draft",
  "conflict",
  "organization",
  "pdf-unavailable",
  "failed",
] as const;

export type FeedbackErrorCode = (typeof errorCodes)[number];
export type ToastCode = (typeof toastCodes)[number];

const fieldCodes: Readonly<Record<string, FeedbackErrorCode>> = {
  organization: "organization",
  logo: "invalid-logo",
  logoFile: "invalid-logo",
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

function isOneOf<T extends string>(codes: readonly T[], code: unknown): code is T {
  return typeof code === "string" && (codes as readonly string[]).includes(code);
}

/** The message key for a `?toast=` code. Unknown codes give `undefined`. */
export function toastKey(code: unknown): TemplatesMessageKey | undefined {
  return isOneOf(toastCodes, code) ? `toast.${code}` : undefined;
}

/** The message key for an error code. Unknown codes give `undefined`. */
export function errorKey(code: unknown): TemplatesMessageKey | undefined {
  return isOneOf(errorCodes, code) ? `error.${code}` : undefined;
}
