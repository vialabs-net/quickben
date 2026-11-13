# @quickben/db-drizzle

Database adapter for [Quickben](https://quickben.vialabs.net) on [Drizzle ORM](https://orm.drizzle.team). It supports Postgres, PGlite and SQLite (libSQL).

```sh
pnpm add @quickben/db-drizzle drizzle-orm
pnpm add pg                    # Postgres
pnpm add @electric-sql/pglite  # PGlite
pnpm add @libsql/client        # SQLite
```

Install only the driver you use. Drivers are optional peer dependencies and load when the adapter starts.

## Dialects

Each dialect has its own entry point that exports `drizzleAdapter`. A bundler then resolves only the driver you import, so Next.js builds without the other drivers.

```ts
import { drizzleAdapter } from "@quickben/db-drizzle/postgres";
drizzleAdapter({ url: process.env.DATABASE_URL });

import { drizzleAdapter } from "@quickben/db-drizzle/pglite";
drizzleAdapter(); // in memory
drizzleAdapter({ dataDir: "./.pglite", push: true });

import { drizzleAdapter } from "@quickben/db-drizzle/sqlite";
drizzleAdapter(); // :memory:
drizzleAdapter({ url: "file:./app.db" });
drizzleAdapter({ url: "libsql://app.turso.io", authToken });
```

| Entry point | Driver                 | Options                                                         |
| ----------- | ---------------------- | --------------------------------------------------------------- |
| `/postgres` | `pg` (node-postgres)   | `url`, `pool` (extra `pg.Pool` options), or `client` (a `Pool`) |
| `/pglite`   | `@electric-sql/pglite` | `dataDir` (omit for memory), or `client` (a `PGlite`)           |
| `/sqlite`   | `@libsql/client`       | `url` (default `:memory:`), `authToken`, or `client`            |
| all         |                        | `push`: create missing tables at startup (see below)            |

`dialect` is optional; when given it must match the entry point. The main entry (`@quickben/db-drizzle`) has the types and schema tools. In Next.js, add `serverExternalPackages: ["@electric-sql/pglite"]` for PGlite; Postgres and SQLite need nothing.

The adapter closes only clients it created. PGlite and local SQLite have one connection, so the adapter runs their operations one at a time.

## Tables

Each collection gets a table named after its slug. Column names are field names.

| Field                              | Postgres / PGlite             | SQLite                            |
| ---------------------------------- | ----------------------------- | --------------------------------- |
| `id`                               | `text` primary key            | `text` primary key                |
| `createdAt`, `updatedAt`, datetime | `timestamp(3) with time zone` | `text` (ISO 8601)                 |
| `date`                             | `date`                        | `text`                            |
| text, textarea, email, url, select | `text`                        | `text`                            |
| relation (one)                     | `text`                        | `text`                            |
| select / relation with `many`      | `text[]`, default `'{}'`      | `text` JSON array, default `'[]'` |
| number                             | `double precision`            | `real`                            |
| number with `integer`              | `bigint`                      | `integer`                         |
| boolean                            | `boolean`                     | `integer` (0/1)                   |
| json                               | `jsonb`                       | `text` (JSON)                     |

- `required` fields are `not null`. `many` fields are always `not null`.
- `unique` creates the unique index `<slug>_<field>_unique`. `index` creates `<slug>_<field>_idx` (GIN for Postgres arrays). `createdAt` is always indexed.
- Ids are `text`, because core accepts custom ids that are not UUIDs.

## Queries

The adapter follows the query model of `@quickben/core` and passes `@quickben/adapter-tests`.

| Behavior                   | Postgres / PGlite                   | SQLite                                                      |
| -------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| `contains`, `startsWith`   | `ilike`                             | `like` (ignores case for ASCII letters only)                |
| `many` fields              | `&&` on `text[]`                    | `json_each`                                                 |
| Text order and comparisons | column collation (database default) | binary                                                      |
| Nulls                      | last ascending, first descending    | same                                                        |
| Unique violations          | `ConflictError` (code `23505`)      | `ConflictError` (`SQLITE_CONSTRAINT_UNIQUE`, `_PRIMARYKEY`) |
| Transactions               | Drizzle transactions                | Drizzle transactions                                        |

On SQLite, `contains` and `startsWith` ignore case for ASCII letters only. `{ title: { contains: "émile" } }` finds `émile` but not `Émile`. Postgres and the memory adapter find both.

Sorting and filters use the same collation, so cursors work with any database collation.

## Custom queries

`adapter.raw` (or `qb.db.raw`) gives the Drizzle database and the generated tables. Inside `qb.transaction`, `raw.db` is the transaction.

```ts
import { count, eq } from "drizzle-orm";

import type { DrizzleRaw } from "@quickben/db-drizzle";

const { db, table } = qb.db.raw as DrizzleRaw<"postgres">;
const posts = table("posts");
await db.select({ n: count() }).from(posts).where(eq(posts.status!, "draft"));
```

Columns of these tables are typed as `PgColumn | undefined`. For fully typed tables, import them from the generated schema file (below).

## Migrations

`push` creates missing tables, columns and indexes when Quickben starts. It never drops or changes a column. It is on by default for in-memory databases only. Use migrations for databases with real data.

1. Write the Drizzle schema from your config:

   ```sh
   pnpm quickben-drizzle generate --config quickben.config.ts --out drizzle/schema.ts
   ```

   The dialect comes from `drizzleAdapter` in the config, or pass `--dialect`. The CLI loads the config with jiti. Use relative imports in the config; tsconfig path aliases are not resolved.

2. Point drizzle-kit at it:

   ```ts
   // drizzle.config.ts
   import { defineConfig } from "drizzle-kit";

   export default defineConfig({
     dialect: "postgresql", // "sqlite" or "turso" for SQLite
     schema: "./drizzle/schema.ts",
     out: "./drizzle/migrations",
     dbCredentials: { url: process.env.DATABASE_URL! },
   });
   ```

3. Create and apply the migration:

   ```sh
   pnpm drizzle-kit generate
   pnpm drizzle-kit migrate
   ```

Run step 1 and 3 again after you change collections. Commit the schema file and the migrations.

From code, `generateDrizzleSchema(config, { out })` writes the same file and returns its source.

## Tests

The contract suite runs against PGlite and SQLite in memory. To also run it against a Postgres server:

```sh
QUICKBEN_TEST_POSTGRES_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test
```

The suite drops and recreates the `public` schema of that database. Use a throwaway database.
