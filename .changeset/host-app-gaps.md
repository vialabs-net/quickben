---
"@quickben/core": patch
"@quickben/next": patch
"@quickben/auth-firebase": patch
"@quickben/plugin-connections": patch
"@quickben/plugin-tenancy": patch
"@quickben/plugin-templates": patch
"@quickben/plugin-doc-reader": patch
---

Gaps found by the first real host app, all additive:

- `@quickben/core`: `customAuth({ getUser })` and `chainAuth(...adapters)` (first user wins; `null` or `UnauthorizedError` moves to the next adapter). `ctx.preserveTimestamps` with `overrideAccess: true` keeps `createdAt` and `updatedAt` from the input, for imports. `defineCollection({ trackAuthor: true })` adds `createdBy` and `updatedBy`, set from `ctx.user.id`. `pluginState(id)` keeps per-config plugin state on `globalThis`.
- `@quickben/next`: imports `next/headers.js` and `next/server.js`, so the built package loads in plain Node ESM.
- `@quickben/auth-firebase`: `session: { read(req) → uid | null, loadUser? }` resolves the host's own session instead of the Firebase session cookie. Bearer ID tokens still work. Firebase SDK service and permission errors propagate instead of allowing a later auth adapter to authenticate the request.
- `@quickben/plugin-connections`: `connections({ modelSchema: (base) => base.extend({ … }) })` adds keys to LLM model entries; `ModelOf<typeof plugin>` types them in `resolveLanguageModel`.
- Tenancy, templates, doc reader and connections: plugin state survives dev hot reloads.
