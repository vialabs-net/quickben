import { ConfigError } from "@quickben/core";
import { count, eq } from "drizzle-orm";

import { familyOf, tableSpecs } from "./columns";
import { toConflict } from "./errors";
import { compareSchema, inspectDatabase, uniqueIndexNames } from "./inspect";
import { pushTables } from "./push";
import { buildTable, decodeValue, encodeValue } from "./tables";
import { orderToSql, whereToSql } from "./where";

import type { Dialect, Family } from "./columns";
import type { Connection, Connector, DrizzleAdapterOptions, DrizzleDatabase } from "./connect";
import type { SchemaReport } from "./inspect";
import type { RuntimeTable } from "./tables";
import type {
  DatabaseAdapter,
  DatabaseSchema,
  DocumentData,
  FindArgs,
  WhereNode,
} from "@quickben/core";
import type { SQL } from "drizzle-orm";
import type { PgColumn, PgTableWithColumns } from "drizzle-orm/pg-core";
import type { SQLiteColumn, SQLiteTableWithColumns } from "drizzle-orm/sqlite-core";

/** The Drizzle table type of a dialect. */
export type DrizzleTableOf<D extends Dialect = Dialect> = D extends "sqlite"
  ? SQLiteGeneratedTable
  : PgGeneratedTable;

/**
 * A generated Postgres table. Columns are known at runtime only, so `table.title` is a
 * `PgColumn | undefined`. For fully typed tables, import them from the generated schema file.
 */
export type PgGeneratedTable = PgTableWithColumns<{
  name: string;
  schema: string | undefined;
  columns: Record<string, PgColumn>;
  dialect: "pg";
}>;

/** A generated SQLite table. See {@link PgGeneratedTable}. */
export type SQLiteGeneratedTable = SQLiteTableWithColumns<{
  name: string;
  schema: undefined;
  columns: Record<string, SQLiteColumn>;
  dialect: "sqlite";
}>;

/**
 * The native client of the Drizzle adapter (`adapter.raw`, `qb.db.raw`). Use it for queries
 * the portable query model does not cover. Inside `qb.transaction`, `db` is the transaction.
 */
export interface DrizzleRaw<D extends Dialect = Dialect> {
  readonly dialect: D;
  /** The Drizzle database. Throws before `init` (before `createQuickben`). */
  readonly db: DrizzleDatabase<D>;
  /** Generated tables keyed by collection slug. Empty before `init`. */
  readonly tables: Readonly<Record<string, DrizzleTableOf<D>>>;
  /** The table of a collection. Throws `ConfigError` for an unknown slug. */
  table(slug: string): DrizzleTableOf<D>;
}

/** A Quickben database adapter backed by Drizzle ORM. */
export interface DrizzleAdapter<D extends Dialect = Dialect> extends DatabaseAdapter<
  DrizzleRaw<D>
> {
  readonly dialect: D;
  /** Postgres schema of the tables (the `schema` option). `undefined`: the current schema. */
  readonly schema: string | undefined;
  /**
   * Compare the tables the collections need with the database: what is missing or different,
   * and the SQL that adds what is missing. Call it after `init`. The `verify` option runs it.
   */
  checkSchema(): Promise<SchemaReport>;
  transaction<T>(fn: (tx: DrizzleAdapter<D>) => Promise<T>): Promise<T>;
}

type Row = Record<string, unknown>;

interface SelectQuery extends PromiseLike<Row[]> {
  where(condition: SQL | undefined): SelectQuery;
  orderBy(...terms: SQL[]): SelectQuery;
  limit(limit: number): SelectQuery;
  offset(offset: number): SelectQuery;
}

interface Returning {
  returning(fields?: Record<string, unknown>): PromiseLike<Row[]>;
}

/** The query builder methods shared by Postgres and SQLite Drizzle databases. */
interface QueryRunner {
  select(fields: Record<string, unknown>): { from(table: unknown): SelectQuery };
  insert(table: unknown): { values(values: Row): Returning };
  update(table: unknown): { set(values: Row): { where(condition: SQL): Returning } };
  delete(table: unknown): { where(condition: SQL): Returning };
  transaction<T>(fn: (tx: QueryRunner) => Promise<T>): Promise<T>;
}

interface State {
  options: DrizzleAdapterOptions;
  /** Postgres schema, `undefined` for the current one. */
  schema: string | undefined;
  connect: Connector;
  family: Family;
  connection: Connection | undefined;
  connecting: Promise<Connection> | undefined;
  tables: Map<string, RuntimeTable>;
  /** Tail of the queue when operations are serialized. */
  queue: Promise<unknown>;
}

function serialized<T>(state: State, fn: () => Promise<T>): Promise<T> {
  if (!state.connection?.serialize) return fn();
  const run = state.queue.then(fn);
  state.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function tableOf(state: State, slug: string): RuntimeTable {
  const table = state.tables.get(slug);
  if (!table) throw new ConfigError(`drizzleAdapter: unknown collection "${slug}"`);
  return table;
}

function decodeRow(table: RuntimeTable, row: Row): DocumentData {
  const doc: DocumentData = {};
  for (const [name, value] of Object.entries(row)) {
    const entry = table.columns.get(name);
    doc[name] = entry ? decodeValue(entry.spec.kind, value) : value;
  }
  return doc;
}

/** Values for every known column in `data`. With `fill`, missing columns get their empty value. */
function encodeRow(table: RuntimeTable, family: Family, data: DocumentData, fill: boolean): Row {
  const row: Row = {};
  for (const [name, { spec }] of table.columns) {
    if (name in data) row[name] = encodeValue(spec.kind, family, data[name]);
    else if (fill) row[name] = encodeValue(spec.kind, family, undefined);
  }
  return row;
}

function selection(
  table: RuntimeTable,
  select: readonly string[] | undefined,
): Record<string, unknown> {
  const names = select
    ? ["id", ...select.filter((name) => name !== "id")]
    : [...table.columns.keys()];
  const fields: Record<string, unknown> = {};
  for (const name of names) {
    const entry = table.columns.get(name);
    if (entry) fields[name] = entry.column;
  }
  return fields;
}

function idEquals(table: RuntimeTable, id: string): SQL {
  return eq(tableColumn(table, "id"), id);
}

function tableColumn(table: RuntimeTable, name: string) {
  const entry = table.columns.get(name);
  if (!entry)
    throw new ConfigError(`drizzleAdapter: missing column "${name}" in "${table.spec.slug}"`);
  return entry.column;
}

/**
 * Create a Quickben database adapter on Drizzle ORM. Each dialect entry point
 * (`@quickben/db-drizzle/postgres`, `/pglite`, `/sqlite`) calls this with its driver, so a
 * bundler only sees the driver of the dialect the app imports.
 *
 * Tables are generated from the collections in `init`. With `push` (the default for in-memory
 * databases) missing tables, columns and indexes are created. For persistent databases, write
 * a schema file with `generateDrizzleSchema` and run drizzle-kit migrations.
 */
export function createDrizzleAdapter<O extends DrizzleAdapterOptions>(
  options: O,
  connect: Connector<O>,
): DrizzleAdapter<O["dialect"]> {
  const schema = "schema" in options ? options.schema : undefined;
  if (schema === "") throw new ConfigError("drizzleAdapter: `schema` must not be empty");
  const state: State = {
    options,
    schema,
    connect: connect as Connector,
    family: familyOf(options.dialect),
    connection: undefined,
    connecting: undefined,
    tables: new Map(),
    queue: Promise.resolve(),
  };
  return createAdapter(state, undefined);
}

/** Compare the tables with the database and record the real unique index names. */
async function checkSchema(
  state: State,
  db: Connection["db"],
  inTransaction = false,
): Promise<SchemaReport> {
  const specs = [...state.tables.values()].map((table) => table.spec);
  const inspect = () => inspectDatabase(db, state.family, specs, state.schema);
  const snapshot = await (inTransaction ? inspect() : serialized(state, inspect));
  for (const table of state.tables.values()) {
    for (const [name, field] of uniqueIndexNames(table.spec, snapshot.tables.get(table.spec.slug)))
      table.constraints.set(name, field);
  }
  return compareSchema(specs, snapshot, state.family, state.schema);
}

async function verify(state: State, connection: Connection): Promise<void> {
  const mode = state.options.verify ?? false;
  if (mode === false) return;
  const { issues } = await checkSchema(state, connection.db);
  if (issues.length === 0) return;
  const message = [
    `drizzleAdapter: the database does not match the collections (${String(issues.length)} issues):`,
    ...issues.map((entry) => `  - ${entry.message}`),
    "Run `quickben-drizzle sql --diff --url <url>` for the SQL that adds what is missing.",
  ].join("\n");
  if (mode === "warn") console.warn(message);
  else throw new ConfigError(message);
}

function createAdapter(state: State, tx: QueryRunner | undefined): DrizzleAdapter {
  const dialect = state.options.dialect;

  const connected = (): Connection => {
    if (!state.connection) {
      throw new ConfigError("drizzleAdapter: not initialized. Call createQuickben(config) first.");
    }
    return state.connection;
  };

  const runner = (): QueryRunner => tx ?? (connected().db as unknown as QueryRunner);

  /** Outside a transaction, wait for our turn when the driver needs it. */
  const run = <T>(fn: (db: QueryRunner) => Promise<T>): Promise<T> =>
    tx ? fn(tx) : serialized(state, () => fn(runner()));

  const find = (args: FindArgs): Promise<DocumentData[]> =>
    run(async (db) => {
      const table = tableOf(state, args.collection);
      let query = db
        .select(selection(table, args.select))
        .from(table.table)
        .where(args.where ? whereToSql(args.where, table, state.family) : undefined);
      if (args.sort && args.sort.length > 0) query = query.orderBy(...orderToSql(args.sort, table));
      if (args.limit !== undefined) query = query.limit(args.limit);
      if (args.offset) {
        // SQLite needs a LIMIT before OFFSET.
        if (args.limit === undefined && state.family === "sqlite") {
          query = query.limit(Number.MAX_SAFE_INTEGER);
        }
        query = query.offset(args.offset);
      }
      const rows = await query;
      return rows.map((row) => decodeRow(table, row));
    });

  const write = <T>(
    slug: string,
    fn: (db: QueryRunner, table: RuntimeTable) => Promise<T>,
  ): Promise<T> =>
    run(async (db) => {
      const table = tableOf(state, slug);
      try {
        return await fn(db, table);
      } catch (error) {
        throw toConflict(error, table);
      }
    });

  const adapter: DrizzleAdapter = {
    name: "drizzle",
    dialect,
    schema: state.schema,
    get raw() {
      const tables = Object.fromEntries(
        [...state.tables].map(([slug, table]) => [slug, table.table]),
      );
      return {
        dialect,
        get db() {
          return runner() as unknown as DrizzleDatabase;
        },
        tables,
        table: (slug: string) => tableOf(state, slug).table,
      } as DrizzleRaw;
    },

    async init(schema: DatabaseSchema) {
      if (!state.connection) {
        state.connecting ??= state.connect(state.options);
        state.connection = await state.connecting;
      }
      const connection = state.connection;
      const specs = tableSpecs(schema);
      state.tables = new Map(
        specs.map((spec) => [spec.slug, buildTable(spec, dialect, state.schema)]),
      );
      if (state.options.push ?? connection.inMemory) {
        await serialized(state, () => pushTables(connection.db, state.family, specs, state.schema));
      }
      await verify(state, connection);
    },

    checkSchema() {
      return tx
        ? checkSchema(state, tx as unknown as Connection["db"], true)
        : checkSchema(state, connected().db);
    },

    find,

    async findOne(args) {
      const [doc] = await find({ ...args, limit: 1 });
      return doc ?? null;
    },

    count(args: { collection: string; where?: WhereNode }) {
      return run(async (db) => {
        const table = tableOf(state, args.collection);
        const [row] = await db
          .select({ value: count() })
          .from(table.table)
          .where(args.where ? whereToSql(args.where, table, state.family) : undefined);
        return Number(row?.value ?? 0);
      });
    },

    create({ collection, data }) {
      return write(collection, async (db, table) => {
        const [row] = await db
          .insert(table.table)
          .values(encodeRow(table, state.family, data, true))
          .returning();
        if (!row) throw new Error(`drizzleAdapter: insert into "${collection}" returned no row`);
        return decodeRow(table, row);
      });
    },

    update({ collection, id, data }) {
      return write(collection, async (db, table) => {
        const values = encodeRow(table, state.family, data, false);
        delete values.id;
        if (Object.keys(values).length === 0) {
          const [row] = await db
            .select(selection(table, undefined))
            .from(table.table)
            .where(idEquals(table, id))
            .limit(1);
          return row ? decodeRow(table, row) : null;
        }
        const [row] = await db
          .update(table.table)
          .set(values)
          .where(idEquals(table, id))
          .returning();
        return row ? decodeRow(table, row) : null;
      });
    },

    delete({ collection, id }) {
      return write(collection, async (db, table) => {
        const rows = await db
          .delete(table.table)
          .where(idEquals(table, id))
          .returning({ id: tableColumn(table, "id") });
        return rows.length > 0;
      });
    },

    transaction<T>(fn: (tx: DrizzleAdapter) => Promise<T>): Promise<T> {
      // A transaction adapter joins its own transaction.
      if (tx) return fn(adapter);
      return serialized(state, () =>
        runner().transaction((inner) => fn(createAdapter(state, inner))),
      );
    },

    async close() {
      const connection = state.connection;
      state.connection = undefined;
      state.connecting = undefined;
      if (connection) await connection.close();
    },
  };
  return adapter;
}
