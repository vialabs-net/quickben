import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

import { tableSpec } from "../src";
import { columnDdl, createTableDdl, indexDdl, quote } from "../src/push";

import { drizzleAdapter } from "./drizzle";
import { fullSchema } from "./fixtures/schema";

import type { DatabaseSchema, FieldSchema } from "@quickben/core";

const spec = tableSpec(fullSchema.collections[0]!);

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

function schemaWith(...fields: FieldSchema[]): DatabaseSchema {
  return { collections: [{ slug: "notes", fields }] };
}

describe("DDL", () => {
  it("quotes identifiers", () => {
    expect(quote('a"b')).toBe('"a""b"');
  });

  it("writes columns per dialect", () => {
    const columns = new Map(spec.columns.map((column) => [column.name, column]));
    const ddl = (name: string, family: "pg" | "sqlite") => columnDdl(columns.get(name)!, family);
    expect(ddl("id", "pg")).toBe('"id" text primary key');
    expect(ddl("createdAt", "pg")).toBe('"createdAt" timestamp(3) with time zone not null');
    expect(ddl("tags", "pg")).toBe(`"tags" text[] default '{}' not null`);
    expect(ddl("tags", "sqlite")).toBe(`"tags" text default '[]' not null`);
    expect(ddl("views", "pg")).toBe('"views" bigint');
    expect(ddl("meta", "pg")).toBe('"meta" jsonb');
    expect(ddl("published", "sqlite")).toBe('"published" integer');
  });

  it("writes tables and indexes", () => {
    expect(createTableDdl(spec, "sqlite")).toMatch(
      /^create table if not exists "blog-posts" \("id" text primary key, /,
    );
    expect(indexDdl(spec, "pg")).toEqual([
      'create index if not exists "blog-posts_createdAt_idx" on "blog-posts" ("createdAt")',
      'create index if not exists "blog-posts_title_idx" on "blog-posts" ("title")',
      'create unique index if not exists "blog-posts_slug_unique" on "blog-posts" ("slug")',
      'create index if not exists "blog-posts_labels_idx" on "blog-posts" using gin ("labels")',
      'create index if not exists "blog-posts_author_idx" on "blog-posts" ("author")',
    ]);
    expect(indexDdl(spec, "sqlite")).toContain(
      'create index if not exists "blog-posts_labels_idx" on "blog-posts" ("labels")',
    );
  });
});

const now = "2024-01-01T00:00:00.000Z";

describe.each(["pglite", "sqlite"] as const)("push (%s)", (dialect) => {
  it("adds missing columns and indexes and keeps the data", async () => {
    const db =
      dialect === "sqlite" ? drizzleAdapter({ dialect }) : drizzleAdapter({ dialect: "pglite" });
    await db.init(schemaWith(field("text", { required: true })));
    await db.create({
      collection: "notes",
      data: { id: "n1", createdAt: now, updatedAt: now, text: "a" },
    });

    await db.init(
      schemaWith(
        field("text", { required: true }),
        field("code", { unique: true }),
        field("tags", { type: "select", many: true, options: ["x"], index: true }),
      ),
    );
    expect(await db.findOne({ collection: "notes" })).toEqual({
      id: "n1",
      createdAt: now,
      updatedAt: now,
      text: "a",
      code: null,
      tags: [],
    });
    await db.update({ collection: "notes", id: "n1", data: { code: "c" } });
    await expect(
      db.create({
        collection: "notes",
        data: { id: "n2", createdAt: now, updatedAt: now, text: "b", code: "c" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", field: "code" });
    await db.close?.();
  });
});

it("does not push persistent databases by default", async () => {
  const client = createClient({ url: ":memory:" });
  const db = drizzleAdapter({ dialect: "sqlite", client });
  await db.init(schemaWith(field("text")));
  await expect(db.count({ collection: "notes" })).rejects.toThrow();
  client.close();
});
