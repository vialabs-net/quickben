import type { ValidationIssue } from "@quickben/core";
import type { FieldMeta } from "@quickben/next";

/** Fields the admin form renders as editable inputs. */
export function editableFields(fields: readonly FieldMeta[]): FieldMeta[] {
  return fields.filter((field) => field.admin.hidden !== true && field.admin.readOnly !== true);
}

type Parsed = { value: unknown } | { error: string };

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function texts(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string" && value !== "");
}

function parseNumber(raw: string, field: FieldMeta): Parsed {
  const value = Number(raw);
  if (!Number.isFinite(value)) return { error: "Enter a number" };
  if (field.integer === true && !Number.isInteger(value)) return { error: "Enter a whole number" };
  return { value };
}

function parseDatetime(raw: string): Parsed {
  // `<input type="datetime-local">` gives `YYYY-MM-DDTHH:mm` or `…:ss`. The admin uses UTC.
  const withSeconds = raw.length === 16 ? `${raw}:00` : raw;
  const date = new Date(`${withSeconds}Z`);
  if (Number.isNaN(date.getTime())) return { error: "Enter a valid date and time" };
  return { value: date.toISOString() };
}

function parseJson(raw: string): Parsed {
  try {
    return { value: JSON.parse(raw) as unknown };
  } catch {
    return { error: "Enter valid JSON" };
  }
}

function parseSingle(raw: string, field: FieldMeta): Parsed {
  switch (field.type) {
    case "number":
      return parseNumber(raw, field);
    case "datetime":
      return parseDatetime(raw);
    case "json":
      return parseJson(raw);
    default:
      return { value: raw };
  }
}

function parseField(formData: FormData, field: FieldMeta): Parsed {
  if (field.type === "boolean") {
    const value = text(formData, field.name);
    return { value: value === "on" || value === "true" };
  }
  if (field.many) {
    const values = texts(formData, field.name);
    if (field.required && values.length === 0) return { error: "Choose at least one" };
    return { value: values };
  }
  const raw =
    field.type === "json" ? text(formData, field.name).trim() : text(formData, field.name);
  if (raw === "") return field.required ? { error: "Required" } : { value: null };
  return parseSingle(raw, field);
}

/**
 * Read create or update data from a submitted admin form. Only editable fields are read:
 * hidden and read-only fields are left out, so an update does not touch them. Empty inputs
 * become `null`. Returns the data and the first error per field.
 */
export function parseFormData(
  fields: readonly FieldMeta[],
  formData: FormData,
): { data: Record<string, unknown>; errors: Record<string, string> } {
  const data: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const field of editableFields(fields)) {
    const parsed = parseField(formData, field);
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

/** Value of a `datetime-local` input for a stored ISO datetime (UTC). */
export function toDatetimeLocal(value: unknown): string {
  return typeof value === "string" && value.length >= 16 ? value.slice(0, 16) : "";
}

/** Text of a JSON editor for a stored value. */
export function toJsonText(value: unknown): string {
  return value === null || value === undefined ? "" : JSON.stringify(value, null, 2);
}
