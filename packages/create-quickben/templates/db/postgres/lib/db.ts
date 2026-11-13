import { drizzleAdapter } from "@quickben/db-drizzle";
import { singleton } from "@quickben/next";

import type { DatabaseAdapter } from "@quickben/core";

/**
 * Postgres through node-postgres. The connection string comes from `DATABASE_URL`.
 * `push` creates missing tables and columns on start. Use migrations once the database holds
 * real data (see the `@quickben/db-drizzle` README).
 *
 * A process-wide singleton, so route handlers, pages and server functions share one pool,
 * also across dev reloads.
 */
export function createDb(): DatabaseAdapter {
  return singleton("quickben-db", () =>
    drizzleAdapter({ dialect: "postgres", url: process.env.DATABASE_URL, push: true }),
  );
}
