import { ConfigError } from "@quickben/core";

import { arrayDefault, familyOf, indexName, tableSpecs, uniqueIndexName } from "./columns";

import type { ColumnSpec, Dialect, Family, TableSpec } from "./columns";
import type { DatabaseSchema, QuickbenConfig } from "@quickben/core";

/** Options of {@link generateDrizzleSchema}. */
export interface GenerateSchemaOptions {
  /** Defaults to the dialect of `config.db` when it is a Drizzle adapter. */
  dialect?: Dialect;
  /** Write the file to this path. Directories are created. */
  out?: string;
}

/** Schema passed to `DatabaseAdapter.init`, built from a config like `createQuickben` does. */
export function schemaOf(config: QuickbenConfig): DatabaseSchema {
  return {
    collections: config.collections.map((collection) => ({
      slug: collection.slug,
      fields: collection.fieldList.map((field) => ({
        name: field.name,
        type: field.type,
        many: field.many,
        required: field.required,
        unique: field.unique,
        index: field.index,
        ...(field.type === "relation" ? { to: field.to } : {}),
        ...(field.type === "select" ? { options: field.options } : {}),
        ...(field.type === "number" ? { integer: field.integer } : {}),
      })),
    })),
  };
}

/** Export name of a table: `blog-posts` → `blogPostsTable`. */
export function tableExportName(slug: string): string {
  const camel = slug
    .split(/[-_]/)
    .filter((part) => part !== "")
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
  const name = `${camel}Table`;
  return /^[a-z_$]/i.test(name) ? name : `_${name}`;
}

const pgBuilders: Record<ColumnSpec["kind"], (name: string) => string> = {
  id: (name) => `pg.text(${JSON.stringify(name)}).primaryKey()`,
  text: (name) => `pg.text(${JSON.stringify(name)})`,
  integer: (name) => `pg.bigint(${JSON.stringify(name)}, { mode: "number" })`,
  float: (name) => `pg.doublePrecision(${JSON.stringify(name)})`,
  boolean: (name) => `pg.boolean(${JSON.stringify(name)})`,
  date: (name) => `pg.date(${JSON.stringify(name)}, { mode: "string" })`,
  datetime: (name) =>
    `pg.timestamp(${JSON.stringify(name)}, { withTimezone: true, precision: 3, mode: "date" })`,
  json: (name) => `pg.jsonb(${JSON.stringify(name)})`,
  array: (name) => `pg.text(${JSON.stringify(name)}).array()`,
};

const sqliteBuilders: Record<ColumnSpec["kind"], (name: string) => string> = {
  id: (name) => `sqlite.text(${JSON.stringify(name)}).primaryKey()`,
  text: (name) => `sqlite.text(${JSON.stringify(name)})`,
  integer: (name) => `sqlite.integer(${JSON.stringify(name)})`,
  float: (name) => `sqlite.real(${JSON.stringify(name)})`,
  boolean: (name) => `sqlite.integer(${JSON.stringify(name)}, { mode: "boolean" })`,
  date: (name) => `sqlite.text(${JSON.stringify(name)})`,
  datetime: (name) => `sqlite.text(${JSON.stringify(name)})`,
  json: (name) => `sqlite.text(${JSON.stringify(name)}, { mode: "json" })`,
  array: (name) => `sqlite.text(${JSON.stringify(name)}, { mode: "json" })`,
};

function columnCode(column: ColumnSpec, family: Family): string {
  const ns = family === "pg" ? pgBuilders : sqliteBuilders;
  let code = ns[column.kind](column.name);
  if (column.kind === "array") return `${code}.notNull().default(sql\`${arrayDefault[family]}\`)`;
  if (column.notNull && column.kind !== "id") code += ".notNull()";
  return code;
}

function indexCode(table: TableSpec, family: Family): string[] {
  const ns = family === "pg" ? "pg" : "sqlite";
  const lines: string[] = [];
  for (const column of table.columns) {
    const target = `t.${column.name}`;
    if (column.unique) {
      lines.push(
        `${ns}.uniqueIndex(${JSON.stringify(uniqueIndexName(table.slug, column.name))}).on(${target})`,
      );
    } else if (column.index) {
      const name = JSON.stringify(indexName(table.slug, column.name));
      lines.push(
        family === "pg" && column.kind === "array"
          ? `${ns}.index(${name}).using("gin", ${target})`
          : `${ns}.index(${name}).on(${target})`,
      );
    }
  }
  return lines;
}

function tableCode(table: TableSpec, family: Family): string {
  const ns = family === "pg" ? "pg" : "sqlite";
  const fn = family === "pg" ? "pgTable" : "sqliteTable";
  const columns = table.columns.map(
    (column) => `    ${column.name}: ${columnCode(column, family)},`,
  );
  const indexes = indexCode(table, family).map((line) => `    ${line},`);
  return [
    `export const ${tableExportName(table.slug)} = ${ns}.${fn}(`,
    `  ${JSON.stringify(table.slug)},`,
    "  {",
    ...columns,
    "  },",
    "  (t) => [",
    ...indexes,
    "  ],",
    ");",
  ].join("\n");
}

/** TypeScript source of the Drizzle schema for `schema`. */
export function schemaSource(schema: DatabaseSchema, dialect: Dialect): string {
  const family = familyOf(dialect);
  const tables = tableSpecs(schema);
  const usesSql = tables.some((table) => table.columns.some((column) => column.kind === "array"));
  const imports = [
    ...(usesSql ? ['import { sql } from "drizzle-orm";'] : []),
    family === "pg"
      ? 'import * as pg from "drizzle-orm/pg-core";'
      : 'import * as sqlite from "drizzle-orm/sqlite-core";',
  ];
  return [
    "// Generated by @quickben/db-drizzle from the Quickben config. Do not edit.",
    "// Run `quickben-drizzle generate` again after you change collections.",
    ...imports,
    "",
    ...tables.map((table) => `${tableCode(table, family)}\n`),
  ].join("\n");
}

function dialectOf(config: QuickbenConfig): Dialect | undefined {
  const db = config.db as { name?: unknown; dialect?: unknown };
  const dialect = db.name === "drizzle" ? db.dialect : undefined;
  return dialect === "postgres" || dialect === "pglite" || dialect === "sqlite"
    ? dialect
    : undefined;
}

/**
 * Generate a Drizzle schema file from a Quickben config, for drizzle-kit migrations. The tables
 * are the ones the adapter builds at runtime: same names, columns, types and indexes.
 * Returns the TypeScript source and writes it to `options.out` when given.
 */
export async function generateDrizzleSchema(
  config: QuickbenConfig,
  options: GenerateSchemaOptions = {},
): Promise<string> {
  const dialect = options.dialect ?? dialectOf(config);
  if (!dialect) {
    throw new ConfigError(
      "generateDrizzleSchema: pass `dialect` when the config does not use drizzleAdapter",
    );
  }
  const source = schemaSource(schemaOf(config), dialect);
  if (options.out) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    await fs.mkdir(path.dirname(options.out), { recursive: true });
    await fs.writeFile(options.out, source, "utf8");
  }
  return source;
}
