import { compareBySort, ConflictError, matchesWhere } from "../src";

import type {
  DatabaseAdapter,
  DatabaseSchema,
  DocumentData,
  FindArgs,
  RequestContext,
} from "../src";

/** Context that skips access checks. */
export const system: RequestContext = { user: null, overrideAccess: true };

/**
 * Minimal adapter for core tests. Transactions snapshot the data and restore it on error.
 * The real reference adapter is `@quickben/db-memory`.
 */
export function testAdapter(): DatabaseAdapter<Map<string, Map<string, DocumentData>>> & {
  schema: DatabaseSchema | undefined;
} {
  let data = new Map<string, Map<string, DocumentData>>();
  const docs = (slug: string) => {
    let map = data.get(slug);
    if (!map) {
      map = new Map();
      data.set(slug, map);
    }
    return map;
  };
  const find = (args: FindArgs) => {
    const rows = [...docs(args.collection).values()].filter((doc) => matchesWhere(doc, args.where));
    if (args.sort) rows.sort(compareBySort(args.sort));
    const start = args.offset ?? 0;
    const end = args.limit === undefined ? rows.length : start + args.limit;
    return rows.slice(start, end).map((doc) => {
      if (!args.select) return structuredClone(doc);
      return Object.fromEntries(
        Object.entries(doc).filter(([key]) => key === "id" || args.select?.includes(key)),
      );
    });
  };
  const adapter = {
    name: "test",
    schema: undefined as DatabaseSchema | undefined,
    get raw() {
      return data;
    },
    init(schema: DatabaseSchema) {
      adapter.schema = schema;
      return Promise.resolve();
    },
    find: (args: FindArgs) => Promise.resolve(find(args)),
    findOne: (args: FindArgs) => Promise.resolve(find({ ...args, limit: 1 })[0] ?? null),
    count: (args: FindArgs) => Promise.resolve(find(args).length),
    create({ collection, data: doc }: { collection: string; data: DocumentData }) {
      const id = String(doc.id);
      if (docs(collection).has(id)) return Promise.reject(new ConflictError("Id taken", "id"));
      const unique = adapter.schema?.collections
        .find((c) => c.slug === collection)
        ?.fields.filter((f) => f.unique);
      for (const field of unique ?? []) {
        const value = doc[field.name];
        if (
          value !== null &&
          [...docs(collection).values()].some((other) => other[field.name] === value)
        ) {
          return Promise.reject(new ConflictError("Value taken", field.name));
        }
      }
      docs(collection).set(id, structuredClone(doc));
      return Promise.resolve(structuredClone(doc));
    },
    update({
      collection,
      id,
      data: patch,
    }: {
      collection: string;
      id: string;
      data: DocumentData;
    }) {
      const current = docs(collection).get(id);
      if (!current) return Promise.resolve(null);
      const next = { ...current, ...structuredClone(patch) };
      docs(collection).set(id, next);
      return Promise.resolve(structuredClone(next));
    },
    delete({ collection, id }: { collection: string; id: string }) {
      return Promise.resolve(docs(collection).delete(id));
    },
    async transaction<T>(
      fn: (tx: DatabaseAdapter<Map<string, Map<string, DocumentData>>>) => Promise<T>,
    ): Promise<T> {
      const snapshot = new Map([...data].map(([slug, map]) => [slug, new Map(map)]));
      try {
        return await fn(adapter);
      } catch (error) {
        data = snapshot;
        throw error;
      }
    },
  };
  return adapter;
}
