import { defineCollection, fields as f } from "@quickben/core";

import type { AccessArgs, CollectionAccess, QuickbenUser } from "@quickben/core";

/** Slugs of the collections the plugin adds. */
export const DOC_TYPES = "doc-types";
export const DOC_SAMPLES = "doc-samples";
export const DOC_TEST_RUNS = "doc-test-runs";
export const DOC_JOBS = "doc-jobs";
export const DOC_USAGE = "doc-usage";
export const DOC_QUOTAS = "doc-quotas";
export const DOC_SPLITS = "doc-splits";
export const DOC_TEST_RESULTS = "doc-test-results";
export const DOC_EVAL_CLAIMS = "doc-eval-claims";
export const DOC_CORRECTIONS = "doc-corrections";

/** Durable unique claims shared by queue workers and dataset writers. */
export function docEvalClaimsCollection() {
  return defineCollection({
    slug: DOC_EVAL_CLAIMS,
    fields: {
      key: f.text({ required: true, unique: true, maxLength: 200 }),
      sampleId: f.text({ maxLength: 64 }),
    },
    access: { read: () => false, create: () => false, update: () => false, delete: () => false },
    admin: { hidden: true },
  });
}

/**
 * Sample splits. `dev`: tune prompts and pick few-shot examples. `validation`: decide whether a
 * draft may be published. `test`: measured at publish time. `unseen`: groups no other split
 * has, measured at publish time.
 */
export const SPLITS = ["dev", "validation", "test", "unseen"] as const;
export type Split = (typeof SPLITS)[number];
/** Splits that run only when publishing, or with `heldOut: true`. */
export const HELD_OUT_SPLITS: readonly Split[] = ["test", "unseen"];

export const JOB_STATES = ["queued", "running", "done", "failed", "cancelled"] as const;
export type JobState = (typeof JOB_STATES)[number];
export const RUN_STATES = ["running", "done", "failed"] as const;
export const RUN_PURPOSES = ["bench", "baseline", "publish", "rescore"] as const;
export type RunPurpose = (typeof RUN_PURPOSES)[number];
const STATUSES = ["OK", "INCOMPLETE", "NO_MATCH", "NO_TEXT", "ERROR"] as const;

type IsStaff = (user: QuickbenUser) => boolean;

const staffOnly = (isStaff: IsStaff) => {
  const rule = ({ user }: AccessArgs) => user !== null && isStaff(user);
  return { read: rule, create: rule, update: rule, delete: rule };
};

const hidden = { group: "Documents", hidden: true } as const;
const text = () => f.text({ maxLength: 500 });
const internal = { admin: { readOnly: true } } as const;

/** One version of a document type. A published version never changes. */
export function docTypesCollection(isStaff: IsStaff) {
  return defineCollection({
    slug: DOC_TYPES,
    labels: { singular: "Document type", plural: "Document types" },
    fields: {
      key: f.text({ required: true, index: true, maxLength: 64 }),
      version: f.number({ required: true, integer: true, min: 1 }),
      /** `key@version`, unique. */
      versionKey: f.text({ required: true, unique: true, maxLength: 80 }),
      state: f.select({ options: ["draft", "published"], required: true, default: "draft" }),
      /** The type's key while this version is a draft: one draft per type. */
      draftKey: f.text({ unique: true, maxLength: 64 }),
      label: f.text({ required: true, maxLength: 120 }),
      definition: f.json({ required: true }),
      /** Changes on every save, so a test run names the exact definition it tested. */
      revision: f.text({ required: true, maxLength: 64, ...internal }),
      builtin: f.boolean({ default: false }),
      createdBy: text(),
      updatedBy: text(),
      publishedBy: text(),
      publishedAt: f.datetime(),
      /** Test runs of the publication: validation, test and unseen, with their summaries. */
      evaluation: f.json(),
      exampleSnapshot: f.json(),
    },
    access: staffOnly(isStaff),
    admin: { useAsTitle: "versionKey", ...hidden },
  });
}

/** A test document of a type, with the values it should read to. */
export function docSamplesCollection(isStaff: IsStaff) {
  return defineCollection({
    slug: DOC_SAMPLES,
    labels: { singular: "Document sample", plural: "Document samples" },
    fields: {
      typeKey: f.text({ required: true, index: true, maxLength: 64 }),
      fileRef: f.text({ required: true, maxLength: 500 }),
      fileName: f.text({ required: true, maxLength: 255 }),
      mime: f.text({ required: true, maxLength: 100 }),
      size: f.number({ integer: true, min: 0 }),
      expected: f.json({ required: true, default: () => ({}) }),
      params: f.json({ required: true, default: () => ({}) }),
      note: text(),
      createdBy: text(),
      /** The caller's key of an imported sample, unique per type. `null` for uploads. */
      sampleKey: f.text({ maxLength: 200 }),
      /** `typeKey/sampleKey`, unique: imports update instead of adding twice. */
      sampleUid: f.text({ unique: true, maxLength: 280 }),
      /** SHA-256 of the file, so an import skips files that did not change. */
      fileHash: f.text({ maxLength: 64 }),
      split: f.select({ options: SPLITS, index: true }),
      /** The split version that set `split`. */
      splitVersion: f.number({ integer: true, min: 0 }),
      /** Who the document comes from (issuer, tenant): splits keep groups apart. */
      group: f.text({ index: true, maxLength: 200 }),
      /** Other properties to stratify and slice by, e.g. `{ hasTextLayer: true }`. */
      attributes: f.json({ required: true, default: () => ({}) }),
      /** Notes for prompt work, by field: `[{ field, text, by, at }]`. */
      annotations: f.json({ required: true, default: () => [] }),
    },
    access: staffOnly(isStaff),
    admin: { useAsTitle: "fileName", ...hidden },
  });
}

/** The log of expected-value corrections: one row per reviewer decision. */
export function docCorrectionsCollection(isStaff: IsStaff) {
  return defineCollection({
    slug: DOC_CORRECTIONS,
    labels: { singular: "Expected value correction", plural: "Expected value corrections" },
    fields: {
      typeKey: f.text({ required: true, index: true, maxLength: 64 }),
      sampleId: f.text({ index: true, maxLength: 64 }),
      sampleKey: f.text({ maxLength: 200 }),
      field: f.text({ required: true, maxLength: 200 }),
      before: f.text({ maxLength: 10_000 }),
      after: f.text({ maxLength: 10_000 }),
      reason: f.text({ maxLength: 1000 }),
      action: f.select({
        options: ["use-read", "edit", "keep", "mark-system", "bulk"],
        required: true,
      }),
      runId: f.text({ maxLength: 64 }),
      by: text(),
    },
    access: {
      read: ({ user }) => user !== null && isStaff(user),
      create: ({ user }) => user !== null && isStaff(user),
      update: () => false,
      delete: () => false,
    },
    admin: { ...hidden },
  });
}

/** One split assignment of a type's samples. A new split is a new version. */
export function docSplitsCollection(isStaff: IsStaff) {
  return defineCollection({
    slug: DOC_SPLITS,
    labels: { singular: "Document sample split", plural: "Document sample splits" },
    fields: {
      typeKey: f.text({ required: true, index: true, maxLength: 64 }),
      version: f.number({ required: true, integer: true, min: 1 }),
      /** `typeKey@version`, unique. */
      versionKey: f.text({ required: true, unique: true, maxLength: 80 }),
      seed: f.text({ required: true, maxLength: 200 }),
      ratios: f.json({ required: true }),
      stratifyBy: f.json({ required: true, default: () => [] }),
      unseenGroups: f.json({ required: true, default: () => [] }),
      counts: f.json({ required: true, default: () => ({}) }),
      note: text(),
      createdBy: text(),
    },
    access: staffOnly(isStaff),
    admin: { ...hidden },
  });
}

/** One sample's result in a test run. Written by the plugin only. */
export function docTestResultsCollection(isStaff: IsStaff) {
  return defineCollection({
    slug: DOC_TEST_RESULTS,
    labels: { singular: "Document test result", plural: "Document test results" },
    fields: {
      run: f.text({ required: true, index: true, maxLength: 64 }),
      /** Position of the sample in the run. `run:index` is unique. */
      index: f.number({ required: true, integer: true, min: 0 }),
      slot: f.text({ required: true, unique: true, maxLength: 80 }),
      lane: f.number({ required: true, integer: true, min: 0, index: true }),
      laneCostUsd: f.number({ required: true, min: 0 }),
      sampleId: f.text({ required: true, index: true, maxLength: 64 }),
      costUsd: f.number({ required: true, default: 0, min: 0 }),
      result: f.json({ required: true }),
    },
    access: {
      read: ({ user }) => user !== null && isStaff(user),
      create: () => false,
      update: () => false,
      delete: () => false,
    },
    admin: { ...hidden },
  });
}

/** A test bench run: one type version (or one model) over the samples. */
export function docTestRunsCollection(isStaff: IsStaff) {
  return defineCollection({
    slug: DOC_TEST_RUNS,
    labels: { singular: "Document test run", plural: "Document test runs" },
    fields: {
      typeKey: f.text({ required: true, index: true, maxLength: 64 }),
      typeVersion: f.number({ required: true, integer: true }),
      typeRevision: f.text({ required: true, maxLength: 64 }),
      /** Runs started together to compare models share it. */
      compareGroup: f.text({ maxLength: 64 }),
      /** `{ connectionId, model }` when a model was compared, else `null`. */
      variant: f.json(),
      pipeline: f.json({ required: true }),
      state: f.select({ options: RUN_STATES, required: true, default: "running", index: true }),
      results: f.json({ required: true, default: () => [] }),
      summary: f.json(),
      error: text(),
      costUsd: f.number({ required: true, default: 0, min: 0 }),
      createdBy: text(),
      finishedAt: f.datetime(),
      /** The definition the run reads with, so saving the draft mid-run changes nothing. */
      definition: f.json(),
      examplesRevision: f.text({ maxLength: 100000 }),
      /** Splits the samples were taken from; `null`: every sample. */
      splits: f.json(),
      splitVersion: f.number({ integer: true, min: 0 }),
      /** Read `test` or `unseen` samples. */
      heldOut: f.boolean({ default: false }),
      /** `bench`: started by hand. `baseline`: the published version, for the publish check. `publish`: held-out runs of a publication. `rescore`: an earlier run's reads scored again, without reading. */
      purpose: f.select({ options: RUN_PURPOSES, default: "bench" }),
      /** A `rescore` run: the run whose reads it scored again. */
      rescoredFrom: f.text({ maxLength: 64 }),
      sampleIds: f.json({ required: true, default: () => [] }),
      total: f.number({ required: true, integer: true, default: 0, min: 0 }),
      concurrency: f.number({ required: true, integer: true, default: 3, min: 1 }),
      maxCostUsd: f.number({ min: 0 }),
      retries: f.number({ required: true, integer: true, default: 1, min: 0 }),
      metrics: f.json(),
    },
    access: staffOnly(isStaff),
    admin: { ...hidden },
  });
}

/** A reading: one document read with one type. */
export function docJobsCollection(isStaff: IsStaff, access: CollectionAccess = {}) {
  const staff = (user: QuickbenUser | null) => user !== null && isStaff(user);
  return defineCollection({
    slug: DOC_JOBS,
    labels: { singular: "Document reading", plural: "Document readings" },
    fields: {
      /** A type key or `auto`. */
      requestedType: f.text({ required: true, maxLength: 64 }),
      typeKey: f.text({ index: true, maxLength: 64 }),
      typeVersion: f.number({ integer: true }),
      fileRef: f.text({ required: true, maxLength: 500 }),
      fileName: f.text({ maxLength: 255 }),
      mime: f.text({ required: true, maxLength: 100 }),
      size: f.number({ integer: true, min: 0 }),
      params: f.json({ required: true, default: () => ({}) }),
      state: f.select({ options: JOB_STATES, required: true, default: "queued", index: true }),
      status: f.select({ options: STATUSES }),
      result: f.json(),
      attempts: f.json({ required: true, default: () => [] }),
      error: text(),
      costUsd: f.number({ required: true, default: 0, min: 0 }),
      durationMs: f.number({ integer: true, min: 0 }),
      runs: f.number({ required: true, integer: true, default: 0 }),
      /** Bumped by a retry, so a stale queue message for an older run is ignored. */
      queueVersion: f.number({ required: true, integer: true, default: 1 }),
      /** Who the reading is billed to, for quotas. The organization when tenancy is on. */
      tenant: f.text({ index: true, maxLength: 200 }),
      actorUserId: f.text({ index: true, maxLength: 200 }),
      actorEmail: text(),
      actorName: text(),
      startedAt: f.datetime(),
      finishedAt: f.datetime(),
    },
    access: {
      // eslint-disable-next-line sonarjs/function-return-type -- an access rule returns a boolean or a filter
      read: ({ user }) => {
        if (!user) return false;
        return staff(user) ? true : { actorUserId: { eq: user.id } };
      },
      create: ({ user }) => user !== null,
      update: ({ user }) => staff(user),
      delete: ({ user }) => staff(user),
      ...access,
    },
    admin: { useAsTitle: "fileName", ...hidden },
  });
}

/** Aggregated paid calls of one extractor step. Written by the plugin only. */
export function docUsageCollection(isStaff: IsStaff) {
  return defineCollection({
    slug: DOC_USAGE,
    labels: { singular: "Document reading usage", plural: "Document reading usage" },
    fields: {
      tenant: f.text({ index: true, maxLength: 200 }),
      actorUserId: f.text({ maxLength: 200 }),
      job: f.text({ index: true, maxLength: 64 }),
      testRun: f.text({ maxLength: 64 }),
      typeKey: f.text({ required: true, maxLength: 64 }),
      typeVersion: f.number({ integer: true }),
      extractor: f.text({ required: true, maxLength: 64 }),
      connectionId: f.text({ required: true, maxLength: 200 }),
      connectionName: f.text({ maxLength: 200 }),
      model: f.text({ required: true, maxLength: 200 }),
      inputTokens: f.number({ required: true, integer: true, min: 0 }),
      outputTokens: f.number({ required: true, integer: true, min: 0 }),
      cachedInputTokens: f.number({ integer: true, min: 0 }),
      calls: f.number({ integer: true, min: 1, default: 1 }),
      pages: f.number({ required: true, integer: true, min: 0 }),
      costUsd: f.number({ required: true, min: 0 }),
      latencyMs: f.number({ integer: true, min: 0 }),
      outcome: f.text({ maxLength: 20 }),
    },
    access: {
      read: ({ user }) => user !== null && isStaff(user),
      create: () => false,
      update: () => false,
      delete: () => false,
    },
    admin: { ...hidden },
  });
}

/** Monthly USD budgets. `tenant` is a tenant id, or `*` for the platform cap. */
export function docQuotasCollection(isStaff: IsStaff) {
  return defineCollection({
    slug: DOC_QUOTAS,
    labels: { singular: "Document reading budget", plural: "Document reading budgets" },
    fields: {
      tenant: f.text({ required: true, unique: true, maxLength: 200 }),
      monthlyUsd: f.number({ required: true, min: 0, max: 1_000_000 }),
      updatedBy: text(),
    },
    access: staffOnly(isStaff),
    admin: { useAsTitle: "tenant", ...hidden },
  });
}

export type DocTypesCollection = ReturnType<typeof docTypesCollection>;
export type DocSamplesCollection = ReturnType<typeof docSamplesCollection>;
export type DocTestRunsCollection = ReturnType<typeof docTestRunsCollection>;
export type DocJobsCollection = ReturnType<typeof docJobsCollection>;
export type DocUsageCollection = ReturnType<typeof docUsageCollection>;
export type DocQuotasCollection = ReturnType<typeof docQuotasCollection>;
export type DocSplitsCollection = ReturnType<typeof docSplitsCollection>;
export type DocTestResultsCollection = ReturnType<typeof docTestResultsCollection>;
export type DocCorrectionsCollection = ReturnType<typeof docCorrectionsCollection>;
