import { familyOf, indexName, tableSpecs, uniqueIndexName } from "./columns";

import type { ColumnKind, ColumnOptions, ColumnSpec, Dialect, Family, TableSpec } from "./columns";
import type { DatabaseSchema } from "@quickben/core";

/** Prisma scalar type and native type attribute of each column kind. */
const prismaTypes: Record<Family, Record<ColumnKind, { type: string; attributes: string[] }>> = {
  pg: {
    id: { type: "String", attributes: ["@id"] },
    text: { type: "String", attributes: [] },
    integer: { type: "BigInt", attributes: [] },
    integer32: { type: "Int", attributes: [] },
    float: { type: "Float", attributes: [] },
    boolean: { type: "Boolean", attributes: [] },
    date: { type: "DateTime", attributes: ["@db.Date"] },
    datetime: { type: "DateTime", attributes: ["@db.Timestamptz(3)"] },
    json: { type: "Json", attributes: ["@db.JsonB"] },
    array: { type: "String[]", attributes: ["@default([])"] },
  },
  // Quickben stores dates, datetimes, JSON and arrays as text on SQLite.
  sqlite: {
    id: { type: "String", attributes: ["@id"] },
    text: { type: "String", attributes: [] },
    integer: { type: "BigInt", attributes: [] },
    integer32: { type: "Int", attributes: [] },
    float: { type: "Float", attributes: [] },
    boolean: { type: "Boolean", attributes: [] },
    date: { type: "String", attributes: [] },
    datetime: { type: "String", attributes: [] },
    json: { type: "String", attributes: [] },
    array: { type: "String", attributes: ['@default("[]")'] },
  },
};

const identifier = /^[A-Za-z]\w*$/;

/** Names Prisma does not accept for a model. */
const reserved = new Set([
  "string",
  "boolean",
  "int",
  "bigint",
  "float",
  "decimal",
  "datetime",
  "json",
  "bytes",
  "unsupported",
  "prisma",
  "prismaclient",
]);

/**
 * Prisma model name of a collection: `blog-posts` → `BlogPosts`. Names Prisma reserves get
 * a `Model` prefix. The models of one schema are made unique with a number.
 */
export function prismaModelName(slug: string): string {
  const name = slug
    .split(/[-_]/)
    .filter((part) => part !== "")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return identifier.test(name) && !reserved.has(name.toLowerCase()) ? name : `Model${name}`;
}

/** `name`, or `name2`, `name3`, … when another one already took it (ignoring case). */
function unique(name: string, used: Set<string>): string {
  let candidate = name;
  let n = 1;
  while (used.has(candidate.toLowerCase())) {
    n += 1;
    candidate = `${name}${String(n)}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Prisma field names of a table. Names Prisma does not accept get a prefix and `@map`. */
function fieldNames(table: TableSpec): Map<string, string> {
  const used = new Set(
    table.columns.filter((c) => identifier.test(c.name)).map((c) => c.name.toLowerCase()),
  );
  return new Map(
    table.columns.map((column) => [
      column.name,
      identifier.test(column.name) ? column.name : unique(`f${column.name}`, used),
    ]),
  );
}

function fieldLine(table: TableSpec, column: ColumnSpec, family: Family, name: string): string[] {
  const { type, attributes } = prismaTypes[family][column.kind];
  const optional = !column.notNull && column.kind !== "id" ? "?" : "";
  const extra = [...attributes];
  if (name !== column.name) extra.push(`@map(${JSON.stringify(column.name)})`);
  if (column.unique) {
    extra.push(`@unique(map: ${JSON.stringify(uniqueIndexName(table.slug, column.name))})`);
  }
  return [name, `${type}${optional}`, extra.join(" ")];
}

function indexLine(
  table: TableSpec,
  column: ColumnSpec,
  family: Family,
  name: string,
): string | undefined {
  if (!column.index || column.unique) return undefined;
  const map = `map: ${JSON.stringify(indexName(table.slug, column.name))}`;
  return family === "pg" && column.kind === "array"
    ? `@@index([${name}(ops: ArrayOps)], type: Gin, ${map})`
    : `@@index([${name}], ${map})`;
}

/** Pad the columns of each row so they line up, like `prisma format`. */
function align(rows: readonly string[][]): string[] {
  const widths = [0, 1].map((cell) => Math.max(...rows.map((row) => row[cell]?.length ?? 0)));
  return rows.map((row) =>
    row
      .map((value, cell) => (cell < 2 && row[cell + 1] ? value.padEnd(widths[cell] ?? 0) : value))
      .join(" ")
      .trimEnd(),
  );
}

function modelCode(
  table: TableSpec,
  model: string,
  family: Family,
  schema: string | undefined,
): string {
  const names = fieldNames(table);
  const nameOf = (column: ColumnSpec) => names.get(column.name) ?? column.name;
  const fields = align(
    table.columns.map((column) => fieldLine(table, column, family, nameOf(column))),
  );
  const blocks = [
    ...table.columns.flatMap((column) => indexLine(table, column, family, nameOf(column)) ?? []),
    `@@map(${JSON.stringify(table.slug)})`,
    ...(schema === undefined ? [] : [`@@schema(${JSON.stringify(schema)})`]),
  ];
  return [
    `model ${model} {`,
    ...fields.map((line) => `  ${line}`),
    "",
    ...blocks.map((line) => `  ${line}`),
    "}",
  ].join("\n");
}

/**
 * Prisma models for the tables of `schema`, with `@@map`, `@map` and `@db.*` attributes that
 * give the exact tables, columns and indexes the adapter expects. Paste them into
 * `schema.prisma` so Prisma Migrate owns the DDL. A plain string: Prisma is not needed.
 */
export function prismaSource(
  schema: DatabaseSchema,
  dialect: Dialect,
  pgSchema?: string,
  options: ColumnOptions = {},
): string {
  const family = familyOf(dialect);
  const named = family === "pg" ? pgSchema : undefined;
  const header = [
    `// Generated by @quickben/db-drizzle from the Quickben config (${dialect}).`,
    "// Paste these models into schema.prisma. Keep @@map, @map, @db and the index names.",
    "// Run `quickben-drizzle sql --format prisma` again after you change collections.",
    ...(named === undefined
      ? []
      : [`// List the schema in the datasource: schemas = [${JSON.stringify(named)}].`]),
  ];
  const used = new Set<string>();
  return [
    ...header,
    "",
    ...tableSpecs(schema, options).map((table) => {
      const model = unique(prismaModelName(table.slug), used);
      return `${modelCode(table, model, family, named)}\n`;
    }),
  ].join("\n");
}
