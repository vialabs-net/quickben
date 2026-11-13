import type { Dialect } from "./columns";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

/** A Drizzle database on Postgres or PGlite. Transactions have the same type. */
export type PgDrizzleDatabase = PgDatabase<PgQueryResultHKT>;

/** A Drizzle database on SQLite (libSQL). Transactions have the same type. */
export type SQLiteDrizzleDatabase = BaseSQLiteDatabase<"async", unknown>;

/** The Drizzle database type of a dialect. */
export type DrizzleDatabase<D extends Dialect = Dialect> = D extends "sqlite"
  ? SQLiteDrizzleDatabase
  : PgDrizzleDatabase;

/** Options shared by every dialect. */
export interface CommonOptions {
  /**
   * Create missing tables, columns and indexes in `init`. It never drops or changes anything.
   * Default: `true` for in-memory databases (PGlite without `dataDir`, SQLite `:memory:`),
   * `false` otherwise. Use migrations for databases that hold real data.
   */
  push?: boolean;
}

/**
 * Postgres through node-postgres (`pg`). Pass `url` or your own `client` (a `pg.Pool`).
 * The adapter closes only a pool it created.
 */
export interface PostgresOptions extends CommonOptions {
  dialect: "postgres";
  /** Connection string, e.g. `postgres://user:pass@localhost:5432/app`. */
  url?: string;
  /** Extra `pg.Pool` options, such as `max` or `ssl`. Used with `url`. */
  pool?: Record<string, unknown>;
  /** An existing `pg.Pool`. */
  client?: object;
}

/**
 * PGlite: Postgres compiled to WebAssembly, in process. No server to run.
 * Without `dataDir` the data lives in memory.
 */
export interface PgliteOptions extends CommonOptions {
  dialect: "pglite";
  /** Directory for the data, e.g. `./.pglite`. Omit for an in-memory database. */
  dataDir?: string;
  /** An existing `PGlite` instance. */
  client?: object;
}

/** SQLite through libSQL (`@libsql/client`): a local file, `:memory:` or a libSQL server. */
export interface SqliteOptions extends CommonOptions {
  dialect: "sqlite";
  /** `:memory:` (default), `file:./app.db`, or a `libsql://` / `http(s)://` server URL. */
  url?: string;
  /** Auth token for a remote libSQL server. */
  authToken?: string;
  /** An existing libSQL `Client`. */
  client?: object;
}

/** Options of `drizzleAdapter`, by dialect. */
export type DrizzleAdapterOptions = PostgresOptions | PgliteOptions | SqliteOptions;

/** An open connection. */
export interface Connection {
  db: PgDrizzleDatabase | SQLiteDrizzleDatabase;
  /**
   * Run every operation one at a time. Needed when the driver has one connection that
   * transactions share (PGlite, local SQLite), so other calls never land in a transaction.
   */
  serialize: boolean;
  /** Default of the `push` option. */
  inMemory: boolean;
  close(): Promise<void>;
}

/** Opens the driver of one dialect. Each dialect entry point has its own. */
export type Connector<O extends DrizzleAdapterOptions = DrizzleAdapterOptions> = (
  options: O,
) => Promise<Connection>;

/** Options of the `drizzleAdapter` of one dialect entry point. `dialect` may be omitted. */
export type DialectOptions<O extends DrizzleAdapterOptions> = Omit<O, "dialect"> & {
  dialect?: O["dialect"];
};

export const noop = (): Promise<void> => Promise.resolve();
