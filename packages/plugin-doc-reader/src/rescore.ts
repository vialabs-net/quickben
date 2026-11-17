/**
 * Score an earlier run again without reading anything: its read values against the expected
 * values saved now, with a version's definition as it is now (field rules, origins, scoring).
 * The result is a new run with purpose `rescore` that points at the source run. It never
 * counts for publishing.
 */
import { ValidationError } from "@quickben/core";

import { getTestRun } from "./bench";
import { DOC_SAMPLES, DOC_TEST_RESULTS, DOC_TEST_RUNS } from "./collections";
import { checkFields, runMetrics, summarize } from "./metrics";
import { findAll, SYSTEM } from "./store";
import { getVersion } from "./studio";

import type { TestRun } from "./bench";
import type { DocumentType } from "./definition";
import type { FieldValue } from "./extractor";
import type { SampleResult } from "./metrics";
import type { SampleRecord, TestRunRecord } from "./records";
import type { Quickben, RequestContext } from "@quickben/core";

/** Options of {@link rescoreTestRun}. */
export interface RescoreOptions {
  /** Version whose definition scores the reads. Default: the run's own version, as it is now. */
  readonly version?: number;
}

/** The reads of a result as pipeline fields: what was kept, with its confidence and evidence. */
function readsOf(result: SampleResult): Record<string, FieldValue> {
  const fields: Record<string, FieldValue> = {};
  for (const check of result.fields) {
    if (check.read === null) continue;
    fields[check.key] = {
      value: check.read,
      confidence: check.confidence ?? 0,
      ...(check.evidence ? { evidence: check.evidence } : {}),
    };
  }
  return fields;
}

/**
 * One result scored again with `type` and `expected`. Skipped and failed samples stay as they
 * were. The step that read each value is kept.
 */
export function rescoreResult(
  type: DocumentType,
  expected: Readonly<Record<string, string>>,
  result: SampleResult,
): SampleResult {
  if (result.skipped !== undefined || result.failed === true) return result;
  const steps = new Map(result.fields.map((check) => [check.key, check.step]));
  const fields = checkFields(type, expected, { fields: readsOf(result) }).map((check) => {
    const step = steps.get(check.key);
    return step ? { ...check, step } : check;
  });
  return { ...result, fields };
}

/**
 * Score a finished run again with the current expected values and a version's current
 * definition. No extractor runs and nothing is spent. Returns the new run.
 */
export async function rescoreTestRun(
  qb: Quickben,
  ctx: RequestContext,
  runId: string,
  options: RescoreOptions = {},
): Promise<TestRun> {
  const source = await getTestRun(qb, ctx, runId);
  if (source.state === "running") {
    throw new ValidationError([{ path: "run", message: "The run is still running" }]);
  }
  const version = await getVersion(qb, ctx, source.typeKey, options.version ?? source.typeVersion);
  const type = version.definition;
  const ids = [...new Set(source.results.map((result) => result.sampleId))];
  const samples = await findAll<SampleRecord>(qb, DOC_SAMPLES, { id: { in: ids } }, ctx);
  const expected = new Map(samples.map((sample) => [sample.id, sample.expected]));
  const results = source.results.map((result) =>
    rescoreResult(type, expected.get(result.sampleId) ?? {}, result),
  );
  const wallMs = source.metrics?.wallMs ?? source.summary?.wallMs ?? null;
  const record = (await qb.create(
    DOC_TEST_RUNS,
    {
      typeKey: source.typeKey,
      typeVersion: version.version,
      typeRevision: version.revision,
      examplesRevision: source.examplesRevision ?? null,
      compareGroup: null,
      variant: source.variant,
      pipeline: type.pipeline,
      definition: type,
      state: "done",
      results,
      summary: summarize(results, wallMs),
      metrics: runMetrics(type, results, wallMs),
      error: source.error,
      costUsd: source.costUsd,
      splits: source.splits,
      splitVersion: source.splitVersion,
      heldOut: source.heldOut,
      purpose: "rescore",
      rescoredFrom: source.id,
      sampleIds: ids,
      total: source.total,
      concurrency: 1,
      maxCostUsd: null,
      retries: 0,
      finishedAt: new Date().toISOString(),
      createdBy: ctx.user?.email ?? ctx.user?.id ?? null,
    },
    ctx,
  )) as unknown as TestRunRecord;
  for (const [index, result] of results.entries()) {
    await qb.create(
      DOC_TEST_RESULTS,
      {
        run: record.id,
        index,
        slot: `${record.id}:${String(index)}`,
        sampleId: result.sampleId,
        lane: 0,
        laneCostUsd: 0,
        costUsd: result.costUsd,
        result,
      },
      SYSTEM,
    );
  }
  return getTestRun(qb, ctx, record.id);
}
