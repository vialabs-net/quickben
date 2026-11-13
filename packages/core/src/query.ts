import { ValidationError } from "./errors";
import { normalizeWhere } from "./where";

import type { DocumentData, SortSpec, WhereNode } from "./adapter";
import type { SanitizedCollection } from "./types";

/** Default page size of `find`. */
export const DEFAULT_LIMIT = 20;

const systemSortable = new Set(["id", "createdAt", "updatedAt"]);

/**
 * Parse `"field"` / `"-field"` keys into sort specs. Defaults to `-createdAt` and always ends
 * with `id`, so the order is total.
 */
export function parseSort(collection: SanitizedCollection, sort: unknown): SortSpec[] {
  let keys: unknown[] = ["-createdAt"];
  if (Array.isArray(sort)) keys = sort;
  else if (sort !== undefined) keys = [sort];
  const specs: SortSpec[] = [];
  for (const [index, key] of keys.entries()) {
    if (typeof key !== "string" || key === "" || key === "-") {
      throw invalid(`sort.${index}`, "Expected a field name");
    }
    const direction = key.startsWith("-") ? "desc" : "asc";
    const field = direction === "desc" ? key.slice(1) : key;
    if (!isSortable(collection, field)) {
      throw invalid(
        `sort.${index}`,
        `Cannot sort by "${field}" in collection "${collection.slug}"`,
      );
    }
    if (specs.some((spec) => spec.field === field)) continue;
    specs.push({ field, direction });
  }
  if (!specs.some((spec) => spec.field === "id")) {
    specs.push({ field: "id", direction: specs.at(-1)?.direction ?? "asc" });
  }
  return specs;
}

function isSortable(collection: SanitizedCollection, field: string): boolean {
  if (systemSortable.has(field)) return true;
  const definition = Object.hasOwn(collection.fields, field) ? collection.fields[field] : undefined;
  return definition !== undefined && !definition.many && definition.type !== "json";
}

/** Validate `limit` and `page`. */
export function parsePaging(limit: unknown, page: unknown): { limit: number; page: number } {
  const resolvedLimit = limit ?? DEFAULT_LIMIT;
  if (!isPositiveInt(resolvedLimit)) throw invalid("limit", "Expected a positive integer");
  const resolvedPage = page ?? 1;
  if (!isPositiveInt(resolvedPage)) throw invalid("page", "Expected a positive integer");
  return { limit: resolvedLimit, page: resolvedPage };
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

interface CursorPayload {
  /** Sort signature, e.g. `-createdAt,-id`. */
  s: string;
  /** Sort values of the last document, in sort order. */
  v: unknown[];
}

function signature(sort: readonly SortSpec[]): string {
  return sort.map((spec) => (spec.direction === "desc" ? "-" : "") + spec.field).join(",");
}

/** Encode the position after `doc` for `sort`. */
export function encodeCursor(sort: readonly SortSpec[], doc: DocumentData): string {
  const payload: CursorPayload = {
    s: signature(sort),
    v: sort.map((spec) => doc[spec.field] ?? null),
  };
  return toBase64Url(JSON.stringify(payload));
}

/**
 * Turn a cursor into a filter that matches the documents after it (keyset pagination).
 * Throws `ValidationError` when the cursor is malformed, was made for another sort, or holds
 * values that do not fit the sort fields (cursors come from clients and can be edited).
 */
export function cursorWhere(
  collection: SanitizedCollection,
  sort: readonly SortSpec[],
  cursor: string,
): WhereNode {
  const payload = decodeCursor(cursor);
  if (payload?.s !== signature(sort) || payload.v.length !== sort.length) {
    throw invalid("cursor", "Invalid cursor for this sort");
  }
  const values = sort.map((spec, index) => cursorValue(collection, spec.field, payload.v[index]));
  const branches: WhereNode[] = [];
  for (const [index, spec] of sort.entries()) {
    const after = afterValue(spec, values[index] ?? null);
    if (!after) continue;
    const ties = sort
      .slice(0, index)
      .map((previous, i) => equalTo(previous.field, values[i] ?? null));
    branches.push({ and: [...ties, after] });
  }
  return { or: branches };
}

/** Check one cursor value against its field, as a `where` operand would be. */
function cursorValue(collection: SanitizedCollection, field: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  try {
    const node = normalizeWhere(collection, { [field]: { eq: value } });
    return "value" in node ? node.value : null;
  } catch {
    throw invalid("cursor", "Invalid cursor for this sort");
  }
}

function decodeCursor(cursor: string): CursorPayload | undefined {
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(cursor));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as CursorPayload).s === "string" &&
      Array.isArray((parsed as CursorPayload).v)
    ) {
      return parsed as CursorPayload;
    }
  } catch {
    // Fall through to the error below.
  }
  return undefined;
}

function equalTo(field: string, value: unknown): WhereNode {
  return value === null ? { field, op: "exists", value: false } : { field, op: "eq", value };
}

/** Documents that sort strictly after `value` on one key. Nulls are last in `asc`. */
function afterValue(spec: SortSpec, value: unknown): WhereNode | undefined {
  const { field, direction } = spec;
  if (direction === "asc") {
    if (value === null) return undefined;
    return {
      or: [
        { field, op: "gt", value },
        { field, op: "exists", value: false },
      ],
    };
  }
  if (value === null) return { field, op: "exists", value: true };
  return { field, op: "lt", value };
}

function toBase64Url(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCodePoint(byte);
  let encoded = btoa(binary).replaceAll("+", "-").replaceAll("/", "_");
  while (encoded.endsWith("=")) encoded = encoded.slice(0, -1);
  return encoded;
}

function fromBase64Url(encoded: string): string {
  const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0);
  return new TextDecoder().decode(bytes);
}

function invalid(path: string, message: string): ValidationError {
  return new ValidationError([{ path, message }]);
}
