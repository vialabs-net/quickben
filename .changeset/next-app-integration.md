---
"@quickben/db-drizzle": patch
"@quickben/admin": patch
"@quickben/core": patch
"@quickben/next": patch
"create-quickben": patch
---

Fixes for new `create-next-app` projects.

- `@quickben/db-drizzle`: one entry point per dialect (`@quickben/db-drizzle/postgres`, `/pglite`, `/sqlite`), each exporting `drizzleAdapter`. A bundler now sees only the driver you import, so Next.js builds without `serverExternalPackages` for drivers you did not install. The main entry no longer exports `drizzleAdapter`.
- `@quickben/admin`: the admin page renders inside `<Suspense>`, so it builds with `cacheComponents: true`. Utilities are no longer in a cascade layer, so unlayered app resets (`* { margin: 0; padding: 0 }`) do not override them. It reads the request before the database. Control ids are unique per form, because Next.js keeps visited pages mounted. New `generateAdminMetadata(config)`. `Label` requires `htmlFor`.
- `@quickben/next`: `getRequestContext` calls `connection()`, so database reads after it never run while prerendering.
- `@quickben/core`: `admin.meta` (`title`, `description`) for the admin page metadata.
- `create-quickben`: templates use the dialect entry points and Cache Components, and no longer externalize the adapter.
