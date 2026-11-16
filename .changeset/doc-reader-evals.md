---
"@quickben/plugin-doc-reader": minor
"@quickben/plugin-connections": minor
---

Doc reader: evaluate document types on datasets of hundreds or thousands of samples.

- Samples get a `split` (`dev`, `validation`, `test`, `unseen`), a `group` and `attributes`. `splitSamples` splits them from a saved seed, stratified, with unseen groups; a new split is a new version (`resplit: true`).
- `importSamples` adds or updates samples by key, with an optional mapping of nested expected JSON. `@quickben/plugin-doc-reader/node` reads folders and manifests. New CLI: `quickben-doc-reader import | split | run | export`.
- `startTestRun` takes `split`, `heldOut`, `concurrency`, `maxCostUsd`, `retries`, `baseline` and up to 8 variants of version, connection and model. Samples go through the runner's queue. Provider failures are retried and counted apart.
- Runs keep `metrics`: right, wrong, missed and hallucinated by field, group, attribute and split; p50/p95 latency and wall time; tokens and cost per document, cached input included. `compareTestRuns`, `exportTestRun` (CSV, JSON). Fields with `scored: false` are reported, not counted. Empty values are configurable per type (`evaluation.emptyValues`).
- Once a type is split, publishing needs a `validation` run no worse than the published version (`evaluation.gate`), then runs `test` and `unseen` and stores them on the version. Few-shot `examples` must be `dev` samples.
- Admin: test bench by split, run options, metrics, run comparison with the cases that got worse, publish check, history, and a sample view with each field drawn on the page.
- Connections: models take `cachedInputPerMTokUsd`; `callCost` takes cached input tokens.

**Migration**

- New collections `doc-splits` and `doc-test-results`, and new fields on `doc-samples`, `doc-test-runs`, `doc-types` and `doc-usage`. With `@quickben/db-drizzle`, regenerate the schema and migrate.
- Test runs now read their samples through the runner. With `bullmqRunner`, a worker process must be running for test runs to progress, as for readings.
- `Variant.connectionId` is optional and `Variant.version` is new. Code that reads `run.variant.connectionId` must handle `undefined`.
- `summarize` returns more keys; `FieldCheck` and `SampleResult` have new optional keys.
- A vision-LLM provider error or timeout now has `problems.transient: true`.
- Types that are not split publish as before.
