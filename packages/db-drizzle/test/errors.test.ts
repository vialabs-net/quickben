import { ConflictError } from "@quickben/core";
import { expect, it } from "vitest";

import { tableSpec } from "../src";
import { toConflict } from "../src/errors";
import { buildTable } from "../src/tables";

import { fullSchema } from "./fixtures/schema";

const table = buildTable(tableSpec(fullSchema.collections[0]!), "postgres");

function wrapped(cause: object) {
  return new Error("Failed query", { cause });
}

it("maps Postgres unique violations to the field", () => {
  const error = toConflict(wrapped({ code: "23505", constraint: "blog-posts_slug_unique" }), table);
  expect(error).toBeInstanceOf(ConflictError);
  expect(error).toMatchObject({ code: "CONFLICT", field: "slug" });
  expect(toConflict({ code: "23505", constraint: "blog-posts_pkey" }, table)).toMatchObject({
    field: "id",
  });
  expect(toConflict({ code: "23505", constraint: "other" }, table)).toMatchObject({
    code: "CONFLICT",
    field: undefined,
  });
  expect(toConflict({ code: "23505" }, table)).toMatchObject({ field: undefined });
});

it("maps SQLite constraint errors to the field", () => {
  const unique = { code: "SQLITE_CONSTRAINT", extendedCode: "SQLITE_CONSTRAINT_UNIQUE" };
  expect(
    toConflict(wrapped({ ...unique, message: "UNIQUE constraint failed: blog-posts.slug" }), table),
  ).toMatchObject({ field: "slug" });
  expect(
    toConflict(
      { code: "SQLITE_CONSTRAINT_PRIMARYKEY", message: "UNIQUE constraint failed: posts.id" },
      table,
    ),
  ).toMatchObject({ field: "id" });
  expect(toConflict(unique, table)).toMatchObject({ field: undefined });
});

it("keeps other errors", () => {
  const error = wrapped({ code: "23503" });
  expect(toConflict(error, table)).toBe(error);
  expect(toConflict("text", table)).toBe("text");
  const notNull = { code: "SQLITE_CONSTRAINT", extendedCode: "SQLITE_CONSTRAINT_NOTNULL" };
  expect(toConflict(notNull, table)).toBe(notNull);
});
