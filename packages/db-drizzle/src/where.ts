import {
  and,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import { encodeValue } from "./tables";

import type { Family } from "./columns";
import type { RuntimeTable } from "./tables";
import type { SortSpec, WhereNode, WhereOperator } from "@quickben/core";
import type { Column, SQL } from "drizzle-orm";

const TRUE = sql`1 = 1`;
const FALSE = sql`1 = 0`;

/** Escape `%`, `_` and `\` for a `LIKE` pattern that uses `\` as the escape character. */
export function escapeLike(value: string): string {
  return value.replaceAll(/[\\%_]/g, (char) => `\\${char}`);
}

function columnOf(table: RuntimeTable, field: string) {
  const entry = table.columns.get(field);
  if (!entry) throw new Error(`Unknown field "${field}" in collection "${table.spec.slug}"`);
  return entry;
}

/**
 * Translate a normalized filter to Drizzle SQL. Follows `matchesWhere` from `@quickben/core`:
 * `ne` and `notIn` match `null`, other comparisons never do, `contains` and `startsWith`
 * ignore case, `and: []` is true and `or: []` is false.
 */
export function whereToSql(node: WhereNode, table: RuntimeTable, family: Family): SQL {
  if ("and" in node) {
    if (node.and.length === 0) return TRUE;
    return and(...node.and.map((child) => whereToSql(child, table, family))) ?? TRUE;
  }
  if ("or" in node) {
    if (node.or.length === 0) return FALSE;
    return or(...node.or.map((child) => whereToSql(child, table, family))) ?? FALSE;
  }
  const { spec, column } = columnOf(table, node.field);
  if (spec.kind === "array") return arrayCondition(column, node.op, node.value, family);
  const encode = (value: unknown) => encodeValue(spec.kind, family, value);
  return scalarCondition(column, node.op, node.value, family, encode);
}

function scalarCondition(
  column: Column,
  op: WhereOperator,
  value: unknown,
  family: Family,
  encode: (value: unknown) => unknown,
): SQL {
  switch (op) {
    case "eq":
      return eq(column, encode(value));
    case "ne":
      return or(ne(column, encode(value)), isNull(column)) ?? FALSE;
    case "in": {
      const values = (value as unknown[]).map(encode);
      return values.length === 0 ? FALSE : inArray(column, values);
    }
    case "notIn": {
      const values = (value as unknown[]).map(encode);
      if (values.length === 0) return TRUE;
      return or(notInArray(column, values), isNull(column)) ?? FALSE;
    }
    case "lt":
      return lt(column, encode(value));
    case "lte":
      return lte(column, encode(value));
    case "gt":
      return gt(column, encode(value));
    case "gte":
      return gte(column, encode(value));
    case "contains":
      return like(column, `%${escapeLike(String(value))}%`, family);
    case "startsWith":
      return like(column, `${escapeLike(String(value))}%`, family);
    case "exists":
      return value === true ? isNotNull(column) : isNull(column);
  }
}

/** Case-insensitive `LIKE`. SQLite `LIKE` already ignores case for ASCII letters. */
function like(column: Column, pattern: string, family: Family): SQL {
  return family === "pg"
    ? sql`${column} ilike ${pattern} escape '\\'`
    : sql`${column} like ${pattern} escape '\\'`;
}

function textArray(values: readonly unknown[]): SQL {
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

function sqliteHasAny(column: Column, values: readonly unknown[]): SQL {
  return sql`exists (select 1 from json_each(${column}) where json_each.value in (${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}))`;
}

/** Operators on `many` fields: `contains` has the value, `in` has any, `notIn` has none. */
function arrayCondition(column: Column, op: WhereOperator, value: unknown, family: Family): SQL {
  if (op === "exists") {
    const length =
      family === "pg" ? sql`cardinality(${column})` : sql`json_array_length(${column})`;
    return value === true ? sql`${length} > 0` : sql`${length} = 0`;
  }
  let values: readonly unknown[];
  if (op === "contains") values = [value];
  else if (op === "in" || op === "notIn") values = value as unknown[];
  else throw new Error(`Operator "${op}" is not supported on array fields`);
  const negate = op === "notIn";
  if (values.length === 0) return negate ? TRUE : FALSE;
  const hasAny =
    family === "pg" ? sql`${column} && ${textArray(values)}` : sqliteHasAny(column, values);
  return negate ? sql`not (${hasAny})` : hasAny;
}

/**
 * `ORDER BY` terms. Nulls sort last ascending and first descending, as in core. Text uses the
 * column collation for both sorting and comparing, so cursors stay consistent.
 */
export function orderToSql(sort: readonly SortSpec[], table: RuntimeTable): SQL[] {
  return sort.map(({ field, direction }) => {
    const { column } = columnOf(table, field);
    return direction === "asc" ? sql`${column} asc nulls last` : sql`${column} desc nulls first`;
  });
}
