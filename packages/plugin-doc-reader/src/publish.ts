/**
 * Rules against overfitting, checked when a draft is published.
 *
 * Before the type is split, a draft needs one finished run of its current revision (as
 * before). Once it is split:
 *
 * 1. The draft needs a finished run of its current revision that read the `validation` split
 *    of the current split version.
 * 2. When a version is published already, it needs such a run too (the baseline), and the
 *    draft must not be worse on `validation` beyond the type's `evaluation.gate`.
 * 3. Few-shot examples must still be `dev` samples.
 * 4. Publishing starts runs of `test` and `unseen`, recorded on the version. They never decide
 *    the publication: judging on them would tune the type to them.
 */
import { listTestRuns, startRuns, TEST_RUN_JOB } from "./bench";
import { DOC_SAMPLES, DOC_TYPES } from "./collections";
import { StudioError } from "./errors";
import { sampleRevision } from "./eval-state";
import { checkExamples, examplesRevision } from "./examples";
import { compareResults, runMetrics, summarize } from "./metrics";
import { getDocReader } from "./options";
import { currentSplit } from "./splits";
import { findAll, SYSTEM, toDefinition } from "./store";

import type { TestRun } from "./bench";
import type { PublishGate } from "./definition";
import type { StudioRule } from "./errors";
import type { RunComparison, RunSummary, SampleResult } from "./metrics";
import type { DocTypeRecord, SampleRecord } from "./records";
import type { Quickben, RequestContext } from "@quickben/core";

export interface PublishCheck {
  readonly ok: boolean;
  /** Why not, when `ok` is false. */
  readonly rule: StudioRule | null;
  /** One line per failed gate check. */
  readonly reasons: readonly string[];
  readonly splitVersion: number | null;
  /** The draft's validation run that counts. */
  readonly run: TestRun | null;
  /** The published version's validation run it was compared with. */
  readonly baseline: TestRun | null;
  readonly baselineVersion: number | null;
  /** Reference = baseline, candidate = draft, over `validation` samples. */
  readonly comparison: RunComparison | null;
}

export interface EvaluationRun {
  readonly runId: string;
  readonly summary: RunSummary | null;
  readonly state?: TestRun["state"];
}

/** Stored on a published version: the runs of its publication. */
export interface VersionEvaluation {
  readonly splitVersion: number | null;
  readonly validation: EvaluationRun | null;
  readonly baseline: (EvaluationRun & { readonly version: number }) | null;
  readonly test: EvaluationRun | null;
  readonly unseen: EvaluationRun | null;
}

/** Whether a version may be published before the type is split: a finished run of it as it is. */
export function canPublish(
  version: { readonly state: string; readonly revision: string; readonly updatedAt: string },
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

const onValidation = (results: readonly SampleResult[]) =>
  results.filter((result) => result.split === "validation");

const readValidation = (run: TestRun, splitVersion: number, samples: readonly SampleRecord[]) => {
  const readIds = new Set(
    run.results
      .filter((result) => result.split === "validation" && result.skipped === undefined)
      .map((result) => `${result.sampleId}:${result.sampleRevision ?? ""}`),
  );
  return (
    run.state === "done" &&
    run.variant === null &&
    run.splitVersion === splitVersion &&
    (run.splits?.includes("validation") ?? false) &&
    samples.length > 0 &&
    samples.every((sample) => readIds.has(`${sample.id}:${sampleRevision(sample)}`))
  );
};

const pct = (ratio: number) => `${(ratio * 100).toFixed(1)} %`;

/** Failed checks of the gate, as sentences. */
export function gateReasons(gate: PublishGate, comparison: RunComparison): string[] {
  const reasons: string[] = [];
  const { accuracy } = comparison;
  if (accuracy.delta !== null && accuracy.delta < -gate.maxAccuracyDrop - 1e-9) {
    reasons.push(
      `accuracy ${pct(accuracy.b ?? 0)} vs ${pct(accuracy.a ?? 0)} published (allowed drop ${pct(gate.maxAccuracyDrop)})`,
    );
  }
  if (gate.maxFieldDrop !== null) {
    for (const field of comparison.fields) {
      if (!field.scored || field.delta === null) continue;
      if (field.delta < -gate.maxFieldDrop - 1e-9) {
        reasons.push(
          `${field.key}: ${pct(field.b ?? 0)} vs ${pct(field.a ?? 0)} (allowed drop ${pct(gate.maxFieldDrop)})`,
        );
      }
    }
  }
  const cost = comparison.costPerDocUsd;
  if (gate.maxCostIncrease !== null && cost.b > cost.a * (1 + gate.maxCostIncrease)) {
    reasons.push(
      `cost per document ${String(cost.b)} USD vs ${String(cost.a)} (allowed increase ${pct(gate.maxCostIncrease)})`,
    );
  }
  const p95 = comparison.p95LatencyMs;
  if (
    gate.maxLatencyIncrease !== null &&
    p95.a > 0 &&
    p95.b > p95.a * (1 + gate.maxLatencyIncrease)
  ) {
    reasons.push(
      `p95 latency ${String(p95.b)} ms vs ${String(p95.a)} (allowed increase ${pct(gate.maxLatencyIncrease)})`,
    );
  }
  return reasons;
}

async function newestPublished(
  qb: Quickben,
  ctx: RequestContext,
  key: string,
): Promise<DocTypeRecord | undefined> {
  const records = await findAll<DocTypeRecord>(
    qb,
    DOC_TYPES,
    { key: { eq: key }, state: { eq: "published" } },
    ctx,
    { sort: "-version" },
  );
  return records[0];
}

const refused = (rule: StudioRule, rest: Partial<PublishCheck> = {}): PublishCheck => ({
  ok: false,
  rule,
  reasons: [],
  splitVersion: null,
  run: null,
  baseline: null,
  baselineVersion: null,
  comparison: null,
  ...rest,
});

/** Whether a draft may be published now, and why not. */
export async function checkPublish(
  qb: Quickben,
  ctx: RequestContext,
  record: DocTypeRecord,
): Promise<PublishCheck> {
  if (record.state !== "draft") return refused("published");
  const split = await currentSplit(qb, ctx, record.key);
  const runs = await listTestRuns(qb, ctx, record.key, record.version, 200);
  if (!split) {
    const run = runs.find((r) => canPublish(record, [r])) ?? null;
    return run ? { ...refused("not-tested"), ok: true, rule: null, run } : refused("not-tested");
  }
  const splitVersion = split.version;
  const validation = await findAll<SampleRecord>(
    qb,
    DOC_SAMPLES,
    { typeKey: { eq: record.key }, split: { eq: "validation" } },
    ctx,
    {},
  );

  const type = toDefinition(record);
  const revision = await examplesRevision(qb, type);
  const run =
    runs.find(
      (r) =>
        readValidation(r, splitVersion, validation) &&
        runMetrics(type, onValidation(r.results)).global.checked > 0 &&
        r.examplesRevision === revision &&
        r.typeRevision === record.revision &&
        r.createdAt >= record.updatedAt,
    ) ?? null;
  if (!run) return refused("not-validated", { splitVersion });
  const published = await newestPublished(qb, ctx, record.key);
  if (!published) return { ...refused("gate", { splitVersion, run }), ok: true, rule: null };
  const baseRuns = await listTestRuns(qb, ctx, record.key, published.version, 200);
  const baseline =
    baseRuns.find(
      (r) =>
        readValidation(r, splitVersion, validation) &&
        runMetrics(type, onValidation(r.results)).global.checked > 0,
    ) ?? null;
  if (!baseline) {
    return refused("no-baseline", { splitVersion, run, baselineVersion: published.version });
  }
  const comparison = compareResults(
    type,
    onValidation(baseline.results),
    onValidation(run.results),
  );
  const reasons = gateReasons(type.evaluation.gate, comparison);
  if (comparison.accuracy.delta === null) reasons.push("No scored validation fields in common");
  return {
    ok: reasons.length === 0,
    rule: reasons.length === 0 ? null : "gate",
    reasons,
    splitVersion,
    run,
    baseline,
    baselineVersion: published.version,
    comparison,
  };
}

const MESSAGES: Partial<Record<StudioRule, string>> = {
  "not-tested": "Test this version on its samples before publishing it",
  "not-validated": "Run this draft, as it is now, on the validation split before publishing it",
  "no-baseline":
    "Run the published version on the validation split of the current split, to compare",
  gate: "This draft is worse than the published version on validation",
};

/** Throw the check's refusal, if any. */
export function assertPublishable(check: PublishCheck): void {
  if (check.ok || check.rule === null) return;
  throw new StudioError(
    check.rule,
    MESSAGES[check.rule] ?? "This version cannot be published",
    check.reasons,
  );
}

/** Few-shot examples must be dev samples when the type is split. */
export async function checkExamplesForPublish(
  qb: Quickben,
  ctx: RequestContext,
  record: DocTypeRecord,
  check: PublishCheck,
): Promise<void> {
  if (check.splitVersion === null) return;
  await checkExamples(qb, ctx, record.key, toDefinition(record).examples);
}

const summaryOf = (run: TestRun | null): EvaluationRun | null =>
  run
    ? { runId: run.id, summary: summarize(onValidation(run.results), run.summary?.wallMs ?? null) }
    : null;

/** What a publication stores before its held-out runs start. */
export function initialEvaluation(check: PublishCheck): VersionEvaluation {
  return {
    splitVersion: check.splitVersion,
    validation: summaryOf(check.run),
    baseline:
      check.baseline && check.baselineVersion !== null
        ? {
            runId: check.baseline.id,
            summary: summaryOf(check.baseline)?.summary ?? null,
            version: check.baselineVersion,
          }
        : null,
    test: null,
    unseen: null,
  };
}

export interface PublishOptions {
  /** Samples read at the same time in the held-out runs. */
  readonly concurrency?: number;
  /** Spending limit of each held-out run (USD). */
  readonly maxCostUsd?: number;
}

async function publicationRun(
  qb: Quickben,
  ctx: RequestContext,
  record: DocTypeRecord,
  splitVersion: number,
  split: "test" | "unseen",
  options: PublishOptions,
): Promise<TestRun | undefined> {
  if ((await currentSplit(qb, ctx, record.key))?.version !== splitVersion) {
    throw new StudioError(
      "changed",
      "The split changed; held-out runs cannot use a different dataset",
    );
  }
  const previous = (await listTestRuns(qb, ctx, record.key, record.version, 200)).find(
    (run) =>
      run.purpose === "publish" &&
      run.splitVersion === splitVersion &&
      run.splits?.length === 1 &&
      run.splits[0] === split,
  );
  if (previous) {
    if (previous.state === "running") {
      for (let lane = 1; lane <= previous.concurrency; lane += 1) {
        await getDocReader(qb).runner.enqueue(`${TEST_RUN_JOB}${previous.id}`, lane);
      }
    }
    return previous;
  }

  const [run] = await startRuns(
    qb,
    ctx,
    record.key,
    record.version,
    {
      split,
      heldOut: true,
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
      ...(options.maxCostUsd === undefined ? {} : { maxCostUsd: options.maxCostUsd }),
    },
    "publish",
  );
  return run;
}

/** Start the `test` and `unseen` runs of a publication and record them on the version. */
export async function startHeldOutRuns(
  qb: Quickben,
  ctx: RequestContext,
  record: DocTypeRecord,
  evaluation: VersionEvaluation,
  options: PublishOptions = {},
): Promise<VersionEvaluation> {
  if (evaluation.splitVersion === null) return evaluation;
  const next: { -readonly [K in keyof VersionEvaluation]: VersionEvaluation[K] } = {
    ...evaluation,
  };
  for (const split of ["test", "unseen"] as const) {
    if (next[split]) continue;
    try {
      const run = await publicationRun(qb, ctx, record, evaluation.splitVersion, split, options);
      if (run) next[split] = { runId: run.id, summary: null };
      await qb.update(DOC_TYPES, record.id, { evaluation: next }, SYSTEM);
    } catch (error) {
      // A split with no samples has nothing to measure.
      if (!(error instanceof StudioError && error.rule === "no-samples")) throw error;
    }
  }
  await qb.update(DOC_TYPES, record.id, { evaluation: next }, SYSTEM);
  return next;
}

/** A version's publication runs, with the summaries of runs that ended since. */
export async function getEvaluation(
  qb: Quickben,
  ctx: RequestContext,
  record: Pick<DocTypeRecord, "key" | "version" | "evaluation">,
): Promise<VersionEvaluation | null> {
  const stored = record.evaluation ?? null;
  if (!stored) return null;
  const runs = await listTestRuns(qb, ctx, record.key, record.version, 200);
  const byId = new Map(runs.map((run) => [run.id, run]));
  const fill = (entry: EvaluationRun | null): EvaluationRun | null => {
    if (!entry) return null;
    const run = byId.get(entry.runId);
    return run ? { runId: run.id, summary: run.summary, state: run.state } : entry;
  };
  return { ...stored, test: fill(stored.test), unseen: fill(stored.unseen) };
}
