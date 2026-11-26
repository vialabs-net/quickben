# @quickben/auth-better-auth

## 0.4.1

No changes in this release.

## 0.4.0

### Patch Changes

- Updated dependencies [42af925]
  - @quickben/core@0.4.0

## 0.3.1

### Patch Changes

- dcf82ce: OpenAPI 3.1 and contract checks. New package `@quickben/openapi`: `generateOpenApi(config, options)` documents custom endpoints (schemas from Zod, shared through `components/schemas` by `.meta({ id })`) and, opt-in, the CRUD routes of collections marked `api: { openapi: true }`; `diffOpenApi` classifies changes as breaking or not; `createOpenApiHandler` serves the document. The `quickben-openapi` CLI runs `generate` (with `--check` for stale files) and `diff`. Core adds the `api` collection option, `operationId` on endpoints and `securitySchemes` on auth adapters (`devAuth`, `firebaseAuth`, `betterAuthAdapter` describe theirs). `createRouteHandlers(config, { openapi: { serve: true } })` serves `GET /openapi.json`.

## 0.3.0

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
