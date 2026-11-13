import { describe, expect, it } from "vitest";

import { columnKind, sqlTypes, tableSpec } from "../src";
import { familyOf } from "../src/columns";
import { buildTable, decodeValue, encodeValue } from "../src/tables";

import { fullSchema } from "./fixtures/schema";

import type { FieldSchema } from "@quickben/core";

const posts = fullSchema.collections[0]!;
const byName = (name: string) => posts.fields.find((field) => field.name === name)!;

it("maps every field type to a column kind", () => {
  const kinds = Object.fromEntries(posts.fields.map((field) => [field.name, columnKind(field)]));
  expect(kinds).toEqual({
    title: "text",
    slug: "text",
    body: "text",
    email: "text",
    site: "text",
    views: "integer",
    rating: "float",
    published: "boolean",
    publishedOn: "date",
    publishedAt: "datetime",
    status: "text",
    labels: "array",
    author: "text",
    tags: "array",
    meta: "json",
  });
});

it("adds system columns and derives constraints", () => {
  const spec = tableSpec(posts);
  expect(spec.columns.slice(0, 3).map((column) => column.name)).toEqual([
    "id",
    "createdAt",
    "updatedAt",
  ]);
  const column = (name: string) => spec.columns.find((c) => c.name === name);
  expect(column("title")).toMatchObject({ notNull: true, index: true, unique: false });
  // unique implies an index, so only the unique index is created.
  expect(column("slug")).toMatchObject({ notNull: false, unique: true, index: false });
  expect(column("tags")).toMatchObject({ notNull: true });
  expect(column("createdAt")).toMatchObject({ notNull: true, index: true });
});

describe.each(["postgres", "sqlite"] as const)("%s tables", (dialect) => {
  it("use the SQL types written by push", () => {
    const table = buildTable(tableSpec(posts), dialect);
    for (const { spec, column } of table.columns.values()) {
      const drizzleType = column.getSQLType().replace(" (", "(");
      expect(drizzleType, spec.name).toBe(sqlTypes[familyOf(dialect)][spec.kind]);
    }
  });
});

it("encodes and decodes values", () => {
  const date = encodeValue("datetime", "pg", "2024-01-10T10:00:00.000Z");
  expect(date).toBeInstanceOf(Date);
  expect(decodeValue("datetime", date)).toBe("2024-01-10T10:00:00.000Z");
  expect(encodeValue("datetime", "sqlite", "2024-01-10T10:00:00.000Z")).toBe(
    "2024-01-10T10:00:00.000Z",
  );
  expect(encodeValue("array", "pg", undefined)).toEqual([]);
  expect(encodeValue("text", "pg", undefined)).toBeNull();
  expect(decodeValue("array", null)).toEqual([]);
  expect(decodeValue("json", undefined)).toBeNull();
  expect(decodeValue("integer", 3)).toBe(3);
});

it("treats an unknown field type as text", () => {
  const odd = { ...byName("title"), type: "color" } as unknown as FieldSchema;
  expect(columnKind(odd)).toBe("text");
});
