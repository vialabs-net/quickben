import type { CollectionMeta, FieldMeta } from "@quickben/next";

/** What a table cell shows. */
export type Cell =
  | { kind: "empty" }
  | { kind: "text"; text: string; mono?: boolean }
  | { kind: "badges"; items: string[] }
  | { kind: "boolean"; value: boolean };

const systemLabels: Record<string, string> = {
  id: "ID",
  createdAt: "Created",
  updatedAt: "Updated",
};

/** Label of a column: the field label, or a name for system fields. */
export function columnLabel(meta: CollectionMeta, name: string): string {
  return systemLabels[name] ?? meta.fields.find((field) => field.name === name)?.label ?? name;
}

/** `2026-11-13T14:05:09.000Z` → `2026-11-13 14:05 UTC`. Same output on every server. */
export function formatDatetime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
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

function fieldCell(
  field: FieldMeta,
  value: unknown,
  metas: ReadonlyMap<string, CollectionMeta>,
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
        text: truncate(items.map((item) => relationTitle(item, related)).join(", "), 80),
      };
    }
    case "datetime":
      return { kind: "text", text: formatDatetime(String(value)) };
    case "json":
      return { kind: "text", text: truncate(JSON.stringify(value), 60), mono: true };
    case "number":
      return { kind: "text", text: String(value) };
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
): Cell {
  const value = doc[column];
  if (isEmpty(value)) return { kind: "empty" };
  if (column === "createdAt" || column === "updatedAt") {
    return { kind: "text", text: formatDatetime(String(value)) };
  }
  if (column === "id") return { kind: "text", text: String(value), mono: true };
  const field = meta.fields.find((candidate) => candidate.name === column);
  return field ? fieldCell(field, value, metas) : { kind: "text", text: String(value) };
}
