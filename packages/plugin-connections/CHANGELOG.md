# @quickben/plugin-connections

## 0.4.1

No changes in this release.

## 0.4.0

### Minor Changes

- 932d404: Doc reader: what the first app on it needed.
  
  - Field keys may be camelCase words joined by `.` (`vehicle.make`). `nestValues` and `flattenValues` convert between dotted keys and nested JSON; `importSamples` reads nested expected values by dotted key.
  - `vision-llm` options: `includeText` and `textBoxes` (send the PDF's text layer with the images), `maxOutputTokens`, `temperature` (`null` sends none), `reasoning`, `providerOptions` (e.g. `{ anthropic: { effort: "low" } }`), `output` (`structured` or `json`), `groupSize` and `repair`.
  - Connections by name: steps and variants take `connection` instead of `connectionId`. New option `resolveConnectionId`, provided by `connectionModels()`. Connections: `findConnectionIdByName`.
  - Variants take `options` with the `vision-llm` options above.
  - Extractor context has `qb` and `user`; `runPipeline` takes them.
  - Large types: fields are read in groups (default 24 with structured outputs), in parallel, with cost added up. A group whose schema the provider refuses as too large is split, then asked as plain JSON.
  - Repairs: fields missing, invalid, or required and empty are asked again once by default (`repair`). Attempts record `repairs`; run metrics add `repaired`, `repairs` and `stepErrors`. A structured reply that fails the schema keeps its valid fields.
  - Provider errors show their HTTP status and fixed diagnostics for recognized schema-size or token-limit errors. Raw messages are never persisted because they may echo credentials.
  - Types in `types` that changed in the code become a draft (never touching the published version), logged as `type-changed-in-code` and shown in the admin.
  
  **Migration**
  
  - Types with more than 24 fields on a model with structured outputs now make one call per group of 24 fields. Set `groupSize` to the field count to keep one call, or `output: "json"`.
  - `repair` defaults to 1: a reading with missing or invalid fields, or required fields left empty, makes one more call and costs more. Set `repair: 0` to keep one call.
  - A provider error that is not a timeout, 429 or 5xx is no longer `transient`: test runs do not retry it and score the sample as read. The error text now starts with `the model provider rejected the request` and adds the status and message.
  - A changed type in `types` now creates a draft at start. Before, the change was ignored.
  - `visionConfigSchema.connectionId` is optional; a step needs `connectionId` or `connection`.
- df2049b: Doc reader: evaluate document types on datasets of hundreds or thousands of samples.
  
  - Samples get a `split` (`dev`, `validation`, `test`, `unseen`), a `group` and `attributes`. `splitSamples` splits them from a saved seed, stratified, with unseen groups; a new split is a new version (`resplit: true`).
  - `importSamples` adds or updates samples by key, with an optional mapping of nested expected JSON. `@quickben/plugin-doc-reader/node` reads folders and manifests. New CLI: `quickben-doc-reader import | split | run | export`.
  - `startTestRun` takes `split`, `heldOut`, `concurrency`, `maxCostUsd`, `retries`, `baseline` and up to 8 variants of version, connection and model. Samples go through the runner's queue. Provider failures are retried and counted apart.
  - Runs keep `metrics`: right, wrong, missed and hallucinated by field, group, attribute and split; p50/p95 latency and wall time; tokens and cost per document, cached input included. `compareTestRuns`, `exportTestRun` (CSV, JSON). Fields with `scored: false` are reported, not counted. Empty values are configurable per type (`evaluation.emptyValues`).
  - Once a type is split, publishing needs a `validation` run no worse than the published version (`evaluation.gate`), then runs `test` and `unseen` and stores them on the version. Few-shot `examples` must be `dev` samples.
  - Admin: test bench by split, run options, metrics, run comparison with the cases that got worse, publish check, history, and a sample view with each field drawn on the page.
  - Connections: models take `cachedInputPerMTokUsd`; `callCost` takes cached input tokens.
  
  **Migration**
  
  - New collections `doc-splits`, `doc-test-results` and `doc-eval-claims`, and new fields on `doc-samples`, `doc-test-runs`, `doc-types` and `doc-usage`. With `@quickben/db-drizzle`, regenerate the schema and migrate.
  - Test runs now read their samples through the runner. With `bullmqRunner`, a worker process must be running for test runs to progress, as for readings.
  - `Variant.connectionId` is optional and `Variant.version` is new. Code that reads `run.variant.connectionId` must handle `undefined`.
  - `summarize` returns more keys; `FieldCheck` and `SampleResult` have new optional keys.
  - A vision-LLM provider error or timeout now has `problems.transient: true`.
  - Types that are not split publish as before.
  
  - Evaluations claim each sample before calling providers, so repeated queue delivery cannot bill it twice. Dataset changes and publication share durable locks. If a process crashes while holding a dataset lock, confirm it has stopped before deleting that `dataset:<type>` claim through the trusted local API; item claims must never be cleared to retry uncertain provider calls. Interrupted runs should be replaced with a new run. Published examples use private file copies and their source samples must remain in dev on resplit.

### Patch Changes

- 6d8e9cb: Connection and credential pages use the width they have. The form takes the free width and the status card stays 17rem; under 84rem of container width (an admin embedded in a host's settings column) the status card goes under the form. The models row editor sizes its inputs to their content: id and name columns share the free width, numbers and checkboxes stay narrow, headers wrap. It scrolls only when the columns still do not fit. The page header has the provider mark (a key on credential pages) next to the title, the provider under it, and the actions on the same line. New CSS classes in `@quickben/admin/styles.css`: `qb-detail` and `qb-detail-columns`.
- Updated dependencies [932d404]
- Updated dependencies [6d8e9cb]
- Updated dependencies [42af925]
  - @quickben/admin@0.4.0
  - @quickben/core@0.4.0
  - @quickben/next@0.4.0

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
