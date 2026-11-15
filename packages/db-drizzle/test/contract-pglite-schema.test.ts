import { runAdapterContractTests } from "@quickben/adapter-tests";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterEach, expect, it } from "vitest";

import { drizzleAdapter } from "./drizzle";

import type { DrizzleAdapter } from "../src";

// The same contract, with every table in the Postgres schema "quickben".
let current: DrizzleAdapter | undefined;

afterEach(async () => {
  await current?.close?.();
  current = undefined;
});

runAdapterContractTests(() => {
  current = drizzleAdapter({ dialect: "pglite", schema: "quickben", verify: true });
  return current;
});

it("keeps the tables in the schema, not in public", async () => {
  const db = drizzleAdapter({ dialect: "pglite", schema: "quickben" });
  current = db;
  await db.init({
    collections: [
      {
        slug: "notes",
        fields: [
          { name: "text", type: "text", many: false, required: true, unique: false, index: false },
        ],
      },
    ],
  });
  expect(db.schema).toBe("quickben");
  expect(getTableConfig(db.raw.table("notes") as never).schema).toBe("quickben");
  const result = await db.raw.db.execute<{ table_schema: string }>(
    "select table_schema from information_schema.tables where table_name = 'notes'",
  );
  expect((result as { rows: unknown[] }).rows).toEqual([{ table_schema: "quickben" }]);
});

it("rejects an empty schema", () => {
  expect(() => drizzleAdapter({ dialect: "pglite", schema: "" })).toThrow("must not be empty");
});
