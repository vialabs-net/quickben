import { PgDialect } from "drizzle-orm/pg-core";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { tableSpec } from "../src";
import { buildTable } from "../src/tables";
import { escapeLike, orderToSql, whereToSql } from "../src/where";

import { fullSchema } from "./fixtures/schema";

import type { WhereNode } from "@quickben/core";
import type { SQL } from "drizzle-orm";

const collection = fullSchema.collections[0]!;
const pgTable = buildTable(tableSpec(collection), "postgres");
const sqliteTable = buildTable(tableSpec(collection), "sqlite");
const pgDialect = new PgDialect();
const sqliteDialect = new SQLiteSyncDialect();

function pg(node: WhereNode) {
  return pgDialect.sqlToQuery(whereToSql(node, pgTable, "pg"));
}

function lite(node: WhereNode) {
  return sqliteDialect.sqlToQuery(whereToSql(node, sqliteTable, "sqlite"));
}

const t = '"blog-posts"';

describe("whereToSql", () => {
  it("empty and is true, empty or is false", () => {
    expect(pg({ and: [] }).sql).toBe("1 = 1");
    expect(pg({ or: [] }).sql).toBe("1 = 0");
    expect(lite({ and: [] }).sql).toBe("1 = 1");
  });

  it("ne and notIn also match null", () => {
    expect(pg({ field: "title", op: "ne", value: "a" })).toMatchObject({
      sql: `(${t}."title" <> $1 or ${t}."title" is null)`,
      params: ["a"],
    });
    expect(pg({ field: "views", op: "notIn", value: [1, 2] }).sql).toBe(
      `(${t}."views" not in ($1, $2) or ${t}."views" is null)`,
    );
    expect(pg({ field: "views", op: "notIn", value: [] }).sql).toBe("1 = 1");
    expect(pg({ field: "views", op: "in", value: [] }).sql).toBe("1 = 0");
    expect(pg({ field: "views", op: "in", value: [3] })).toMatchObject({
      sql: `${t}."views" in ($1)`,
      params: [3],
    });
  });

  it("comparisons and exists", () => {
    expect(pg({ field: "views", op: "lt", value: 1 }).sql).toBe(`${t}."views" < $1`);
    expect(pg({ field: "views", op: "lte", value: 1 }).sql).toBe(`${t}."views" <= $1`);
    expect(pg({ field: "views", op: "gt", value: 1 }).sql).toBe(`${t}."views" > $1`);
    expect(pg({ field: "views", op: "gte", value: 1 }).sql).toBe(`${t}."views" >= $1`);
    expect(pg({ field: "slug", op: "exists", value: true }).sql).toBe(`${t}."slug" is not null`);
    expect(pg({ field: "slug", op: "exists", value: false }).sql).toBe(`${t}."slug" is null`);
  });

  it("encodes values like the column", () => {
    expect(
      pg({ field: "publishedAt", op: "eq", value: "2024-01-01T00:00:00.000Z" }).params,
    ).toEqual(["2024-01-01T00:00:00.000Z"]);
    expect(lite({ field: "published", op: "eq", value: true }).params).toEqual([1]);
  });

  it("contains and startsWith ignore case and escape wildcards", () => {
    expect(pg({ field: "title", op: "contains", value: "50%_off" })).toMatchObject({
      sql: `${t}."title" ilike $1 escape '\\'`,
      params: ["%50\\%\\_off%"],
    });
    expect(lite({ field: "title", op: "startsWith", value: "a\\b" })).toMatchObject({
      sql: `${t}."title" like ? escape '\\'`,
      params: ["a\\\\b%"],
    });
  });

  it("array operators on Postgres", () => {
    expect(pg({ field: "tags", op: "contains", value: "a" })).toMatchObject({
      sql: `${t}."tags" && array[$1]::text[]`,
      params: ["a"],
    });
    expect(pg({ field: "tags", op: "notIn", value: ["a", "b"] }).sql).toBe(
      `not (${t}."tags" && array[$1, $2]::text[])`,
    );
    expect(pg({ field: "tags", op: "in", value: [] }).sql).toBe("1 = 0");
    expect(pg({ field: "tags", op: "notIn", value: [] }).sql).toBe("1 = 1");
    expect(pg({ field: "tags", op: "exists", value: true }).sql).toBe(
      `cardinality(${t}."tags") > 0`,
    );
    expect(pg({ field: "tags", op: "exists", value: false }).sql).toBe(
      `cardinality(${t}."tags") = 0`,
    );
  });

  it("array operators on SQLite", () => {
    expect(lite({ field: "tags", op: "in", value: ["a", "b"] })).toMatchObject({
      sql: `exists (select 1 from json_each(${t}."tags") where json_each.value in (?, ?))`,
      params: ["a", "b"],
    });
    expect(lite({ field: "tags", op: "exists", value: false }).sql).toBe(
      `json_array_length(${t}."tags") = 0`,
    );
  });

  it("nests groups", () => {
    const node: WhereNode = {
      or: [
        {
          and: [
            { field: "views", op: "gt", value: 1 },
            { field: "rating", op: "lt", value: 2 },
          ],
        },
        { field: "title", op: "eq", value: "x" },
      ],
    };
    expect(pg(node).sql).toBe(`((${t}."views" > $1 and ${t}."rating" < $2) or ${t}."title" = $3)`);
  });

  it("rejects unknown fields and operators", () => {
    expect(() => pg({ field: "nope", op: "eq", value: 1 })).toThrow('Unknown field "nope"');
    expect(() => pg({ field: "tags", op: "lt", value: "a" })).toThrow("not supported");
  });
});

it("escapeLike escapes the escape character and wildcards", () => {
  expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
});

it("orderToSql puts nulls last ascending and first descending", () => {
  const terms: SQL[] = orderToSql(
    [
      { field: "views", direction: "asc" },
      { field: "id", direction: "desc" },
    ],
    pgTable,
  );
  expect(terms.map((term) => pgDialect.sqlToQuery(term).sql)).toEqual([
    `${t}."views" asc nulls last`,
    `${t}."id" desc nulls first`,
  ]);
});
