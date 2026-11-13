/**
 * The studio: versioned document types, test samples and test runs.
 *
 * A version is a draft until it is published; a published version never changes, so a
 * reading's `(typeKey, typeVersion)` always names what read it. A type has at most one draft.
 * A draft can be published only after a test run of it, as it is now, finished.
 *
 * Every function runs with the caller's context, so the access rules of the collections apply
 * (platform staff by default). Test runs execute in the background through the runner.
 */
import { ConflictError, NotFoundError, QuickbenError, ValidationError } from "@quickben/core";
import { z } from "zod";

import { DOC_SAMPLES, DOC_TEST_RUNS, DOC_TYPES } from "./collections";
import { documentTypeSchema, parseDocumentType, TYPE_KEY } from "./definition";
import { VISION_LLM } from "./extractors/vision-llm";
import { sameFieldValue } from "./field-values";
import { getDocReader } from "./options";
import { attemptsCost, runPipeline } from "./pipeline";
import { recordUsage, skipHook } from "./quotas";
import { parseParams, readUpload, storageRef } from "./readings";
import { findAll, newRevision, SYSTEM, toDefinition, versionKey } from "./store";

import type { DocumentType, ExtractionParams, Pipeline } from "./definition";
import type { ExtractionStatus } from "./extractor";
import type { PipelineResult } from "./pipeline";
import type { DocumentFile } from "./readings";
import type { DocTypeRecord, SampleRecord, TestRunRecord } from "./records";
import type { Quickben, RequestContext } from "@quickben/core";

/** Why a studio action was refused. */
export type StudioRule =
  "type-exists" | "draft-exists" | "published" | "not-tested" | "no-samples" | "changed";

/** A studio action conflicts with the current state, e.g. editing a published version. */
export class StudioError extends QuickbenError {
  readonly rule: StudioRule;

  constructor(rule: StudioRule, message: string) {
    super("CONFLICT", message);
    this.name = "StudioError";
    this.rule = rule;
  }
}

/** Parallel samples per test run. */
const PARALLEL = 3;
/** A run still `running` after this long belongs to a process that is gone. */
const STALE_MS = 30 * 60 * 1000;

const actorOf = (ctx: RequestContext) => ctx.user?.email ?? ctx.user?.id ?? null;

function zodIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

// ---------------------------------------------------------------------------------------------
// Types and versions

export interface VersionSummary {
  readonly version: number;
  readonly state: "draft" | "published";
  readonly label: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

export interface TypeSummary {
  readonly key: string;
  readonly label: string;
  readonly builtin: boolean;
  readonly published: VersionSummary | null;
  readonly draft: VersionSummary | null;
  readonly versions: number;
  readonly samples: number;
}

/** A stored version with its parsed definition. */
export interface TypeVersion extends VersionSummary {
  readonly id: string;
  readonly key: string;
  readonly revision: string;
  readonly builtin: boolean;
  readonly definition: DocumentType;
  readonly createdBy: string | null;
  readonly updatedBy: string | null;
  readonly publishedBy: string | null;
}

const summary = (record: DocTypeRecord): VersionSummary => ({
  version: record.version,
  state: record.state,
  label: record.label,
  updatedAt: record.updatedAt,
  publishedAt: record.publishedAt,
});

const toVersion = (record: DocTypeRecord): TypeVersion => ({
  ...summary(record),
  id: record.id,
  key: record.key,
  revision: record.revision,
  builtin: record.builtin === true,
  definition: toDefinition(record),
  createdBy: record.createdBy,
  updatedBy: record.updatedBy,
  publishedBy: record.publishedBy,
});

async function versionRecords(
  qb: Quickben,
  ctx: RequestContext,
  key: string,
): Promise<DocTypeRecord[]> {
  return findAll<DocTypeRecord>(qb, DOC_TYPES, { key: { eq: key } }, ctx, { sort: "-version" });
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

/** One entry per type: its newest published version, its draft and the sample count. */
export async function listDocTypes(qb: Quickben, ctx: RequestContext): Promise<TypeSummary[]> {
  const [records, samples] = await Promise.all([
    findAll<DocTypeRecord>(qb, DOC_TYPES, {}, ctx, { sort: ["key", "-version"] }),
    findAll<SampleRecord>(qb, DOC_SAMPLES, {}, ctx, { select: ["typeKey"] }),
  ]);
  const counts = new Map<string, number>();
  for (const sample of samples) counts.set(sample.typeKey, (counts.get(sample.typeKey) ?? 0) + 1);
  const byKey = new Map<string, DocTypeRecord[]>();
  for (const record of records) byKey.set(record.key, [...(byKey.get(record.key) ?? []), record]);
  return [...byKey.entries()].map(([key, versions]) => {
    const published = versions.find((v) => v.state === "published");
    const draft = versions.find((v) => v.state === "draft");
    return {
      key,
      label: (draft ?? published ?? versions[0])?.label ?? key,
      builtin: versions.some((v) => v.builtin === true),
      published: published ? summary(published) : null,
      draft: draft ? summary(draft) : null,
      versions: versions.length,
      samples: counts.get(key) ?? 0,
    };
  });
}

/** Versions of a type, newest first. */
export async function listVersions(
  qb: Quickben,
  ctx: RequestContext,
  key: string,
): Promise<VersionSummary[]> {
  const records = await versionRecords(qb, ctx, key);
  if (records.length === 0) throw new NotFoundError(`Document type ${key} not found`);
  return records.map((record) => summary(record));
}

export async function getVersion(
  qb: Quickben,
  ctx: RequestContext,
  key: string,
  version: number,
): Promise<TypeVersion> {
  return toVersion(await versionRecord(qb, ctx, key, version));
}

/** What a new type starts with: one field and a vision-LLM step to configure. */
export function starterDefinition(key: string, label: string): DocumentType {
  return parseDocumentType({
    key,
    version: 1,
    label,
    state: "draft",
    fields: [{ key: "number", label: "Number", type: "text", required: true }],
    pipeline: { steps: [{ extractor: VISION_LLM, config: {} }] },
  });
}

/** A new type, as draft v1. */
export async function createDocType(
  qb: Quickben,
  ctx: RequestContext,
  input: { key: string; label: string },
): Promise<TypeVersion> {
  const key = input.key.trim();
  const label = input.label.trim();
  if (!TYPE_KEY.test(key) || key.length > 64 || key === "auto") {
    throw new ValidationError([
      { path: "key", message: "Use lowercase words joined by -, e.g. invoice" },
    ]);
  }
  if (!label) throw new ValidationError([{ path: "label", message: "Give the type a name" }]);
  const existing = await qb.find(DOC_TYPES, { where: { key: { eq: key } }, limit: 1 }, ctx);
  if (existing.docs.length > 0)
    throw new StudioError("type-exists", `Document type ${key} already exists`);
  const definition = starterDefinition(key, label.slice(0, 120));
  return toVersion(
    (await qb.create(
      DOC_TYPES,
      {
        key,
        version: 1,
        versionKey: versionKey(key, 1),
        state: "draft",
        draftKey: key,
        label: definition.label,
        definition: definition,
        revision: newRevision(),
        createdBy: actorOf(ctx),
        updatedBy: actorOf(ctx),
      },
      ctx,
    )) as unknown as DocTypeRecord,
  );
}

function draftExists(error: unknown, key: string): never {
  if (error instanceof ConflictError && !(error instanceof StudioError)) {
    throw new StudioError("draft-exists", `Document type ${key} already has a draft`);
  }
  throw error;
}

/** A new draft copied from a version (default: the newest). One draft per type. */
export async function createDraft(
  qb: Quickben,
  ctx: RequestContext,
  key: string,
  from?: number,
): Promise<TypeVersion> {
  const records = await versionRecords(qb, ctx, key);
  const newest = records[0];
  if (!newest) throw new NotFoundError(`Document type ${key} not found`);
  const existing = records.find((record) => record.state === "draft");
  if (existing) {
    throw new StudioError(
      "draft-exists",
      `Document type ${key} already has draft v${String(existing.version)}`,
    );
  }
  const source = from === undefined ? newest : records.find((record) => record.version === from);
  if (!source) throw new NotFoundError(`Document type ${versionKey(key, from ?? 0)} not found`);
  const version = newest.version + 1;
  const definition = { ...toDefinition(source), version, state: "draft" };
  try {
    return toVersion(
      (await qb.create(
        DOC_TYPES,
        {
          key,
          version,
          versionKey: versionKey(key, version),
          state: "draft",
          draftKey: key,
          label: source.label,
          definition: definition,
          revision: newRevision(),
          createdBy: actorOf(ctx),
          updatedBy: actorOf(ctx),
        },
        ctx,
      )) as unknown as DocTypeRecord,
    );
  } catch (error) {
    return draftExists(error, key);
  }
}

/**
 * Save a draft's definition. `key`, `version` and `state` belong to the version and are
 * ignored. Every save gets a new revision, so earlier test runs no longer allow publishing.
 */
export async function saveDraft(
  qb: Quickben,
  ctx: RequestContext,
  key: string,
  version: number,
  definition: unknown,
): Promise<TypeVersion> {
  const record = await versionRecord(qb, ctx, key, version);
  if (record.state !== "draft")
    throw new StudioError("published", `v${String(version)} is published and cannot change`);
  const parsed = documentTypeSchema.safeParse({
    ...(definition as object),
    key,
    version,
    state: "draft",
  });
  if (!parsed.success) throw new ValidationError(zodIssues(parsed.error));
  const saved = await qb.transaction(async (tx) => {
    const current = (await tx.findById(DOC_TYPES, record.id, {}, ctx)) as unknown as DocTypeRecord;
    if (current.state !== "draft") {
      throw new StudioError("published", `v${String(version)} is published and cannot change`);
    }
    return tx.update(
      DOC_TYPES,
      record.id,
      {
        label: parsed.data.label,
        definition: parsed.data,
        revision: newRevision(),
        updatedBy: actorOf(ctx),
      },
      ctx,
    );
  });
  return toVersion(saved as unknown as DocTypeRecord);
}

/** Delete a draft. A type whose only version was this draft is gone with it. */
export async function deleteDraft(
  qb: Quickben,
  ctx: RequestContext,
  key: string,
  version: number,
): Promise<void> {
  const record = await versionRecord(qb, ctx, key, version);
  if (record.state !== "draft")
    throw new StudioError("published", `v${String(version)} is published and cannot be deleted`);
  await qb.delete(DOC_TYPES, record.id, ctx);
}

/** Whether a version may be published: a draft with a finished test run of its current revision. */
export function canPublish(
  version: Pick<TypeVersion, "state" | "revision" | "updatedAt">,
  runs: readonly Pick<TestRun, "state" | "variant" | "typeRevision" | "createdAt">[],
): boolean {
  return (
    version.state === "draft" &&
    runs.some(
      (run) =>
        run.state === "done" &&
        run.variant === null &&
        run.typeRevision === version.revision &&
        run.createdAt >= version.updatedAt,
    )
  );
}

/** Publish a draft that passed through the test bench. */
export async function publishDraft(
  qb: Quickben,
  ctx: RequestContext,
  key: string,
  version: number,
): Promise<TypeVersion> {
  const record = await versionRecord(qb, ctx, key, version);
  if (record.state !== "draft")
    throw new StudioError("published", `v${String(version)} is already published`);
  const runs = await listTestRuns(qb, ctx, key, version);
  if (!canPublish(toVersion(record), runs)) {
    throw new StudioError("not-tested", "Test this version on its samples before publishing it");
  }
  const published = await qb.transaction(async (tx) => {
    const current = (await tx.findById(DOC_TYPES, record.id, {}, ctx)) as unknown as DocTypeRecord;
    if (current.state !== "draft" || current.revision !== record.revision) {
      throw new StudioError("changed", "The draft changed; test it again");
    }
    return tx.update(
      DOC_TYPES,
      record.id,
      {
        state: "published",
        draftKey: null,
        publishedAt: new Date().toISOString(),
        publishedBy: actorOf(ctx),
      },
      ctx,
    );
  });
  return toVersion(published as unknown as DocTypeRecord);
}

// ---------------------------------------------------------------------------------------------
// Samples

export interface Sample {
  readonly id: string;
  readonly typeKey: string;
  readonly fileName: string;
  readonly mime: string;
  readonly size: number | null;
  readonly expected: Record<string, string>;
  readonly params: ExtractionParams;
  readonly note: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

const toSample = (record: SampleRecord): Sample => ({
  id: record.id,
  typeKey: record.typeKey,
  fileName: record.fileName,
  mime: record.mime,
  size: record.size,
  expected: record.expected,
  params: record.params,
  note: record.note,
  createdBy: record.createdBy,
  createdAt: record.createdAt,
});

function noteOf(note: string | null | undefined): string | null {
  const text = note?.trim().slice(0, 500) ?? "";
  return text === "" ? null : text;
}

const expectedSchema = z.record(z.string().max(64), z.string().max(500));

function parseExpected(expected: unknown): Record<string, string> {
  const parsed = expectedSchema.safeParse(expected ?? {});
  if (!parsed.success)
    throw new ValidationError([{ path: "expected", message: "Expected values are text" }]);
  // Blank means "not checked".
  return Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value.trim() !== ""));
}

/** Samples of a type, oldest first. */
export async function listSamples(
  qb: Quickben,
  ctx: RequestContext,
  typeKey: string,
): Promise<Sample[]> {
  const records = await findAll<SampleRecord>(qb, DOC_SAMPLES, { typeKey: { eq: typeKey } }, ctx, {
    sort: "createdAt",
  });
  return records.map((record) => toSample(record));
}

export interface SampleInput {
  readonly file: DocumentFile;
  readonly expected?: Record<string, string>;
  readonly params?: ExtractionParams;
  readonly note?: string;
}

/** Add a test document to a type. Samples belong to the type, not to one version. */
export async function addSample(
  qb: Quickben,
  ctx: RequestContext,
  typeKey: string,
  input: SampleInput,
): Promise<Sample> {
  const state = getDocReader(qb);
  await listVersions(qb, ctx, typeKey);
  const upload = await readUpload(state, input.file);
  const fileRef = storageRef(`samples/${typeKey}`, upload.mime);
  await state.files.write(fileRef, upload.bytes, upload.mime);
  const record = await qb.create(
    DOC_SAMPLES,
    {
      typeKey,
      fileRef,
      fileName: upload.name ?? `sample${fileRef.slice(fileRef.lastIndexOf("."))}`,
      mime: upload.mime,
      size: upload.bytes.byteLength,
      expected: parseExpected(input.expected),
      params: parseParams(input.params),
      note: noteOf(input.note),
      createdBy: actorOf(ctx),
    },
    ctx,
  );
  return toSample(record as unknown as SampleRecord);
}

/** Change a sample's expected values, parameters or note. */
export async function updateSample(
  qb: Quickben,
  ctx: RequestContext,
  id: string,
  input: { expected?: Record<string, string>; params?: ExtractionParams; note?: string | null },
): Promise<Sample> {
  const data: Record<string, unknown> = {};
  if (input.expected !== undefined) data.expected = parseExpected(input.expected);
  if (input.params !== undefined) data.params = parseParams(input.params);
  if (input.note !== undefined) data.note = noteOf(input.note);
  return toSample((await qb.update(DOC_SAMPLES, id, data, ctx)) as unknown as SampleRecord);
}

/** Remove a sample and its file. */
export async function removeSample(qb: Quickben, ctx: RequestContext, id: string): Promise<void> {
  const record = (await qb.delete(DOC_SAMPLES, id, ctx)) as unknown as SampleRecord;
  await getDocReader(qb)
    .files.delete?.(record.fileRef)
    .catch(() => undefined);
}

/** A sample's file, for a preview. */
export async function sampleFile(
  qb: Quickben,
  ctx: RequestContext,
  id: string,
): Promise<{ bytes: Uint8Array; mime: string; fileName: string }> {
  const record = (await qb.findById(DOC_SAMPLES, id, {}, ctx)) as unknown as SampleRecord;
  const bytes = await getDocReader(qb).files.read(record.fileRef);
  if (!bytes) throw new NotFoundError("The file of this sample is gone");
  return { bytes, mime: record.mime, fileName: record.fileName };
}

// ---------------------------------------------------------------------------------------------
// Test runs

export const variantSchema = z.object({
  connectionId: z.string().trim().min(1).max(200),
  model: z.string().trim().min(1).max(200).optional(),
});
export type Variant = z.infer<typeof variantSchema>;

export interface FieldCheck {
  readonly key: string;
  readonly label: string;
  readonly expected: string | null;
  readonly read: string | null;
  readonly confidence: number | null;
  /** `null` when the sample has no expected value for the field. */
  readonly match: boolean | null;
}

export interface SampleResult {
  readonly sampleId: string;
  readonly fileName: string;
  readonly status: ExtractionStatus;
  readonly durationMs: number;
  readonly costUsd: number;
  readonly fields: FieldCheck[];
  readonly error?: string;
}

export interface RunSummary {
  readonly samples: number;
  readonly checked: number;
  readonly matched: number;
  /** matched / checked, or `null` when nothing had an expected value. */
  readonly accuracy: number | null;
  readonly costUsd: number;
  readonly avgLatencyMs: number;
}

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
}

const toRun = (record: TestRunRecord): TestRun => ({
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
});

/**
 * A model comparison isolates the model: the pipeline is that model alone, so a free step that
 * reads a document first does not hide the difference.
 */
export function variantPipeline(pipeline: Pipeline, variant: Variant): Pipeline {
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

/** Each field read compared with the sample's expected value. */
export function checkFields(
  type: DocumentType,
  expected: Readonly<Record<string, string>>,
  result: Pick<PipelineResult, "fields">,
): FieldCheck[] {
  return type.fields.map((field) => {
    const read = Object.hasOwn(result.fields, field.key) ? result.fields[field.key] : undefined;
    const want = Object.hasOwn(expected, field.key) ? (expected[field.key] ?? "") : null;
    return {
      key: field.key,
      label: field.label,
      expected: want,
      read: read?.value ?? null,
      confidence: read?.confidence ?? null,
      match: want === null ? null : sameFieldValue(field, want, read?.value),
    };
  });
}

export function summarize(results: readonly SampleResult[]): RunSummary {
  const checks = results.flatMap((result) => result.fields).filter((field) => field.match !== null);
  const matched = checks.filter((field) => field.match).length;
  const latency = results.reduce((total, result) => total + result.durationMs, 0);
  return {
    samples: results.length,
    checked: checks.length,
    matched,
    accuracy: checks.length > 0 ? matched / checks.length : null,
    costUsd: Math.round(results.reduce((total, result) => total + result.costUsd, 0) * 1e6) / 1e6,
    avgLatencyMs: results.length > 0 ? Math.round(latency / results.length) : 0,
  };
}

async function readSample(
  qb: Quickben,
  runId: string,
  type: DocumentType,
  sample: SampleRecord,
): Promise<SampleResult> {
  const state = getDocReader(qb);
  const started = Date.now();
  const base = { sampleId: sample.id, fileName: sample.fileName };
  const bytes = await state.files.read(sample.fileRef);
  if (!bytes) {
    return {
      ...base,
      status: "ERROR",
      durationMs: 0,
      costUsd: 0,
      fields: checkFields(type, sample.expected, { fields: {} }),
      error: "file not found",
    };
  }
  // Test runs count against the platform cap only.
  const skip = await skipHook(qb, null, state.log);
  const result = await runPipeline({
    type,
    input: { bytes, mime: sample.mime, pages: type.pages },
    params: sample.params,
    tenant: null,
    extractors: state.extractors,
    ...(skip ? { skip } : {}),
  });
  await recordUsage(
    qb,
    { tenant: null, testRun: runId, typeKey: type.key, typeVersion: type.version },
    result.attempts,
  ).catch((error: unknown) => {
    state.log("usage-failed", { testRun: runId, error: String(error) });
  });
  // Without this a failed step (a provider rejecting the request) shows only "ERROR".
  const errors = result.attempts
    .map((attempt) => attempt.problems?.error)
    .filter((error): error is string => typeof error === "string" && error.length > 0);
  return {
    ...base,
    status: result.status,
    durationMs: Date.now() - started,
    costUsd: attemptsCost(result.attempts),
    fields: checkFields(type, sample.expected, result),
    ...(errors.length > 0 ? { error: errors.join("; ").slice(0, 500) } : {}),
  };
}

async function executeRun(
  qb: Quickben,
  runId: string,
  type: DocumentType,
  samples: readonly SampleRecord[],
): Promise<void> {
  const state = getDocReader(qb);
  try {
    const results: SampleResult[] = Array.from({ length: samples.length });
    const queue = samples.map((sample, index) => ({ sample, index }));
    const failures = new Set<string>();
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const { sample, index } = item;
        try {
          results[index] = await readSample(qb, runId, type, sample);
        } catch (error) {
          failures.add(sample.id);
          state.log("test-run-sample-failed", { runId, sampleId: sample.id, error: String(error) });
          results[index] = {
            sampleId: sample.id,
            fileName: sample.fileName,
            status: "ERROR",
            durationMs: 0,
            costUsd: 0,
            error: "the sample could not be read",
            fields: checkFields(type, sample.expected, { fields: {} }),
          };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, samples.length) }, worker));
    const runSummary = summarize(results);
    const failed = failures.size > 0;
    await qb.update(
      DOC_TEST_RUNS,
      runId,
      {
        state: failed ? "failed" : "done",
        error: failed ? "one or more samples could not be read" : null,
        results: results,
        summary: runSummary,
        costUsd: runSummary.costUsd,
        finishedAt: new Date().toISOString(),
      },
      SYSTEM,
    );
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

export interface StartTestRunInput {
  /** Default: every sample of the type. */
  readonly sampleIds?: readonly string[];
  /** Empty: the version as it is. Two: compare these models side by side. */
  readonly variants?: readonly Variant[];
}

/**
 * Start test runs of a version over its samples: one run, or one per variant to compare
 * models. Returns at once; runs finish in the background (poll `getTestRun`).
 */
export async function startTestRun(
  qb: Quickben,
  ctx: RequestContext,
  key: string,
  version: number,
  input: StartTestRunInput = {},
): Promise<TestRun[]> {
  const state = getDocReader(qb);
  const variants = z
    .array(variantSchema)
    .max(2)
    .safeParse(input.variants ?? []);
  if (!variants.success) throw new ValidationError(zodIssues(variants.error));
  const record = await versionRecord(qb, ctx, key, version);
  const type = toDefinition(record);
  const all = await findAll<SampleRecord>(qb, DOC_SAMPLES, { typeKey: { eq: key } }, ctx, {
    sort: "createdAt",
  });
  const samples = input.sampleIds
    ? all.filter((sample) => input.sampleIds?.includes(sample.id))
    : all;
  if (samples.length === 0)
    throw new StudioError("no-samples", "Add samples before running a test");

  const list: (Variant | null)[] = variants.data.length > 0 ? variants.data : [null];
  const compareGroup = list.length > 1 ? newRevision() : null;
  const runs: TestRun[] = [];
  for (const variant of list) {
    const pipeline = variant ? variantPipeline(type.pipeline, variant) : type.pipeline;
    const run = (await qb.create(
      DOC_TEST_RUNS,
      {
        typeKey: key,
        typeVersion: version,
        typeRevision: record.revision,
        compareGroup,
        variant: variant,
        pipeline: pipeline,
        createdBy: actorOf(ctx),
      },
      ctx,
    )) as unknown as TestRunRecord;
    state.runner.background(() => executeRun(qb, run.id, { ...type, pipeline }, samples));
    runs.push(toRun(run));
  }
  return runs;
}

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
  return toRun((await qb.findById(DOC_TEST_RUNS, id, {}, ctx)) as unknown as TestRunRecord);
}

/** Fail runs left `running` by a process that is gone. */
export async function failInterruptedRuns(qb: Quickben, staleMs = STALE_MS): Promise<number> {
  const before = new Date(Date.now() - staleMs).toISOString();
  const stale = await qb.find(
    DOC_TEST_RUNS,
    { where: { state: { eq: "running" }, createdAt: { lt: before } }, limit: 100 },
    SYSTEM,
  );
  for (const run of stale.docs) {
    await qb.update(
      DOC_TEST_RUNS,
      run.id,
      { state: "failed", error: "interrupted by a restart", finishedAt: new Date().toISOString() },
      SYSTEM,
    );
  }
  return stale.docs.length;
}
