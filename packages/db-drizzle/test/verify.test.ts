import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@libsql/client";
import { ConfigError } from "@quickben/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { affinity } from "../src/inspect";

import { drizzleAdapter } from "./drizzle";
import { fullSchema } from "./fixtures/schema";

import type { DrizzleAdapter } from "../src";
import type { DatabaseSchema, FieldSchema } from "@quickben/core";

const now = "2024-01-01T00:00:00.000Z";

function field(name: string, extra: Partial<FieldSchema> = {}): FieldSchema {
  return {
    name,
    type: "text",
    many: false,
    required: false,
    unique: false,
    index: false,
    ...extra,
  };
}

const notes: DatabaseSchema = {
  collections: [
    {
      slug: "notes",
      fields: [
        field("title", { required: true, index: true }),
        field("code", { unique: true }),
        field("tags", { type: "select", many: true, options: ["a"], index: true }),
        field("rank", { type: "number", integer: true }),
        field("done", { type: "boolean" }),
      ],
    },
    { slug: "people", fields: [field("name")] },
  ],
};

let adapter: DrizzleAdapter | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await adapter?.close?.();
  adapter = undefined;
});

async function pglite(ddl: string, options: { schema?: string; verify?: boolean | "warn" } = {}) {
  const client = await PGlite.create();
  await client.exec(ddl);
  adapter = drizzleAdapter({ dialect: "pglite", client, push: false, ...options });
  return { client, db: adapter };
}

async function sqlite(ddl: string, verify?: boolean | "warn") {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(ddl);
  adapter = drizzleAdapter({
    dialect: "sqlite",
    client,
    push: false,
    ...(verify === undefined ? {} : { verify }),
  });
  return adapter;
}

const messages = async (db: DrizzleAdapter) =>
  (await db.checkSchema()).issues.map((entry) => entry.message);

describe("verify (pglite)", () => {
  const drifted = `
    create table "notes" (
      "id" text, "createdAt" timestamp not null, "updatedAt" timestamp(3) with time zone not null,
      "title" text, "tags" text[] not null default '{}', "rank" integer, "done" boolean,
      "extra" text not null default 'x'
    );
    create index "notes_tags_btree" on "notes" ("tags");
    create table "audit" ("id" serial primary key);`;

  it("lists every mismatch and the SQL that adds what is missing", async () => {
    const { client, db } = await pglite(drifted);
    await db.init(notes);
    const report = await db.checkSchema();
    expect(report.issues.map((entry) => entry.message)).toEqual([
      "notes.createdAt: type is timestamp without time zone, expected timestamp(3) with time zone",
      'notes.createdAt: index is missing, expected create index "notes_createdAt_idx" on "notes" ("createdAt")',
      "notes.title: column is nullable, expected not null",
      'notes.title: index is missing, expected create index "notes_title_idx" on "notes" ("title")',
      "notes.code: column is missing, expected text",
      'notes.code: unique index is missing, expected create unique index "notes_code_unique" on "notes" ("code")',
      'notes.tags: index is missing, expected create index "notes_tags_idx" on "notes" using gin ("tags")',
      "notes.rank: type is integer, expected bigint",
      "notes: primary key is missing, expected (id)",
      "people: table is missing",
    ]);
    expect(report.issues[0]).toMatchObject({
      table: "notes",
      column: "createdAt",
      problem: "type",
      actual: "timestamp without time zone",
    });
    expect(report.statements).toEqual([
      'create index "notes_createdAt_idx" on "notes" ("createdAt")',
      'create index "notes_title_idx" on "notes" ("title")',
      'alter table "notes" add column "code" text',
      'create unique index "notes_code_unique" on "notes" ("code")',
      'create index "notes_tags_idx" on "notes" using gin ("tags")',
      expect.stringMatching(/^create table "people" \(/),
      'create index "people_createdAt_idx" on "people" ("createdAt")',
    ]);

    await client.exec(report.statements.join(";\n"));
    expect(await messages(db)).toEqual([
      "notes.createdAt: type is timestamp without time zone, expected timestamp(3) with time zone",
      "notes.title: column is nullable, expected not null",
      "notes.rank: type is integer, expected bigint",
      "notes: primary key is missing, expected (id)",
    ]);
  });

  it("throws a ConfigError with verify: true", async () => {
    const { db } = await pglite(drifted, { verify: true });
    const error: unknown = await db.init(notes).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as Error).message).toContain("does not match the collections (10 issues)");
    expect((error as Error).message).toContain("  - people: table is missing");
  });

  it('logs with verify: "warn" and keeps going', async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { db } = await pglite(drifted, { verify: "warn" });
    await db.init(notes);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain("notes.rank: type is integer");
    expect(await db.count({ collection: "notes" })).toBe(0);
  });

  it("passes after push, with no statements", async () => {
    adapter = drizzleAdapter({ dialect: "pglite", verify: true });
    await adapter.init(fullSchema);
    expect(await adapter.checkSchema()).toEqual({ issues: [], statements: [] });
  });

  it("accepts tables created by another tool, with other index names", async () => {
    const { db } = await pglite(
      `create schema "quickben";
      create table "quickben"."notes" (
        "id" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
        "title" TEXT NOT NULL, "code" TEXT, "tags" TEXT[] DEFAULT ARRAY[]::TEXT[], "rank" BIGINT,
        "done" BOOLEAN, "ownedElsewhere" INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
      );
      create table "quickben"."people" (
        "id" TEXT NOT NULL PRIMARY KEY, "createdAt" TIMESTAMPTZ(3) NOT NULL,
        "updatedAt" TIMESTAMPTZ(3) NOT NULL, "name" TEXT
      );
      create unique index "notes_code_key" on "quickben"."notes" ("code");
      create index "a" on "quickben"."notes" ("createdAt", "id");
      create index "b" on "quickben"."notes" ("title");
      create index "c" on "quickben"."notes" using gin ("tags" array_ops);
      create index "d" on "quickben"."people" ("createdAt");`,
      { schema: "quickben", verify: true },
    );
    await db.init(notes);
    const row = { createdAt: now, updatedAt: now, title: "t", code: "c" };
    await db.create({ collection: "notes", data: { ...row, id: "n1" } });
    expect(await db.findOne({ collection: "notes" })).toEqual(
      expect.objectContaining({ id: "n1", tags: [] }),
    );
    // The real unique index name maps to the field.
    await expect(
      db.create({ collection: "notes", data: { ...row, id: "n2" } }),
    ).rejects.toMatchObject({ code: "CONFLICT", field: "code" });
  });

  it("creates the schema in the diff when it is missing", async () => {
    const { db } = await pglite("select 1", { schema: "app" });
    await db.init(notes);
    const { statements } = await db.checkSchema();
    expect(statements[0]).toBe('create schema if not exists "app"');
    expect(statements[1]).toMatch(/^create table "app"\."notes" \(/);
  });

  it("checks the primary key and partial indexes", async () => {
    const { db } = await pglite(`
      create table "people" (
        "id" text not null, "createdAt" timestamp(3) with time zone not null,
        "updatedAt" timestamp(3) with time zone not null, "name" text,
        primary key ("id", "name")
      );
      create index "people_createdAt_idx" on "people" ("createdAt") where "name" is not null;`);
    await db.init({ collections: [notes.collections[1]!] });
    expect(await messages(db)).toEqual([
      'people.createdAt: index is missing, expected create index "people_createdAt_idx" on "people" ("createdAt")',
      "people.name: column is not null, expected nullable",
      "people: primary key is (id, name), expected (id)",
    ]);
  });

  it("ignores invalid indexes and does not reuse a taken index name", async () => {
    const { client, db } = await pglite(`
      create table "people" (
        "id" text primary key, "createdAt" timestamp(3) with time zone not null,
        "updatedAt" timestamp(3) with time zone not null, "name" text
      );
      create index "people_createdAt_idx" on "people" ("createdAt") where "name" is null;
      create index "other" on "people" ("createdAt");`);
    // What a failed `create index concurrently` leaves behind.
    await client.exec(
      "update pg_index set indisvalid = false where indexrelid = 'other'::regclass",
    );
    await db.init({ collections: [notes.collections[1]!] });
    const report = await db.checkSchema();
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({ problem: "index", column: "createdAt" });
    expect(report.issues[0]?.fix).toBeUndefined();
    expect(report.statements).toEqual([]);
  });

  it('names "public" in queries, whatever the search_path', async () => {
    const client = await PGlite.create();
    await client.exec(`create schema "tenant";
      create table "tenant"."people" ("id" text primary key, "createdAt" text, "updatedAt" text, "name" text);
      set search_path = "tenant", public;`);
    adapter = drizzleAdapter({ dialect: "pglite", client, schema: "public", verify: true });
    await adapter.init({ collections: [notes.collections[1]!] });
    await adapter.create({
      collection: "people",
      data: { id: "p1", createdAt: now, updatedAt: now, name: "a" },
    });
    const { rows } = await client.query('select count(*)::int as n from public."people"');
    expect(rows).toEqual([{ n: 1 }]);
    const tenant = await client.query('select count(*)::int as n from "tenant"."people"');
    expect(tenant.rows).toEqual([{ n: 0 }]);
  });

  it("needs init first", () => {
    adapter = drizzleAdapter({ dialect: "pglite" });
    expect(() => adapter?.checkSchema()).toThrow(ConfigError);
  });

  it("works inside a transaction", async () => {
    adapter = drizzleAdapter({ dialect: "pglite" });
    await adapter.init(notes);
    const report = await adapter.transaction((tx) => tx.checkSchema());
    expect(report.issues).toEqual([]);
  });
});

describe("verify (sqlite)", () => {
  it("compares type affinity, so other tools' type names pass", async () => {
    const db = await sqlite(
      `CREATE TABLE "notes" (
        "id" TEXT NOT NULL PRIMARY KEY, "createdAt" DATETIME_TEXT NOT NULL, "updatedAt" TEXT NOT NULL,
        "title" VARCHAR(200) NOT NULL, "code" TEXT, "tags" TEXT NOT NULL DEFAULT '[]',
        "rank" BIGINT, "done" BOOLEAN, "other" BLOB
      );
      CREATE TABLE "people" ("id" TEXT PRIMARY KEY, "createdAt" TEXT NOT NULL, "updatedAt" TEXT NOT NULL, "name" TEXT);
      CREATE UNIQUE INDEX "notes_code_key" ON "notes"("code");
      CREATE INDEX "x" ON "notes"("createdAt");
      CREATE INDEX "y" ON "notes"("title");
      CREATE INDEX "z" ON "notes"("tags");
      CREATE INDEX "w" ON "people"("createdAt");`,
      true,
    );
    await db.init(notes);
    await db.create({
      collection: "notes",
      data: { id: "n1", createdAt: now, updatedAt: now, title: "t", code: "c", done: true },
    });
    expect(await db.findOne({ collection: "notes" })).toMatchObject({ done: true, tags: [] });
    await expect(
      db.create({
        collection: "notes",
        data: { id: "n2", createdAt: now, updatedAt: now, title: "t", code: "c" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", field: "code" });
  });

  it("lists mismatches", async () => {
    const db = await sqlite(`
      CREATE TABLE "notes" (
        "id" TEXT, "createdAt" TEXT NOT NULL, "updatedAt" TEXT NOT NULL, "title" TEXT,
        "code" TEXT, "tags" TEXT NOT NULL, "rank" REAL, "done" TEXT
      );
      CREATE UNIQUE INDEX "notes_code_part" ON "notes"("code") WHERE "code" IS NOT NULL;
      CREATE INDEX "notes_expr" ON "notes"(lower("title"));`);
    await db.init(notes);
    expect(await messages(db)).toEqual([
      'notes.createdAt: index is missing, expected create index "notes_createdAt_idx" on "notes" ("createdAt")',
      "notes.title: column is nullable, expected not null",
      'notes.title: index is missing, expected create index "notes_title_idx" on "notes" ("title")',
      'notes.code: unique index is missing, expected create unique index "notes_code_unique" on "notes" ("code")',
      'notes.tags: index is missing, expected create index "notes_tags_idx" on "notes" ("tags")',
      "notes.rank: type is REAL, expected integer",
      "notes.done: type is TEXT, expected integer",
      "notes: primary key is missing, expected (id)",
      "people: table is missing",
    ]);
  });

  it("knows the SQLite affinity rules", () => {
    expect(
      ["INT", "BIGINT", "VARCHAR(5)", "CLOB", "", "BLOB", "REAL", "FLOAT", "DOUBLE", "BOOLEAN"].map(
        affinity,
      ),
    ).toEqual([
      "INTEGER",
      "INTEGER",
      "TEXT",
      "TEXT",
      "BLOB",
      "BLOB",
      "REAL",
      "REAL",
      "REAL",
      "NUMERIC",
    ]);
  });
});
