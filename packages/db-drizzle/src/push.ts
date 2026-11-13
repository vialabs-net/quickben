import { sql } from "drizzle-orm";

import { arrayDefault, indexName, sqlTypes, uniqueIndexName } from "./columns";

import type { ColumnSpec, Family, TableSpec } from "./columns";
import type { PgDrizzleDatabase, SQLiteDrizzleDatabase } from "./connect";

/** Quote an identifier for Postgres and SQLite. */
export function quote(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Column definition as written in `CREATE TABLE` and `ADD COLUMN`. */
export function columnDdl(column: ColumnSpec, family: Family): string {
  const parts = [quote(column.name), sqlTypes[family][column.kind]];
  if (column.kind === "id") parts.push("primary key");
  if (column.kind === "array") parts.push(`default ${arrayDefault[family]}`);
  if (column.notNull && column.kind !== "id") parts.push("not null");
  return parts.join(" ");
}

/** `CREATE TABLE IF NOT EXISTS` for a table. */
export function createTableDdl(table: TableSpec, family: Family): string {
  const columns = table.columns.map((column) => columnDdl(column, family)).join(", ");
  return `create table if not exists ${quote(table.slug)} (${columns})`;
}

/** `CREATE INDEX IF NOT EXISTS` statements for a table. */
export function indexDdl(table: TableSpec, family: Family): string[] {
  const statements: string[] = [];
  const target = quote(table.slug);
  for (const column of table.columns) {
    const name = quote(column.name);
    if (column.unique) {
      statements.push(
        `create unique index if not exists ${quote(uniqueIndexName(table.slug, column.name))} on ${target} (${name})`,
      );
    } else if (column.index) {
      const using = family === "pg" && column.kind === "array" ? " using gin" : "";
      statements.push(
        `create index if not exists ${quote(indexName(table.slug, column.name))} on ${target}${using} (${name})`,
      );
    }
  }
  return statements;
}

type Db = PgDrizzleDatabase | SQLiteDrizzleDatabase;

async function rows(
  db: Db,
  family: Family,
  query: ReturnType<typeof sql>,
): Promise<Record<string, unknown>[]> {
  if (family === "sqlite") return (db as SQLiteDrizzleDatabase).all<Record<string, unknown>>(query);
  const result = (await (db as PgDrizzleDatabase).execute(query)) as {
    rows: Record<string, unknown>[];
  };
  return result.rows;
}

async function existingColumns(db: Db, family: Family, slug: string): Promise<Set<string>> {
  const query =
    family === "pg"
      ? sql`select column_name as name from information_schema.columns where table_schema = current_schema() and table_name = ${slug}`
      : sql`select name from pragma_table_info(${slug})`;
  return new Set((await rows(db, family, query)).map((row) => String(row.name)));
}

/**
 * Create missing tables, columns and indexes. Additive only: it never drops, renames or
 * changes a column. Adding a `required` column to a table with rows fails; write a migration.
 */
export async function pushTables(
  db: Db,
  family: Family,
  tables: readonly TableSpec[],
): Promise<void> {
  const run = (statement: string) => rows(db, family, sql.raw(statement));
  for (const table of tables) {
    const existing = await existingColumns(db, family, table.slug);
    if (existing.size === 0) {
      await run(createTableDdl(table, family));
    } else {
      for (const column of table.columns) {
        if (!existing.has(column.name)) {
          await run(`alter table ${quote(table.slug)} add column ${columnDdl(column, family)}`);
        }
      }
    }
    for (const statement of indexDdl(table, family)) await run(statement);
  }
}
