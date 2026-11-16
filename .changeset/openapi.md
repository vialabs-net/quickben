---
"@quickben/openapi": patch
"@quickben/core": patch
"@quickben/next": patch
"@quickben/auth-firebase": patch
"@quickben/auth-better-auth": patch
---

OpenAPI 3.1 and contract checks. New package `@quickben/openapi`: `generateOpenApi(config, options)` documents custom endpoints (schemas from Zod, shared through `components/schemas` by `.meta({ id })`) and, opt-in, the CRUD routes of collections marked `api: { openapi: true }`; `diffOpenApi` classifies changes as breaking or not; `createOpenApiHandler` serves the document. The `quickben-openapi` CLI runs `generate` (with `--check` for stale files) and `diff`. Core adds the `api` collection option, `operationId` on endpoints and `securitySchemes` on auth adapters (`devAuth`, `firebaseAuth`, `betterAuthAdapter` describe theirs). `createRouteHandlers(config, { openapi: { serve: true } })` serves `GET /openapi.json`.
