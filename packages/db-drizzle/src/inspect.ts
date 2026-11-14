import { sql } from "drizzle-orm";

import { sqlTypes } from "./columns";
import { addColumnDdl, columnIndexDdl, createSchemaDdl, createTableDdl, indexDdl } from "./ddl";

import type { ColumnSpec, Family, TableSpec } from "./columns";
import type { PgDrizzleDatabase, SQLiteDrizzleDatabase } from "./connect";
import type { SQL } from "drizzle-orm";

type Db = PgDrizzleDatabase | SQLiteDrizzleDatabase;
type Row = Record<string, unknown>;

/** Run a query and return its rows, on Postgres, PGlite or SQLite. */
export async function queryRows(db: Db, family: Family, query: SQL): Promise<Row[]> {
  if (family === "sqlite") return (db as SQLiteDrizzleDatabase).all<Row>(query);
  const result = (await (db as PgDrizzleDatabase).execute(query)) as { rows: Row[] };
  return result.rows;
}

/** A column as the database has it. */
export interface DbColumn {
  /** Postgres: `format_type`, e.g. `timestamp(3) with time zone`. SQLite: the declared type. */
  type: string;
  notNull: boolean;
}

/** An index as the database has it. Unique constraints and primary keys are indexes too. */
export interface DbIndex {
  name: string;
  /** Key columns in order. Empty for expression indexes. */
  columns: string[];
  unique: boolean;
  primary: boolean;
  /** Partial or expression index: it does not cover every row by the column. */
  partial: boolean;
  /** Postgres access method, e.g. `btree` or `gin`. `undefined` on SQLite. */
  method: string | undefined;
}

/** A table as the database has it. */
export interface DbTable {
  columns: Map<string, DbColumn>;
  indexes: DbIndex[];
}

/** The tables of one Postgres schema, or of a SQLite database. */
export interface DbSnapshot {
  /** `false` when the Postgres schema does not exist. Always `true` on SQLite. */
  schemaExists: boolean;
  tables: Map<string, DbTable>;
}

/** The kind of a schema mismatch. */
export type SchemaProblem =
  "missing-table" | "missing-column" | "type" | "nullability" | "primary-key" | "unique" | "index";

/** One difference between the tables Quickben expects and the database. */
export interface SchemaIssue {
  /** Collection slug (table name). */
  table: string;
  /** Field name (column name), when the issue is about one column. */
  column?: string;
  problem: SchemaProblem;
  /** What Quickben expects, e.g. `text not null`. */
  expected: string;
  /** What the database has, when it has something. */
  actual?: string;
  /** One line, e.g. `notes.title: type is varchar(20), expected text`. */
  message: string;
}

/** Result of comparing the expected tables with a database. */
export interface SchemaReport {
  /** Every mismatch. Empty when the database has everything Quickben needs. */
  issues: SchemaIssue[];
  /**
   * SQL statements that add what is missing: schema, tables, columns and indexes. Type,
   * nullability and primary key mismatches have no statement; fix them by hand.
   */
  statements: string[];
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === "t" || value === "1" || value === 1n;
}

function table(snapshot: DbSnapshot, name: string): DbTable {
  let entry = snapshot.tables.get(name);
  if (!entry) {
    entry = { columns: new Map(), indexes: [] };
    snapshot.tables.set(name, entry);
  }
  return entry;
}

function textArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  // Some drivers return arrays as Postgres literals, e.g. `{a,b}`.
  if (typeof value === "string" && value.startsWith("{")) {
    const inner = value.slice(1, -1);
    return inner === "" ? [] : inner.split(",").map((part) => part.replaceAll('"', ""));
  }
  return [];
}

async function inspectPg(db: Db, schema: string | undefined): Promise<DbSnapshot> {
  const namespace = schema === undefined ? sql`current_schema()` : sql`${schema}`;
  const [exists] = await queryRows(
    db,
    "pg",
    sql`select count(*)::int as "n" from pg_namespace where nspname = ${namespace}`,
  );
  const snapshot: DbSnapshot = { schemaExists: Number(exists?.n) > 0, tables: new Map() };
  const columns = await queryRows(
    db,
    "pg",
    sql`select c.relname as "table", a.attname as "column",
          format_type(a.atttypid, a.atttypmod) as "type", a.attnotnull as "notNull"
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = ${namespace} and c.relkind in ('r', 'p')
          and a.attnum > 0 and not a.attisdropped`,
  );
  for (const row of columns) {
    table(snapshot, String(row.table)).columns.set(String(row.column), {
      type: String(row.type),
      notNull: bool(row.notNull),
    });
  }
  const indexes = await queryRows(
    db,
    "pg",
    sql`select c.relname as "table", i.relname as "name", ix.indisunique as "unique",
          ix.indisprimary as "primary", am.amname as "method",
          (ix.indpred is not null or ix.indexprs is not null) as "partial",
          array(
            select a.attname::text
            from unnest(ix.indkey::int2[]) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = k.attnum
            where k.ord <= ix.indnkeyatts
            order by k.ord
          ) as "columns"
        from pg_index ix
        join pg_class c on c.oid = ix.indrelid
        join pg_class i on i.oid = ix.indexrelid
        join pg_namespace n on n.oid = c.relnamespace
        join pg_am am on am.oid = i.relam
        where n.nspname = ${namespace}`,
  );
  for (const row of indexes) {
    const entry = snapshot.tables.get(String(row.table));
    entry?.indexes.push({
      name: String(row.name),
      columns: textArray(row.columns),
      unique: bool(row.unique),
      primary: bool(row.primary),
      partial: bool(row.partial),
      method: String(row.method),
    });
  }
  return snapshot;
}

async function inspectSqlite(db: Db, names: readonly string[]): Promise<DbSnapshot> {
  const snapshot: DbSnapshot = { schemaExists: true, tables: new Map() };
  for (const name of names) {
    const columns = await queryRows(
      db,
      "sqlite",
      sql`select name, type, "notnull" as "notNull", pk from pragma_table_info(${name})`,
    );
    if (columns.length === 0) continue;
    const entry = table(snapshot, name);
    const primary: string[] = [];
    for (const row of columns) {
      entry.columns.set(String(row.name), { type: String(row.type), notNull: bool(row.notNull) });
      if (Number(row.pk) > 0) primary.push(String(row.name));
    }
    if (primary.length > 0) {
      entry.indexes.push({
        name: `${name}_pkey`,
        columns: primary,
        unique: true,
        primary: true,
        partial: false,
        method: undefined,
      });
    }
    const list = await queryRows(
      db,
      "sqlite",
      sql`select name, "unique", partial, origin from pragma_index_list(${name})`,
    );
    for (const row of list) {
      if (row.origin === "pk") continue;
      const info = await queryRows(
        db,
        "sqlite",
        sql`select name from pragma_index_info(${String(row.name)}) order by seqno`,
      );
      const keys = info.map((key) => key.name);
      entry.indexes.push({
        name: String(row.name),
        columns: keys.filter((key) => key !== null).map(String),
        unique: bool(row.unique),
        primary: false,
        // A null name is an expression.
        partial: bool(row.partial) || keys.includes(null),
        method: undefined,
      });
    }
  }
  return snapshot;
}

/** Read the tables, columns and indexes of a database. */
export function inspectDatabase(
  db: Db,
  family: Family,
  tables: readonly TableSpec[],
  schema?: string,
): Promise<DbSnapshot> {
  return family === "pg"
    ? inspectPg(db, schema)
    : inspectSqlite(
        db,
        tables.map((spec) => spec.slug),
      );
}

/** SQLite type affinity of a declared type (https://sqlite.org/datatype3.html). */
export function affinity(declared: string): "INTEGER" | "TEXT" | "BLOB" | "REAL" | "NUMERIC" {
  const type = declared.toUpperCase();
  if (type.includes("INT")) return "INTEGER";
  if (type.includes("CHAR") || type.includes("CLOB") || type.includes("TEXT")) return "TEXT";
  if (type === "" || type.includes("BLOB")) return "BLOB";
  if (type.includes("REAL") || type.includes("FLOA") || type.includes("DOUB")) return "REAL";
  return "NUMERIC";
}

function typeMatches(column: ColumnSpec, family: Family, actual: string): boolean {
  const expected = sqlTypes[family][column.kind];
  if (family === "pg") return actual === expected;
  const found = affinity(actual);
  // Booleans are stored as 0 and 1, which NUMERIC (e.g. `BOOLEAN`) keeps as integers.
  if (column.kind === "boolean") return found === "INTEGER" || found === "NUMERIC";
  return found === affinity(expected);
}

function describeColumn(column: ColumnSpec, family: Family): string {
  return `${sqlTypes[family][column.kind]}${column.notNull ? " not null" : ""}`;
}

/** Whether an index serves a column's `index` (or `unique`) option. */
function covers(index: DbIndex, column: ColumnSpec, family: Family): boolean {
  if (index.partial || index.columns[0] !== column.name) return false;
  // `many` fields are queried with `&&`, which needs a GIN index on Postgres.
  if (family === "pg" && column.kind === "array") return index.method === "gin";
  return true;
}

function isUnique(index: DbIndex, column: ColumnSpec): boolean {
  return (
    index.unique && !index.partial && index.columns.length === 1 && index.columns[0] === column.name
  );
}

interface Context {
  family: Family;
  schema: string | undefined;
  issues: SchemaIssue[];
  statements: string[];
}

function issue(context: Context, entry: Omit<SchemaIssue, "message">): void {
  const where = entry.column === undefined ? entry.table : `${entry.table}.${entry.column}`;
  const messages: Record<SchemaProblem, string> = {
    "missing-table": `table is missing`,
    "missing-column": `column is missing, expected ${entry.expected}`,
    type: `type is ${entry.actual ?? "?"}, expected ${entry.expected}`,
    nullability: `column is ${entry.actual ?? "?"}, expected ${entry.expected}`,
    "primary-key": `primary key is ${entry.actual ?? "missing"}, expected (${entry.expected})`,
    unique: `unique index is missing, expected ${entry.expected}`,
    index: `index is missing, expected ${entry.expected}`,
  };
  context.issues.push({ ...entry, message: `${where}: ${messages[entry.problem]}` });
}

function checkShape(context: Context, spec: TableSpec, column: ColumnSpec, found: DbTable): void {
  const { family } = context;
  const actual = found.columns.get(column.name);
  const base = { table: spec.slug, column: column.name };
  if (!actual) {
    issue(context, {
      ...base,
      problem: "missing-column",
      expected: describeColumn(column, family),
    });
    context.statements.push(addColumnDdl(spec, column, family, { schema: context.schema }));
    return;
  }
  if (!typeMatches(column, family, actual.type)) {
    const expected = sqlTypes[family][column.kind];
    issue(context, { ...base, problem: "type", expected, actual: actual.type });
  }
  // Primary keys are checked apart. `many` columns may be nullable: null reads as `[]`.
  const nullable = column.kind === "id" || (column.kind === "array" && !actual.notNull);
  if (!nullable && actual.notNull !== column.notNull) {
    issue(context, {
      ...base,
      problem: "nullability",
      expected: column.notNull ? "not null" : "nullable",
      actual: actual.notNull ? "not null" : "nullable",
    });
  }
}

function checkIndex(context: Context, spec: TableSpec, column: ColumnSpec, found: DbTable): void {
  const { family } = context;
  const missing = column.unique
    ? !found.indexes.some((index) => isUnique(index, column))
    : column.index && !found.indexes.some((index) => covers(index, column, family));
  const ddl = columnIndexDdl(spec, column, family, { schema: context.schema });
  if (!missing || ddl === undefined) return;
  issue(context, {
    table: spec.slug,
    column: column.name,
    problem: column.unique ? "unique" : "index",
    expected: ddl,
  });
  context.statements.push(ddl);
}

function checkTable(context: Context, spec: TableSpec, found: DbTable | undefined): void {
  const { family, schema } = context;
  if (!found) {
    issue(context, { table: spec.slug, problem: "missing-table", expected: spec.slug });
    context.statements.push(
      createTableDdl(spec, family, { schema }),
      ...indexDdl(spec, family, { schema }),
    );
    return;
  }
  for (const column of spec.columns) {
    checkShape(context, spec, column, found);
    checkIndex(context, spec, column, found);
  }
  const primary = found.indexes.find((index) => index.primary);
  const columns = primary?.columns.join(", ");
  if (columns !== "id" && found.columns.has("id")) {
    issue(context, {
      table: spec.slug,
      problem: "primary-key",
      expected: "id",
      ...(columns === undefined ? {} : { actual: `(${columns})` }),
    });
  }
}

/**
 * Compare the tables Quickben expects with a database. Extra tables, columns and indexes are
 * allowed: another tool may own them.
 */
export function compareSchema(
  tables: readonly TableSpec[],
  snapshot: DbSnapshot,
  family: Family,
  schema?: string,
): SchemaReport {
  const context: Context = { family, schema, issues: [], statements: [] };
  if (family === "pg" && schema !== undefined && !snapshot.schemaExists) {
    context.statements.push(createSchemaDdl(schema));
  }
  for (const spec of tables) checkTable(context, spec, snapshot.tables.get(spec.slug));
  return { issues: context.issues, statements: context.statements };
}

/** The names of the unique indexes that serve each column, for conflict errors. */
export function uniqueIndexNames(spec: TableSpec, found: DbTable | undefined): Map<string, string> {
  const names = new Map<string, string>();
  for (const index of found?.indexes ?? []) {
    if (index.primary) names.set(index.name, "id");
    const column = spec.columns.find((candidate) => isUnique(index, candidate));
    if (column) names.set(index.name, column.name);
  }
  return names;
}
