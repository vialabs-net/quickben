import { accessDenied, checkAccess } from "./access";
import {
  fetchSelect,
  fillMissing,
  finishRead,
  normalizeDoc,
  parseSelect,
  relationIds,
} from "./documents";
import { NotFoundError, ValidationError } from "./errors";
import { uuidv7 } from "./id";
import { cursorWhere, encodeCursor, parsePaging, parseSort } from "./query";
import { validateData } from "./validation";
import { andWhere, matchesWhere, normalizeWhere } from "./where";

import type { DatabaseAdapter, DatabaseSchema, DocumentData, WhereNode } from "./adapter";
import type { OperationScope } from "./documents";
import type {
  FindResult,
  HookArgs,
  Quickben,
  QuickbenConfig,
  Registry,
  RequestContext,
  SanitizedCollection,
} from "./types";

const MAX_DEPTH = 3;

type Collections = ReadonlyMap<string, SanitizedCollection>;

interface FindQueryInput {
  where?: unknown;
  sort?: unknown;
  limit?: unknown;
  page?: unknown;
  cursor?: unknown;
  select?: unknown;
  depth?: unknown;
}

function assertContext(ctx: unknown): RequestContext {
  if (typeof ctx !== "object" || ctx === null || !("user" in ctx)) {
    throw new TypeError("Every Quickben call needs a request context: { user }");
  }
  return ctx as RequestContext;
}

function getCollection(collections: Collections, slug: string): SanitizedCollection {
  const collection = collections.get(slug);
  if (!collection) throw new NotFoundError(`Unknown collection "${slug}"`);
  return collection;
}

function parseDepth(depth: unknown): number {
  if (depth === undefined) return 0;
  if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 0 || depth > MAX_DEPTH) {
    throw new ValidationError([
      { path: "depth", message: `Expected an integer from 0 to ${MAX_DEPTH}` },
    ]);
  }
  return depth;
}

function assertId(id: unknown): string {
  if (typeof id !== "string" || id === "") {
    throw new ValidationError([{ path: "id", message: "Expected a non-empty string" }]);
  }
  return id;
}

function assertObject(data: unknown): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ValidationError([{ path: "", message: "Expected an object" }]);
  }
  return data as Record<string, unknown>;
}

async function readFilter(
  scope: OperationScope,
  collection: SanitizedCollection,
  id?: string,
): Promise<WhereNode | undefined> {
  const access = await checkAccess(collection, "read", scope.ctx, {
    qb: scope.api,
    ...(id === undefined ? {} : { id }),
  });
  if (access === false) throw accessDenied(scope.ctx, "read", collection.slug);
  return access === true ? undefined : access;
}

function hookArgs(scope: OperationScope, collection: SanitizedCollection): HookArgs {
  return { user: scope.ctx.user, req: scope.ctx.req, ctx: scope.ctx, qb: scope.api, collection };
}

async function find(scope: OperationScope, slug: string, query: FindQueryInput) {
  const collection = getCollection(scope.collections, slug);
  const sort = parseSort(collection, query.sort);
  const { limit, page } = parsePaging(query.limit, query.page);
  const select = parseSelect(collection, query.select);
  const depth = parseDepth(query.depth);
  if (query.cursor !== undefined && query.page !== undefined) {
    throw new ValidationError([{ path: "cursor", message: "Use either page or cursor, not both" }]);
  }
  const where = andWhere(
    normalizeWhere(collection, query.where),
    await readFilter(scope, collection),
  );
  const loadSelect = fetchSelect(
    collection,
    select,
    sort.map((spec) => spec.field),
  );
  let rows: DocumentData[];
  let totalDocs: number | null = null;
  if (query.cursor === undefined) {
    [rows, totalDocs] = await Promise.all([
      scope.db.find({
        collection: slug,
        where,
        sort,
        limit: limit + 1,
        offset: (page - 1) * limit,
        ...selectArg(loadSelect),
      }),
      scope.db.count({ collection: slug, where }),
    ]);
  } else {
    if (typeof query.cursor !== "string") {
      throw new ValidationError([{ path: "cursor", message: "Expected a string" }]);
    }
    rows = await scope.db.find({
      collection: slug,
      where: andWhere(where, cursorWhere(collection, sort, query.cursor)),
      sort,
      limit: limit + 1,
      ...selectArg(loadSelect),
    });
  }
  const hasNextPage = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  const docs = await finishRead(scope, collection, pageRows, { depth, ...selectArg(select) });
  const result: FindResult<DocumentData> = {
    docs,
    limit,
    hasNextPage,
    nextCursor: hasNextPage && last ? encodeCursor(sort, last) : null,
    page: totalDocs === null ? null : page,
    totalDocs,
    totalPages: totalDocs === null ? null : Math.ceil(totalDocs / limit),
  };
  return result;
}

function selectArg(select: readonly string[] | undefined): { select?: readonly string[] } {
  return select ? { select } : {};
}

async function findById(
  scope: OperationScope,
  slug: string,
  id: unknown,
  query: { select?: unknown; depth?: unknown },
) {
  const collection = getCollection(scope.collections, slug);
  const docId = assertId(id);
  const select = parseSelect(collection, query.select);
  const depth = parseDepth(query.depth);
  const where = andWhere(
    { field: "id", op: "eq", value: docId },
    await readFilter(scope, collection, docId),
  );
  const row = await scope.db.findOne({
    collection: slug,
    where,
    ...selectArg(fetchSelect(collection, select)),
  });
  if (!row) throw new NotFoundError(`Document "${docId}" not found in "${slug}"`);
  const [doc] = await finishRead(scope, collection, [row], { depth, ...selectArg(select) });
  return doc;
}

async function count(scope: OperationScope, slug: string, query: { where?: unknown }) {
  const collection = getCollection(scope.collections, slug);
  const where = andWhere(
    normalizeWhere(collection, query.where),
    await readFilter(scope, collection),
  );
  return scope.db.count({ collection: slug, where });
}

function applyDefaults(collection: SanitizedCollection, data: Record<string, unknown>) {
  const result = { ...data };
  for (const field of collection.fieldList) {
    if (result[field.name] !== undefined || field.default === undefined) continue;
    const value: unknown = field.default;
    result[field.name] =
      typeof value === "function" ? (value as () => unknown)() : structuredClone(value);
  }
  return result;
}

/**
 * Check that related ids exist and that the user may read them, so a write cannot link to
 * documents the user cannot see (for example another organization's). One query per related
 * collection. `overrideAccess` checks existence only. On update, ids the document already
 * stores are kept without a check, so a form can send them back unchanged.
 */
async function assertRelations(
  scope: OperationScope,
  collection: SanitizedCollection,
  data: DocumentData,
  original: DocumentData | null = null,
) {
  for (const field of collection.fieldList) {
    if (field.type !== "relation") continue;
    const stored = new Set(relationIds(original?.[field.name]));
    const ids = relationIds(data[field.name]).filter((id) => !stored.has(id));
    if (ids.length === 0) continue;
    const target = getCollection(scope.collections, field.to);
    const access = await checkAccess(target, "read", scope.ctx, { qb: scope.api });
    const found =
      access === false
        ? []
        : await scope.db.find({
            collection: field.to,
            where: andWhere(
              { field: "id", op: "in", value: ids },
              access === true ? undefined : access,
            ),
            select: ["id"],
          });
    const existing = new Set(found.map((doc) => doc.id));
    const missing = ids.filter((id) => !existing.has(id));
    if (missing.length > 0) {
      throw new ValidationError(
        missing.map((id) => ({
          path: field.name,
          message: `No "${field.to}" document with id "${id}"`,
        })),
      );
    }
  }
}

async function runDataHooks(
  hooks: readonly ((args: never) => unknown)[] | undefined,
  args: Record<string, unknown> & { data: DocumentData },
): Promise<DocumentData> {
  let data = args.data;
  for (const hook of hooks ?? []) {
    const next = await (hook as (args: unknown) => unknown)({ ...args, data });
    if (next) data = next as DocumentData;
  }
  return data;
}

async function runVoidHooks(
  hooks: readonly ((args: never) => unknown)[] | undefined,
  args: unknown,
) {
  for (const hook of hooks ?? []) await (hook as (args: unknown) => unknown)(args);
}

/**
 * Load the document an update or delete targets. A document the user cannot read is
 * `NOT_FOUND`, as in `findById`, so writes do not reveal which ids exist elsewhere.
 */
async function loadOriginal(
  scope: OperationScope,
  slug: string,
  collection: SanitizedCollection,
  id: string,
) {
  const read = await checkAccess(collection, "read", scope.ctx, { qb: scope.api, id });
  const row = await scope.db.findOne({
    collection: slug,
    where: andWhere(
      { field: "id", op: "eq", value: id },
      read === true || read === false ? undefined : read,
    ),
  });
  if (!row) throw new NotFoundError(`Document "${id}" not found in "${slug}"`);
  return normalizeDoc(collection, row);
}

/** Check the stored document against the rule. Returns the rule result for later checks. */
async function assertWriteAccess(
  scope: OperationScope,
  collection: SanitizedCollection,
  operation: "update" | "delete",
  original: DocumentData,
  data?: Record<string, unknown>,
): Promise<true | WhereNode> {
  const access = await checkAccess(collection, operation, scope.ctx, {
    qb: scope.api,
    id: original.id as string,
    ...(data ? { data } : {}),
  });
  if (access === false || (access !== true && !matchesWhere(original, access))) {
    throw accessDenied(scope.ctx, operation, collection.slug);
  }
  return access;
}

async function create(scope: OperationScope, slug: string, input: unknown) {
  const collection = getCollection(scope.collections, slug);
  const data = assertObject(input);
  const access = await checkAccess(collection, "create", scope.ctx, { data, qb: scope.api });
  if (access === false) throw accessDenied(scope.ctx, "create", slug);
  const base = { ...hookArgs(scope, collection), operation: "create", original: null };
  const prepared = await runDataHooks(collection.hooks.beforeValidate, {
    ...base,
    data: applyDefaults(collection, data),
  });
  const { id: inputId, ...parsed } = await validateData({
    collection,
    operation: "create",
    data: prepared,
    original: null,
    user: scope.ctx.user,
  });
  await assertRelations(scope, collection, parsed);
  const changed = await runDataHooks(collection.hooks.beforeChange, {
    ...base,
    data: fillMissing(collection, parsed),
  });
  const now = new Date().toISOString();
  const record: DocumentData = {
    id: typeof inputId === "string" ? inputId : uuidv7(),
    ...fillMissing(collection, changed),
    createdAt: now,
    updatedAt: now,
  };
  if (access !== true && !matchesWhere(record, access))
    throw accessDenied(scope.ctx, "create", slug);
  const doc = normalizeDoc(collection, await scope.db.create({ collection: slug, data: record }));
  await runVoidHooks(collection.hooks.afterChange, { ...base, doc });
  const [result] = await finishRead(scope, collection, [doc], { depth: 0 });
  return result;
}

async function update(scope: OperationScope, slug: string, id: unknown, input: unknown) {
  const collection = getCollection(scope.collections, slug);
  const docId = assertId(id);
  const data = assertObject(input);
  const original = await loadOriginal(scope, slug, collection, docId);
  const access = await assertWriteAccess(scope, collection, "update", original, data);
  const base = { ...hookArgs(scope, collection), operation: "update", original };
  const prepared = await runDataHooks(collection.hooks.beforeValidate, {
    ...base,
    data: { ...data },
  });
  const parsed = await validateData({
    collection,
    operation: "update",
    data: prepared,
    original,
    user: scope.ctx.user,
  });
  await assertRelations(scope, collection, parsed, original);
  const changed = await runDataHooks(collection.hooks.beforeChange, { ...base, data: parsed });
  const fieldData = { ...changed };
  delete fieldData.id;
  delete fieldData.createdAt;
  // A filter rule also limits where a document can go: the updated document must match it.
  if (access !== true && !matchesWhere({ ...original, ...fieldData }, access)) {
    throw accessDenied(scope.ctx, "update", slug);
  }
  const stored = await scope.db.update({
    collection: slug,
    id: docId,
    data: { ...fieldData, updatedAt: new Date().toISOString() },
  });
  if (!stored) throw new NotFoundError(`Document "${docId}" not found in "${slug}"`);
  const doc = normalizeDoc(collection, stored);
  await runVoidHooks(collection.hooks.afterChange, { ...base, doc });
  const [result] = await finishRead(scope, collection, [doc], { depth: 0 });
  return result;
}

async function remove(scope: OperationScope, slug: string, id: unknown) {
  const collection = getCollection(scope.collections, slug);
  const docId = assertId(id);
  const original = await loadOriginal(scope, slug, collection, docId);
  await assertWriteAccess(scope, collection, "delete", original);
  const args = { ...hookArgs(scope, collection), id: docId, doc: original };
  await runVoidHooks(collection.hooks.beforeDelete, args);
  if (!(await scope.db.delete({ collection: slug, id: docId }))) {
    throw new NotFoundError(`Document "${docId}" not found in "${slug}"`);
  }
  await runVoidHooks(collection.hooks.afterDelete, args);
  const [result] = await finishRead(scope, collection, [original], { depth: 0 });
  return result;
}

function buildApi(config: QuickbenConfig, collections: Collections, db: DatabaseAdapter): Quickben {
  const scope = (ctx: RequestContext, adapter: DatabaseAdapter = db): OperationScope => {
    const context = assertContext(ctx);
    return {
      collections,
      db: adapter,
      api: adapter === db ? qb : buildApi(config, collections, adapter),
      ctx: context,
    };
  };
  const write = async <T>(ctx: RequestContext, fn: (scope: OperationScope) => Promise<T>) => {
    assertContext(ctx);
    return db.transaction((tx) => fn(scope(ctx, tx)));
  };
  const api = {
    config,
    collections: Object.fromEntries(collections),
    db,
    find: async (slug: string, query: FindQueryInput | undefined, ctx: RequestContext) =>
      find(scope(ctx), slug, query ?? {}),
    findById: async (
      slug: string,
      id: string,
      query: { select?: unknown; depth?: unknown } | undefined,
      ctx: RequestContext,
    ) => findById(scope(ctx), slug, id, query ?? {}),
    count: async (slug: string, query: { where?: unknown } | undefined, ctx: RequestContext) =>
      count(scope(ctx), slug, query ?? {}),
    create: (slug: string, data: unknown, ctx: RequestContext) =>
      write(ctx, (s) => create(s, slug, data)),
    update: (slug: string, id: string, data: unknown, ctx: RequestContext) =>
      write(ctx, (s) => update(s, slug, id, data)),
    delete: (slug: string, id: string, ctx: RequestContext) =>
      write(ctx, (s) => remove(s, slug, id)),
    transaction: <T>(fn: (qb: Quickben) => Promise<T>) =>
      db.transaction((tx) => fn(buildApi(config, collections, tx))),
  };
  const qb = api as unknown as Quickben;
  return qb;
}

/** Schema description passed to `DatabaseAdapter.init`. */
export function databaseSchema(config: QuickbenConfig): DatabaseSchema {
  return {
    collections: config.collections.map((collection) => ({
      slug: collection.slug,
      fields: collection.fieldList.map((field) => ({
        name: field.name,
        type: field.type,
        many: field.many,
        required: field.required,
        unique: field.unique,
        index: field.index,
        ...(field.type === "relation" ? { to: field.to } : {}),
        ...(field.type === "select" ? { options: field.options } : {}),
        ...(field.type === "number" ? { integer: field.integer } : {}),
      })),
    })),
  };
}

/**
 * Create a Quickben instance: prepares the database, then runs plugin `onInit` hooks.
 * Most apps call {@link getQuickben} instead, which caches the instance.
 */
export async function createQuickben<R extends Registry>(
  config: QuickbenConfig<R>,
): Promise<Quickben<R>> {
  await config.db.init(databaseSchema(config));
  const collections = new Map(
    config.collections.map((collection) => [collection.slug, collection]),
  );
  const qb = buildApi(config, collections, config.db);
  for (const hook of config.onInit) await hook(qb);
  return qb as unknown as Quickben<R>;
}

const instances = new WeakMap<QuickbenConfig, Promise<Quickben>>();

/** Return the instance for `config`, creating it on first use. One instance per config object. */
export function getQuickben<R extends Registry>(config: QuickbenConfig<R>): Promise<Quickben<R>> {
  const key = config as QuickbenConfig;
  let instance = instances.get(key);
  if (!instance) {
    instance = createQuickben(key);
    instances.set(key, instance);
    instance.catch(() => instances.delete(key));
  }
  return instance as unknown as Promise<Quickben<R>>;
}
