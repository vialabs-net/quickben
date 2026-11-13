# @quickben/db-drizzle

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
