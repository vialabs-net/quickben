---
"@quickben/core": patch
"@quickben/next": patch
"create-quickben": patch
---

Custom endpoints: `defineEndpoint`, `reply` and `endpointFactory` in `@quickben/core`, `defineConfig({ endpoints })` and `definePlugin({ endpoints })`, and `handleEndpointRequest` in the new `@quickben/core/http` entry point. Endpoints are typed from Zod schemas, versioned under `/vN`, can be deprecated (`Deprecation` and `Sunset` headers) and run in a transaction with `transactional: true`. `createRouteHandlers` serves them before the CRUD routes and returns a `PUT` handler. The app template exports `PUT`.
