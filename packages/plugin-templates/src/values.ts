import type { CatalogVariable } from "./kinds";

/** Printed for a missing value. */
export const BLANK = "________________";

/** Data passed to a render: nested objects, read by dot paths. */
export type TemplateData = Readonly<Record<string, unknown>>;

/** How values are printed. */
export interface FormatOptions {
  /** BCP 47 locale for numbers, dates and transforms. Default `en-US`. */
  locale?: string;
  /** Time zone for datetimes. Dates (`YYYY-MM-DD`) are never shifted. Default `UTC`. */
  timeZone?: string;
  /** Text for `true` and `false`. Default `["yes", "no"]`. */
  booleanLabels?: readonly [string, string];
}

/** Format options with defaults applied. */
export interface ResolvedFormat {
  locale: string;
  timeZone: string;
  booleanLabels: readonly [string, string];
}

export function resolveFormat(options: FormatOptions = {}): ResolvedFormat {
  return {
    locale: options.locale ?? "en-US",
    timeZone: options.timeZone ?? "UTC",
    booleanLabels: options.booleanLabels ?? ["yes", "no"],
  };
}

function own(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * The value at a dot path. Reads own properties only, so `constructor` or `__proto__` never
 * reach the prototype. A flat key (`{ "customer.name": … }`) also works.
 */
export function lookup(data: TemplateData, path: string): unknown {
  if (Object.hasOwn(data, path)) return data[path];
  let value: unknown = data;
  for (const key of path.split(".")) {
    value = own(value, key);
    if (value === undefined) return undefined;
  }
  return value;
}

/** Whether a value is missing: `null`, `undefined` or an empty string. */
export const isMissing = (value: unknown): boolean =>
  value === null || value === undefined || value === "";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function formatDate(value: unknown, format: ResolvedFormat): string | null {
  let date: Date | null = null;
  let timeZone = format.timeZone;
  if (value instanceof Date) date = value;
  else if (typeof value === "string") {
    if (datePattern.test(value)) timeZone = "UTC";
    date = new Date(datePattern.test(value) ? `${value}T00:00:00Z` : value);
  } else if (typeof value === "number") date = new Date(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(format.locale, { dateStyle: "long", timeZone }).format(date);
}

function scalarText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return null;
}

/** The text a variable prints. */
export function display(
  variable: CatalogVariable | undefined,
  value: unknown,
  format: ResolvedFormat,
  custom?: (value: unknown) => string,
): string {
  const placeholder = variable?.placeholder ?? BLANK;
  if (isMissing(value) || Array.isArray(value)) return placeholder;
  if (custom) return custom(value);
  switch (variable?.type) {
    case "enum": {
      const text = scalarText(value);
      return variable.values?.find((v) => v.value === text)?.label ?? text ?? placeholder;
    }
    case "number":
      return typeof value === "number"
        ? new Intl.NumberFormat(format.locale).format(value)
        : (scalarText(value) ?? placeholder);
    case "date":
      return formatDate(value, format) ?? scalarText(value) ?? placeholder;
    default:
      if (typeof value === "boolean")
        return value ? format.booleanLabels[0] : format.booleanLabels[1];
      if (value instanceof Date) return formatDate(value, format) ?? placeholder;
      return scalarText(value) ?? placeholder;
  }
}

/** Items of a list value: objects only. */
export function listItems(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === "object" && !Array.isArray(item),
  );
}

/** One field of a list item, as text. */
export function itemText(
  item: Record<string, unknown>,
  key: string,
  format: ResolvedFormat,
): string {
  const value = Object.hasOwn(item, key) ? item[key] : undefined;
  if (isMissing(value) || Array.isArray(value)) return "";
  return display(
    { path: key, label: key, group: "", type: "text", placeholder: "" },
    value,
    format,
  );
}
