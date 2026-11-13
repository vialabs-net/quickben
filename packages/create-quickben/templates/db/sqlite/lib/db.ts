import { drizzleAdapter } from "@quickben/db-drizzle/sqlite";
import { singleton } from "@quickben/next";

import type { DatabaseAdapter } from "@quickben/core";

/**
 * SQLite through libSQL. `DATABASE_URL` is a local file (`file:./app.db`) or a libSQL server
 * (`libsql://…`, with `DATABASE_AUTH_TOKEN`). `push` creates missing tables and columns on
 * start.
 *
 * A process-wide singleton, so route handlers, pages and server functions share one
 * connection, also across dev reloads.
 */
export function createDb(): DatabaseAdapter {
  return singleton("quickben-db", () =>
    drizzleAdapter({
      url: process.env.DATABASE_URL ?? "file:./app.db",
      authToken: process.env.DATABASE_AUTH_TOKEN,
      push: true,
    }),
  );
}
