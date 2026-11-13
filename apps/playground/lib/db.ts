import { memoryAdapter } from "@quickben/db-memory";
import { singleton } from "@quickben/next";

import type { DatabaseAdapter } from "@quickben/core";

/**
 * Databases the playground can use, chosen with the `QUICKBEN_DB` environment variable.
 *
 * | Value              | Adapter                                        |
 * | ------------------ | ---------------------------------------------- |
 * | `memory` (default) | `@quickben/db-memory`. Data resets on restart. |
 */
const adapters: Record<string, () => DatabaseAdapter> = {
  memory: () => memoryAdapter(),
  // eslint-disable-next-line sonarjs/todo-tag -- planned switch, see the note below
  // TODO(db-drizzle): add PGlite once @quickben/db-drizzle is merged, and make it the default
  // so data survives restarts and `pnpm seed` fills it:
  //   pglite: () => drizzleAdapter({ dialect: "pglite", dataDir: ".data/pglite" }),
};

/**
 * The playground database. It is a process-wide singleton, so route handlers, pages and
 * server functions share the same data, also across dev reloads.
 */
export function createDb(): DatabaseAdapter {
  const kind = process.env.QUICKBEN_DB ?? "memory";
  const create = Object.hasOwn(adapters, kind) ? adapters[kind] : undefined;
  if (!create) {
    throw new Error(
      `Unknown QUICKBEN_DB "${kind}". Use one of: ${Object.keys(adapters).join(", ")}.`,
    );
  }
  return singleton(`playground-db-${kind}`, create);
}
