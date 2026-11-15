import type { AdminI18n } from "./i18n/translator";
import type { CollectionMeta, FieldMeta } from "@quickben/next";

/** What a table cell shows. */
export type Cell =
  | { kind: "empty" }
  | { kind: "text"; text: string; mono?: boolean }
  | { kind: "badges"; items: string[] }
  | { kind: "boolean"; value: boolean };

const systemLabels = {
  id: "column.id",
  createdAt: "column.createdAt",
  updatedAt: "column.updatedAt",
} as const;

/** Label of a column: the field label, or a name for system fields. */
export function columnLabel(meta: CollectionMeta, name: string, i18n: AdminI18n): string {
  if (Object.hasOwn(systemLabels, name))
    return i18n.t(systemLabels[name as keyof typeof systemLabels]);
  return meta.fields.find((field) => field.name === name)?.label ?? name;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Title of a document: its `useAsTitle` value, or its id. */
export function documentTitle(
  meta: CollectionMeta | undefined,
  doc: Record<string, unknown>,
): string {
  const value = meta ? doc[meta.admin.useAsTitle] : undefined;
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number") return String(value);
  return typeof doc.id === "string" ? doc.id : "";
}

/** Title of a relation value: a populated document or an id. */
export function relationTitle(value: unknown, related: CollectionMeta | undefined): string {
  if (isRecord(value)) return documentTitle(related, value);
  return typeof value === "string" ? value : "";
}

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function fileName(value: unknown): string {
  const name = (value as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name : "";
}

function fieldCell(
  field: FieldMeta,
  value: unknown,
  metas: ReadonlyMap<string, CollectionMeta>,
  i18n: AdminI18n,
): Cell {
  switch (field.type) {
    case "boolean":
      return { kind: "boolean", value: value === true };
    case "select":
      return { kind: "badges", items: Array.isArray(value) ? value.map(String) : [String(value)] };
    case "relation": {
      const related = field.to ? metas.get(field.to) : undefined;
      const items = Array.isArray(value) ? value : [value];
      return {
        kind: "text",
        text: truncate(i18n.list(items.map((item) => relationTitle(item, related))), 80),
      };
    }
    case "datetime":
      return { kind: "text", text: i18n.dateTime(String(value)) };
    case "date":
      return { kind: "text", text: i18n.date(String(value)) };
    case "json":
      return { kind: "text", text: truncate(JSON.stringify(value), 60), mono: true };
    case "file":
      return { kind: "text", text: truncate(fileName(value), 80) };
    case "number":
      return { kind: "text", text: typeof value === "number" ? i18n.number(value) : String(value) };
    default:
      return { kind: "text", text: truncate(String(value), 80) };
  }
}

/** What to show in the cell of `column` for `doc`. */
export function formatCell(
  meta: CollectionMeta,
  column: string,
  doc: Record<string, unknown>,
  metas: ReadonlyMap<string, CollectionMeta>,
  i18n: AdminI18n,
): Cell {
  const value = doc[column];
  if (isEmpty(value)) return { kind: "empty" };
  if (column === "createdAt" || column === "updatedAt") {
    return { kind: "text", text: i18n.dateTime(String(value)) };
  }
  if (column === "id") return { kind: "text", text: String(value), mono: true };
  const field = meta.fields.find((candidate) => candidate.name === column);
  return field ? fieldCell(field, value, metas, i18n) : { kind: "text", text: String(value) };
}
