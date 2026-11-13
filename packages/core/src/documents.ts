import { checkAccess } from "./access";
import { ValidationError } from "./errors";
import { andWhere } from "./where";

import type { DatabaseAdapter, DocumentData } from "./adapter";
import type { Quickben, RequestContext, SanitizedCollection } from "./types";

/** Everything an operation needs. */
export interface OperationScope {
  collections: ReadonlyMap<string, SanitizedCollection>;
  db: DatabaseAdapter;
  /** Local API bound to `db`, passed to hooks. */
  api: Quickben;
  ctx: RequestContext;
}

const systemFields = ["id", "createdAt", "updatedAt"] as const;

/** Validate a `select` list. Returns `undefined` for "all fields". */
export function parseSelect(
  collection: SanitizedCollection,
  select: unknown,
): string[] | undefined {
  if (select === undefined) return undefined;
  if (!Array.isArray(select)) {
    throw new ValidationError([{ path: "select", message: "Expected an array of field names" }]);
  }
  const names = new Set<string>(["id"]);
  for (const [index, name] of select.entries()) {
    const known =
      typeof name === "string" &&
      ((systemFields as readonly string[]).includes(name) ||
        Object.hasOwn(collection.fields, name));
    if (!known) {
      throw new ValidationError([
        { path: `select.${index}`, message: `Unknown field "${String(name)}"` },
      ]);
    }
    names.add(name);
  }
  return [...names];
}

/**
 * Shape a stored document: system fields first, then every field in declaration order.
 * Missing values become `null` (or `[]` for `many` fields). With `select`, only those keys.
 */
export function normalizeDoc(
  collection: SanitizedCollection,
  raw: DocumentData,
  select?: readonly string[],
): DocumentData {
  const wanted = select ? new Set(select) : undefined;
  const doc: DocumentData = {};
  for (const name of systemFields) {
    if (!wanted || wanted.has(name)) doc[name] = raw[name] ?? null;
  }
  for (const field of collection.fieldList) {
    if (wanted && !wanted.has(field.name)) continue;
    doc[field.name] = raw[field.name] ?? (field.many ? [] : null);
  }
  return doc;
}

/** Fill fields missing from create data with `null` (or `[]`). */
export function fillMissing(collection: SanitizedCollection, data: DocumentData): DocumentData {
  const complete: DocumentData = {};
  for (const field of collection.fieldList) {
    complete[field.name] = data[field.name] ?? (field.many ? [] : null);
  }
  return complete;
}

/** Options of {@link finishRead}. */
export interface FinishReadOptions {
  depth: number;
  /** Fields to keep after hooks, from {@link parseSelect}. */
  select?: readonly string[];
}

/**
 * Turn stored documents into results: normalize, load relations, run `afterRead` hooks,
 * then apply `select`.
 */
export async function finishRead(
  scope: OperationScope,
  collection: SanitizedCollection,
  rows: readonly DocumentData[],
  options: FinishReadOptions,
): Promise<DocumentData[]> {
  const docs = rows.map((row) =>
    normalizeDoc(collection, row, fetchSelect(collection, options.select)),
  );
  if (options.depth > 0) await populate(scope, collection, docs, options.depth);
  const hooks = collection.hooks.afterRead ?? [];
  const results: DocumentData[] = [];
  for (let doc of docs) {
    for (const hook of hooks) {
      const args = { doc, user: scope.ctx.user, req: scope.ctx.req, qb: scope.api, collection };
      const next = await hook(args as never);
      if (next) doc = next as DocumentData;
    }
    results.push(options.select ? pick(doc, options.select) : doc);
  }
  return results;
}

/**
 * Fields to load from the adapter. With `afterRead` hooks, all fields are loaded so hooks see
 * full documents; `select` is applied afterwards.
 */
export function fetchSelect(
  collection: SanitizedCollection,
  select: readonly string[] | undefined,
  extra: readonly string[] = [],
): string[] | undefined {
  if (!select || (collection.hooks.afterRead?.length ?? 0) > 0) return undefined;
  return [...new Set([...select, ...extra])];
}

function pick(doc: DocumentData, keys: readonly string[]): DocumentData {
  const result: DocumentData = {};
  for (const key of keys) if (key in doc) result[key] = doc[key];
  return result;
}

/** Replace relation ids with documents, one query per related collection and level. */
async function populate(
  scope: OperationScope,
  collection: SanitizedCollection,
  docs: DocumentData[],
  depth: number,
): Promise<void> {
  const relations = collection.fieldList.flatMap((field) =>
    field.type === "relation" && docs.some((doc) => field.name in doc)
      ? [{ name: field.name, to: field.to }]
      : [],
  );
  const idsByTarget = new Map<string, Set<string>>();
  for (const { name, to } of relations) {
    const ids = idsByTarget.get(to) ?? new Set<string>();
    for (const doc of docs) for (const id of relationIds(doc[name])) ids.add(id);
    idsByTarget.set(to, ids);
  }
  const loaded = new Map<string, Map<string, DocumentData>>();
  for (const [slug, ids] of idsByTarget) {
    loaded.set(slug, await loadRelated(scope, slug, [...ids], depth - 1));
  }
  for (const { name, to } of relations) {
    const byId = loaded.get(to);
    const resolve = (id: unknown) => (typeof id === "string" ? (byId?.get(id) ?? id) : id);
    for (const doc of docs) {
      const value = doc[name];
      doc[name] = Array.isArray(value) ? value.map(resolve) : resolve(value);
    }
  }
}

/** Ids stored in a relation value (one id, an array of ids, or nothing). */
export function relationIds(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((id): id is string => typeof id === "string");
  return [];
}

async function loadRelated(
  scope: OperationScope,
  slug: string,
  ids: string[],
  depth: number,
): Promise<Map<string, DocumentData>> {
  const target = scope.collections.get(slug);
  const byId = new Map<string, DocumentData>();
  if (!target || ids.length === 0) return byId;
  const access = await checkAccess(target, "read", scope.ctx);
  if (access === false) return byId;
  const rows = await scope.db.find({
    collection: slug,
    where: andWhere({ field: "id", op: "in", value: ids }, access === true ? undefined : access),
  });
  const docs = await finishRead(scope, target, rows, { depth });
  for (const doc of docs) byId.set(doc.id as string, doc);
  return byId;
}
