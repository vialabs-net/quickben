import { memoryAdapter } from "@quickben/db-memory";
import { singleton } from "@quickben/next";

import type { DatabaseAdapter } from "@quickben/core";

/**
 * In-memory database. Data resets when the server restarts. Switch to `@quickben/db-drizzle`
 * to keep data.
 *
 * A process-wide singleton, so route handlers, pages and server functions share one store,
 * also across dev reloads.
 */
export function createDb(): DatabaseAdapter {
  return singleton("quickben-db", () => memoryAdapter());
}
