# @quickben/plugin-doc-reader

Document reading for [Quickben](https://quickben.vialabs.net): versioned document types, a pipeline of extractors (PDF text layer, vision LLM, your own), a test bench, monthly budgets, usage and a job queue.

```sh
pnpm add @quickben/plugin-doc-reader ai
```

```ts
import { defineConfig } from "@quickben/core";
import { docReader } from "@quickben/plugin-doc-reader";
import { localFileStorage } from "@quickben/storage-local";

export default defineConfig({
  db,
  collections: [],
  plugins: [
    docReader({
      files: localFileStorage({ root: "./uploads" }), // default: the config storage
      resolveModel, // see "Models"
      types: [invoice], // optional: types shipped with your code
    }),
  ],
});
```

```ts
import { getReading, readDocument } from "@quickben/plugin-doc-reader";

const reading = await readDocument(qb, { type: "invoice", file, wait: 10_000 }, ctx);
reading.fields.total; // { value: "1234.5", confidence: 0.9, evidence: { page: 1, text, box } }

const later = await getReading(qb, reading.id, ctx);
```

## What the plugin adds

| Collection         | Holds                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| `doc-types`        | One row per type version: `draft` or `published`, with its definition. |
| `doc-samples`      | Test documents of a type, with the values they should read to.         |
| `doc-test-runs`    | Test bench runs: per sample and field, expected vs read.               |
| `doc-test-results` | One row per sample of a run, written as the run reads it.              |
| `doc-splits`       | Split versions of a type's samples: seed, ratios, counts.              |
| `doc-jobs`         | Readings: state, result, attempts, cost.                               |
| `doc-usage`        | One row per paid extractor call: tokens, pages, cost.                  |
| `doc-quotas`       | Monthly USD budgets per tenant, and the platform cap (tenant `*`).     |

All collections are hidden from the generic admin. `@quickben/plugin-doc-reader/admin` adds their pages.

## Document types

```ts
const invoice: DocumentTypeInput = {
  key: "invoice",
  version: 1,
  label: "Invoice",
  fields: [
    { key: "number", label: "Invoice number", type: "text", required: true, transform: "compact" },
    { key: "issuedOn", label: "Issue date", type: "date", required: true },
    { key: "total", label: "Total", type: "number" },
  ],
  params: [{ key: "issuerIds", label: "Issuer ids", type: "string-list", excludes: ["buyerId"] }],
  classification: { text: ["INVOICE"], fileName: ["invoice"] },
  pipeline: {
    steps: [
      { extractor: "text-layer", config: { template: "invoice" } },
      { extractor: "vision-llm", config: { connectionId: "openai-main", model: "gpt-vision" } },
    ],
    threshold: 0.8,
    stopWhen: "required",
  },
};
```

| Field type | Stored value                                                     |
| ---------- | ---------------------------------------------------------------- |
| `text`     | Whitespace collapsed.                                            |
| `date`     | `YYYY-MM-DD`. `dateOrder: "dmy"` (default) or `"mdy"` for input. |
| `number`   | Plain decimal (`1234.5`). `decimalSeparator: "."` or `","`.      |
| `email`    | Lowercase.                                                       |
| `phone`    | Digits, with `+` when printed.                                   |

Every field also takes `transform` (`upper`, `compact`: uppercase without spaces, dots and dashes) and `pattern` (a regular expression the value must match). A value that fails is dropped, also from a model.

A parameter with `excludes` lists values that can never be the value of those fields, for example the issuer's own tax id.

## Pipeline

Steps run in order. Per field, the first value at or above `threshold` wins. The run stops when the `stopWhen` fields (`required` or `all`) are read, so free steps spare paid ones.

| Extractor    | Cost | Config                                                                                                |
| ------------ | ---- | ----------------------------------------------------------------------------------------------------- |
| `text-layer` | free | `template` (a key of `templates`, or an inline template) or `reader` (a key of `readers`). PDFs only. |
| `vision-llm` | paid | `connectionId`, `model` (default: the connection's), `maxPages`.                                      |
| your own     | any  | Pass `extractors: [{ key, paid, extract }]`.                                                          |

Templates are regular expressions over the text, whitespace collapsed:

```ts
docReader({
  templates: {
    invoice: {
      match: ["INVOICE"],
      fields: { number: [{ pattern: "INVOICE NO\\.? ([A-Z\\d-]+)" }] },
    },
  },
});
```

Results: `OK`, `INCOMPLETE` (required fields missing), `NO_MATCH`, `NO_TEXT`, `ERROR`. Each step is recorded in `attempts`, with `SKIPPED` for paid steps over budget.

## Models

`vision-llm` uses the [AI SDK](https://ai-sdk.dev) (`generateText` with `Output.object`). The plugin never sees a key: `resolveModel` returns a ready model and its prices.

**With `@quickben/plugin-connections`**

```ts
import { connections } from "@quickben/plugin-connections";
import { docReader } from "@quickben/plugin-doc-reader";
import { connectionModels } from "@quickben/plugin-doc-reader/connections";

plugins: [connections({ masterKey }), docReader({ ...connectionModels() })];
```

`connectionModels()` resolves a step's `connectionId` and `model` with `resolveLanguageModel` from `@quickben/plugin-connections/ai`, and lists connections with vision models for the admin. Model prices come from the connection. Connections do not store a page limit: `connectionModels({ maxPages })` sets it (default 4).

**Your own resolver**

```ts
docReader({
  resolveModel: async (connectionId, modelId, qb) => ({
    connection: { id: connectionId, name: "OpenAI" },
    model: {
      id: "gpt-vision",
      vision: true,
      structuredOutput: true,
      maxPages: 4,
      inputPerMTokUsd: 2.5,
      outputPerMTokUsd: 10,
    },
    languageModel: openai("gpt-vision"),
  }),
  listModels: async (qb) => [
    { connectionId: "openai-main", connectionName: "OpenAI", models: [{ id: "gpt-vision" }] },
  ],
});
```

- Cost = tokens × the model's prices per million. Cached input tokens use `cachedInputPerMTokUsd` when the model has it, else the input price. A billed call that returns no fields still records its usage.
- One call per step, no retries, 60 s deadline (`modelTimeoutMs`). Provider errors show a fixed message.
- The answer schema has no nullable or union types: Anthropic rejects schemas with more than 16 union parameters.
- Boxes are read as `x0,y0,x1,y1` in thousandths of the page and stored as fractions 0..1.
- PDF pages are rendered with `unpdf` and the optional peer `@napi-rs/canvas`. In Next.js add `@napi-rs/canvas` to `serverExternalPackages`, or pass your own `rasterize`.

**Example low-cost models**

Prices change; set them in the connection, never in code.

| Provider type in connections                                                  | Model id                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------ |
| `anthropic`                                                                   | `claude-haiku-5-5`                               |
| `openai_compatible` (OpenAI, or a gateway at its `baseUrl`, e.g. LLM Gateway) | `gpt-6-luna`                                     |
| `google` or `vertex`                                                          | `gemini-2.5-flash-lite`, `gemini-3.1-flash-lite` |

A connection model takes `inputPerMTokUsd`, `outputPerMTokUsd` and, optionally, `cachedInputPerMTokUsd`.

**An external extraction service**

Register an extractor that calls your service and returns the fields. Steps name it by `key`, and test runs compare it like any other step.

```ts
import { docReader } from "@quickben/plugin-doc-reader";

import type { Extractor, FieldValue } from "@quickben/plugin-doc-reader";

const external: Extractor = {
  key: "acme-ocr",
  paid: true, // skipped over budget
  async extract(input, type, params, ctx) {
    const response = await fetch(String(ctx.config.url), {
      method: "POST",
      headers: { "content-type": input.mime },
      body: new Blob([new Uint8Array(input.bytes)]),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`); // counted as a failure, retried in test runs
    const body = (await response.json()) as Partial<Record<string, FieldValue>>;
    const fields: Record<string, FieldValue> = {};
    for (const field of type.fields) {
      const value = body[field.key];
      if (value) fields[field.key] = value;
    }
    return {
      status: Object.keys(fields).length > 0 ? "OK" : "NO_MATCH",
      fields,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        pages: 1,
        costUsd: 0.002,
        model: "acme",
        connectionId: "acme",
      },
    };
  },
};

docReader({ extractors: [external] });
// pipeline: { steps: [{ extractor: "acme-ocr", config: { url: "https://ocr.example.com/read" } }] }
```

Test runs normalize expected and read values by field type before comparing them. Return `evidence: { page, text, box }` per field to get boxes in the sample view.

## Running jobs

| Runner                              | Where jobs run                                                          |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `inProcessRunner()`                 | Default. The process that queued them.                                  |
| `inProcessRunner({ defer: after })` | Serverless: Next.js `after` keeps the function alive.                   |
| `bullmqRunner(options)`             | Worker processes, through Redis (`@quickben/plugin-doc-reader/bullmq`). |

With the in-process runner, readings still `queued` at start are queued again and readings `running` for 30 minutes are marked `failed`.

**Separate worker**

```ts filename="quickben.config.ts"
import { bullmqRunner } from "@quickben/plugin-doc-reader/bullmq";

const runner = bullmqRunner({
  connection: { url: process.env.REDIS_URL! },
  worker: process.env.DOC_READER_WORKER === "1" ? { concurrency: 4 } : false,
});
```

```ts filename="worker.ts"
import { getQuickben } from "@quickben/core";

import config from "./quickben.config";

await getQuickben(config); // starts the BullMQ worker; keep the process running
```

Run `DOC_READER_WORKER=1 node worker.js` next to the web app. Both processes use the same database, file store and `prefix`.

## Files

Files are kept in a `StorageAdapter` from `@quickben/core`: `files`, else the config `storage`, else `memoryStorage()` (tests and demos only).

| Deprecated            | Use instead                                                       |
| --------------------- | ----------------------------------------------------------------- |
| `FileStore`           | `StorageAdapter`. A `FileStore` still works in `files`.           |
| `memoryFileStore()`   | `memoryStorage()` from `@quickben/core`.                          |
| `localFileStore(dir)` | `localFileStorage({ root: dir })` from `@quickben/storage-local`. |

Uploads are checked by their first bytes: PDF, JPEG, PNG or WebP, at most `maxFileBytes` (20 MB).

## Studio

| Function                                       | Does                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------- |
| `createDocType(qb, ctx, { key, label })`       | New type as draft v1.                                                             |
| `createDraft(qb, ctx, key, from?)`             | New draft copied from a version. One draft per type.                              |
| `saveDraft(qb, ctx, key, version, def)`        | Save a draft. Published versions never change.                                    |
| `addSample`, `updateSample`, `removeSample`    | Test documents and their expected values.                                         |
| `startTestRun(qb, ctx, key, version, options)` | Test on the samples. See "Evaluating on datasets".                                |
| `publishDraft(qb, ctx, key, version)`          | Needs a finished test run of the draft as it is now; once split, the rules below. |
| `annotateSample(qb, ctx, id, { field, text })` | A note on a sample for prompt work. The editor lists them.                        |

Refusals throw `StudioError` (409) with a `rule`: `type-exists`, `draft-exists`, `published`, `not-tested`, `no-samples`, `changed`, `split-exists`, `held-out`, `not-validated`, `no-baseline`, `gate` (see `reasons`).

## Evaluating on datasets

**1. Import samples.** Keys make imports repeatable: a known key updates its sample and keeps its split.

```ts
import { importSamples } from "@quickben/plugin-doc-reader";
import { loadFolder, loadManifest } from "@quickben/plugin-doc-reader/node";

const report = await importSamples(qb, ctx, "receipt", loadManifest("data/manifest.jsonl"), {
  map: (raw) => ({ total: raw.totals.amount, issuedOn: raw.header.date }), // nested JSON → fields
});
// { created, updated, unchanged, failed: [{ key, error }], unknownFields }
```

| Source               | Format                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `loadManifest(path)` | JSON Lines or a JSON array of `{ file, key?, expected?, group?, attributes?, params?, note? }`. `file` is relative to the manifest. |
| `loadFolder(dir)`    | Every PDF, JPEG, PNG and WebP, with `a.json` next to `a.pdf`: `{ expected, group, attributes }`, or the expected values alone.      |

Expected `null`, `""`, `"-"` and `-1` mean "expected empty" and are stored as the type's first empty value (`-`). An absent key is not checked.

**2. Split.** `dev` is for tuning and few-shot examples, `validation` decides publishing, `test` and `unseen` run only when publishing.

```ts
await splitSamples(qb, ctx, "receipt", {
  seed: "2026-11", // default: random, saved
  ratios: { dev: 0.6, validation: 0.2, test: 0.2 }, // default
  stratifyBy: ["group", "hasTextLayer"], // default ["group"]
  unseenGroups: ["issuer-42"], // all their samples go to unseen
});
```

The same seed and samples give the same split. A second call needs `resplit: true` and makes a new version. Samples added later get a split from a hash of their key; existing samples do not move.

**3. Run.** Samples go through the runner (in process or BullMQ), `concurrency` at a time.

```ts
const [run] = await startTestRun(qb, ctx, "receipt", 3, {
  split: "validation", // default: every sample outside test and unseen
  concurrency: 8, // default 3, at most 32
  maxCostUsd: 5, // the rest is skipped
  retries: 1, // provider failures, timeouts and throws
  variants: [{ connectionId: "gw", model: "gpt-6-luna" }, { version: 2 }],
  baseline: true, // also run the published version
});
```

A variant names a version, a connection and model, or both. With a connection the pipeline is that model alone. `test` and `unseen` need `heldOut: true`; each such run is logged (`held-out-run`) with who, when and the version.

**4. Read the metrics.** `getTestRun(...).metrics`:

| Key                                 | Holds                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `global`, `byField`                 | `checked`, `correct`, `correctEmpty`, `wrong`, `missed`, `hallucinated`, `accuracy`. |
| `byGroup`, `bySplit`, `byAttribute` | The same counts per value.                                                           |
| `latency`, `wallMs`                 | Per document `meanMs`, `p50Ms`, `p95Ms`, `maxMs`; the batch's wall time.             |
| `tokens`, `cost`                    | Input, cached input, output; total and per document.                                 |
| `failed`, `retries`, `skipped`      | Counted apart, never as wrong reads.                                                 |

Values are normalized by field type before they are compared. `null`, blank and `evaluation.emptyValues` (default `-`, `-1`) are empty. Fields with `scored: false` are reported but not counted. `compareTestRuns(qb, ctx, a, b)` gives deltas per field, cost and latency, and the cases that got worse. `exportTestRun(qb, ctx, id, "csv" | "json")` writes one row per sample and field.

**5. Publish.** Once a type is split, `publishDraft` needs:

1. A finished run of the draft, as saved, that read `validation` of the current split.
2. When a version is published already, a run of it on the same split (`baseline: true` starts one), and the draft no worse than the type's `evaluation.gate`.
3. Few-shot examples (`examples: [{ sampleId }]`) that are `dev` samples. Saving a draft checks this too.

Publishing then starts runs of `test` and `unseen` and stores them on the version (`getVersion(...).evaluation`). Use `publishCheck(qb, ctx, key, version)` to see the result before publishing.

```ts
evaluation: {
  emptyValues: ["-", "-1"],
  gate: { maxAccuracyDrop: 0.01, maxFieldDrop: 0.05, maxCostIncrease: 0.2, maxLatencyIncrease: null },
},
```

`null` turns a check off. Drops are fractions: `0.01` is one point.

**From a terminal**

```sh
quickben-doc-reader import --config quickben.config.ts --type receipt --manifest data/manifest.jsonl --map map.ts
quickben-doc-reader split  --config quickben.config.ts --type receipt --seed 2026-11 --unseen issuer-42
quickben-doc-reader run    --config quickben.config.ts --type receipt --version 3 --split validation --concurrency 8 --wait
quickben-doc-reader export --config quickben.config.ts --run <id> --format csv --out run.csv # --out stays inside the working directory
```

The CLI runs as trusted server code against the config's database. `--map` names a module whose default export maps expected JSON to fields. TypeScript configs load through `tsx` when the app has it.

## Budgets

| Function                               | Does                                                   |
| -------------------------------------- | ------------------------------------------------------ |
| `setQuota(qb, ctx, tenant, usd)`       | Monthly budget of a tenant. `0`: no paid reads.        |
| `setPlatformCap(qb, ctx, usd \| null)` | Cap for all paid reads, including test runs.           |
| `quotaStatus(qb, tenant)`              | Spend and limits this month (UTC).                     |
| `usageReport(qb, ctx, "2026-11")`      | Totals by tenant, model and type, and a 6-month trend. |

A reading checks budgets once, before it starts. At 100 % paid steps are skipped; free steps still run.

## Access

| Collection                                                | Default                                                                                                  |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `doc-types`, `doc-samples`, `doc-test-runs`, `doc-quotas` | Staff only.                                                                                              |
| `doc-jobs`                                                | Signed-in users create and read their own; staff read all and retry or cancel. Replace with `jobAccess`. |
| `doc-usage`                                               | Staff read. Only the plugin writes.                                                                      |

Staff: `isStaff(user)`, default `user.roles` includes `platform-admin`.

## Multi-tenancy

List `doc-jobs` in `tenancy({ scope })` and put `tenancy()` after `docReader()`. Readings then belong to the active organization and are billed to it. Pass `tenant` to `readDocument` to bill another id.

## Admin

```tsx
import { docReaderAdmin } from "@quickben/plugin-doc-reader/admin";

export default createAdminPage(config, { serverFunction, extensions: [docReaderAdmin(config)] });
```

| Page           | Path                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| Document types | `/admin/document-types`: list, editor, test bench by split, run comparison, publish check, history.     |
| One sample     | `/admin/document-types/<key>/samples/<id>`: read it with a version and model, fields drawn on the page. |
| Readings       | `/admin/document-queue`: filters, one reading with attempts and a file preview.                         |
| Usage          | `/admin/document-usage`: spend, budgets, platform cap.                                                  |

**Sample view**

| Column   | Shows                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------- |
| Samples  | The samples of the run, with their error count. Filter to those with errors.                   |
| Document | Each page, with a box per field: green right, red wrong or missed, dashed below the threshold. |
| Fields   | State (right, wrong, missed, hallucinated, low confidence), value read, confidence.            |

Click a box or a row to see expected against read, the evidence text and page, the pipeline step, and to correct the expected value or leave a note for the prompt. "Read now" starts a one-sample test run with the chosen version and model. An uploaded document is added as a `dev` sample, then read.

Boxes: for a PDF with a text layer, the value (else its evidence text) is looked up in the PDF's text; otherwise the box is the one the vision model returns. Scans always use the model's box.

## Options

| Option                 | Default               | Purpose                                         |
| ---------------------- | --------------------- | ----------------------------------------------- |
| `files`                | config `storage`      | Where uploads and samples are kept.             |
| `runner`               | `inProcessRunner()`   | How jobs reach a worker.                        |
| `resolveModel`         | none                  | Models for `vision-llm` steps.                  |
| `listModels`           | none                  | Model pickers in the admin.                     |
| `templates`, `readers` | none                  | What `text-layer` steps can name.               |
| `extractors`           | none                  | More extractors, or replacements by `key`.      |
| `types`                | none                  | Types added as published versions when missing. |
| `isStaff`              | `platform-admin` role | Platform staff.                                 |
| `jobAccess`            | own readings          | Access rules of `doc-jobs`.                     |
| `maxWaitMs`            | `30000`               | Longest `wait`.                                 |
| `maxFileBytes`         | 20 MB                 | Largest upload.                                 |
| `rasterize`            | unpdf + canvas        | Page images for vision models.                  |
| `modelTimeoutMs`       | `60000`               | Deadline of one model call.                     |
| `testRetryDelayMs`     | `1000`                | Wait before a test run tries a sample again.    |
| `onReadingDone`        | none                  | Called when a reading ends.                     |
| `log`                  | `console.warn`        | Failures that do not fail a reading.            |
