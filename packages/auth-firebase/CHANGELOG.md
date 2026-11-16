# @quickben/auth-firebase

## 0.4.0

### Patch Changes

- Updated dependencies [932d404]
- Updated dependencies [6d8e9cb]
- Updated dependencies [42af925]
  - @quickben/admin@0.4.0
  - @quickben/core@0.4.0
  - @quickben/next@0.4.0

## 0.3.1

### Patch Changes

- 11e160b: Gaps found by the first real host app, all additive:
  
  - `@quickben/core`: `customAuth({ getUser })` and `chainAuth(...adapters)` (first user wins; `null` or `UnauthorizedError` moves to the next adapter). `ctx.preserveTimestamps` with `overrideAccess: true` keeps `createdAt` and `updatedAt` from the input, for imports. `defineCollection({ trackAuthor: true })` adds `createdBy` and `updatedBy`, set from `ctx.user.id`. `pluginState(id)` keeps per-config plugin state on `globalThis`.
  - `@quickben/next`: imports `next/headers.js` and `next/server.js`, so the built package loads in plain Node ESM.
  - `@quickben/auth-firebase`: `session: { read(req) → uid | null, loadUser? }` resolves the host's own session instead of the Firebase session cookie. Bearer ID tokens still work. Firebase SDK service and permission errors propagate instead of allowing a later auth adapter to authenticate the request.
  - `@quickben/plugin-connections`: `connections({ modelSchema: (base) => base.extend({ … }) })` adds keys to LLM model entries; `ModelOf<typeof plugin>` types them in `resolveLanguageModel`.
  - Tenancy, templates, doc reader and connections: plugin state survives dev hot reloads.
- dcf82ce: OpenAPI 3.1 and contract checks. New package `@quickben/openapi`: `generateOpenApi(config, options)` documents custom endpoints (schemas from Zod, shared through `components/schemas` by `.meta({ id })`) and, opt-in, the CRUD routes of collections marked `api: { openapi: true }`; `diffOpenApi` classifies changes as breaking or not; `createOpenApiHandler` serves the document. The `quickben-openapi` CLI runs `generate` (with `--check` for stale files) and `diff`. Core adds the `api` collection option, `operationId` on endpoints and `securitySchemes` on auth adapters (`devAuth`, `firebaseAuth`, `betterAuthAdapter` describe theirs). `createRouteHandlers(config, { openapi: { serve: true } })` serves `GET /openapi.json`.

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

- a259198: New `@quickben/auth-firebase` 0.1.0: auth adapter for Firebase session cookies, a session route (create from an ID token, read, clear; CSRF-checked), roles from custom claims or a resolver, a browser client (Google popup, One Tap, email and password), a session keeper that reloads tabs when the account changes, and a sign-in page (`@quickben/auth-firebase/admin`).
  
  New `@quickben/auth-better-auth` 0.1.0: auth adapter that reads the Better Auth session, with the organization plugin's active organization and member roles, `tenancySync` hooks that mirror Better Auth organizations into `@quickben/plugin-tenancy`, and `withActiveOrganizationCookie` that keeps the tenancy cookie on Better Auth's active organization.

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
