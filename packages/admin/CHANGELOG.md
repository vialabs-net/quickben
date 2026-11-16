# @quickben/admin

## 0.3.1

### Patch Changes

- 62d9804: Admin gaps found by the first embedded host app:
  
  - `pageTitle: "none"` hides page titles and breadcrumbs (admin and plugin pages); `getAdminNav(…, { pathname }).page` gives the title and breadcrumb to the host.
  - The dashboard tells "nothing set up yet" from "no access".
  - Layout tokens: `--qb-card-radius`, `--qb-card-padding`, `--qb-title-size`, `--qb-title-weight`, `--qb-heading-size`, `--qb-heading-weight`, `--qb-table-row-height`.
  - `json` fields whose schema is a list of objects get a row editor (`FieldMeta.rows`, `jsonRowColumns`, `RowsEditor`); plugin-connections uses it for LLM models.
  - Selects and relation chips fit their column; tables scroll in their own box and never widen the page.
  - `ListToolbar` in `@quickben/admin/ui`; the connections and credentials lists get search and filters.

## 0.3.0

### Minor Changes

- 2aa9bd5: Admin languages, embedded mode and theme tokens.
  
  - `@quickben/core`: `LocalizedText` labels (string or per-locale record) for collections, fields, modules, nav items and `admin.title`. `admin.locale`, `admin.messages`, `admin.timeZone`. `localize`, `negotiateLocale`, `localeFromRequest`.
  - `@quickben/next`: `getMeta` and `collectionMeta` take `{ locale }` and return plain strings.
  - `@quickben/admin`: `@quickben/admin/i18n` with `defineMessages`, `useAdminI18n`, `createAdminI18n`, `missingMessages`; English and Spanish catalogs. `i18n` in page, view and sidebar props. `chrome: "none"`, `getAdminNav`, `getAdminLocale`, `getAdminI18n`. Public `--qb-*` theme tokens with light and dark defaults.
  - Plugins: every admin page uses its own message catalog (English and Spanish) and the theme tokens. `createOrganizationSwitcher` in `@quickben/plugin-tenancy/admin`.
- 66c95ed: Field access rules, `afterCommit` hooks and time zones for date inputs.
  
  - `@quickben/core`: field `access: { read, create, update }` returning booleans. Unreadable fields are removed from documents and `select` and rejected in `where` and `sort` (`ValidationError`). Input that sets an unwritable field throws `ForbiddenError` with `fields`. `checkFieldAccess`. `afterCommit` hooks run after the outermost transaction commits, with a non-transactional `qb`; errors are logged. `timeZone` in `defineConfig` and on `date`/`datetime` fields: `Date`, offset and offset-less inputs resolve in it (default `UTC`); the server time zone is never used. Strings in other formats are rejected in `where`. Helpers: `formatDateValue`, `zonedTimeToUtc`, `localDateTime`, `dateInTimeZone`, `isTimeZone`.
  - `@quickben/next`: `/_meta` leaves out unreadable fields and gives each field `access: { create, update }` and date fields `timeZone`. `FORBIDDEN` from field rules has `details: { fields }`.
  - `@quickben/admin`: unreadable fields are not shown; unwritable fields are read-only and not submitted. `datetime-local` inputs use the admin time zone, which defaults to the config `timeZone`. Message key `edit.utc` is now `edit.timeZone` (`{zone}`).
  - `@quickben/plugin-templates`: dates are formatted with `formatDateValue`.
- 102d4f2: Files and storage adapters.
  
  - `@quickben/core`: `StorageAdapter` (`put`, `get`, `getBytes`, `head`, `delete`, optional `signedUrl`), `assertStorageKey`, `memoryStorage`, `sniffMime`, `detectMime`. Config `storage`. `fields.file({ accept, maxBytes, storage })` stores `{ key, name, mime, size, sha256 }`; uploads are checked by their first bytes. Replaced and deleted files are removed after the commit; files of a rolled-back transaction are removed. `qb.readFile(slug, id, field, ctx)` follows read access.
  - `@quickben/db-drizzle`: file fields are JSON columns.
  - `@quickben/next`: `POST` and `PATCH` accept `multipart/form-data` (`_payload` JSON part, one part per file field, `maxUploadBytes`). `GET /:collection/:id/:field` streams a file. `_meta` describes `accept` and `maxBytes`.
  - `@quickben/admin`: file input with image and PDF preview, size check and a remove checkbox. Option `apiBasePath` (default `/api`).
  - `@quickben/storage-local`, `@quickben/storage-gcs`, `@quickben/storage-s3`: new storage adapters. The cloud SDKs are optional peer dependencies.
  - `@quickben/plugin-doc-reader`: `files` takes a `StorageAdapter`; the default is the config `storage`, else memory. `FileStore`, `memoryFileStore` and `localFileStore` are deprecated and still work.
  - `@quickben/plugin-templates`: brands have a `logoFile` file field (option `storage`, default the config `storage`). Without storage the brand form keeps the old `data:` URL `logo`. `migrateBrandLogos(qb)` moves old logos to `logoFile`.
  
  Not breaking for existing apps. The `brands` collection gets a `logoFile` column: run your migration tool if you do not use `push`. Admin uploads go through server actions, whose body limit is 1 MB by default (`experimental.serverActions.bodySizeLimit`).
- 1396c30: Tenancy: organization statuses, module expiry, added fields and settings sections in the admin, delete modes.
  
  - `@quickben/plugin-tenancy`: `statuses` (access `full`, `limited` or `none`, for members and optionally platform staff, with a `label`) and `defaultStatus`; defaults keep `active` and `suspended`. `OrganizationError` reason `inactive` for other blocking statuses. `organization.modules` takes `{ key, expiresAt, source }` next to plain keys; expired modules count as disabled. `onOrganizationDelete`: `restrict` (default, `TenancyRuleError` `not-empty`) or `cascade`. `platformRoles` and `isPlatformStaff`. Helpers `activeModules`, `moduleKeys`, `isExpired`, `toGrant`. Admin: fields added to `organizations` and `memberships` render in the settings form and a member Details dialog, with field access; `tenancyAdmin(config, { sections })` adds settings tabs.
  - `@quickben/admin`: `@quickben/admin/forms` entry (`FieldInput`, `loadFieldContext`, `parseFormData`, `editableFields`, `formScope`). `PageProps` has `serverFunction`.
  
  Breaking: deleting an organization that still has scoped documents now throws `TenancyRuleError` `not-empty`; pass `onOrganizationDelete: "cascade"` to delete them. `OrganizationRecord.status` and the inferred `organizations.status` are `string`; `organizations.modules` is `ModuleEntitlement[]`.

### Patch Changes

- Updated dependencies [2aa9bd5]
- Updated dependencies [66c95ed]
- Updated dependencies [102d4f2]
  - @quickben/core@0.3.0
  - @quickben/next@0.3.0

## 0.2.0

### Patch Changes

- @quickben/core@0.2.0
  - @quickben/next@0.2.0

## 0.1.0

### Minor Changes

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
  - @quickben/next@0.1.0
