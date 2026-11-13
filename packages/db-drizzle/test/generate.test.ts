import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@libsql/client";
import { defineCollection, defineConfig, fields as f } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import {
  generateDrizzleJson,
  generateMigration,
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from "drizzle-kit/api";
import { getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as sqliteTableConfig } from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { drizzleAdapter, generateDrizzleSchema, schemaSource, tableSpecs } from "../src";
import { tableExportName } from "../src/generate";
import { buildTable } from "../src/tables";

import { fullSchema } from "./fixtures/schema";

import type { Dialect } from "../src";
import type { PgTable } from "drizzle-orm/pg-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "quickben-drizzle-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Write the generated schema to a file and import it. */
async function importSchema(dialect: Dialect): Promise<Record<string, unknown>> {
  const file = join(dir, `schema-${dialect}.ts`);
  await writeFile(file, schemaSource(fullSchema, dialect));
  return (await import(file)) as Record<string, unknown>;
}

function describeTable(table: PgTable | SQLiteTable, dialect: Dialect) {
  const config =
    dialect === "sqlite"
      ? sqliteTableConfig(table as SQLiteTable)
      : pgTableConfig(table as PgTable);
  return {
    name: config.name,
    columns: config.columns.map((column) => ({
      name: column.name,
      type: column.getSQLType(),
      notNull: column.notNull,
      primary: column.primary,
      hasDefault: column.hasDefault,
    })),
    indexes: config.indexes.map((index) => ({
      name: index.config.name,
      unique: index.config.unique,
      columns: index.config.columns.map((column) => (column as { name: string }).name),
      method: (index.config as { method?: string }).method ?? null,
    })),
  };
}

describe.each(["postgres", "sqlite"] as const)("schemaSource (%s)", (dialect) => {
  it("describes the same tables the adapter builds", async () => {
    const generated = await importSchema(dialect);
    for (const spec of tableSpecs(fullSchema)) {
      const table = generated[tableExportName(spec.slug)] as PgTable | SQLiteTable;
      expect(describeTable(table, dialect)).toEqual(
        describeTable(buildTable(spec, dialect).table, dialect),
      );
    }
  });
});

it("names tables in camel case and avoids invalid identifiers", () => {
  expect(tableExportName("blog-posts")).toBe("blogPostsTable");
  expect(tableExportName("audit_log")).toBe("auditLogTable");
  expect(tableExportName("2fa")).toBe("_2faTable");
});

it("imports sql only when a table has array columns", () => {
  const simple = { collections: [{ slug: "notes", fields: [] }] };
  expect(schemaSource(simple, "pglite")).not.toContain('from "drizzle-orm";');
  expect(schemaSource(fullSchema, "pglite")).toContain('import { sql } from "drizzle-orm";');
  expect(schemaSource(fullSchema, "sqlite")).toContain('from "drizzle-orm/sqlite-core"');
});

describe("drizzle-kit migrations", () => {
  it("creates Postgres tables the adapter can use without push", async () => {
    const generated = await importSchema("pglite");
    const statements = await generateMigration(
      generateDrizzleJson({}),
      generateDrizzleJson(generated),
    );
    const client = await PGlite.create();
    for (const statement of statements) await client.exec(statement);
    await expectWorkingAdapter(drizzleAdapter({ dialect: "pglite", client, push: false }));
    await client.close();
  });

  it("creates SQLite tables the adapter can use without push", async () => {
    const generated = await importSchema("sqlite");
    const statements = await generateSQLiteMigration(
      await generateSQLiteDrizzleJson({}),
      await generateSQLiteDrizzleJson(generated),
    );
    const client = createClient({ url: ":memory:" });
    for (const statement of statements) await client.execute(statement);
    await expectWorkingAdapter(drizzleAdapter({ dialect: "sqlite", client, push: false }));
    client.close();
  });
});

async function expectWorkingAdapter(db: ReturnType<typeof drizzleAdapter>) {
  await db.init(fullSchema);
  const now = new Date().toISOString();
  const doc = await db.create({
    collection: "blog-posts",
    data: {
      id: "p1",
      createdAt: now,
      updatedAt: now,
      title: "Hello",
      status: "a",
      labels: ["x"],
      published: true,
      publishedAt: now,
      meta: { a: [1] },
    },
  });
  expect(doc).toMatchObject({
    title: "Hello",
    labels: ["x"],
    tags: [],
    publishedAt: now,
    meta: { a: [1] },
  });
  await expect(
    db.create({
      collection: "blog-posts",
      data: { id: "p1", createdAt: now, updatedAt: now, title: "x", status: "a" },
    }),
  ).rejects.toMatchObject({ code: "CONFLICT", field: "id" });
  expect(
    await db.count({
      collection: "blog-posts",
      where: { field: "labels", op: "contains", value: "x" },
    }),
  ).toBe(1);
}

describe("generateDrizzleSchema", () => {
  const notes = defineCollection({ slug: "notes", fields: { text: f.text({ unique: true }) } });

  it("uses the dialect of the config and writes the file", async () => {
    const config = defineConfig({
      db: drizzleAdapter({ dialect: "sqlite" }),
      collections: [notes],
    });
    const out = join(dir, "nested", "schema.ts");
    const source = await generateDrizzleSchema(config, { out });
    expect(source).toContain("export const notesTable = sqlite.sqliteTable(");
    expect(source).toContain('sqlite.uniqueIndex("notes_text_unique").on(t.text)');
    expect(await readFile(out, "utf8")).toBe(source);
  });

  it("needs a dialect for other adapters", async () => {
    const config = defineConfig({ db: memoryAdapter(), collections: [notes] });
    await expect(generateDrizzleSchema(config)).rejects.toMatchObject({ code: "CONFIG" });
    expect(await generateDrizzleSchema(config, { dialect: "postgres" })).toContain("pg.pgTable(");
  });
});
