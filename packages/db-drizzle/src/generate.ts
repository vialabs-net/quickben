import { ConfigError } from "@quickben/core";

import { arrayDefault, familyOf, indexName, tableSpecs, uniqueIndexName } from "./columns";

import type { ColumnSpec, Dialect, Family, TableSpec } from "./columns";
import type { DatabaseSchema, QuickbenConfig } from "@quickben/core";

/** Options of {@link generateDrizzleSchema}. */
export interface GenerateSchemaOptions {
  /** Defaults to the dialect of `config.db` when it is a Drizzle adapter. */
  dialect?: Dialect;
  /** Postgres schema of the tables. Defaults to the `schema` of `config.db`. */
  schema?: string;
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

function tableCode(table: TableSpec, family: Family, schema: string | undefined): string {
  const ns = family === "pg" ? "pg" : "sqlite";
  const fn = family === "pg" ? "pgTable" : "sqliteTable";
  const define = schema === undefined ? `${ns}.${fn}` : "dbSchema.table";
  const columns = table.columns.map(
    (column) => `    ${column.name}: ${columnCode(column, family)},`,
  );
  const indexes = indexCode(table, family).map((line) => `    ${line},`);
  return [
    `export const ${tableExportName(table.slug)} = ${define}(`,
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

/** TypeScript source of the Drizzle schema for `schema`, in a Postgres `pgSchema` if given. */
export function schemaSource(schema: DatabaseSchema, dialect: Dialect, pgSchema?: string): string {
  const family = familyOf(dialect);
  // Drizzle uses `public` when there is no schema, and rejects `pgSchema("public")`.
  const named = family === "pg" && pgSchema !== "public" ? pgSchema : undefined;
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
    ...(named === undefined
      ? []
      : [`export const dbSchema = pg.pgSchema(${JSON.stringify(named)});`, ""]),
    ...tables.map((table) => `${tableCode(table, family, named)}\n`),
  ].join("\n");
}

/** The dialect and Postgres schema of `config.db` when it is a Drizzle adapter. */
export function drizzleOptionsOf(config: QuickbenConfig): {
  dialect: Dialect | undefined;
  schema: string | undefined;
} {
  const db = config.db as { name?: unknown; dialect?: unknown; schema?: unknown };
  if (db.name !== "drizzle") return { dialect: undefined, schema: undefined };
  const { dialect, schema } = db;
  return {
    dialect:
      dialect === "postgres" || dialect === "pglite" || dialect === "sqlite" ? dialect : undefined,
    schema: typeof schema === "string" ? schema : undefined,
  };
}

/** Dialect and schema from the options, else from the config. Throws without a dialect. */
export function resolveTarget(
  caller: string,
  config: QuickbenConfig,
  options: { dialect?: Dialect; schema?: string },
): { dialect: Dialect; schema: string | undefined } {
  const fromConfig = drizzleOptionsOf(config);
  const dialect = options.dialect ?? fromConfig.dialect;
  if (!dialect) {
    throw new ConfigError(
      `${caller}: pass \`dialect\` when the config does not use drizzleAdapter`,
    );
  }
  const schema = familyOf(dialect) === "pg" ? (options.schema ?? fromConfig.schema) : undefined;
  return { dialect, schema };
}

/** Write `source` to `out`, creating directories. */
export async function writeOut(out: string, source: string): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, source, "utf8");
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
  const { dialect, schema } = resolveTarget("generateDrizzleSchema", config, options);
  const source = schemaSource(schemaOf(config), dialect, schema);
  if (options.out) await writeOut(options.out, source);
  return source;
}
