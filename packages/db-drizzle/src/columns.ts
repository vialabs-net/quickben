import type { CollectionSchema, DatabaseSchema, FieldSchema } from "@quickben/core";

/** Database engines supported by `drizzleAdapter`. */
export type Dialect = "postgres" | "pglite" | "sqlite";

/** Storage family of a dialect: `postgres` and `pglite` share the Postgres column types. */
export type Family = "pg" | "sqlite";

/** How a value is stored. Every field type maps to one kind. */
export type ColumnKind =
  "id" | "text" | "integer" | "float" | "boolean" | "date" | "datetime" | "json" | "array";

/** One column of a generated table. */
export interface ColumnSpec {
  /** Column name. Same as the field name. */
  name: string;
  kind: ColumnKind;
  notNull: boolean;
  unique: boolean;
  index: boolean;
}

/** One generated table: the collection slug and its columns, system columns first. */
export interface TableSpec {
  slug: string;
  columns: readonly ColumnSpec[];
}

/** Storage family of a dialect. */
export function familyOf(dialect: Dialect): Family {
  return dialect === "sqlite" ? "sqlite" : "pg";
}

/** Column kind of a collection field. */
export function columnKind(field: FieldSchema): ColumnKind {
  if (field.many) return "array";
  switch (field.type) {
    case "number":
      return field.integer ? "integer" : "float";
    case "boolean":
    case "date":
    case "datetime":
    case "json":
      return field.type;
    default:
      return "text";
  }
}

const systemColumns: readonly ColumnSpec[] = [
  { name: "id", kind: "id", notNull: true, unique: false, index: false },
  { name: "createdAt", kind: "datetime", notNull: true, unique: false, index: true },
  { name: "updatedAt", kind: "datetime", notNull: true, unique: false, index: false },
];

/** Table description of one collection. */
export function tableSpec(collection: CollectionSchema): TableSpec {
  return {
    slug: collection.slug,
    columns: [
      ...systemColumns,
      ...collection.fields.map((field) => {
        const kind = columnKind(field);
        return {
          name: field.name,
          kind,
          // `many` fields are never null: `[]` when unset.
          notNull: kind === "array" || field.required,
          unique: field.unique,
          index: field.index && !field.unique,
        };
      }),
    ],
  };
}

/** Table descriptions of every collection. */
export function tableSpecs(schema: DatabaseSchema): TableSpec[] {
  return schema.collections.map(tableSpec);
}

/** SQL type of a column kind, as written in DDL. */
export const sqlTypes: Record<Family, Record<ColumnKind, string>> = {
  pg: {
    id: "text",
    text: "text",
    integer: "bigint",
    float: "double precision",
    boolean: "boolean",
    date: "date",
    datetime: "timestamp(3) with time zone",
    json: "jsonb",
    array: "text[]",
  },
  sqlite: {
    id: "text",
    text: "text",
    integer: "integer",
    float: "real",
    boolean: "integer",
    date: "text",
    datetime: "text",
    json: "text",
    array: "text",
  },
};

/** SQL default of `many` columns, as written in DDL. */
export const arrayDefault: Record<Family, string> = { pg: "'{}'", sqlite: "'[]'" };

/** Name of the unique index of a column. */
export function uniqueIndexName(slug: string, column: string): string {
  return `${slug}_${column}_unique`;
}

/** Name of the plain index of a column. */
export function indexName(slug: string, column: string): string {
  return `${slug}_${column}_idx`;
}
