import { expectTypeOf, it } from "vitest";

import { drizzleAdapter } from "../src";

import type {
  PgDrizzleDatabase,
  PgGeneratedTable,
  SQLiteDrizzleDatabase,
  SQLiteGeneratedTable,
} from "../src";
import type { DatabaseAdapter } from "@quickben/core";
import type { PgColumn } from "drizzle-orm/pg-core";

it("types raw by dialect", () => {
  const sqlite = drizzleAdapter({ dialect: "sqlite" });
  expectTypeOf(sqlite.dialect).toEqualTypeOf<"sqlite">();
  expectTypeOf(sqlite.raw.db).toEqualTypeOf<SQLiteDrizzleDatabase>();
  expectTypeOf(sqlite.raw.table("posts")).toEqualTypeOf<SQLiteGeneratedTable>();

  const pglite = drizzleAdapter({ dialect: "pglite" });
  expectTypeOf(pglite.dialect).toEqualTypeOf<"pglite">();
  expectTypeOf(pglite.raw.db).toEqualTypeOf<PgDrizzleDatabase>();
  expectTypeOf(pglite.raw.tables).toEqualTypeOf<Readonly<Record<string, PgGeneratedTable>>>();
  expectTypeOf(pglite.raw.table("posts").title).toEqualTypeOf<PgColumn | undefined>();

  const postgres = drizzleAdapter({ dialect: "postgres", url: "postgres://localhost/app" });
  expectTypeOf(postgres.raw.db).toEqualTypeOf<PgDrizzleDatabase>();
  expectTypeOf(postgres).toExtend<DatabaseAdapter>();
});

it("rejects options of another dialect", () => {
  // @ts-expect-error `dataDir` is a PGlite option.
  const db = drizzleAdapter({ dialect: "sqlite", dataDir: "./data" });
  expectTypeOf(db.dialect).toEqualTypeOf<"sqlite">();
});
