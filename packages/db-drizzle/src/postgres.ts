import { ConfigError } from "@quickben/core";

import { createDrizzleAdapter } from "./adapter";
import { noop } from "./connect";

import type { DrizzleAdapter } from "./adapter";
import type { Connection, DialectOptions, PostgresOptions } from "./connect";

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

/**
 * Quickben adapter on Postgres through node-postgres (`pg`). Pass `url` or your own `client`.
 *
 * @example
 * drizzleAdapter({ url: process.env.DATABASE_URL })
 */
export function drizzleAdapter(
  options: DialectOptions<PostgresOptions> = {},
): DrizzleAdapter<"postgres"> {
  return createDrizzleAdapter({ ...options, dialect: "postgres" }, connectPostgres);
}

export type { PostgresOptions } from "./connect";
