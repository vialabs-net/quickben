# @quickben/core

## 0.1.0

### Minor Changes

- e70ef29: First release: collections, fields, type inference, validation, the portable query model, the database adapter contract, the local API with access rules, hooks and plugins, `devAuth`, and the in-memory adapter.
- d62a1a8: First release of `@quickben/next` (REST route handlers, server helpers) and `@quickben/admin` (admin UI generated from collections). Core exports `checkAccess` and adds `admin.component` to fields.
- 991ab37: New `@quickben/plugin-tenancy` 0.1.0: organizations, memberships, roles, module entitlements, tenant-scoped collections, membership guard rails, local API helpers and an admin extension (`@quickben/plugin-tenancy/admin`).
  
  Core: `definePlugin({ addFields })` adds typed fields to existing collections. Access rules get `ctx` and `qb`; hooks get `ctx`. `RelationField` takes a `THasDefault` parameter.
  
  Admin: extensions can add `sidebar` components.
- 745dd01: Polish before 0.1.
  
  - Next: `createRouteHandlers` limits `POST` and `PATCH` bodies to `maxBodyBytes` (default 1 MB). Larger bodies get `413 PAYLOAD_TOO_LARGE`.
  - Next: `getQuickben` is no longer re-exported. Import it from `@quickben/core`.
  - Admin: `resolveRoute` and `AdminRoute` are no longer exported.
  - Core: `QuickbenUser.emailVerified`. Auth adapters should set it.
  - Tenancy: `acceptInvitation` throws `ForbiddenError` for an invitation by email when the user has `emailVerified: false`. `listMyInvitations` and membership reads then ignore the email.
  - Tenancy: the organization cookie is `Secure` only on https requests, so it works on `http://localhost`. `organizationCookie(qb, id, req)` takes the request; new `isSecureRequest(req)`.
  - Tenancy: guard rails throw `TenancyRuleError` (a `ForbiddenError`) with a `rule`.
  - Tenancy admin: actions redirect with `?toast=` and `?error=` codes that map to fixed messages. Text from the URL is never shown.
  - create-quickben: templates import `getQuickben` from `@quickben/core`.
- eb5c707: Access hardening and one API change before 0.1.
  
  - Core: `findById(slug, id, query, ctx)`. The context is no longer merged with `select` and `depth`.
  - Core: relation values must point to documents the user can read (`overrideAccess`: they must exist).
  - Core: an update filter also applies to the updated document, so a document cannot leave the filter.
  - Core: `update` and `delete` of a document the user cannot read throw `NotFoundError`.
  - Core: cursor values are validated against the sort fields.
  - Core: `getQuickben` caches on `globalThis`, so every copy of the package shares one instance per config.
  - Core: field names must be unique without case; reserved names match in any case.
  - Next: 5xx Quickben errors (such as `ConfigError`) are returned as `INTERNAL` without their message.
  - Memory adapter: an update no longer brings back a document deleted by a concurrent commit.
  - Tenancy: a suspended organization is read-only for its members.

### Patch Changes

- 811793e: Fixes for new `create-next-app` projects.
  
  - `@quickben/db-drizzle`: one entry point per dialect (`@quickben/db-drizzle/postgres`, `/pglite`, `/sqlite`), each exporting `drizzleAdapter`. A bundler now sees only the driver you import, so Next.js builds without `serverExternalPackages` for drivers you did not install. The main entry no longer exports `drizzleAdapter`.
  - `@quickben/admin`: the admin page renders inside `<Suspense>`, so it builds with `cacheComponents: true`. Utilities are no longer in a cascade layer, so unlayered app resets (`* { margin: 0; padding: 0 }`) do not override them. It reads the request before the database. Control ids are unique per form, because Next.js keeps visited pages mounted. New `generateAdminMetadata(config)`. `Label` requires `htmlFor`.
  - `@quickben/next`: `getRequestContext` calls `connection()`, so database reads after it never run while prerendering.
  - `@quickben/core`: `admin.meta` (`title`, `description`) for the admin page metadata.
  - `create-quickben`: templates use the dialect entry points and Cache Components, and no longer externalize the adapter.
