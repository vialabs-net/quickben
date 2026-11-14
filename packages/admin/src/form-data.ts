import { localDateTime, zonedTimeToUtc } from "@quickben/core";

import { englishI18n } from "./i18n/translator";

import type { AdminI18n } from "./i18n/translator";
import type { ValidationIssue } from "@quickben/core";
import type { FieldMeta } from "@quickben/next";

/**
 * Fields the admin form renders as editable inputs. With `operation`, fields that a field
 * access rule does not let the user set are left out too.
 */
export function editableFields(
  fields: readonly FieldMeta[],
  operation?: "create" | "update",
): FieldMeta[] {
  return fields.filter(
    (field) =>
      field.admin.hidden !== true &&
      field.admin.readOnly !== true &&
      (operation === undefined || field.access[operation]),
  );
}

type Parsed = { value: unknown } | { error: string };

type T = AdminI18n["t"];

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function texts(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string" && value !== "");
}

function parseNumber(raw: string, field: FieldMeta, t: T): Parsed {
  const value = Number(raw);
  if (!Number.isFinite(value)) return { error: t("error.number") };
  if (field.integer === true && !Number.isInteger(value)) return { error: t("error.wholeNumber") };
  return { value };
}

function parseDatetime(raw: string, t: T, timeZone: string): Parsed {
  // `<input type="datetime-local">` gives `YYYY-MM-DDTHH:mm` or `…:ss`, in the admin time zone.
  const value = zonedTimeToUtc(raw, timeZone);
  return value === null ? { error: t("error.datetime") } : { value };
}

function parseJson(raw: string, t: T): Parsed {
  try {
    return { value: JSON.parse(raw) as unknown };
  } catch {
    return { error: t("error.json") };
  }
}

function parseSingle(raw: string, field: FieldMeta, i18n: AdminI18n): Parsed {
  const { t } = i18n;
  switch (field.type) {
    case "number":
      return parseNumber(raw, field, t);
    case "datetime":
      return parseDatetime(raw, t, i18n.timeZone);
    case "json":
      return parseJson(raw, t);
    default:
      return { value: raw };
  }
}

function parseField(formData: FormData, field: FieldMeta, i18n: AdminI18n): Parsed {
  const { t } = i18n;
  if (field.type === "boolean") {
    const value = text(formData, field.name);
    return { value: value === "on" || value === "true" };
  }
  if (field.many) {
    const values = texts(formData, field.name);
    if (field.required && values.length === 0) return { error: t("error.chooseOne") };
    return { value: values };
  }
  const raw =
    field.type === "json" ? text(formData, field.name).trim() : text(formData, field.name);
  if (raw === "") return field.required ? { error: t("error.required") } : { value: null };
  return parseSingle(raw, field, i18n);
}

/**
 * Read create or update data from a submitted admin form. Only editable fields are read:
 * hidden and read-only fields, and fields the user may not set for `operation`, are left
 * out, so an update does not touch them. Empty inputs become `null`. Datetimes are read in
 * the admin time zone. Returns the data and the first error per field.
 */
export function parseFormData(
  fields: readonly FieldMeta[],
  formData: FormData,
  i18n: AdminI18n = englishI18n,
  operation?: "create" | "update",
): { data: Record<string, unknown>; errors: Record<string, string> } {
  const data: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const field of editableFields(fields, operation)) {
    const parsed = parseField(formData, field, i18n);
    if ("error" in parsed) errors[field.name] = parsed.error;
    else data[field.name] = parsed.value;
  }
  return { data, errors };
}

/**
 * Map validation issues to fields. The issue path `tags.0` belongs to the field `tags`.
 * Issues for unknown paths become the form message.
 */
export function issuesToErrors(
  issues: readonly ValidationIssue[],
  fieldNames: readonly string[],
): { fieldErrors: Record<string, string>; formError: string | null } {
  const known = new Set(fieldNames);
  const fieldErrors: Record<string, string> = {};
  let formError: string | null = null;
  for (const issue of issues) {
    const name = issue.path.split(".")[0] ?? "";
    if (known.has(name)) fieldErrors[name] ??= issue.message;
    else formError ??= issue.path ? `${issue.path}: ${issue.message}` : issue.message;
  }
  return { fieldErrors, formError };
}

/** Value of a `datetime-local` input for a stored ISO datetime, in `timeZone` (default UTC). */
export function toDatetimeLocal(value: unknown, timeZone = "UTC"): string {
  return typeof value === "string" ? localDateTime(value, timeZone) : "";
}

/** Text of a JSON editor for a stored value. */
export function toJsonText(value: unknown): string {
  return value === null || value === undefined ? "" : JSON.stringify(value, null, 2);
}
