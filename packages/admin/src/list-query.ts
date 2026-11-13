import type { SearchParams } from "./types";
import type { CollectionMeta, FieldMeta } from "@quickben/next";

/** State of a list view, read from its URL. */
export interface ListState {
  /** Search text. */
  q: string;
  /** Sort key (`field` or `-field`), or `null` for the default order. */
  sort: string | null;
  page: number;
  limit: number;
  /** Filter values by field name: an option, or `"true"` / `"false"` for booleans. */
  filters: Record<string, string>;
}

/** Page sizes offered by the list view. */
export const pageSizes = [10, 20, 50, 100] as const;

const defaultLimit = 20;
const systemColumns = new Set(["id", "createdAt", "updatedAt"]);
const textTypes = new Set(["text", "textarea", "email", "url"]);
const simpleColumnTypes = new Set([
  "text",
  "email",
  "url",
  "number",
  "boolean",
  "date",
  "datetime",
  "select",
  "relation",
]);

/** Prefix of filter parameters: `?filter.status=draft`. */
export const filterPrefix = "filter.";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function fieldOf(meta: CollectionMeta, name: string): FieldMeta | undefined {
  return meta.fields.find((field) => field.name === name);
}

/** Fields that get a filter: visible `select` and `boolean` fields. */
export function filterFields(meta: CollectionMeta): FieldMeta[] {
  return meta.fields.filter(
    (field) => field.admin.hidden !== true && (field.type === "select" || field.type === "boolean"),
  );
}

/** Whether the list can be sorted by a column. */
export function isSortable(meta: CollectionMeta, name: string): boolean {
  if (systemColumns.has(name)) return true;
  const field = fieldOf(meta, name);
  return field !== undefined && !field.many && field.type !== "json";
}

/**
 * Columns of the list view: `admin.defaultColumns`, or the title field and the next three
 * simple fields.
 */
export function columnsOf(meta: CollectionMeta): string[] {
  const visible = (name: string) =>
    systemColumns.has(name) ||
    (fieldOf(meta, name) !== undefined && fieldOf(meta, name)?.admin.hidden !== true);
  if (meta.admin.defaultColumns) return meta.admin.defaultColumns.filter(visible);
  const title = meta.admin.useAsTitle;
  const rest = meta.fields
    .filter(
      (field) =>
        field.name !== title && field.admin.hidden !== true && simpleColumnTypes.has(field.type),
    )
    .map((field) => field.name);
  return [title, ...rest].slice(0, 4);
}

/** The field searched by the search box: the title field when it is text-like, else `null`. */
export function searchField(meta: CollectionMeta): FieldMeta | null {
  const field = fieldOf(meta, meta.admin.useAsTitle);
  return field && textTypes.has(field.type) && !field.many ? field : null;
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^\d{1,6}$/.test(value)) return fallback;
  const parsed = Number(value);
  return parsed > 0 ? parsed : fallback;
}

function validFilter(field: FieldMeta, value: string): boolean {
  if (field.type === "boolean") return value === "true" || value === "false";
  return field.options?.includes(value) ?? false;
}

/** Read the list state from search parameters. Invalid values fall back to defaults. */
export function parseListState(meta: CollectionMeta, params: SearchParams): ListState {
  const sortParam = first(params.sort);
  const sortField = sortParam?.startsWith("-") ? sortParam.slice(1) : sortParam;
  const limit = positiveInt(first(params.limit), defaultLimit);
  const filters: Record<string, string> = {};
  for (const field of filterFields(meta)) {
    const value = first(params[`${filterPrefix}${field.name}`]);
    if (value !== undefined && validFilter(field, value)) filters[field.name] = value;
  }
  return {
    q: first(params.q)?.trim() ?? "",
    sort: sortField && isSortable(meta, sortField) ? (sortParam ?? null) : null,
    page: positiveInt(first(params.page), 1),
    limit: (pageSizes as readonly number[]).includes(limit) ? limit : defaultLimit,
    filters,
  };
}

/** The `qb.find` query of a list state. Relations are loaded one level to show their titles. */
export function listQuery(meta: CollectionMeta, state: ListState) {
  const conditions: Record<string, unknown>[] = [];
  const search = searchField(meta);
  if (state.q !== "" && search) conditions.push({ [search.name]: { contains: state.q } });
  for (const [name, value] of Object.entries(state.filters)) {
    const field = fieldOf(meta, name);
    if (!field) continue;
    if (field.type === "boolean") conditions.push({ [name]: { eq: value === "true" } });
    else conditions.push({ [name]: field.many ? { contains: value } : { eq: value } });
  }
  return {
    ...(conditions.length > 0 ? { where: { and: conditions } } : {}),
    ...(state.sort ? { sort: state.sort } : {}),
    limit: state.limit,
    page: state.page,
    depth: 1 as const,
  };
}

/** URL of a list view with some state changed. Default values are left out of the URL. */
export function listHref(
  basePath: string,
  slug: string,
  state: ListState,
  patch: Partial<ListState> = {},
): string {
  const next = { ...state, ...patch };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  for (const [name, value] of Object.entries(next.filters)) {
    params.set(`${filterPrefix}${name}`, value);
  }
  if (next.sort) params.set("sort", next.sort);
  if (next.limit !== defaultLimit) params.set("limit", String(next.limit));
  if (next.page > 1) params.set("page", String(next.page));
  const query = params.toString();
  const path = `${basePath}/${slug}`;
  return query ? `${path}?${query}` : path;
}

/** Sort key a column header links to: ascending first, then descending. */
export function nextSort(state: ListState, column: string): string {
  return state.sort === column ? `-${column}` : column;
}
