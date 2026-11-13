import { drizzleAdapter as pglite } from "../src/pglite";
import { drizzleAdapter as postgres } from "../src/postgres";
import { drizzleAdapter as sqlite } from "../src/sqlite";

import type { DrizzleAdapter, DrizzleAdapterOptions } from "../src";
import type { Dialect } from "../src/columns";

/** The `drizzleAdapter` of the entry point for `options.dialect`. */
export function drizzleAdapter<D extends Dialect>(
  options: Extract<DrizzleAdapterOptions, { dialect: D }>,
): DrizzleAdapter<D> {
  const adapters = { pglite, postgres, sqlite } as Record<
    Dialect,
    (options: DrizzleAdapterOptions) => DrizzleAdapter
  >;
  return adapters[options.dialect](options) as DrizzleAdapter<D>;
}
