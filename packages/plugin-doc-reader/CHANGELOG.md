# @quickben/plugin-doc-reader

## 0.4.2

### Patch Changes

- f79a6ba: Dataset review. Fields take comparison rules as data (`compare`: ignore accents, ignore punctuation, equivalents, minimum similarity); a read equal only under them scores the new outcome `near`, counted as right and reported apart (`near` in metrics). Fields of `origin: "system"` are never sent to extractors and never scored. `rescoreTestRun` (and the CLI's `rescore`) scores an earlier run again with today's rules and expected values, without reading, as a new `rescore` run that never counts for publishing. Corrections of expected values are logged in `doc-corrections` (`correctExpected`, `correctExpectedBulk`, `markSystemField`, `listCorrections`, `exportCorrections`, `applyCorrections`), and `importSamples` keeps them on re-import. `findSuspects` lists expected values that look wrong: constant in a group, read value in the PDF text but not the expected one, expected value not in the text, and the same difference on several samples. Types without the new options score as before.
- 59a866b: Evidence boxes: when the read value is not in the PDF text, the value after the label in the model's evidence (`Tipo de Combustible : Gasolina` → `Gasolina`) is searched before the whole evidence, so the box lands on the printed value instead of the model's guess.
- 70edc4a: Review helpers score a run's reads live: `sampleFieldViews` uses today's expected value and the definition's rules (the run's expected value stays as `runExpected`), and `errorsBySample` and `runProblems` take `current` (a definition and expected values by sample) to do the same. New `liveResults`.
- 3950de6: `phone` fields take a default country (`phoneCountry`, ISO 3166): read and expected values become E.164 (`+56912345678`) before they are compared, and extractors return E.164. Numbers that do not fit the country's plan stay as digits. Fields take their own `emptyValues` (e.g. a system placeholder `1`). `correctExpectedBulk` accepts `values` by sample id, so each sample can get its own value.
- fcc0899: A re-score of a re-scored run points `rescoredFrom` at the run that read, not at the intermediate re-score.
- 67c04d6: Headless helpers for apps that build their own review UI on test runs: `listTestRunHeads` (runs without results), `sampleFieldViews` (a sample's fields with the expected value saved now, the read value, status and evidence box), `fieldStatus`, `isWrongStatus`, `sampleErrors`, `errorsBySample`, `runProblems`, `pickSampleRun` and `isHeldOutSplit`. The admin's sample view uses the same status rules.

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

- Updated dependencies [932d404]
- Updated dependencies [6d8e9cb]
- Updated dependencies [932d404]
- Updated dependencies [df2049b]
- Updated dependencies [42af925]
  - @quickben/admin@0.4.0
  - @quickben/plugin-connections@0.4.0
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
- 102d4f2: Files and storage adapters.
  
  - `@quickben/core`: `StorageAdapter` (`put`, `get`, `getBytes`, `head`, `delete`, optional `signedUrl`), `assertStorageKey`, `memoryStorage`, `sniffMime`, `detectMime`. Config `storage`. `fields.file({ accept, maxBytes, storage })` stores `{ key, name, mime, size, sha256 }`; uploads are checked by their first bytes. Replaced and deleted files are removed after the commit; files of a rolled-back transaction are removed. `qb.readFile(slug, id, field, ctx)` follows read access.
  - `@quickben/db-drizzle`: file fields are JSON columns.
  - `@quickben/next`: `POST` and `PATCH` accept `multipart/form-data` (`_payload` JSON part, one part per file field, `maxUploadBytes`). `GET /:collection/:id/:field` streams a file. `_meta` describes `accept` and `maxBytes`.
  - `@quickben/admin`: file input with image and PDF preview, size check and a remove checkbox. Option `apiBasePath` (default `/api`).
  - `@quickben/storage-local`, `@quickben/storage-gcs`, `@quickben/storage-s3`: new storage adapters. The cloud SDKs are optional peer dependencies.
  - `@quickben/plugin-doc-reader`: `files` takes a `StorageAdapter`; the default is the config `storage`, else memory. `FileStore`, `memoryFileStore` and `localFileStore` are deprecated and still work.
  - `@quickben/plugin-templates`: brands have a `logoFile` file field (option `storage`, default the config `storage`). Without storage the brand form keeps the old `data:` URL `logo`. `migrateBrandLogos(qb)` moves old logos to `logoFile`.
  
  Not breaking for existing apps. The `brands` collection gets a `logoFile` column: run your migration tool if you do not use `push`. Admin uploads go through server actions, whose body limit is 1 MB by default (`experimental.serverActions.bodySizeLimit`).

### Patch Changes

- Updated dependencies [2aa9bd5]
- Updated dependencies [66c95ed]
- Updated dependencies [102d4f2]
- Updated dependencies [1396c30]
  - @quickben/core@0.3.0
  - @quickben/next@0.3.0
  - @quickben/admin@0.3.0
  - @quickben/plugin-connections@0.3.0

## 0.2.0

### Minor Changes

- 56a76c0: New `@quickben/plugin-doc-reader`: versioned document types, a pipeline of text-layer (regex templates, reader functions) and vision-LLM extractors (AI SDK, prices from the connection), a test bench with model comparison, monthly budgets and a platform cap, usage reports, a job queue with an in-process runner and a BullMQ runner (`@quickben/plugin-doc-reader/bullmq`), models from `@quickben/plugin-connections` (`@quickben/plugin-doc-reader/connections`), and an admin extension (`@quickben/plugin-doc-reader/admin`).

### Patch Changes

- @quickben/admin@0.2.0
  - @quickben/core@0.2.0
  - @quickben/next@0.2.0
  - @quickben/plugin-connections@0.2.0
