# @quickben/plugin-connections

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

- ade0d6a: New `@quickben/plugin-connections`: `credentials` (AES-256-GCM encrypted, write-only secrets) and `connections` collections, a provider registry (`defineProvider`) with built-in Anthropic, OpenAI-compatible, Gemini, Vertex AI and HTTP providers, connection and credential tests, master key rotation, AI SDK models (`/ai`) and an admin extension (`/admin`).

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
