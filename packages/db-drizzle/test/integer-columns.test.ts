import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { defineCollection, defineConfig, fields as f } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  columnKind,
  generateDrizzleSchema,
  generateSql,
  prismaSource,
  schemaSource,
  sqlStatements,
  tableSpecs,
} from "../src";
import { main } from "../src/cli";

import { drizzleAdapter } from "./drizzle";
import { fullSchema } from "./fixtures/schema";

import type { DatabaseSchema } from "@quickben/core";

const orders = defineCollection({
  slug: "orders",
  fields: { qty: f.number({ integer: true, required: true }), price: f.number() },
});

const schema: DatabaseSchema = {
  collections: [
    {
      slug: "orders",
      fields: [
        {
          name: "qty",
          type: "number",
          integer: true,
          many: false,
          required: true,
          unique: false,
          index: false,
        },
      ],
    },
  ],
};

describe("integerColumns", () => {
  it("maps integer fields to integer32 only when asked", () => {
    const field = schema.collections[0]!.fields[0]!;
    expect(columnKind(field)).toBe("integer");
    expect(columnKind(field, { integerColumns: "bigint" })).toBe("integer");
    expect(columnKind(field, { integerColumns: "integer" })).toBe("integer32");
    expect(columnKind({ ...field, integer: false }, { integerColumns: "integer" })).toBe("float");
  });

  it("changes the SQL, the Drizzle schema and the Prisma models", () => {
    const options = { integerColumns: "integer" } as const;
    expect(sqlStatements(schema, "postgres").join("\n")).toContain('"qty" bigint not null');
    expect(sqlStatements(schema, "postgres", undefined, options).join("\n")).toContain(
      '"qty" integer not null',
    );
    expect(sqlStatements(schema, "sqlite", undefined, options).join("\n")).toContain(
      '"qty" integer not null',
    );
    expect(schemaSource(schema, "postgres", undefined, options)).toContain(
      'qty: pg.integer("qty").notNull()',
    );
    expect(schemaSource(schema, "sqlite", undefined, options)).toContain(
      'qty: sqlite.integer("qty").notNull()',
    );
    expect(prismaSource(schema, "postgres", undefined, options)).toMatch(/qty\s+Int\b/);
    expect(prismaSource(schema, "postgres")).toMatch(/qty\s+BigInt\b/);
    expect(prismaSource(schema, "sqlite", undefined, options)).toMatch(/qty\s+Int\b/);
  });

  it("is read from the config's adapter, and the options win", async () => {
    const db = Object.assign(memoryAdapter(), {
      name: "drizzle",
      dialect: "postgres",
      integerColumns: "integer",
    });
    const config = defineConfig({ db, collections: [orders] });
    expect(await generateSql(config)).toContain('"qty" integer not null');
    expect(await generateSql(config, { format: "prisma" })).toMatch(/qty\s+Int\b/);
    expect(await generateDrizzleSchema(config)).toContain('pg.integer("qty")');
    expect(await generateSql(config, { integerColumns: "bigint" })).toContain(
      '"qty" bigint not null',
    );
    await expect(generateSql(config, { integerColumns: "int4" as "integer" })).rejects.toThrow(
      'integerColumns is "bigint" or "integer"',
    );
  });

  it("rejects an unknown value in the adapter", () => {
    expect(() =>
      drizzleAdapter({ dialect: "pglite", integerColumns: "int2" as "integer" }),
    ).toThrow('`integerColumns` is "bigint" or "integer"');
    expect(drizzleAdapter({ dialect: "pglite" }).integerColumns).toBe("bigint");
  });

  it("keeps every other column kind as before", () => {
    const before = tableSpecs(fullSchema).flatMap((t) => t.columns.map((c) => c.kind));
    const after = tableSpecs(fullSchema, { integerColumns: "integer" }).flatMap((t) =>
      t.columns.map((c) => c.kind),
    );
    expect(after).toEqual(before.map((kind) => (kind === "integer" ? "integer32" : kind)));
  });

  it("pushes and verifies int4 columns on PGlite", async () => {
    const client = await PGlite.create();
    const adapter = drizzleAdapter({
      dialect: "pglite",
      client,
      push: true,
      verify: true,
      integerColumns: "integer",
    });
    await adapter.init(schema);
    const { rows } = await client.query<{ data_type: string }>(
      "select data_type from information_schema.columns where table_name = 'orders' and column_name = 'qty'",
    );
    expect(rows).toEqual([{ data_type: "integer" }]);
    const doc = await adapter.create({
      collection: "orders",
      data: {
        id: "o1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        qty: 7,
      },
    });
    expect(doc.qty).toBe(7);
    expect((await adapter.checkSchema()).issues).toEqual([]);

    // The same table checked as bigint reports the drift.
    const wide = drizzleAdapter({ dialect: "pglite", client, push: false });
    await wide.init(schema);
    const report = await wide.checkSchema();
    expect(report.issues.map((issue) => issue.message)).toEqual([
      "orders.qty: type is integer, expected bigint",
    ]);
    await client.close();
  });
});

describe("quickben-drizzle --integer-columns", () => {
  let dir: string;
  const fixtures = join(import.meta.dirname, "fixtures");

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "quickben-int-"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("passes the column type to generate and sql", async () => {
    const out = join(dir, "schema.ts");
    expect(await main(["generate", "--out", out, "--integer-columns", "integer"], fixtures)).toBe(
      0,
    );
    expect(await readFile(out, "utf8")).toContain("notesTable");
    const sql = join(dir, "schema.sql");
    expect(
      await main(
        ["sql", "--out", sql, "--integer-columns", "integer", "--format", "prisma"],
        fixtures,
      ),
    ).toBe(0);
  });

  it("rejects an unknown column type", async () => {
    expect(await main(["sql", "--integer-columns", "int8"], fixtures)).toBe(1);
    expect(console.error).toHaveBeenLastCalledWith(
      'Unknown integer column type "int8". Use bigint or integer.',
    );
  });
});
