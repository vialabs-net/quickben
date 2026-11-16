---
"@quickben/core": patch
"@quickben/db-drizzle": patch
"@quickben/next": patch
---

Host apps that share the database and the URL with Quickben.

- Core: `qb.withTransaction(db)` returns `{ qb, committed, rolledBack }`. Writes through `qb` join a transaction the host opened. Call `committed()` after the commit (runs `afterCommit` hooks) and `rolledBack()` after a rollback (removes stored files).
- db-drizzle: `adapter.fromTransaction(tx)` gives an adapter on a Drizzle transaction, or on a Drizzle database over a node-postgres client that ran `BEGIN`. Tested on PGlite and Postgres.
- db-drizzle: `integerColumns: "bigint" | "integer"` (default `bigint`) sets the Postgres column type of integer fields. Push, verify, `generate`, `sql`, `--format prisma` (`Int`) and the CLI flag `--integer-columns` follow it. `ColumnKind` has a new member, `integer32`.
- next: `pathnameHeaders(request)` for `proxy.ts` passes the page path to `currentRequest()` and `getRequestContext()`, through the `x-quickben-pathname` header.

**Migration**

- Nothing changes with the defaults. Code that switches over `ColumnKind` exhaustively must handle `integer32`.
