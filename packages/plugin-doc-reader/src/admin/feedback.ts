import { ConflictError, ValidationError } from "@quickben/core";

import { StudioError } from "../studio";

import type { QuickbenError } from "@quickben/core";

/** Success messages, by the code in `?toast=`. */
export const toastMessages = {
  "type-created": "Document type created",
  "draft-created": "Draft created",
  "draft-saved": "Draft saved. Test it again before publishing.",
  "draft-deleted": "Draft deleted",
  published: "Version published",
  "samples-added": "Samples added",
  "sample-saved": "Sample saved",
  "sample-removed": "Sample removed",
  "test-started": "Test started",
  "budget-saved": "Budget saved",
  "budget-removed": "Budget removed",
  "cap-saved": "Platform cap saved",
  "reading-retried": "Reading queued again",
  "reading-cancelled": "Reading cancelled",
} as const;

/** Error messages, by the code in `?error=`. */
export const errorMessages = {
  unauthorized: "Sign in again to continue.",
  forbidden: "You are not allowed to do that.",
  "not-found": "That item does not exist or you cannot see it.",
  invalid: "Some values are not valid. Check the form and try again.",
  "type-exists": "A document type with that key already exists.",
  "draft-exists": "This type already has a draft. Edit or delete it first.",
  published: "Published versions cannot change. Create a draft.",
  "not-tested": "Test this version on its samples before publishing it.",
  "no-samples": "Add samples before running a test.",
  changed: "The draft changed after its test. Test it again.",
  "no-file": "Choose a file.",
  conflict: "That value is already used.",
  failed: "The change could not be saved.",
} as const;

export type ToastCode = keyof typeof toastMessages;
export type FeedbackErrorCode = keyof typeof errorMessages;

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

function lookup(messages: Readonly<Record<string, string>>, code: unknown): string | undefined {
  return typeof code === "string" && Object.hasOwn(messages, code) ? messages[code] : undefined;
}

export function toastMessage(code: unknown): string | undefined {
  return lookup(toastMessages, code);
}

export function errorMessage(code: unknown): string | undefined {
  return lookup(errorMessages, code);
}

const parts: Readonly<Record<string, string>> = {
  fields: "Field",
  params: "Parameter",
  steps: "Step",
  pages: "Page",
  text: "Text pattern",
  fileName: "File name pattern",
  excludes: "Excluded field",
};

/** `fields.1.key` → `Field 2: key`. Only known words and numbers are shown. */
export function describeIssue(path: unknown): string | undefined {
  if (typeof path !== "string" || !/^[\w.]{1,80}$/u.test(path)) return undefined;
  const words: string[] = [];
  for (const part of path.split(".")) {
    if (/^\d+$/u.test(part)) {
      words.push(String(Number(part) + 1));
    } else if (Object.hasOwn(parts, part)) {
      words.push(parts[part] ?? part);
    } else if (/^[a-zA-Z]{1,40}$/u.test(part) && part !== "pipeline" && part !== "classification") {
      words.push(part);
    }
  }
  return words.length > 0 ? words.join(" ") : undefined;
}
