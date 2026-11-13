import { sql } from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import * as sqlite from "drizzle-orm/sqlite-core";

import { arrayDefault, familyOf, indexName, uniqueIndexName } from "./columns";

import type { ColumnKind, ColumnSpec, Dialect, Family, TableSpec } from "./columns";
import type { Column } from "drizzle-orm";

/** A generated Postgres or SQLite table. */
export type DrizzleTable = pg.PgTable | sqlite.SQLiteTable;

/** A generated table with its columns, as the adapter uses it. */
export interface RuntimeTable {
  spec: TableSpec;
  table: DrizzleTable;
  columns: ReadonlyMap<string, { spec: ColumnSpec; column: Column }>;
  /** Field name of each unique index name, plus the primary key. */
  constraints: ReadonlyMap<string, string>;
}

function pgColumn(spec: ColumnSpec): pg.PgColumnBuilderBase {
  const { name } = spec;
  let builder: pg.PgColumnBuilderBase & { notNull(): pg.PgColumnBuilderBase };
  switch (spec.kind) {
    case "id":
      return pg.text(name).primaryKey();
    case "integer":
      builder = pg.bigint(name, { mode: "number" });
      break;
    case "float":
      builder = pg.doublePrecision(name);
      break;
    case "boolean":
      builder = pg.boolean(name);
      break;
    case "date":
      builder = pg.date(name, { mode: "string" });
      break;
    case "datetime":
      builder = pg.timestamp(name, { withTimezone: true, precision: 3, mode: "date" });
      break;
    case "json":
      builder = pg.jsonb(name);
      break;
    case "array":
      return pg.text(name).array().notNull().default(sql.raw(arrayDefault.pg));
    default:
      builder = pg.text(name);
  }
  return spec.notNull ? builder.notNull() : builder;
}

function sqliteColumn(spec: ColumnSpec): sqlite.SQLiteColumnBuilderBase {
  const { name } = spec;
  let builder: sqlite.SQLiteColumnBuilderBase & { notNull(): sqlite.SQLiteColumnBuilderBase };
  switch (spec.kind) {
    case "id":
      return sqlite.text(name).primaryKey();
    case "integer":
      builder = sqlite.integer(name);
      break;
    case "float":
      builder = sqlite.real(name);
      break;
    case "boolean":
      builder = sqlite.integer(name, { mode: "boolean" });
      break;
    case "json":
      builder = sqlite.text(name, { mode: "json" });
      break;
    case "array":
      return sqlite.text(name, { mode: "json" }).notNull().default(sql.raw(arrayDefault.sqlite));
    default:
      // text, date and datetime: ISO strings sort in time order.
      builder = sqlite.text(name);
  }
  return spec.notNull ? builder.notNull() : builder;
}

type ColumnsOf = Record<string, Column>;

function pgTable(spec: TableSpec): pg.PgTable {
  const builders = Object.fromEntries(
    spec.columns.map((column) => [column.name, pgColumn(column)]),
  );
  return pg.pgTable(spec.slug, builders, (t) => {
    const columns = t as unknown as Record<string, pg.AnyPgColumn>;
    const indexes: pg.IndexBuilder[] = [];
    for (const column of spec.columns) {
      const target = columns[column.name];
      if (!target) continue;
      if (column.unique)
        indexes.push(pg.uniqueIndex(uniqueIndexName(spec.slug, column.name)).on(target));
      else if (column.index && column.kind === "array")
        indexes.push(pg.index(indexName(spec.slug, column.name)).using("gin", target));
      else if (column.index) indexes.push(pg.index(indexName(spec.slug, column.name)).on(target));
    }
    return indexes;
  });
}

function sqliteTable(spec: TableSpec): sqlite.SQLiteTable {
  const builders = Object.fromEntries(
    spec.columns.map((column) => [column.name, sqliteColumn(column)]),
  );
  return sqlite.sqliteTable(spec.slug, builders, (t) => {
    const columns = t as unknown as Record<string, sqlite.AnySQLiteColumn>;
    const indexes: sqlite.IndexBuilder[] = [];
    for (const column of spec.columns) {
      const target = columns[column.name];
      if (!target) continue;
      if (column.unique)
        indexes.push(sqlite.uniqueIndex(uniqueIndexName(spec.slug, column.name)).on(target));
      else if (column.index)
        indexes.push(sqlite.index(indexName(spec.slug, column.name)).on(target));
    }
    return indexes;
  });
}

/** Build the Drizzle table of a collection for a dialect. */
export function buildTable(spec: TableSpec, dialect: Dialect): RuntimeTable {
  const table: DrizzleTable = familyOf(dialect) === "pg" ? pgTable(spec) : sqliteTable(spec);
  const all = table as unknown as ColumnsOf;
  const columns = new Map<string, { spec: ColumnSpec; column: Column }>();
  const constraints = new Map<string, string>([[`${spec.slug}_pkey`, "id"]]);
  for (const column of spec.columns) {
    const target = all[column.name];
    if (target) columns.set(column.name, { spec: column, column: target });
    if (column.unique) constraints.set(uniqueIndexName(spec.slug, column.name), column.name);
  }
  return { spec, table, columns, constraints };
}

/** Convert a value from core to what the Drizzle column expects. */
export function encodeValue(kind: ColumnKind, family: Family, value: unknown): unknown {
  if (kind === "array") return value ?? [];
  if (value === undefined || value === null) return null;
  if (kind === "datetime" && family === "pg" && typeof value === "string") return new Date(value);
  return value;
}

/** Convert a value read by Drizzle back to what core wrote. */
export function decodeValue(kind: ColumnKind, value: unknown): unknown {
  if (kind === "array") return value ?? [];
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}
