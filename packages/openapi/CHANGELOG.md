# @quickben/openapi

## 0.4.2

No changes in this release.

## 0.4.1

No changes in this release.

## 0.4.0

### Patch Changes

- Updated dependencies [42af925]
  - @quickben/core@0.4.0

## 0.3.1

### Patch Changes

- dcf82ce: OpenAPI 3.1 and contract checks. New package `@quickben/openapi`: `generateOpenApi(config, options)` documents custom endpoints (schemas from Zod, shared through `components/schemas` by `.meta({ id })`) and, opt-in, the CRUD routes of collections marked `api: { openapi: true }`; `diffOpenApi` classifies changes as breaking or not; `createOpenApiHandler` serves the document. The `quickben-openapi` CLI runs `generate` (with `--check` for stale files) and `diff`. Core adds the `api` collection option, `operationId` on endpoints and `securitySchemes` on auth adapters (`devAuth`, `firebaseAuth`, `betterAuthAdapter` describe theirs). `createRouteHandlers(config, { openapi: { serve: true } })` serves `GET /openapi.json`.
