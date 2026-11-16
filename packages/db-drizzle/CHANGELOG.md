# @quickben/db-drizzle

## 0.4.0

### Patch Changes

- 42af925: Host apps that share the database and the URL with Quickben.
  
  - Core: `qb.withTransaction(db)` returns `{ qb, committed, rolledBack }`. Writes through `qb` join a transaction the host opened. Call `committed()` after the commit (runs `afterCommit` hooks) and `rolledBack()` after a rollback (removes stored files).
  - db-drizzle: `adapter.fromTransaction(tx)` gives an adapter on a Drizzle transaction, or on a Drizzle database over a node-postgres client that ran `BEGIN`. Tested on PGlite and Postgres.
  - db-drizzle: `integerColumns: "bigint" | "integer"` (default `bigint`) sets the Postgres column type of integer fields. Push, verify, `generate`, `sql`, `--format prisma` (`Int`) and the CLI flag `--integer-columns` follow it. `ColumnKind` has a new member, `integer32`.
  - next: `pathnameHeaders(request)` for `proxy.ts` passes the page path to `currentRequest()` and `getRequestContext()`, through the `x-quickben-pathname` header.
  
  **Migration**
  
  - Nothing changes with the defaults. Code that switches over `ColumnKind` exhaustively must handle `integer32`.
- Updated dependencies [42af925]
  - @quickben/core@0.4.0

## 0.3.1

No changes in this release.

## 0.3.0

### Minor Changes

- a05048d: Run on a database that another tool migrates. `quickben-drizzle sql` (and `generateSql`) prints SQL DDL or, with `--format prisma`, Prisma models; `sql --diff --url` prints only what is missing. The `verify: true | "warn"` option and `quickben-drizzle verify --url` check that every table, column, type, nullability, unique index and index exists. The `schema` option (Postgres, PGlite) puts the tables in a Postgres schema.
- 102d4f2: Files and storage adapters.
  
  - `@quickben/core`: `StorageAdapter` (`put`, `get`, `getBytes`, `head`, `delete`, optional `signedUrl`), `assertStorageKey`, `memoryStorage`, `sniffMime`, `detectMime`. Config `storage`. `fields.file({ accept, maxBytes, storage })` stores `{ key, name, mime, size, sha256 }`; uploads are checked by their first bytes. Replaced and deleted files are removed after the commit; files of a rolled-back transaction are removed. `qb.readFile(slug, id, field, ctx)` follows read access.
  - `@quickben/db-drizzle`: file fields are JSON columns.
  - `@quickben/next`: `POST` and `PATCH` accept `multipart/form-data` (`_payload` JSON part, one part per file field, `maxUploadBytes`). `GET /:collection/:id/:field` streams a file. `_meta` describes `accept` and `maxBytes`.
  - `@quickben/admin`: file input with image and PDF preview, size check and a remove checkbox. Option `apiBasePath` (default `/api`).
  - `@quickben/storage-local`, `@quickben/storage-gcs`, `@quickben/storage-s3`: new storage adapters. The cloud SDKs are optional peer dependencies.
  - `@quickben/plugin-doc-reader`: `files` takes a `StorageAdapter`; the default is the config `storage`, else memory. `FileStore`, `memoryFileStore` and `localFileStore` are deprecated and still work.
  - `@quickben/plugin-templates`: brands have a `logoFile` file field (option `storage`, default the config `storage`). Without storage the brand form keeps the old `data:` URL `logo`. `migrateBrandLogos(qb)` moves old logos to `logoFile`.
  
  Not breaking for existing apps. The `brands` collection gets a `logoFile` column: run your migration tool if you do not use `push`. Admin uploads go through server actions, whose body limit is 1 MB by default (`experimental.serverActions.bodySizeLimit`).

### Patch Changes

- Updated dependencies [2aa9bd5]
- Updated dependencies [66c95ed]
- Updated dependencies [102d4f2]
  - @quickben/core@0.3.0

## 0.2.0

### Patch Changes

- @quickben/core@0.2.0

## 0.1.0

### Minor Changes

- 8f4f894: First release of the Drizzle adapter: Postgres (node-postgres), PGlite and SQLite (libSQL), tables generated from collections, `push` for development databases, and `quickben-drizzle generate` / `generateDrizzleSchema` for drizzle-kit migrations.

### Patch Changes

- 811793e: Fixes for new `create-next-app` projects.
  
  - `@quickben/db-drizzle`: one entry point per dialect (`@quickben/db-drizzle/postgres`, `/pglite`, `/sqlite`), each exporting `drizzleAdapter`. A bundler now sees only the driver you import, so Next.js builds without `serverExternalPackages` for drivers you did not install. The main entry no longer exports `drizzleAdapter`.
  - `@quickben/admin`: the admin page renders inside `<Suspense>`, so it builds with `cacheComponents: true`. Utilities are no longer in a cascade layer, so unlayered app resets (`* { margin: 0; padding: 0 }`) do not override them. It reads the request before the database. Control ids are unique per form, because Next.js keeps visited pages mounted. New `generateAdminMetadata(config)`. `Label` requires `htmlFor`.
  - `@quickben/next`: `getRequestContext` calls `connection()`, so database reads after it never run while prerendering.
  - `@quickben/core`: `admin.meta` (`title`, `description`) for the admin page metadata.
  - `create-quickben`: templates use the dialect entry points and Cache Components, and no longer externalize the adapter.
- Updated dependencies [e70ef29]
- Updated dependencies [d62a1a8]
- Updated dependencies [811793e]
- Updated dependencies [991ab37]
- Updated dependencies [745dd01]
- Updated dependencies [eb5c707]
  - @quickben/core@0.1.0
