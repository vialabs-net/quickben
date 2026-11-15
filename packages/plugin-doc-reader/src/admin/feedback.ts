import { ConflictError, ValidationError } from "@quickben/core";

import { StudioError } from "../studio";

import type { DocReaderT } from "./messages";
import type { QuickbenError } from "@quickben/core";

/** Codes of success messages in `?toast=`. Each maps to the catalog key `toast.<code>`. */
export const toastCodes = [
  "type-created",
  "draft-created",
  "draft-saved",
  "draft-deleted",
  "published",
  "samples-added",
  "sample-saved",
  "sample-removed",
  "test-started",
  "budget-saved",
  "budget-removed",
  "cap-saved",
  "reading-retried",
  "reading-cancelled",
] as const;

/** Codes of error messages in `?error=`. Each maps to the catalog key `error.<code>`. */
export const errorCodes = [
  "unauthorized",
  "forbidden",
  "not-found",
  "invalid",
  "type-exists",
  "draft-exists",
  "published",
  "not-tested",
  "no-samples",
  "changed",
  "no-file",
  "conflict",
  "failed",
] as const;

export type ToastCode = (typeof toastCodes)[number];
export type FeedbackErrorCode = (typeof errorCodes)[number];

/** The `?error=` code for an error thrown by an action. */
export function errorCode(error: QuickbenError): FeedbackErrorCode {
  if (error instanceof StudioError) return error.rule;
  if (error instanceof ValidationError) return "invalid";
  if (error instanceof ConflictError) return "conflict";
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

/** The path of the first validation issue, when it is safe to put in a URL. */
export function issuePath(error: unknown): string | undefined {
  if (!(error instanceof ValidationError)) return undefined;
  const path = error.issues[0]?.path;
  return path && /^[\w.]{1,80}$/u.test(path) ? path : undefined;
}

function isCode<C extends string>(codes: readonly C[], code: unknown): code is C {
  return typeof code === "string" && (codes as readonly string[]).includes(code);
}

/** The message for a `?toast=` code, or `undefined` for unknown codes. */
export function toastMessage(t: DocReaderT, code: unknown): string | undefined {
  return isCode(toastCodes, code) ? t(`toast.${code}`) : undefined;
}

/** The message for an `?error=` code, or `undefined` for unknown codes. */
export function errorMessage(t: DocReaderT, code: unknown): string | undefined {
  return isCode(errorCodes, code) ? t(`error.${code}`) : undefined;
}

const parts = ["fields", "params", "steps", "pages", "text", "fileName", "excludes"] as const;

/** `fields.1.key` → `Field 2 key`. Only known words and numbers are shown. */
export function describeIssue(t: DocReaderT, path: unknown): string | undefined {
  if (typeof path !== "string" || !/^[\w.]{1,80}$/u.test(path)) return undefined;
  const words: string[] = [];
  for (const part of path.split(".")) {
    if (/^\d+$/u.test(part)) {
      words.push(String(Number(part) + 1));
    } else if (isCode(parts, part)) {
      words.push(t(`issue.${part}`));
    } else if (/^[a-zA-Z]{1,40}$/u.test(part) && part !== "pipeline" && part !== "classification") {
      words.push(part);
    }
  }
  return words.length > 0 ? words.join(" ") : undefined;
}
