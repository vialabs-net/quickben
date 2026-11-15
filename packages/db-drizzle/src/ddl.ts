import { arrayDefault, indexName, sqlTypes, uniqueIndexName } from "./columns";

import type { ColumnSpec, Family, TableSpec } from "./columns";

/** Where and how DDL is written. */
export interface DdlOptions {
  /** Postgres schema of the tables. Omit for the connection's current schema. */
  schema?: string;
  /** Add `if not exists`, so the statement can run again. */
  ifNotExists?: boolean;
}

/** Quote an identifier for Postgres and SQLite. */
export function quote(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Quoted table name, with its schema when given. */
export function tableName(slug: string, schema?: string): string {
  return schema === undefined ? quote(slug) : `${quote(schema)}.${quote(slug)}`;
}

function ifNotExists(options: DdlOptions): string {
  return options.ifNotExists ? "if not exists " : "";
}

/** Column definition as written in `CREATE TABLE` and `ADD COLUMN`. */
export function columnDdl(column: ColumnSpec, family: Family): string {
  const parts = [quote(column.name), sqlTypes[family][column.kind]];
  if (column.kind === "id") parts.push("primary key");
  if (column.kind === "array") parts.push(`default ${arrayDefault[family]}`);
  if (column.notNull && column.kind !== "id") parts.push("not null");
  return parts.join(" ");
}

/** `CREATE SCHEMA` for a Postgres schema. */
export function createSchemaDdl(schema: string): string {
  return `create schema if not exists ${quote(schema)}`;
}

/** `CREATE TABLE` for a table, one column per line unless `inline`. */
export function createTableDdl(
  table: TableSpec,
  family: Family,
  options: DdlOptions & { inline?: boolean } = {},
): string {
  const columns = table.columns.map((column) => columnDdl(column, family));
  const name = `create table ${ifNotExists(options)}${tableName(table.slug, options.schema)}`;
  return options.inline
    ? `${name} (${columns.join(", ")})`
    : `${name} (\n  ${columns.join(",\n  ")}\n)`;
}

/** `ALTER TABLE … ADD COLUMN` for one column. */
export function addColumnDdl(
  table: TableSpec,
  column: ColumnSpec,
  family: Family,
  options: DdlOptions = {},
): string {
  return `alter table ${tableName(table.slug, options.schema)} add column ${columnDdl(column, family)}`;
}

/** `CREATE INDEX` for the unique index or plain index of a column, if it has one. */
export function columnIndexDdl(
  table: TableSpec,
  column: ColumnSpec,
  family: Family,
  options: DdlOptions = {},
): string | undefined {
  const target = tableName(table.slug, options.schema);
  const name = quote(column.name);
  if (column.unique) {
    const index = quote(uniqueIndexName(table.slug, column.name));
    return `create unique index ${ifNotExists(options)}${index} on ${target} (${name})`;
  }
  if (!column.index) return undefined;
  const using = family === "pg" && column.kind === "array" ? " using gin" : "";
  const index = quote(indexName(table.slug, column.name));
  return `create index ${ifNotExists(options)}${index} on ${target}${using} (${name})`;
}

/** `CREATE INDEX` statements for a table. */
export function indexDdl(table: TableSpec, family: Family, options: DdlOptions = {}): string[] {
  return table.columns.flatMap((column) => columnIndexDdl(table, column, family, options) ?? []);
}
