import { sql } from "drizzle-orm";

import { addColumnDdl, createSchemaDdl, createTableDdl, indexDdl } from "./ddl";
import { queryRows } from "./inspect";

import type { Family, TableSpec } from "./columns";
import type { PgDrizzleDatabase, SQLiteDrizzleDatabase } from "./connect";

type Db = PgDrizzleDatabase | SQLiteDrizzleDatabase;

async function existingColumns(
  db: Db,
  family: Family,
  slug: string,
  schema: string | undefined,
): Promise<Set<string>> {
  const namespace = schema === undefined ? sql`current_schema()` : sql`${schema}`;
  const query =
    family === "pg"
      ? sql`select column_name as name from information_schema.columns where table_schema = ${namespace} and table_name = ${slug}`
      : sql`select name from pragma_table_info(${slug})`;
  return new Set((await queryRows(db, family, query)).map((row) => String(row.name)));
}

/**
 * Create missing tables, columns and indexes (and the Postgres `schema`). Additive only: it
 * never drops, renames or changes a column. Adding a `required` column to a table with rows
 * fails; write a migration.
 */
export async function pushTables(
  db: Db,
  family: Family,
  tables: readonly TableSpec[],
  schema?: string,
): Promise<void> {
  const run = (statement: string) => queryRows(db, family, sql.raw(statement));
  const options = { schema, ifNotExists: true };
  if (family === "pg" && schema !== undefined) await run(createSchemaDdl(schema));
  for (const table of tables) {
    const existing = await existingColumns(db, family, table.slug, schema);
    if (existing.size === 0) {
      await run(createTableDdl(table, family, { ...options, inline: true }));
    } else {
      for (const column of table.columns) {
        if (!existing.has(column.name)) await run(addColumnDdl(table, column, family, options));
      }
    }
    for (const statement of indexDdl(table, family, options)) await run(statement);
  }
}
