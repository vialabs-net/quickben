import { createDrizzleAdapter } from "./adapter";
import { noop } from "./connect";

import type { DrizzleAdapter } from "./adapter";
import type { Connection, DialectOptions, SqliteOptions } from "./connect";

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

/**
 * Quickben adapter on SQLite through libSQL (`@libsql/client`).
 *
 * @example
 * drizzleAdapter() // :memory:
 * drizzleAdapter({ url: "file:./app.db" })
 */
export function drizzleAdapter(
  options: DialectOptions<SqliteOptions> = {},
): DrizzleAdapter<"sqlite"> {
  return createDrizzleAdapter({ ...options, dialect: "sqlite" }, connectSqlite);
}

export type { SqliteOptions } from "./connect";
