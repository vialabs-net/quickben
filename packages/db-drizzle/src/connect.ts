import { ConfigError } from "@quickben/core";

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

/** Options of {@link drizzleAdapter}. */
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

const noop = () => Promise.resolve();

async function connectPostgres(options: PostgresOptions): Promise<Connection> {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  if (options.client) {
    return {
      db: drizzle({ client: options.client as never }),
      serialize: false,
      inMemory: false,
      close: noop,
    };
  }
  if (!options.url) {
    throw new ConfigError('drizzleAdapter: dialect "postgres" needs `url` or `client`');
  }
  // pg is CommonJS: its exports are on `default`.
  const { Pool } = (await import("pg")).default;
  const pool = new Pool({ ...options.pool, connectionString: options.url });
  return {
    db: drizzle({ client: pool }),
    serialize: false,
    inMemory: false,
    close: () => pool.end(),
  };
}

async function connectPglite(options: PgliteOptions): Promise<Connection> {
  const { drizzle } = await import("drizzle-orm/pglite");
  if (options.client) {
    const client = options.client as { dataDir?: string };
    return {
      db: drizzle({ client: options.client as never }),
      serialize: true,
      inMemory: isMemoryDir(client.dataDir),
      close: noop,
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const client = await PGlite.create(options.dataDir);
  return {
    db: drizzle({ client }),
    serialize: true,
    inMemory: isMemoryDir(options.dataDir),
    close: () => client.close(),
  };
}

function isMemoryDir(dataDir: string | undefined): boolean {
  return dataDir === undefined || dataDir.startsWith("memory://");
}

async function connectSqlite(options: SqliteOptions): Promise<Connection> {
  const { drizzle } = await import("drizzle-orm/libsql");
  if (options.client) {
    const client = options.client as { protocol?: string };
    return {
      db: drizzle({ client: options.client as never }),
      serialize: client.protocol === "file",
      inMemory: false,
      close: noop,
    };
  }
  const { createClient } = await import("@libsql/client");
  const url = options.url ?? ":memory:";
  const client = createClient({
    url,
    ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
  });
  return {
    db: drizzle({ client }),
    serialize: client.protocol === "file",
    inMemory: url === ":memory:",
    close: () => {
      client.close();
      return Promise.resolve();
    },
  };
}

/** Open the driver of `options.dialect`. Drivers are loaded on demand. */
export function connect(options: DrizzleAdapterOptions): Promise<Connection> {
  switch (options.dialect) {
    case "postgres":
      return connectPostgres(options);
    case "pglite":
      return connectPglite(options);
    case "sqlite":
      return connectSqlite(options);
    default:
      return Promise.reject(
        new ConfigError(
          `drizzleAdapter: unknown dialect "${String((options as { dialect: unknown }).dialect)}". Use "postgres", "pglite" or "sqlite".`,
        ),
      );
  }
}
