import { drizzleAdapter } from "@quickben/db-drizzle";
import { singleton } from "@quickben/next";

import type { DatabaseAdapter } from "@quickben/core";

/**
 * PGlite: Postgres compiled to WebAssembly, in process. Data lives in `./.pglite`.
 * `push` creates missing tables and columns on start.
 *
 * A process-wide singleton, so route handlers, pages and server functions share one
 * connection, also across dev reloads.
 */
export function createDb(): DatabaseAdapter {
  return singleton("quickben-db", () =>
    drizzleAdapter({
      dialect: "pglite",
      dataDir: process.env.PGLITE_DATA_DIR ?? "./.pglite",
      push: true,
    }),
  );
}
