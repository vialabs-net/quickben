import { drizzleAdapter } from "@quickben/db-drizzle";
import { memoryAdapter } from "@quickben/db-memory";
import { singleton } from "@quickben/next";

import type { DatabaseAdapter } from "@quickben/core";

/**
 * Databases the playground can use, chosen with the `QUICKBEN_DB` environment variable.
 *
 * | Value              | Adapter                                                                  |
 * | ------------------ | ------------------------------------------------------------------------ |
 * | `pglite` (default) | `@quickben/db-drizzle` on PGlite in `./.pglite`. Tables are pushed on start. |
 * | `memory`           | `@quickben/db-memory`. Data resets on restart.                           |
 */
const adapters: Record<string, () => DatabaseAdapter> = {
  pglite: () => drizzleAdapter({ dialect: "pglite", dataDir: "./.pglite", push: true }),
  memory: () => memoryAdapter(),
};

/**
 * The playground database. It is a process-wide singleton, so route handlers, pages and
 * server functions share one connection, also across dev reloads.
 */
export function createDb(): DatabaseAdapter {
  const kind = process.env.QUICKBEN_DB ?? "pglite";
  const create = Object.hasOwn(adapters, kind) ? adapters[kind] : undefined;
  if (!create) {
    throw new Error(
      `Unknown QUICKBEN_DB "${kind}". Use one of: ${Object.keys(adapters).join(", ")}.`,
    );
  }
  return singleton(`playground-db-${kind}`, create);
}
