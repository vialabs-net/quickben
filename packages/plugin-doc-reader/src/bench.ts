/**
 * The test bench: test runs of a type version over its samples, at any scale.
 *
 * A run is a list of samples and a definition. Its samples go through the runner's queue (the
 * in-process runner or BullMQ), `concurrency` at a time: item `n` queues item
 * `n + concurrency` when it ends, so no counter is shared between workers. Each sample's result
 * is its own row in `doc-test-results`; the item that writes the last row writes the summary,
 * the metrics and the results on the run.
 *
 * A sample whose extractors failed for a reason outside the document (provider error, timeout,
 * a throw) is tried again `retries` times, then counted as `failed`, never as a wrong read.
 * When the run has spent `maxCostUsd`, the remaining samples are `skipped`.
 */
import { NotFoundError, ValidationError } from "@quickben/core";
import { z } from "zod";

import {
  DOC_SAMPLES,
  DOC_TEST_RESULTS,
  DOC_TEST_RUNS,
  DOC_TYPES,
  HELD_OUT_SPLITS,
  SPLITS,
} from "./collections";
import { StudioError } from "./errors";
import { loadExamples } from "./examples";
import { VISION_LLM } from "./extractors/vision-llm";
import { checkFields, compareResults, resultsToCsv, runMetrics, summarize } from "./metrics";
import { getDocReader } from "./options";
import { attemptsCost, isTransientFailure, runPipeline } from "./pipeline";
import { recordUsage, skipHook } from "./quotas";
import { currentSplit } from "./splits";
import { findAll, newRevision, toDefinition, SYSTEM, versionKey } from "./store";

import type { RunPurpose, Split } from "./collections";
import type { DocumentType, Pipeline } from "./definition";
import type { ExtractorExample } from "./extractor";
import type { RunComparison, RunMetrics, RunSummary, SampleResult } from "./metrics";
import type { PipelineResult } from "./pipeline";
import type { DocTypeRecord, SampleRecord, TestRunRecord } from "./records";
import type { Quickben, RequestContext } from "@quickben/core";

/** Default samples read at the same time per run. */
export const DEFAULT_CONCURRENCY = 3;
/** Most samples read at the same time per run. */
export const MAX_CONCURRENCY = 32;
/** A run with no result for this long belongs to a process that is gone. */
const STALE_MS = 30 * 60 * 1000;
/** Job ids of test-run items start with this, so the plugin's processor can tell them apart. */
export const TEST_RUN_JOB = "testrun.";

const actorOf = (ctx: RequestContext) => ctx.user?.email ?? ctx.user?.id ?? null;

function zodIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

// ---------------------------------------------------------------------------------------------
// Variants and runs

/**
 * What a run varies: another version of the type, a connection and model, or both. With a
 * connection the pipeline is that model alone, so a free step that reads a document first does
 * not hide the difference.
 */
export const variantSchema = z
  .object({
    version: z.number().int().min(1).optional(),
    connectionId: z.string().trim().min(1).max(200).optional(),
    model: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => v.version !== undefined || v.connectionId !== undefined, {
    message: "A variant names a version, a connection or both",
  })
  .refine((v) => v.model === undefined || v.connectionId !== undefined, {
    message: "A model needs its connection",
    path: ["model"],
  });
export type Variant = z.infer<typeof variantSchema>;

export interface TestRun {
  readonly id: string;
  readonly typeKey: string;
  readonly typeVersion: number;
  readonly typeRevision: string;
  readonly compareGroup: string | null;
  readonly variant: Variant | null;
  readonly state: "running" | "done" | "failed";
  readonly results: SampleResult[];
  readonly summary: RunSummary | null;
  readonly error: string | null;
  readonly costUsd: number;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  /** Splits the samples came from; `null`: chosen by id, or the type is not split. */
  readonly splits: Split[] | null;
  readonly splitVersion: number | null;
  readonly heldOut: boolean;
  readonly purpose: RunPurpose;
  /** Samples in the run. */
  readonly total: number;
  readonly concurrency: number;
  readonly maxCostUsd: number | null;
  readonly retries: number;
  readonly metrics: RunMetrics | null;
}

export const toRun = (record: TestRunRecord): TestRun => ({
  id: record.id,
  typeKey: record.typeKey,
  typeVersion: record.typeVersion,
  typeRevision: record.typeRevision,
  compareGroup: record.compareGroup,
  variant: record.variant,
  state: record.state,
  results: record.results,
  summary: record.summary,
  error: record.error,
  costUsd: record.costUsd,
  createdBy: record.createdBy,
  createdAt: record.createdAt,
  finishedAt: record.finishedAt,
  splits: record.splits ?? null,
  splitVersion: record.splitVersion ?? null,
  heldOut: record.heldOut === true,
  purpose: record.purpose ?? "bench",
  total: record.total ?? record.results.length,
  concurrency: record.concurrency ?? DEFAULT_CONCURRENCY,
  maxCostUsd: record.maxCostUsd ?? null,
  retries: record.retries ?? 0,
  metrics: record.metrics ?? null,
});

/** The pipeline of a variant with a connection: that model alone. */
export function variantPipeline(
  pipeline: Pipeline,
  variant: Pick<Variant, "connectionId" | "model">,
): Pipeline {
  if (variant.connectionId === undefined) return pipeline;
  const current = pipeline.steps.find((step) => step.extractor === VISION_LLM);
  const config = Object.fromEntries(
    Object.entries(current?.config ?? {}).filter(([key]) => key !== "model"),
  );
  return {
    ...pipeline,
    steps: [
      {
        extractor: VISION_LLM,
        config: {
          ...config,
          connectionId: variant.connectionId,
          ...(variant.model ? { model: variant.model } : {}),
        },
      },
    ],
  };
}

async function versionRecord(
  qb: Quickben,
  ctx: RequestContext,
  key: string,
  version: number,
): Promise<DocTypeRecord> {
  const page = await qb.find(
    DOC_TYPES,
    { where: { versionKey: { eq: versionKey(key, version) } }, limit: 1 },
    ctx,
  );
  const record = page.docs[0] as unknown as DocTypeRecord | undefined;
  if (!record) throw new NotFoundError(`Document type ${versionKey(key, version)} not found`);
  return record;
}

const splitList = z.union([z.enum(SPLITS), z.array(z.enum(SPLITS)).min(1).max(4)]);

export const startTestRunSchema = z.object({
  sampleIds: z.array(z.string()).max(100_000).optional(),
  variants: z.array(variantSchema).max(8).optional(),
  /** Splits to read. Default: every sample outside `test` and `unseen`. */
  split: splitList.optional(),
  /** Allow `test` and `unseen` samples. Each such run is recorded with who, when and what. */
  heldOut: z.boolean().optional(),
  concurrency: z.number().int().min(1).max(MAX_CONCURRENCY).optional(),
  /** Stop reading when the run has cost this much (USD). The rest is `skipped`. */
  maxCostUsd: z.number().min(0).optional(),
  /** Tries after the first one when the provider fails. Default 1. */
  retries: z.number().int().min(0).max(5).optional(),
  /**
   * Also run the published version on the same samples, as the reference of the publish check.
   * Only when testing a draft that has a published version.
   */
  baseline: z.boolean().optional(),
});

export interface StartTestRunInput {
  /** Default: the samples of `split`. */
  readonly sampleIds?: readonly string[];
  /** Empty: the version as it is. Several: one run each, to compare. */
  readonly variants?: readonly Variant[];
  /** Splits to read. Default: every sample outside `test` and `unseen`. */
  readonly split?: Split | readonly Split[];
  /** Allow `test` and `unseen` samples. Each such run is recorded. */
  readonly heldOut?: boolean;
  /** Samples read at the same time. Default 3, at most 32. */
  readonly concurrency?: number;
  /** Stop when the run has cost this much (USD). The rest is `skipped`. */
  readonly maxCostUsd?: number;
  /** Tries after the first when the provider fails. Default 1. */
  readonly retries?: number;
  /** Also run the published version on the same samples (purpose `baseline`). */
  readonly baseline?: boolean;
}

interface Selection {
  readonly samples: SampleRecord[];
  readonly splits: Split[] | null;
  readonly splitVersion: number | null;
  readonly heldOut: boolean;
}

async function selectSamples(
  qb: Quickben,
  ctx: RequestContext,
  key: string,
  input: z.infer<typeof startTestRunSchema>,
  internal: boolean,
): Promise<Selection> {
  const split = await currentSplit(qb, ctx, key);
  const all = await findAll<SampleRecord>(qb, DOC_SAMPLES, { typeKey: { eq: key } }, ctx, {
    sort: "createdAt",
  });
  let splits: Split[] | null = null;
  let samples = all;
  if (input.split !== undefined) {
    splits = typeof input.split === "string" ? [input.split] : [...new Set(input.split)];
    const wanted = new Set<string>(splits);
    samples = samples.filter((sample) => sample.split && wanted.has(sample.split));
  } else if (split && !input.sampleIds) {
    splits = (["dev", "validation"] as Split[]).filter((s) => all.some((x) => x.split === s));
    samples = samples.filter((sample) => !HELD_OUT_SPLITS.includes(sample.split as Split));
  }
  if (input.sampleIds) {
    const ids = new Set(input.sampleIds);
    samples = samples.filter((sample) => ids.has(sample.id));
  }
  const heldOut = samples.some((sample) => HELD_OUT_SPLITS.includes(sample.split as Split));
  if (heldOut && input.heldOut !== true && !internal) {
    throw new StudioError(
      "held-out",
      "test and unseen samples run when publishing; pass heldOut to run them now",
    );
  }
  if (samples.length === 0)
    throw new StudioError("no-samples", "Add samples before running a test");
  return { samples, splits, splitVersion: split?.version ?? null, heldOut };
}

interface Launch {
  readonly record: DocTypeRecord;
  readonly variant: Variant | null;
  readonly purpose: RunPurpose;
  readonly compareGroup: string | null;
}

async function launch(
  qb: Quickben,
  ctx: RequestContext,
  run: Launch,
  selection: Selection,
  options: z.infer<typeof startTestRunSchema>,
): Promise<TestRun> {
  const state = getDocReader(qb);
  const type = toDefinition(run.record);
  const pipeline = run.variant ? variantPipeline(type.pipeline, run.variant) : type.pipeline;
  const concurrency = Math.min(
    options.concurrency ?? DEFAULT_CONCURRENCY,
    selection.samples.length,
  );
  const created = (await qb.create(
    DOC_TEST_RUNS,
    {
      typeKey: run.record.key,
      typeVersion: run.record.version,
      typeRevision: run.record.revision,
      compareGroup: run.compareGroup,
      variant: run.variant,
      pipeline,
      definition: { ...type, pipeline },
      splits: selection.splits,
      splitVersion: selection.splitVersion,
      heldOut: selection.heldOut,
      purpose: run.purpose,
      sampleIds: selection.samples.map((sample) => sample.id),
      total: selection.samples.length,
      concurrency,
      maxCostUsd: options.maxCostUsd ?? null,
      retries: options.retries ?? 1,
      createdBy: actorOf(ctx),
    },
    ctx,
  )) as unknown as TestRunRecord;
  if (selection.heldOut) {
    state.log("held-out-run", {
      runId: created.id,
      type: versionKey(run.record.key, run.record.version),
      splits: selection.splits,
      by: actorOf(ctx),
      purpose: run.purpose,
    });
  }
  for (let lane = 1; lane <= concurrency; lane += 1) {
    await state.runner.enqueue(`${TEST_RUN_JOB}${created.id}`, lane);
  }
  return toRun(created);
}

/**
 * Start test runs of a version: one run, or one per variant to compare. Returns at once; the
 * samples are read through the runner (poll `getTestRun`).
 */
export async function startTestRun(
  qb: Quickben,
  ctx: RequestContext,
  key: string,
  version: number,
  input: StartTestRunInput = {},
): Promise<TestRun[]> {
  return startRuns(qb, ctx, key, version, input, "bench");
}

/** `startTestRun` with a purpose; publishing uses it for the held-out runs. */
export async function startRuns(
  qb: Quickben,
  ctx: RequestContext,
  key: string,
  version: number,
  input: StartTestRunInput,
  purpose: RunPurpose,
): Promise<TestRun[]> {
  const parsed = startTestRunSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodIssues(parsed.error));
  const options = parsed.data;
  const record = await versionRecord(qb, ctx, key, version);
  const selection = await selectSamples(qb, ctx, key, options, purpose === "publish");

  const variants = options.variants ?? [];
  const list: (Variant | null)[] = variants.length > 0 ? variants : [null];
  const records = new Map<number, DocTypeRecord>([[version, record]]);
  for (const variant of list) {
    if (variant?.version !== undefined && !records.has(variant.version)) {
      records.set(variant.version, await versionRecord(qb, ctx, key, variant.version));
    }
  }
  let baseline: DocTypeRecord | undefined;
  if (options.baseline === true && record.state === "draft") {
    const versions = await findAll<DocTypeRecord>(
      qb,
      DOC_TYPES,
      { key: { eq: key }, state: { eq: "published" } },
      ctx,
      { sort: "-version" },
    );
    baseline = versions[0];
  }
  const count = list.length + (baseline ? 1 : 0);
  const compareGroup = count > 1 ? newRevision() : null;
  const runs: TestRun[] = [];
  for (const variant of list) {
    const target = records.get(variant?.version ?? version) ?? record;
    runs.push(
      await launch(qb, ctx, { record: target, variant, purpose, compareGroup }, selection, options),
    );
  }
  if (baseline) {
    runs.push(
      await launch(
        qb,
        ctx,
        { record: baseline, variant: null, purpose: "baseline", compareGroup },
        selection,
        options,
      ),
    );
  }
  return runs;
}

// ---------------------------------------------------------------------------------------------
// Reading one sample

interface Tried {
  readonly result: PipelineResult;
  readonly retries: number;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
}

const wait = (ms: number) =>
  ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

async function tryPipeline(
  qb: Quickben,
  run: TestRunRecord,
  type: DocumentType,
  sample: SampleRecord,
  bytes: Uint8Array,
  examples: readonly ExtractorExample[],
): Promise<Tried> {
  const state = getDocReader(qb);
  const limit = run.retries ?? 0;
  const totals = { costUsd: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  for (let attempt = 0; ; attempt += 1) {
    // Test runs count against the platform cap only.
    const skip = await skipHook(qb, null, state.log);
    const started = Date.now();
    const result = await runPipeline({
      type,
      input: { bytes, mime: sample.mime, pages: type.pages },
      params: sample.params,
      tenant: null,
      extractors: state.extractors,
      ...(skip ? { skip } : {}),
      ...(examples.length > 0 ? { examples } : {}),
    });
    const durationMs = Date.now() - started;
    await recordUsage(
      qb,
      { tenant: null, testRun: run.id, typeKey: type.key, typeVersion: type.version },
      result.attempts,
    ).catch((error: unknown) => {
      state.log("usage-failed", { testRun: run.id, error: String(error) });
    });
    totals.costUsd += attemptsCost(result.attempts);
    for (const step of result.attempts) {
      totals.inputTokens += step.usage?.inputTokens ?? 0;
      totals.cachedInputTokens += step.usage?.cachedInputTokens ?? 0;
      totals.outputTokens += step.usage?.outputTokens ?? 0;
    }
    if (!isTransientFailure(result) || attempt >= limit) {
      return {
        result,
        retries: attempt,
        ...totals,
        costUsd: Math.round(totals.costUsd * 1e6) / 1e6,
        durationMs,
      };
    }
    await wait(state.retryDelayMs * (attempt + 1));
  }
}

function sampleBase(sample: SampleRecord) {
  return {
    sampleId: sample.id,
    fileName: sample.fileName,
    sampleKey: sample.sampleKey ?? null,
    split: sample.split ?? null,
    group: sample.group ?? null,
    attributes: sample.attributes ?? {},
  };
}

async function readSample(
  qb: Quickben,
  run: TestRunRecord,
  type: DocumentType,
  sample: SampleRecord,
  examples: readonly ExtractorExample[],
): Promise<SampleResult> {
  const state = getDocReader(qb);
  const base = sampleBase(sample);
  const bytes = await state.files.getBytes(sample.fileRef);
  if (!bytes) {
    return {
      ...base,
      status: "ERROR",
      durationMs: 0,
      costUsd: 0,
      fields: checkFields(type, sample.expected, { fields: {} }),
      error: "file not found",
      failed: true,
    };
  }
  const tried = await tryPipeline(qb, run, type, sample, bytes, examples);
  const { result } = tried;
  // Without this a failed step (a provider rejecting the request) shows only "ERROR".
  const errors = result.attempts
    .map((attempt) => attempt.problems?.error)
    .filter((error): error is string => typeof error === "string" && error.length > 0);
  return {
    ...base,
    status: result.status,
    durationMs: tried.durationMs,
    costUsd: tried.costUsd,
    inputTokens: tried.inputTokens,
    cachedInputTokens: tried.cachedInputTokens,
    outputTokens: tried.outputTokens,
    retries: tried.retries,
    fields: checkFields(type, sample.expected, result),
    ...(isTransientFailure(result) ? { failed: true } : {}),
    ...(errors.length > 0 ? { error: errors.join("; ").slice(0, 500) } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Processing queued items

/** The definition a run reads with: its snapshot, else the stored version. */
async function runType(qb: Quickben, run: TestRunRecord): Promise<DocumentType> {
  if (run.definition) {
    return toDefinition({
      key: run.typeKey,
      version: run.typeVersion,
      state: "draft",
      definition: run.definition,
    });
  }
  const record = await versionRecord(qb, SYSTEM, run.typeKey, run.typeVersion);
  return { ...toDefinition(record), pipeline: run.pipeline as Pipeline };
}

interface ResultRow {
  readonly id: string;
  readonly index: number;
  readonly costUsd: number;
  readonly result: SampleResult;
  readonly createdAt: string;
}

async function spent(qb: Quickben, runId: string): Promise<number> {
  const rows = await findAll<Pick<ResultRow, "costUsd">>(
    qb,
    DOC_TEST_RESULTS,
    { run: { eq: runId } },
    SYSTEM,
    { select: ["costUsd"] },
  );
  return rows.reduce((total, row) => total + row.costUsd, 0);
}

async function writeResult(
  qb: Quickben,
  run: TestRunRecord,
  index: number,
  sampleId: string,
  result: SampleResult,
): Promise<void> {
  try {
    await qb.create(
      DOC_TEST_RESULTS,
      {
        run: run.id,
        index,
        slot: `${run.id}:${String(index)}`,
        sampleId,
        costUsd: result.costUsd,
        result,
      },
      SYSTEM,
    );
  } catch (error) {
    // A second delivery of the same item: the first one's row stands.
    getDocReader(qb).log("test-run-duplicate", { runId: run.id, index, error: String(error) });
  }
}

async function hasResult(qb: Quickben, runId: string, index: number): Promise<boolean> {
  const page = await qb.find(
    DOC_TEST_RESULTS,
    { where: { slot: { eq: `${runId}:${String(index)}` } }, limit: 1, select: ["id"] },
    SYSTEM,
  );
  return page.docs.length > 0;
}

async function processItem(
  qb: Quickben,
  run: TestRunRecord,
  type: DocumentType,
  index: number,
): Promise<void> {
  const state = getDocReader(qb);
  const sampleId = run.sampleIds?.[index];
  if (sampleId === undefined || (await hasResult(qb, run.id, index))) return;
  const sample = (await qb
    .findById(DOC_SAMPLES, sampleId, {}, SYSTEM)
    .catch(() => null)) as unknown as SampleRecord | null;
  if (!sample) {
    await writeResult(qb, run, index, sampleId, {
      sampleId,
      fileName: "",
      status: "ERROR",
      durationMs: 0,
      costUsd: 0,
      fields: [],
      error: "sample removed",
      failed: true,
    });
    return;
  }
  const limit = run.maxCostUsd ?? null;
  if (limit !== null && (await spent(qb, run.id)) >= limit) {
    await writeResult(qb, run, index, sampleId, {
      ...sampleBase(sample),
      status: "ERROR",
      durationMs: 0,
      costUsd: 0,
      fields: checkFields(type, sample.expected, { fields: {} }),
      skipped: "budget",
    });
    return;
  }
  let result: SampleResult;
  try {
    const examples = await loadExamples(qb, type);
    result = await readSample(qb, run, type, sample, examples);
  } catch (error) {
    state.log("test-run-sample-failed", { runId: run.id, sampleId, error: String(error) });
    result = {
      ...sampleBase(sample),
      status: "ERROR",
      durationMs: 0,
      costUsd: 0,
      error: "the sample could not be read",
      fields: checkFields(type, sample.expected, { fields: {} }),
      failed: true,
    };
  }
  await writeResult(qb, run, index, sampleId, result);
}

/** Write the summary, metrics and results once every sample has a row. */
export async function finishRun(qb: Quickben, runId: string): Promise<void> {
  const run = (await qb.findById(DOC_TEST_RUNS, runId, {}, SYSTEM)) as unknown as TestRunRecord;
  const total = run.total ?? 0;
  if (run.state !== "running") return;
  if ((await qb.count(DOC_TEST_RESULTS, { where: { run: { eq: runId } } }, SYSTEM)) < total) {
    return;
  }
  const rows = await findAll<ResultRow>(qb, DOC_TEST_RESULTS, { run: { eq: runId } }, SYSTEM, {
    sort: "index",
  });
  const results = rows.map((row) => row.result);
  const type = await runType(qb, run);
  const finishedAt = new Date();
  const wallMs = finishedAt.getTime() - new Date(run.createdAt).getTime();
  const runSummary = summarize(results, wallMs);
  const broken = results.filter((r) => r.error === "the sample could not be read").length;
  await qb.update(
    DOC_TEST_RUNS,
    runId,
    {
      state: broken > 0 ? "failed" : "done",
      error: broken > 0 ? "one or more samples could not be read" : null,
      results,
      summary: runSummary,
      metrics: runMetrics(type, results, wallMs),
      costUsd: runSummary.costUsd,
      finishedAt: finishedAt.toISOString(),
    },
    SYSTEM,
  );
}

/**
 * Process one queued item of a test run: read sample `run - 1`, queue the next one of its
 * lane, and finish the run after its last sample. Never throws.
 */
export async function processTestRunItem(qb: Quickben, jobId: string, n: number): Promise<void> {
  const state = getDocReader(qb);
  const runId = jobId.slice(TEST_RUN_JOB.length);
  try {
    const run = (await qb
      .findById(DOC_TEST_RUNS, runId, {}, SYSTEM)
      .catch(() => null)) as unknown as TestRunRecord | null;
    if (run?.state !== "running" || !Number.isSafeInteger(n) || n < 1) return;
    const index = n - 1;
    const type = await runType(qb, run);
    await processItem(qb, run, type, index);
    const next = n + (run.concurrency ?? 1);
    if (next <= (run.total ?? 0)) await state.runner.enqueue(jobId, next);
    await finishRun(qb, runId);
  } catch (error) {
    state.log("test-run-failed", { runId, error: String(error) });
    await qb
      .update(
        DOC_TEST_RUNS,
        runId,
        {
          state: "failed",
          error: String(error).slice(0, 500),
          finishedAt: new Date().toISOString(),
        },
        SYSTEM,
      )
      .catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------
// Reading runs

/** Runs of a type (optionally of one version), newest first. */
export async function listTestRuns(
  qb: Quickben,
  ctx: RequestContext,
  key: string,
  version?: number,
  limit = 20,
): Promise<TestRun[]> {
  await failInterruptedRuns(qb);
  const page = await qb.find(
    DOC_TEST_RUNS,
    {
      where: {
        typeKey: { eq: key },
        ...(version === undefined ? {} : { typeVersion: { eq: version } }),
      },
      sort: "-createdAt",
      limit,
    },
    ctx,
  );
  return (page.docs as unknown as TestRunRecord[]).map((record) => toRun(record));
}

export async function getTestRun(qb: Quickben, ctx: RequestContext, id: string): Promise<TestRun> {
  await failInterruptedRuns(qb);
  const run = toRun((await qb.findById(DOC_TEST_RUNS, id, {}, ctx)) as unknown as TestRunRecord);
  if (run.state !== "running") return run;
  // Progress while it runs: the rows written so far.
  const rows = await findAll<ResultRow>(qb, DOC_TEST_RESULTS, { run: { eq: id } }, SYSTEM, {
    sort: "index",
  });
  return { ...run, results: rows.map((row) => row.result) };
}

/** Fail runs left `running` with no result for `staleMs` (default 30 minutes). */
export async function failInterruptedRuns(qb: Quickben, staleMs = STALE_MS): Promise<number> {
  const before = new Date(Date.now() - staleMs).toISOString();
  const stale = await qb.find(
    DOC_TEST_RUNS,
    { where: { state: { eq: "running" }, createdAt: { lt: before } }, limit: 100 },
    SYSTEM,
  );
  let failed = 0;
  for (const run of stale.docs) {
    const recent = await qb.find(
      DOC_TEST_RESULTS,
      { where: { run: { eq: run.id }, createdAt: { gte: before } }, limit: 1, select: ["id"] },
      SYSTEM,
    );
    if (recent.docs.length > 0) continue;
    await qb.update(
      DOC_TEST_RUNS,
      run.id,
      { state: "failed", error: "interrupted by a restart", finishedAt: new Date().toISOString() },
      SYSTEM,
    );
    failed += 1;
  }
  return failed;
}

/** Two runs field by field: deltas of accuracy, cost and latency, and the cases that changed. */
export async function compareTestRuns(
  qb: Quickben,
  ctx: RequestContext,
  referenceId: string,
  candidateId: string,
): Promise<RunComparison> {
  const [a, b] = await Promise.all([
    getTestRun(qb, ctx, referenceId),
    getTestRun(qb, ctx, candidateId),
  ]);
  const record = (await qb.findById(DOC_TEST_RUNS, b.id, {}, ctx)) as unknown as TestRunRecord;
  const type = await runType(qb, record);
  return compareResults(type, a.results, b.results);
}

/** A run as JSON (run, metrics, results) or CSV (one row per sample and field). */
export async function exportTestRun(
  qb: Quickben,
  ctx: RequestContext,
  id: string,
  format: "json" | "csv",
): Promise<string> {
  const run = await getTestRun(qb, ctx, id);
  if (format === "csv") return resultsToCsv(run.results);
  return JSON.stringify(run, null, 2);
}
