import { createDrizzleAdapter } from "./adapter";
import { noop } from "./connect";

import type { DrizzleAdapter } from "./adapter";
import type { Connection, DialectOptions, PgliteOptions } from "./connect";

function isMemoryDir(dataDir: string | undefined): boolean {
  return dataDir === undefined || dataDir.startsWith("memory://");
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

/**
 * Quickben adapter on PGlite (`@electric-sql/pglite`): Postgres in WebAssembly, in process.
 *
 * @example
 * drizzleAdapter() // in memory
 * drizzleAdapter({ dataDir: "./.pglite", push: true })
 */
export function drizzleAdapter(
  options: DialectOptions<PgliteOptions> = {},
): DrizzleAdapter<"pglite"> {
  return createDrizzleAdapter({ ...options, dialect: "pglite" }, connectPglite);
}

export type { PgliteOptions } from "./connect";
