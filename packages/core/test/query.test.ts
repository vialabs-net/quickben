import { describe, expect, it } from "vitest";

import {
  compareBySort,
  compareValues,
  defineCollection,
  defineConfig,
  fields as f,
  matchesWhere,
  ValidationError,
} from "../src";
import { cursorWhere, encodeCursor, parsePaging, parseSort } from "../src/query";
import { andWhere, normalizeWhere } from "../src/where";

import { testAdapter } from "./helpers";

import type { WhereNode, WhereOperator } from "../src";

const items = defineCollection({
  slug: "items",
  fields: {
    name: f.text(),
    count: f.number(),
    active: f.boolean(),
    kind: f.select({ options: ["a", "b"] }),
    labels: f.select({ options: ["x", "y"], many: true }),
    day: f.date(),
    at: f.datetime(),
    data: f.json(),
  },
});
const collection = defineConfig({ db: testAdapter(), collections: [items] }).collections[0]!;

function issue(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof ValidationError) return error.issues[0];
    throw error;
  }
  throw new Error("Expected a ValidationError");
}

describe("normalizeWhere", () => {
  it("builds a tree and drops undefined keys", () => {
    expect(normalizeWhere(collection, undefined)).toEqual({ and: [] });
    expect(normalizeWhere(collection, { name: { eq: "x" } })).toEqual({
      field: "name",
      op: "eq",
      value: "x",
    });
    expect(
      normalizeWhere(collection, { name: { eq: "x", ne: undefined }, count: undefined }),
    ).toEqual({
      field: "name",
      op: "eq",
      value: "x",
    });
    expect(normalizeWhere(collection, { name: { eq: "x" }, count: { gt: 1 } })).toEqual({
      and: [
        { field: "name", op: "eq", value: "x" },
        { field: "count", op: "gt", value: 1 },
      ],
    });
    expect(normalizeWhere(collection, { or: [{ active: { eq: true } }], and: [] })).toEqual({
      and: [{ or: [{ field: "active", op: "eq", value: true }] }, { and: [] }],
    });
  });

  it("normalizes dates", () => {
    expect(
      normalizeWhere(collection, { day: { eq: new Date("2024-03-04T10:00:00Z") } }),
    ).toMatchObject({
      value: "2024-03-04",
    });
    expect(normalizeWhere(collection, { at: { in: ["2024-03-04T10:00:00+02:00"] } })).toMatchObject(
      {
        value: ["2024-03-04T08:00:00.000Z"],
      },
    );
    expect(normalizeWhere(collection, { createdAt: { lt: "2024-01-01" } })).toMatchObject({
      value: "2024-01-01T00:00:00.000Z",
    });
  });

  it("rejects bad input with a path", () => {
    expect(issue(() => normalizeWhere(collection, "x"))).toEqual({
      path: "where",
      message: "Expected an object",
    });
    expect(issue(() => normalizeWhere(collection, { and: {} }))?.path).toBe("where.and");
    expect(issue(() => normalizeWhere(collection, { nope: { eq: 1 } }))?.message).toMatch(
      /Unknown field "nope"/,
    );
    expect(issue(() => normalizeWhere(collection, { name: "x" }))?.message).toMatch(
      /object of operators/,
    );
    expect(issue(() => normalizeWhere(collection, { name: { like: "x" } }))?.message).toMatch(
      /Unknown operator/,
    );
    expect(issue(() => normalizeWhere(collection, { count: { contains: "x" } }))?.message).toMatch(
      /not allowed/,
    );
    expect(issue(() => normalizeWhere(collection, { data: { eq: 1 } }))?.message).toMatch(
      /not allowed/,
    );
    expect(issue(() => normalizeWhere(collection, { labels: { eq: "x" } }))?.message).toMatch(
      /not allowed/,
    );
    expect(issue(() => normalizeWhere(collection, { name: { exists: 1 } }))?.message).toBe(
      "Expected a boolean",
    );
    expect(issue(() => normalizeWhere(collection, { name: { contains: 1 } }))?.message).toBe(
      "Expected a string",
    );
    expect(issue(() => normalizeWhere(collection, { name: { in: "x" } }))?.message).toBe(
      "Expected an array",
    );
    expect(issue(() => normalizeWhere(collection, { count: { eq: Number.NaN } }))?.message).toBe(
      "Expected a number",
    );
    expect(issue(() => normalizeWhere(collection, { active: { eq: "yes" } }))?.message).toBe(
      "Expected a boolean",
    );
    expect(issue(() => normalizeWhere(collection, { day: { eq: "soon" } }))?.message).toBe(
      "Expected a date",
    );
    expect(issue(() => normalizeWhere(collection, { day: { eq: 5 } }))?.message).toBe(
      "Expected a date",
    );
    expect(issue(() => normalizeWhere(collection, { kind: { eq: "c" } }))?.message).toBe(
      "Expected one of: a, b",
    );
    expect(issue(() => normalizeWhere(collection, { labels: { contains: "z" } }))?.path).toBe(
      "where.labels.contains",
    );
    expect(issue(() => normalizeWhere(collection, { or: [{ name: { in: [1] } }] }))?.path).toBe(
      "where.or.0.name.in.0",
    );
  });
});

describe("matchesWhere", () => {
  const doc = { name: "Hello", count: 3, active: false, labels: ["x"], empty: [], none: null };
  const leaf = (field: string, op: WhereOperator, value: unknown) =>
    matchesWhere(doc, { field, op, value });

  it("handles scalars and nulls", () => {
    expect(matchesWhere(doc, undefined)).toBe(true);
    expect(leaf("name", "eq", "Hello")).toBe(true);
    expect(leaf("none", "eq", null)).toBe(false);
    expect(leaf("none", "ne", "x")).toBe(true);
    expect(leaf("missing", "notIn", ["x"])).toBe(true);
    expect(leaf("count", "in", [1, 3])).toBe(true);
    expect(leaf("count", "lte", 3)).toBe(true);
    expect(leaf("count", "lt", 3)).toBe(false);
    expect(leaf("none", "gt", 0)).toBe(false);
    expect(leaf("name", "contains", "ELL")).toBe(true);
    expect(leaf("name", "startsWith", "he")).toBe(true);
    expect(leaf("count", "contains", "3")).toBe(false);
    expect(leaf("none", "exists", false)).toBe(true);
  });

  it("handles arrays", () => {
    expect(leaf("labels", "contains", "x")).toBe(true);
    expect(leaf("labels", "in", ["y", "x"])).toBe(true);
    expect(leaf("labels", "notIn", ["x"])).toBe(false);
    expect(leaf("labels", "exists", true)).toBe(true);
    expect(leaf("empty", "exists", false)).toBe(true);
    expect(leaf("labels", "eq", "x")).toBe(false);
  });

  it("handles groups", () => {
    expect(matchesWhere(doc, { and: [] })).toBe(true);
    expect(matchesWhere(doc, { or: [] })).toBe(false);
    expect(
      matchesWhere(doc, {
        or: [
          { field: "count", op: "gt", value: 5 },
          { field: "active", op: "eq", value: false },
        ],
      }),
    ).toBe(true);
  });

  it("andWhere drops match-all nodes", () => {
    const a: WhereNode = { field: "a", op: "eq", value: 1 };
    expect(andWhere(undefined, { and: [] })).toEqual({ and: [] });
    expect(andWhere(a, undefined)).toBe(a);
    expect(andWhere(a, a)).toEqual({ and: [a, a] });
  });
});

describe("compareValues", () => {
  it("orders values and puts null last", () => {
    expect(compareValues(1, 2)).toBeLessThan(0);
    expect(compareValues(false, true)).toBeLessThan(0);
    expect(compareValues(true, false)).toBeGreaterThan(0);
    expect(compareValues("b", "a")).toBeGreaterThan(0);
    expect(compareValues("a", "a")).toBe(0);
    expect(compareValues(null, "a")).toBeGreaterThan(0);
    expect(compareValues("a", undefined)).toBeLessThan(0);
    expect(compareValues(null, undefined)).toBe(0);
  });

  it("compareBySort applies directions in order", () => {
    const rows = [
      { a: 1, b: 2 },
      { a: 1, b: 3 },
      { a: 0, b: 1 },
    ];
    rows.sort(
      compareBySort([
        { field: "a", direction: "desc" },
        { field: "b", direction: "asc" },
      ]),
    );
    expect(rows).toEqual([
      { a: 1, b: 2 },
      { a: 1, b: 3 },
      { a: 0, b: 1 },
    ]);
    expect(compareBySort([])({ a: 1 }, { a: 2 })).toBe(0);
  });
});

describe("sort, paging and cursors", () => {
  it("parses sort keys", () => {
    expect(parseSort(collection, undefined)).toEqual([
      { field: "createdAt", direction: "desc" },
      { field: "id", direction: "desc" },
    ]);
    expect(parseSort(collection, ["name", "-count", "name"])).toEqual([
      { field: "name", direction: "asc" },
      { field: "count", direction: "desc" },
      { field: "id", direction: "desc" },
    ]);
    expect(parseSort(collection, "-id")).toEqual([{ field: "id", direction: "desc" }]);
    expect(issue(() => parseSort(collection, "-"))?.path).toBe("sort.0");
    expect(issue(() => parseSort(collection, [1]))?.path).toBe("sort.0");
    expect(issue(() => parseSort(collection, "labels"))?.message).toMatch(/Cannot sort/);
    expect(issue(() => parseSort(collection, "data"))?.message).toMatch(/Cannot sort/);
    expect(issue(() => parseSort(collection, "nope"))?.message).toMatch(/Cannot sort/);
  });

  it("parses paging", () => {
    expect(parsePaging(undefined, undefined)).toEqual({ limit: 20, page: 1 });
    expect(issue(() => parsePaging(0, 1))?.path).toBe("limit");
    expect(issue(() => parsePaging(10, 1.5))?.path).toBe("page");
  });

  it("round-trips cursors and rejects foreign ones", () => {
    const sort = parseSort(collection, ["name", "-count"]);
    const cursor = encodeCursor(sort, { id: "i", name: "ñandú ✓", count: null });
    const where = cursorWhere(collection, sort, cursor);
    expect(matchesWhere({ id: "j", name: "ñandú ✓", count: null }, where)).toBe(false);
    expect(matchesWhere({ id: "a", name: "ñandú ✓", count: null }, where)).toBe(true);
    expect(matchesWhere({ id: "a", name: "ñandú ✓", count: 4 }, where)).toBe(true);
    expect(issue(() => cursorWhere(collection, parseSort(collection, "name"), cursor))?.path).toBe(
      "cursor",
    );
    expect(issue(() => cursorWhere(collection, sort, "%%%"))?.path).toBe("cursor");
    expect(issue(() => cursorWhere(collection, sort, btoa("[1]")))?.path).toBe("cursor");
  });

  it("rejects cursors whose values do not fit the sort fields", () => {
    const sort = parseSort(collection, ["name", "-count"]);
    const forge = (v: unknown[]) =>
      btoa(JSON.stringify({ s: "name,-count,-id", v })).replaceAll("=", "");
    for (const v of [
      [{ gt: 1 }, 1, "i"],
      ["a", "not a number", "i"],
      ["a", 1, ["i"]],
    ]) {
      expect(issue(() => cursorWhere(collection, sort, forge(v)))?.path).toBe("cursor");
    }
    expect(() => cursorWhere(collection, sort, forge(["a", null, "i"]))).not.toThrow();
  });
});

describe("prototype keys", () => {
  it("are unknown fields", () => {
    expect(
      issue(() => normalizeWhere(collection, JSON.parse('{"__proto__":{"eq":1}}')))?.message,
    ).toMatch(/Unknown field/);
    expect(issue(() => normalizeWhere(collection, { constructor: { eq: 1 } }))?.message).toMatch(
      /Unknown field/,
    );
  });
});
