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
import { ConflictError, NotFoundError, ValidationError } from "@quickben/core";
import { z } from "zod";

import { startTestRunSchema } from "./bench";
import { DOC_SAMPLES, DOC_TYPES } from "./collections";
import { documentTypeSchema, parseDocumentType, TYPE_KEY } from "./definition";
import { StudioError } from "./errors";
import { datasetWrite } from "./eval-state";
import { checkExamples, freezeExamples } from "./examples";
import { VISION_LLM } from "./extractors/vision-llm";
import { getDocReader } from "./options";
import {
  assertPublishable,
  checkExamplesForPublish,
  checkPublish,
  getEvaluation,
  initialEvaluation,
  startHeldOutRuns,
} from "./publish";
import { parseParams, readUpload, storageRef } from "./readings";
import { splitFieldsFor } from "./splits";
import { findAll, newRevision, toDefinition, versionKey } from "./store";

import type { Split } from "./collections";
import type { DocumentType, ExtractionParams } from "./definition";
import type { SampleAttributes } from "./metrics";
import type { PublishCheck, PublishOptions, VersionEvaluation } from "./publish";
import type { DocumentFile } from "./readings";
import type { DocTypeRecord, SampleRecord } from "./records";
import type { Quickben, RequestContext } from "@quickben/core";

export { StudioError } from "./errors";
export type { StudioRule } from "./errors";

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
  /** The runs of its publication, once published with a split. */
  readonly evaluation: VersionEvaluation | null;
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
  evaluation: record.evaluation ?? null,
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
  const record = await versionRecord(qb, ctx, key, version);
  const evaluation = await getEvaluation(qb, ctx, record);
  return { ...toVersion(record), evaluation };
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
  await checkExamples(qb, ctx, key, parsed.data.examples);
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

/** Whether a draft may be published now: the run that counts, the comparison, the refusal. */
export async function publishCheck(
  qb: Quickben,
  ctx: RequestContext,
  key: string,
  version: number,
): Promise<PublishCheck> {
  return checkPublish(qb, ctx, await versionRecord(qb, ctx, key, version));
}

/**
 * Publish a draft that passed the test bench. Once the type is split it needs a `validation`
 * run that is not worse than the published version's (see `publishCheck`), and publishing
 * starts the `test` and `unseen` runs, recorded on the version.
 */
export async function publishDraft(
  qb: Quickben,
  ctx: RequestContext,
  key: string,
  version: number,
  options: PublishOptions = {},
): Promise<TypeVersion> {
  return datasetWrite(qb, key, () => publishDraftUnlocked(qb, ctx, key, version, options));
}

async function publishDraftUnlocked(
  qb: Quickben,
  ctx: RequestContext,
  key: string,
  version: number,
  options: PublishOptions = {},
): Promise<TypeVersion> {
  const parsed = startTestRunSchema.safeParse(options);
  if (!parsed.success) throw new ValidationError(zodIssues(parsed.error));
  const record = await versionRecord(qb, ctx, key, version);
  if (record.state === "published" && record.evaluation) {
    const evaluation = await startHeldOutRuns(qb, ctx, record, record.evaluation, options);
    return { ...toVersion(record), evaluation };
  }
  if (record.state !== "draft")
    throw new StudioError("published", `v${String(version)} is already published`);
  const check = await checkPublish(qb, ctx, record);
  assertPublishable(check);
  await checkExamplesForPublish(qb, ctx, record, check);
  const evaluation = check.splitVersion === null ? null : initialEvaluation(check);
  const exampleSnapshot = await freezeExamples(qb, toDefinition(record));
  const published = (await qb.transaction(async (tx) => {
    const current = (await tx.findById(DOC_TYPES, record.id, {}, ctx)) as unknown as DocTypeRecord;
    if (current.state !== "draft" || current.revision !== record.revision) {
      throw new StudioError("changed", "The draft changed; test it again");
    }
    return tx.update(
      DOC_TYPES,
      record.id,
      {
        state: "published",
        exampleSnapshot,
        draftKey: null,
        publishedAt: new Date().toISOString(),
        publishedBy: actorOf(ctx),
        ...(evaluation ? { evaluation } : {}),
      },
      ctx,
    );
  })) as unknown as DocTypeRecord;
  if (!evaluation) return toVersion(published);
  const started = await startHeldOutRuns(qb, ctx, published, evaluation, options);
  return { ...toVersion(published), evaluation: started };
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
  /** The caller's key of an imported sample. */
  readonly key: string | null;
  /** `null` before the type is split. */
  readonly split: Split | null;
  readonly splitVersion: number | null;
  readonly group: string | null;
  readonly attributes: SampleAttributes;
  /** Notes for prompt work. */
  readonly annotations: readonly SampleAnnotation[];
}

/** A note on a sample for prompt work: what the model should do with a field. */
export interface SampleAnnotation {
  /** A field key, or `null` for the whole document. */
  readonly field: string | null;
  readonly text: string;
  readonly by: string | null;
  readonly at: string;
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
  key: record.sampleKey ?? null,
  split: record.split ?? null,
  splitVersion: record.splitVersion ?? null,
  group: record.group ?? null,
  attributes: record.attributes ?? {},
  annotations: record.annotations ?? [],
});

function noteOf(note: string | null | undefined): string | null {
  const text = note?.trim().slice(0, 500) ?? "";
  return text === "" ? null : text;
}

export const expectedSchema = z.record(z.string().max(64), z.string().max(500));

export function parseExpected(expected: unknown, keepEmpty = false): Record<string, string> {
  const parsed = expectedSchema.safeParse(expected ?? {});
  if (!parsed.success)
    throw new ValidationError([{ path: "expected", message: "Expected values are text" }]);
  // Blank means "not checked".
  return Object.fromEntries(
    Object.entries(parsed.data).filter(([, value]) => keepEmpty || value.trim() !== ""),
  );
}

/** Samples of a type (optionally of some splits), oldest first. */
export async function listSamples(
  qb: Quickben,
  ctx: RequestContext,
  typeKey: string,
  split?: Split | readonly Split[],
): Promise<Sample[]> {
  let splits: Split[] | undefined;
  if (split !== undefined) splits = typeof split === "string" ? [split] : [...split];
  const records = await findAll<SampleRecord>(
    qb,
    DOC_SAMPLES,
    { typeKey: { eq: typeKey }, ...(splits ? { split: { in: splits } } : {}) },
    ctx,
    { sort: "createdAt" },
  );
  return records.map((record) => toSample(record));
}

export interface SampleInput {
  readonly file: DocumentFile;
  readonly expected?: Record<string, string>;
  readonly params?: ExtractionParams;
  readonly note?: string;
  /** Who the document comes from (issuer, tenant). Splits stratify by it. */
  readonly group?: string | null;
  /** Properties to stratify and slice by, e.g. `{ hasTextLayer: true }`. */
  readonly attributes?: Readonly<Record<string, string | number | boolean | null>>;
  /**
   * A document uploaded to look at it: it goes to `dev` (once looked at, it is no longer
   * unseen), whatever its hash says.
   */
  readonly inspect?: boolean;
}

const attributesSchema = z
  .record(
    z.string().min(1).max(64),
    z.union([z.string().max(200), z.number(), z.boolean(), z.null()]),
  )
  .refine((value) => Object.keys(value).length <= 30, "At most 30 attributes");

export function parseAttributes(value: unknown): SampleAttributes {
  const parsed = attributesSchema.safeParse(value ?? {});
  if (!parsed.success) throw new ValidationError(zodIssues(parsed.error));
  return parsed.data;
}

export function groupOf(value: string | null | undefined): string | null {
  const text = value?.trim().slice(0, 200) ?? "";
  return text === "" ? null : text;
}

/** Add a test document to a type. Samples belong to the type, not to one version. */
export async function addSample(
  qb: Quickben,
  ctx: RequestContext,
  typeKey: string,
  input: SampleInput,
): Promise<Sample> {
  return datasetWrite(qb, typeKey, () => addSampleUnlocked(qb, ctx, typeKey, input));
}

async function addSampleUnlocked(
  qb: Quickben,
  ctx: RequestContext,
  typeKey: string,
  input: SampleInput,
): Promise<Sample> {
  const state = getDocReader(qb);
  await listVersions(qb, ctx, typeKey);
  const upload = await readUpload(state, input.file);
  const fileRef = storageRef(`samples/${typeKey}`, upload.mime);
  const group = groupOf(input.group);
  const attributes = parseAttributes(input.attributes);
  const assigned = await splitFieldsFor(qb, typeKey, { key: fileRef, group, attributes });
  const split =
    input.inspect === true && assigned.split !== null
      ? { ...assigned, split: "dev" as const }
      : assigned;
  await state.files.put(fileRef, upload.bytes, { contentType: upload.mime });
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
      group,
      attributes,
      ...split,
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
  input: {
    expected?: Record<string, string>;
    params?: ExtractionParams;
    note?: string | null;
    group?: string | null;
    attributes?: SampleAttributes;
  },
): Promise<Sample> {
  const sample = (await qb.findById(DOC_SAMPLES, id, {}, ctx)) as unknown as SampleRecord;
  return datasetWrite(qb, sample.typeKey, () => updateSampleUnlocked(qb, ctx, id, input));
}

async function updateSampleUnlocked(
  qb: Quickben,
  ctx: RequestContext,
  id: string,
  input: {
    expected?: Record<string, string>;
    params?: ExtractionParams;
    note?: string | null;
    group?: string | null;
    attributes?: SampleAttributes;
  },
): Promise<Sample> {
  const data: Record<string, unknown> = {};
  if (input.group !== undefined) data.group = groupOf(input.group);
  if (input.attributes !== undefined) data.attributes = parseAttributes(input.attributes);
  if (input.expected !== undefined) data.expected = parseExpected(input.expected, true);
  if (input.params !== undefined) data.params = parseParams(input.params);
  if (input.note !== undefined) data.note = noteOf(input.note);
  return toSample((await qb.update(DOC_SAMPLES, id, data, ctx)) as unknown as SampleRecord);
}

/** One sample. */
export async function getSample(qb: Quickben, ctx: RequestContext, id: string): Promise<Sample> {
  return toSample((await qb.findById(DOC_SAMPLES, id, {}, ctx)) as unknown as SampleRecord);
}

/** Add a note for prompt work to a sample. Notes are kept in order, at most 50. */
export async function annotateSample(
  qb: Quickben,
  ctx: RequestContext,
  id: string,
  input: { field?: string | null; text: string },
): Promise<Sample> {
  const text = input.text.trim().slice(0, 1000);
  if (!text) throw new ValidationError([{ path: "text", message: "Write the note" }]);
  const record = (await qb.findById(DOC_SAMPLES, id, {}, ctx)) as unknown as SampleRecord;
  const note: SampleAnnotation = {
    field: input.field?.trim() ? input.field.trim().slice(0, 64) : null,
    text,
    by: actorOf(ctx),
    at: new Date().toISOString(),
  };
  const annotations = [...(record.annotations ?? []), note].slice(-50);
  return toSample(
    (await qb.update(DOC_SAMPLES, id, { annotations }, ctx)) as unknown as SampleRecord,
  );
}

/** Notes for prompt work on a type's samples, newest first. */
export async function listAnnotations(
  qb: Quickben,
  ctx: RequestContext,
  typeKey: string,
): Promise<(SampleAnnotation & { sampleId: string; fileName: string })[]> {
  const samples = await listSamples(qb, ctx, typeKey);
  return samples
    .flatMap((sample) =>
      sample.annotations.map((note) => ({
        ...note,
        sampleId: sample.id,
        fileName: sample.key ?? sample.fileName,
      })),
    )
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Remove a sample and its file. */
export async function removeSample(qb: Quickben, ctx: RequestContext, id: string): Promise<void> {
  const sample = (await qb.findById(DOC_SAMPLES, id, {}, ctx)) as unknown as SampleRecord;
  return datasetWrite(qb, sample.typeKey, () => removeSampleUnlocked(qb, ctx, id));
}

async function removeSampleUnlocked(qb: Quickben, ctx: RequestContext, id: string): Promise<void> {
  const record = (await qb.delete(DOC_SAMPLES, id, ctx)) as unknown as SampleRecord;
  await getDocReader(qb)
    .files.delete(record.fileRef)
    .catch(() => undefined);
}

/** A sample's file, for a preview. */
export async function sampleFile(
  qb: Quickben,
  ctx: RequestContext,
  id: string,
): Promise<{ bytes: Uint8Array; mime: string; fileName: string }> {
  const record = (await qb.findById(DOC_SAMPLES, id, {}, ctx)) as unknown as SampleRecord;
  const bytes = await getDocReader(qb).files.getBytes(record.fileRef);
  if (!bytes) throw new NotFoundError("The file of this sample is gone");
  return { bytes, mime: record.mime, fileName: record.fileName };
}

// ---------------------------------------------------------------------------------------------
// Test runs: see bench.ts

export {
  compareTestRuns,
  exportTestRun,
  failInterruptedRuns,
  getTestRun,
  listTestRuns,
  startTestRun,
  variantPipeline,
  variantSchema,
} from "./bench";
export type { StartTestRunInput, TestRun, Variant } from "./bench";
export { checkFields, summarize } from "./metrics";
export type { FieldCheck, RunSummary, SampleResult } from "./metrics";
export { canPublish } from "./publish";
export type { VersionEvaluation } from "./publish";
