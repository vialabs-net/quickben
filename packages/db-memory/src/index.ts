import { compareBySort, ConflictError, matchesWhere } from "@quickben/core";

import type {
  CollectionSchema,
  DatabaseAdapter,
  DatabaseSchema,
  DocumentData,
  FindArgs,
  WhereNode,
} from "@quickben/core";

/** Documents of one collection, keyed by id. */
export type MemoryCollection = ReadonlyMap<string, DocumentData>;

/** The native client of the memory adapter: the data it can see, keyed by collection slug. */
export interface MemoryStore {
  readonly collections: ReadonlyMap<string, MemoryCollection>;
}

/** Options of {@link memoryAdapter}. */
export interface MemoryAdapterOptions {
  /** Documents to load before the first call, keyed by collection slug. */
  initialData?: Record<string, readonly DocumentData[]>;
}

type Data = Map<string, Map<string, DocumentData>>;

interface Shared {
  committed: Data;
  schema: Map<string, CollectionSchema>;
}

/** One pending write. `doc: null` is a delete. */
interface Change {
  doc: DocumentData | null;
  create: boolean;
}

/** A transaction: a copy-on-write view of the data plus the changes to apply on commit. */
interface TxState {
  data: Data;
  copied: Set<string>;
  changes: Map<string, Map<string, Change>>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function project(doc: DocumentData, select: readonly string[] | undefined): DocumentData {
  if (!select) return clone(doc);
  const result: DocumentData = { id: doc.id };
  for (const key of select) if (key in doc) result[key] = clone(doc[key]);
  return result;
}

function begin(shared: Shared): TxState {
  return { data: new Map(shared.committed), copied: new Set(), changes: new Map() };
}

function assertUnique(
  shared: Shared,
  slug: string,
  docs: ReadonlyMap<string, DocumentData>,
  doc: DocumentData,
) {
  for (const field of shared.schema.get(slug)?.fields ?? []) {
    const value = doc[field.name] ?? null;
    if (!field.unique || value === null) continue;
    for (const other of docs.values()) {
      if (other.id !== doc.id && other[field.name] === value) {
        throw new ConflictError(
          `Value of "${field.name}" is already taken in "${slug}"`,
          field.name,
        );
      }
    }
  }
}

/** Apply the changes of a transaction to the latest committed data, checking constraints again. */
function commit(shared: Shared, state: TxState): void {
  const next = new Map(shared.committed);
  for (const [slug, changes] of state.changes) {
    next.set(slug, applyChanges(shared, slug, next.get(slug), changes));
  }
  shared.committed = next;
}

function applyChanges(
  shared: Shared,
  slug: string,
  current: ReadonlyMap<string, DocumentData> | undefined,
  changes: ReadonlyMap<string, Change>,
): Map<string, DocumentData> {
  const docs = new Map(current ?? []);
  const written: DocumentData[] = [];
  for (const [id, change] of changes) {
    if (change.create && docs.has(id)) {
      throw new ConflictError(`Id "${id}" is already taken in "${slug}"`, "id");
    }
    if (!change.doc) {
      docs.delete(id);
    } else if (change.create || docs.has(id)) {
      docs.set(id, change.doc);
      written.push(change.doc);
    }
    // Else the document was updated here but deleted by a concurrent commit: the delete wins.
  }
  for (const doc of written) assertUnique(shared, slug, docs, doc);
  return docs;
}

/**
 * In-memory database adapter. Data lives in the process and is lost on restart.
 *
 * Every write runs in a transaction. A transaction works on a copy-on-write view and applies
 * its changes to the latest data on commit, so concurrent writes to different documents are
 * all kept and unique values are checked again on commit.
 */
export function memoryAdapter(options: MemoryAdapterOptions = {}): DatabaseAdapter<MemoryStore> {
  const shared: Shared = { committed: new Map(), schema: new Map() };
  for (const [slug, docs] of Object.entries(options.initialData ?? {})) {
    shared.committed.set(slug, new Map(docs.map((doc) => [String(doc.id), clone(doc)])));
  }
  return createAdapter(shared, undefined);
}

/** The documents of `slug` in a transaction, copied on first write. */
function writable(state: TxState, slug: string): Map<string, DocumentData> {
  let docs = state.data.get(slug);
  if (!docs || !state.copied.has(slug)) {
    docs = new Map(docs ?? []);
    state.data.set(slug, docs);
    state.copied.add(slug);
  }
  return docs;
}

function record(state: TxState, slug: string, id: string, change: Change): void {
  let changes = state.changes.get(slug);
  if (!changes) {
    changes = new Map();
    state.changes.set(slug, changes);
  }
  // `create` means "the id did not exist when the transaction started": the first change decides.
  const previous = changes.get(id);
  changes.set(id, { doc: change.doc, create: previous ? previous.create : change.create });
}

function query(data: Data, args: FindArgs): DocumentData[] {
  const docs = filter(data, args.collection, args.where);
  if (args.sort && args.sort.length > 0) docs.sort(compareBySort(args.sort));
  const start = args.offset ?? 0;
  const end = args.limit === undefined ? docs.length : start + args.limit;
  return docs.slice(start, end).map((doc) => project(doc, args.select));
}

function filter(data: Data, slug: string, where: WhereNode | undefined): DocumentData[] {
  return [...(data.get(slug)?.values() ?? [])].filter((doc) => matchesWhere(doc, where));
}

function createAdapter(shared: Shared, tx: TxState | undefined): DatabaseAdapter<MemoryStore> {
  const view = (): Data => tx?.data ?? shared.committed;

  /** Inside a transaction write to it, otherwise run a one-step transaction. */
  const write = <T>(fn: (state: TxState) => T): Promise<T> => {
    if (tx) return Promise.resolve(fn(tx));
    const state = begin(shared);
    const result = fn(state);
    commit(shared, state);
    return Promise.resolve(result);
  };

  const adapter: DatabaseAdapter<MemoryStore> = {
    name: "memory",
    get raw(): MemoryStore {
      return { collections: view() };
    },
    init(schema: DatabaseSchema) {
      for (const collection of schema.collections) {
        shared.schema.set(collection.slug, collection);
        if (!shared.committed.has(collection.slug))
          shared.committed.set(collection.slug, new Map());
      }
      return Promise.resolve();
    },
    find(args) {
      return Promise.resolve(query(view(), args));
    },
    findOne(args) {
      return Promise.resolve(query(view(), { ...args, limit: 1 })[0] ?? null);
    },
    count(args) {
      return Promise.resolve(filter(view(), args.collection, args.where).length);
    },
    create({ collection, data }) {
      return write((state) => {
        const docs = writable(state, collection);
        const id = String(data.id);
        if (docs.has(id))
          throw new ConflictError(`Id "${id}" is already taken in "${collection}"`, "id");
        const doc = clone(data);
        assertUnique(shared, collection, docs, doc);
        docs.set(id, doc);
        record(state, collection, id, { doc, create: true });
        return clone(doc);
      });
    },
    update({ collection, id, data }) {
      return write((state) => {
        const docs = writable(state, collection);
        const current = docs.get(id);
        if (!current) return null;
        const doc = { ...current, ...clone(data), id };
        assertUnique(shared, collection, docs, doc);
        docs.set(id, doc);
        record(state, collection, id, { doc, create: false });
        return clone(doc);
      });
    },
    delete({ collection, id }) {
      return write((state) => {
        const deleted = writable(state, collection).delete(id);
        if (deleted) record(state, collection, id, { doc: null, create: false });
        return deleted;
      });
    },
    async transaction(fn) {
      if (tx) return fn(adapter);
      const state = begin(shared);
      const result = await fn(createAdapter(shared, state));
      commit(shared, state);
      return result;
    },
    close() {
      return Promise.resolve();
    },
  };
  return adapter;
}
