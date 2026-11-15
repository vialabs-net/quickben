---
"@quickben/db-drizzle": minor
---

Run on a database that another tool migrates. `quickben-drizzle sql` (and `generateSql`) prints SQL DDL or, with `--format prisma`, Prisma models; `sql --diff --url` prints only what is missing. The `verify: true | "warn"` option and `quickben-drizzle verify --url` check that every table, column, type, nullability, unique index and index exists. The `schema` option (Postgres, PGlite) puts the tables in a Postgres schema.
