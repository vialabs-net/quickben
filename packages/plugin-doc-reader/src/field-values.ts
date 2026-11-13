/**
 * Canonical form of a field value, by field type. Every extractor's values go through here, and
 * so do the expected values of test samples before they are compared.
 *
 * | Type     | Canonical value                                        |
 * | -------- | ------------------------------------------------------ |
 * | `text`   | Whitespace collapsed, then `transform`.                |
 * | `date`   | `YYYY-MM-DD`. Input: ISO, or day/month/year by `dateOrder`. |
 * | `number` | A plain decimal: `1234.5`. Thousands separators dropped. |
 * | `email`  | Lowercase, must look like an address.                  |
 * | `phone`  | Digits, with a leading `+` when printed. 6 digits or more. |
 */
import { listParam } from "./definition";

import type { DocumentType, ExtractionParams, FieldDefinition } from "./definition";

type FieldRules = Pick<
  FieldDefinition,
  "type" | "transform" | "pattern" | "dateOrder" | "decimalSeparator"
>;

const pad = (n: number) => String(n).padStart(2, "0");

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
}

function canonicalDate(value: string, order: "dmy" | "mdy"): string | null {
  const ymd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/u.exec(value);
  if (ymd) return isoDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  const yearLast = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})$/u.exec(value);
  if (!yearLast) return null;
  const [first, second, year] = [Number(yearLast[1]), Number(yearLast[2]), Number(yearLast[3])];
  return order === "dmy" ? isoDate(year, second, first) : isoDate(year, first, second);
}

function canonicalNumber(value: string, decimal: "." | ","): string | null {
  const negative = /^[-−(]/u.test(value.trimStart());
  const kept = value.replaceAll(/[^\d.,]/gu, "");
  const thousands = decimal === "." ? "," : ".";
  const plain = kept.replaceAll(thousands, "").replace(decimal, ".");
  if (!/^\d+(?:\.\d+)?$/u.test(plain)) return null;
  const number = Number(plain);
  return String(negative ? -number : number);
}

function isEmail(value: string): boolean {
  const at = value.indexOf("@");
  const domain = value.slice(at + 1);
  return (
    at > 0 &&
    !/\s/u.test(value) &&
    !domain.includes("@") &&
    domain.includes(".") &&
    !domain.startsWith(".") &&
    !domain.endsWith(".")
  );
}

function byType(field: FieldRules, value: string): string | null {
  switch (field.type) {
    case "date":
      return canonicalDate(value, field.dateOrder ?? "dmy");
    case "number":
      return canonicalNumber(value, field.decimalSeparator ?? ".");
    case "email": {
      const email = value.toLowerCase();
      return isEmail(email) ? email : null;
    }
    case "phone": {
      const digits = value.replaceAll(/\D/gu, "");
      if (digits.length < 6) return null;
      return value.startsWith("+") ? `+${digits}` : digits;
    }
    case "text":
      return value.replaceAll(/\s+/gu, " ");
  }
}

function transform(value: string, kind: FieldRules["transform"]): string {
  if (kind === "upper") return value.toUpperCase();
  if (kind === "compact") return value.replaceAll(/[\s.-]/gu, "").toUpperCase();
  return value;
}

/** Canonical value, or `null` when the value is empty or not valid for the field. */
export function normalizeFieldValue(
  field: FieldRules,
  raw: string | null | undefined,
): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const typed = byType(field, value);
  if (!typed) return null;
  const result = transform(typed, field.transform);
  if (field.pattern && !new RegExp(field.pattern, "iu").test(result)) return null;
  return result;
}

/** Whether a read value matches an expected one, after both are normalized. */
export function sameFieldValue(
  field: FieldRules,
  expected: string | null | undefined,
  read: string | null | undefined,
): boolean {
  const a = normalizeFieldValue(field, expected) ?? (expected ?? "").trim();
  const b = normalizeFieldValue(field, read) ?? (read ?? "").trim();
  if (field.type === "text") return a.toUpperCase() === b.toUpperCase();
  return a === b;
}

/**
 * Normalized values a field can never have: the values of every parameter that `excludes` it.
 */
export function excludedValues(
  type: DocumentType,
  params: ExtractionParams,
  field: FieldDefinition,
): Set<string> {
  const excluded = new Set<string>();
  for (const param of type.params) {
    if (!param.excludes.includes(field.key)) continue;
    for (const raw of listParam(params, param.key)) {
      excluded.add(normalizeFieldValue(field, raw) ?? raw.trim());
    }
  }
  return excluded;
}

/**
 * Normalize raw values of a type's fields. Unknown keys, values that are not valid for their
 * field and excluded values are dropped.
 */
export function cleanValues<T extends { value: string }>(
  type: DocumentType,
  params: ExtractionParams,
  values: Readonly<Record<string, T | undefined>>,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const field of type.fields) {
    const raw = Object.hasOwn(values, field.key) ? values[field.key] : undefined;
    if (!raw) continue;
    const value = normalizeFieldValue(field, raw.value);
    if (!value || excludedValues(type, params, field).has(value)) continue;
    out[field.key] = { ...raw, value };
  }
  return out;
}
