# @quickben/plugin-tenancy

## 0.3.1

### Patch Changes

- 62d9804: Admin gaps found by the first embedded host app:
  
  - `pageTitle: "none"` hides page titles and breadcrumbs (admin and plugin pages); `getAdminNav(…, { pathname }).page` gives the title and breadcrumb to the host.
  - The dashboard tells "nothing set up yet" from "no access".
  - Layout tokens: `--qb-card-radius`, `--qb-card-padding`, `--qb-title-size`, `--qb-title-weight`, `--qb-heading-size`, `--qb-heading-weight`, `--qb-table-row-height`.
  - `json` fields whose schema is a list of objects get a row editor (`FieldMeta.rows`, `jsonRowColumns`, `RowsEditor`); plugin-connections uses it for LLM models.
  - Selects and relation chips fit their column; tables scroll in their own box and never widen the page.
  - `ListToolbar` in `@quickben/admin/ui`; the connections and credentials lists get search and filters.
- 11e160b: Gaps found by the first real host app, all additive:
  
  - `@quickben/core`: `customAuth({ getUser })` and `chainAuth(...adapters)` (first user wins; `null` or `UnauthorizedError` moves to the next adapter). `ctx.preserveTimestamps` with `overrideAccess: true` keeps `createdAt` and `updatedAt` from the input, for imports. `defineCollection({ trackAuthor: true })` adds `createdBy` and `updatedBy`, set from `ctx.user.id`. `pluginState(id)` keeps per-config plugin state on `globalThis`.
  - `@quickben/next`: imports `next/headers.js` and `next/server.js`, so the built package loads in plain Node ESM.
  - `@quickben/auth-firebase`: `session: { read(req) → uid | null, loadUser? }` resolves the host's own session instead of the Firebase session cookie. Bearer ID tokens still work. Firebase SDK service and permission errors propagate instead of allowing a later auth adapter to authenticate the request.
  - `@quickben/plugin-connections`: `connections({ modelSchema: (base) => base.extend({ … }) })` adds keys to LLM model entries; `ModelOf<typeof plugin>` types them in `resolveLanguageModel`.
  - Tenancy, templates, doc reader and connections: plugin state survives dev hot reloads.

## 0.3.0

### Minor Changes

- 2aa9bd5: Admin languages, embedded mode and theme tokens.
  
  - `@quickben/core`: `LocalizedText` labels (string or per-locale record) for collections, fields, modules, nav items and `admin.title`. `admin.locale`, `admin.messages`, `admin.timeZone`. `localize`, `negotiateLocale`, `localeFromRequest`.
  - `@quickben/next`: `getMeta` and `collectionMeta` take `{ locale }` and return plain strings.
  - `@quickben/admin`: `@quickben/admin/i18n` with `defineMessages`, `useAdminI18n`, `createAdminI18n`, `missingMessages`; English and Spanish catalogs. `i18n` in page, view and sidebar props. `chrome: "none"`, `getAdminNav`, `getAdminLocale`, `getAdminI18n`. Public `--qb-*` theme tokens with light and dark defaults.
  - Plugins: every admin page uses its own message catalog (English and Spanish) and the theme tokens. `createOrganizationSwitcher` in `@quickben/plugin-tenancy/admin`.
- 1396c30: Tenancy: organization statuses, module expiry, added fields and settings sections in the admin, delete modes.
  
  - `@quickben/plugin-tenancy`: `statuses` (access `full`, `limited` or `none`, for members and optionally platform staff, with a `label`) and `defaultStatus`; defaults keep `active` and `suspended`. `OrganizationError` reason `inactive` for other blocking statuses. `organization.modules` takes `{ key, expiresAt, source }` next to plain keys; expired modules count as disabled. `onOrganizationDelete`: `restrict` (default, `TenancyRuleError` `not-empty`) or `cascade`. `platformRoles` and `isPlatformStaff`. Helpers `activeModules`, `moduleKeys`, `isExpired`, `toGrant`. Admin: fields added to `organizations` and `memberships` render in the settings form and a member Details dialog, with field access; `tenancyAdmin(config, { sections })` adds settings tabs.
  - `@quickben/admin`: `@quickben/admin/forms` entry (`FieldInput`, `loadFieldContext`, `parseFormData`, `editableFields`, `formScope`). `PageProps` has `serverFunction`.
  
  Breaking: deleting an organization that still has scoped documents now throws `TenancyRuleError` `not-empty`; pass `onOrganizationDelete: "cascade"` to delete them. `OrganizationRecord.status` and the inferred `organizations.status` are `string`; `organizations.modules` is `ModuleEntitlement[]`.

### Patch Changes

- Updated dependencies [2aa9bd5]
- Updated dependencies [66c95ed]
- Updated dependencies [102d4f2]
- Updated dependencies [1396c30]
  - @quickben/core@0.3.0
  - @quickben/next@0.3.0
  - @quickben/admin@0.3.0

## 0.2.0

### Patch Changes

- @quickben/admin@0.2.0
  - @quickben/core@0.2.0
  - @quickben/next@0.2.0

## 0.1.0

### Minor Changes

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

- Updated dependencies [e70ef29]
- Updated dependencies [d62a1a8]
- Updated dependencies [811793e]
- Updated dependencies [991ab37]
- Updated dependencies [745dd01]
- Updated dependencies [eb5c707]
  - @quickben/core@0.1.0
  - @quickben/next@0.1.0
  - @quickben/admin@0.1.0
