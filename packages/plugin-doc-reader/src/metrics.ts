/**
 * Scoring of test runs: each field read compared with the sample's expected value, then
 * accuracy, misses and hallucinations by field, group, attribute and split, latency
 * percentiles, tokens and cost.
 *
 * | Expected | Read     | Outcome         | Counts as |
 * | -------- | -------- | --------------- | --------- |
 * | value    | same     | `correct`       | right     |
 * | value    | other    | `wrong`         | wrong     |
 * | value    | empty    | `missed`        | wrong     |
 * | empty    | empty    | `correct-empty` | right     |
 * | empty    | value    | `hallucinated`  | wrong     |
 *
 * "Empty" is `null`, blank, or one of the type's `evaluation.emptyValues` (default `-`, `-1`).
 * A sample without an expected value for a field does not check it. Fields with
 * `scored: false` are reported but left out of accuracy. Samples that failed (the provider
 * kept failing) or were skipped (spending limit) are counted apart, never as wrong reads.
 */
import { DEFAULT_EMPTY_VALUES, isScored } from "./definition";
import { sameFieldValue } from "./field-values";

import type { Split } from "./collections";
import type { DocumentType, FieldDefinition } from "./definition";
import type { ExtractionStatus, FieldEvidence, FieldValue } from "./extractor";
import type { PipelineAttempt, PipelineResult } from "./pipeline";

export const FIELD_OUTCOMES = [
  "correct",
  "correct-empty",
  "wrong",
  "missed",
  "hallucinated",
] as const;
export type FieldOutcome = (typeof FIELD_OUTCOMES)[number];

export interface FieldCheck {
  readonly key: string;
  readonly label: string;
  readonly expected: string | null;
  readonly read: string | null;
  readonly confidence: number | null;
  /** `null` when the sample has no expected value for the field. */
  readonly match: boolean | null;
  /** `null` when the sample has no expected value for the field. */
  readonly outcome?: FieldOutcome | null;
  /** `false`: reported, not counted. */
  readonly scored?: boolean;
  /** Where the value is: page, nearby text and, when known, its box. */
  readonly evidence?: CheckEvidence | null;
  /** The pipeline step whose value was kept. */
  readonly step?: { readonly index: number; readonly extractor: string } | null;
}

/** Evidence of a read value. `source` says where the box comes from. */
export interface CheckEvidence extends FieldEvidence {
  /** `text-layer`: found in the PDF's own text. `model`: drawn by the vision model. */
  readonly source?: "text-layer" | "model";
}

export type SampleAttributes = Readonly<Record<string, string | number | boolean | null>>;

export interface SampleResult {
  readonly sampleId: string;
  readonly sampleRevision?: string;
  readonly fileName: string;
  readonly status: ExtractionStatus;
  /** Time of the pipeline run that counted (the last try). */
  readonly durationMs: number;
  readonly costUsd: number;
  readonly fields: FieldCheck[];
  readonly error?: string;
  readonly sampleKey?: string | null;
  readonly split?: Split | null;
  readonly group?: string | null;
  readonly attributes?: SampleAttributes;
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  /** Tries after the first one, when the provider failed. */
  readonly retries?: number;
  /** The provider kept failing: left out of accuracy. */
  readonly failed?: boolean;
  /** Not read: the run hit its spending limit. */
  readonly skipped?: "budget" | "held-out";
  /** Pages sent to paid extractors, all tries. */
  readonly pages?: number;
  /** Extra model calls that repaired an incomplete or invalid answer (last try). */
  readonly repairs?: number;
}

export interface RunSummary {
  readonly samples: number;
  readonly checked: number;
  readonly matched: number;
  /** matched / checked, or `null` when nothing had an expected value. */
  readonly accuracy: number | null;
  readonly costUsd: number;
  readonly avgLatencyMs: number;
  readonly failed?: number;
  readonly skipped?: number;
  readonly retries?: number;
  readonly p50LatencyMs?: number;
  readonly p95LatencyMs?: number;
  readonly costPerDocUsd?: number;
  /** From the start of the run to its end. */
  readonly wallMs?: number | null;
}

export interface OutcomeCounts {
  readonly checked: number;
  readonly correct: number;
  readonly correctEmpty: number;
  readonly wrong: number;
  readonly missed: number;
  readonly hallucinated: number;
  /** (correct + correctEmpty) / checked, or `null` when nothing was checked. */
  readonly accuracy: number | null;
}

export interface FieldMetrics extends OutcomeCounts {
  readonly key: string;
  readonly label: string;
  readonly scored: boolean;
}

export interface SliceMetrics extends OutcomeCounts {
  readonly value: string;
  readonly samples: number;
}

export interface LatencyMetrics {
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

export interface RunMetrics {
  readonly samples: number;
  /** Samples read and scored: not failed, not skipped. */
  readonly scored: number;
  readonly failed: number;
  readonly skipped: number;
  readonly retries: number;
  /** Samples whose answer needed a repair call. */
  readonly repaired?: number;
  /** Repair calls, all samples. */
  readonly repairs?: number;
  /** Samples where a step failed (e.g. the provider refused it), even if a later step read them. */
  readonly stepErrors?: number;
  readonly statuses: Readonly<Partial<Record<ExtractionStatus, number>>>;
  /** Scored fields only. */
  readonly global: OutcomeCounts;
  readonly byField: FieldMetrics[];
  readonly byGroup: SliceMetrics[];
  readonly bySplit: SliceMetrics[];
  /** By attribute name, then by value. */
  readonly byAttribute: Readonly<Record<string, SliceMetrics[]>>;
  /** Per document, over samples that were read. */
  readonly latency: LatencyMetrics;
  readonly wallMs: number | null;
  readonly tokens: {
    readonly input: number;
    readonly cachedInput: number;
    readonly output: number;
    readonly perDoc: number;
  };
  readonly cost: { readonly totalUsd: number; readonly perDocUsd: number };
}

const roundUsd = (usd: number) => Math.round(usd * 1e6) / 1e6;

/** Whether a value means "empty": `null`, blank, or one of `emptyValues`. */
export function isEmptyValue(
  value: string | null | undefined,
  emptyValues: readonly string[],
): boolean {
  if (value === null || value === undefined) return true;
  const text = value.trim();
  return text === "" || emptyValues.includes(text);
}

/** The outcome of one field, or `null` when there is no expected value. */
export function fieldOutcome(
  field: Pick<FieldDefinition, "type" | "transform" | "pattern" | "dateOrder" | "decimalSeparator">,
  expected: string | null,
  read: string | null,
  emptyValues: readonly string[],
): FieldOutcome | null {
  if (expected === null) return null;
  const wantEmpty = isEmptyValue(expected, emptyValues);
  const gotEmpty = isEmptyValue(read, emptyValues);
  if (wantEmpty) return gotEmpty ? "correct-empty" : "hallucinated";
  if (gotEmpty) return "missed";
  return sameFieldValue(field, expected, read) ? "correct" : "wrong";
}

const isRight = (outcome: FieldOutcome | null | undefined) =>
  outcome === "correct" || outcome === "correct-empty";

/** Each field read compared with the sample's expected value. */
export function checkFields(
  type: DocumentType,
  expected: Readonly<Record<string, string>>,
  result: Pick<PipelineResult, "fields"> & { readonly attempts?: readonly PipelineAttempt[] },
): FieldCheck[] {
  const emptyValues = type.evaluation.emptyValues;
  return type.fields.map((field) => {
    const read = Object.hasOwn(result.fields, field.key) ? result.fields[field.key] : undefined;
    const want = Object.hasOwn(expected, field.key) ? (expected[field.key] ?? "") : null;
    const outcome = fieldOutcome(field, want, read?.value ?? null, emptyValues);
    return {
      key: field.key,
      label: field.label,
      expected: want,
      read: read?.value ?? null,
      confidence: read?.confidence ?? null,
      match: outcome === null ? null : isRight(outcome),
      outcome,
      scored: isScored(field),
      ...(read?.evidence ? { evidence: read.evidence } : {}),
      ...(read && result.attempts ? { step: stepOf(result.attempts, field.key, read) } : {}),
    };
  });
}

/** The first step that read the value the pipeline kept. */
function stepOf(
  attempts: readonly PipelineAttempt[],
  key: string,
  kept: FieldValue,
): { index: number; extractor: string } | null {
  const attempt = attempts.find((a) => {
    const value = Object.hasOwn(a.fields, key) ? a.fields[key] : undefined;
    return value?.value === kept.value && value.confidence === kept.confidence;
  });
  return attempt ? { index: attempt.step, extractor: attempt.extractor } : null;
}

/** Outcome of a check written before outcomes existed: from `match` alone. */
const outcomeOf = (check: FieldCheck): FieldOutcome | null => {
  if (check.outcome !== undefined) return check.outcome;
  if (check.match === null) return null;
  return check.match ? "correct" : "wrong";
};

/** Samples that count in accuracy and latency. */
export const isScoredResult = (result: SampleResult) =>
  result.failed !== true && result.skipped === undefined;

function countOutcomes(checks: readonly FieldCheck[]): OutcomeCounts {
  const counts = { checked: 0, correct: 0, correctEmpty: 0, wrong: 0, missed: 0, hallucinated: 0 };
  for (const check of checks) {
    const outcome = outcomeOf(check);
    if (outcome === null || check.scored === false) continue;
    counts.checked += 1;
    if (outcome === "correct") counts.correct += 1;
    else if (outcome === "correct-empty") counts.correctEmpty += 1;
    else if (outcome === "wrong") counts.wrong += 1;
    else if (outcome === "missed") counts.missed += 1;
    else counts.hallucinated += 1;
  }
  return {
    ...counts,
    accuracy: counts.checked > 0 ? (counts.correct + counts.correctEmpty) / counts.checked : null,
  };
}

/** Nearest-rank percentile of sorted numbers. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? 0;
}

function slices(
  results: readonly SampleResult[],
  key: (result: SampleResult) => string | null,
): SliceMetrics[] {
  const groups = new Map<string, SampleResult[]>();
  for (const result of results) {
    const value = key(result);
    if (value === null) continue;
    const group = groups.get(value) ?? [];
    group.push(result);
    groups.set(value, group);
  }
  return [...groups.entries()]
    .map(([value, group]) => ({
      value,
      samples: group.length,
      ...countOutcomes(group.flatMap((result) => result.fields)),
    }))
    .sort((a, b) => b.samples - a.samples || a.value.localeCompare(b.value));
}

const attributeText = (value: string | number | boolean | null | undefined): string | null =>
  value === null || value === undefined ? null : String(value);

/** Full metrics of a run's results. `wallMs`: from the run's start to its end. */
export function runMetrics(
  type: Pick<DocumentType, "fields">,
  results: readonly SampleResult[],
  wallMs: number | null = null,
): RunMetrics {
  const scored = results.filter((result) => isScoredResult(result));
  const checks = scored.flatMap((result) => result.fields);
  const byField = type.fields.map((field) => ({
    key: field.key,
    label: field.label,
    scored: isScored(field),
    ...countOutcomes(
      checks
        .filter((check) => check.key === field.key)
        .map((check) => ({ ...check, scored: true })),
    ),
  }));
  const statuses: Partial<Record<ExtractionStatus, number>> = {};
  for (const result of scored) statuses[result.status] = (statuses[result.status] ?? 0) + 1;

  const attributeNames = new Set(scored.flatMap((result) => Object.keys(result.attributes ?? {})));
  const byAttribute: Record<string, SliceMetrics[]> = {};
  for (const name of [...attributeNames].sort((x, y) => x.localeCompare(y))) {
    byAttribute[name] = slices(scored, (result) =>
      attributeText(
        Object.hasOwn(result.attributes ?? {}, name) ? result.attributes?.[name] : null,
      ),
    );
  }

  const durations = scored.map((result) => result.durationMs).sort((a, b) => a - b);
  const sum = (values: readonly number[]) => values.reduce((total, n) => total + n, 0);
  const totalUsd = roundUsd(sum(results.map((result) => result.costUsd)));
  const read = results.filter((result) => result.skipped === undefined).length;
  const input = sum(results.map((result) => result.inputTokens ?? 0));
  const output = sum(results.map((result) => result.outputTokens ?? 0));
  return {
    samples: results.length,
    scored: scored.length,
    failed: results.filter((result) => result.failed === true).length,
    skipped: results.filter((result) => result.skipped !== undefined).length,
    retries: sum(results.map((result) => result.retries ?? 0)),
    repaired: results.filter((result) => (result.repairs ?? 0) > 0).length,
    repairs: sum(results.map((result) => result.repairs ?? 0)),
    stepErrors: results.filter((result) => result.error !== undefined && result.error !== "")
      .length,
    statuses,
    global: countOutcomes(checks),
    byField,
    byGroup: slices(scored, (result) => result.group ?? null),
    bySplit: slices(scored, (result) => result.split ?? null),
    byAttribute,
    latency: {
      meanMs: durations.length > 0 ? Math.round(sum(durations) / durations.length) : 0,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      maxMs: durations.at(-1) ?? 0,
    },
    wallMs,
    tokens: {
      input,
      cachedInput: sum(results.map((result) => result.cachedInputTokens ?? 0)),
      output,
      perDoc: read > 0 ? Math.round((input + output) / read) : 0,
    },
    cost: { totalUsd, perDocUsd: read > 0 ? roundUsd(totalUsd / read) : 0 },
  };
}

/** The short summary kept on a run. */
export function summarize(
  results: readonly SampleResult[],
  wallMs: number | null = null,
): RunSummary {
  const scored = results.filter((result) => isScoredResult(result));
  const counts = countOutcomes(scored.flatMap((result) => result.fields));
  const durations = scored.map((result) => result.durationMs).sort((a, b) => a - b);
  const latency = durations.reduce((total, n) => total + n, 0);
  const costUsd = roundUsd(results.reduce((total, result) => total + result.costUsd, 0));
  const read = results.filter((result) => result.skipped === undefined).length;
  return {
    samples: results.length,
    checked: counts.checked,
    matched: counts.correct + counts.correctEmpty,
    accuracy: counts.accuracy,
    costUsd,
    avgLatencyMs: durations.length > 0 ? Math.round(latency / durations.length) : 0,
    failed: results.filter((result) => result.failed === true).length,
    skipped: results.length - read,
    retries: results.reduce((total, result) => total + (result.retries ?? 0), 0),
    p50LatencyMs: percentile(durations, 50),
    p95LatencyMs: percentile(durations, 95),
    costPerDocUsd: read > 0 ? roundUsd(costUsd / read) : 0,
    wallMs,
  };
}

// ---------------------------------------------------------------------------------------------
// Comparison of two runs

export interface FieldDelta {
  readonly key: string;
  readonly label: string;
  readonly scored: boolean;
  readonly a: number | null;
  readonly b: number | null;
  /** b − a, or `null` when either is `null`. */
  readonly delta: number | null;
}

export interface CaseChange {
  readonly sampleId: string;
  readonly fileName: string;
  readonly group: string | null;
  readonly field: string;
  readonly label: string;
  readonly expected: string | null;
  readonly readA: string | null;
  readonly readB: string | null;
  readonly outcomeA: FieldOutcome | null;
  readonly outcomeB: FieldOutcome | null;
}

export interface RunComparison {
  /** Samples read and scored in both runs. */
  readonly samples: number;
  readonly accuracy: {
    readonly a: number | null;
    readonly b: number | null;
    readonly delta: number | null;
  };
  readonly costPerDocUsd: { readonly a: number; readonly b: number; readonly delta: number };
  readonly p50LatencyMs: { readonly a: number; readonly b: number; readonly delta: number };
  readonly p95LatencyMs: { readonly a: number; readonly b: number; readonly delta: number };
  readonly fields: FieldDelta[];
  /** Right in A, wrong in B. */
  readonly worse: CaseChange[];
  /** Wrong in A, right in B. */
  readonly better: CaseChange[];
}

const delta = (a: number | null, b: number | null) => (a === null || b === null ? null : b - a);

/**
 * Two runs field by field, over the samples both read. `A` is the reference (e.g. the
 * published version), `B` the candidate.
 */
export function compareResults(
  type: Pick<DocumentType, "fields"> & Partial<Pick<DocumentType, "evaluation">>,
  a: readonly SampleResult[],
  b: readonly SampleResult[],
): RunComparison {
  const inB = new Map(b.filter((result) => isScoredResult(result)).map((r) => [r.sampleId, r]));
  const pairs = a.flatMap((result) => {
    const other = isScoredResult(result) ? inB.get(result.sampleId) : undefined;
    return other ? [[result, other] as const] : [];
  });
  const common = (result: SampleResult, other: SampleResult): SampleResult => ({
    ...result,
    fields: type.fields.flatMap((field) => {
      const check = result.fields.find((c) => c.key === field.key);
      const peer = other.fields.find((c) => c.key === field.key);
      if (!check || !peer) return [];
      const outcome = fieldOutcome(
        field,
        check.expected,
        check.read,
        type.evaluation?.emptyValues ?? DEFAULT_EMPTY_VALUES,
      );
      return [
        {
          ...check,
          scored: isScored(field),
          outcome,
          match: outcome === null ? null : isRight(outcome),
        },
      ];
    }),
  });
  const scoredPairs = pairs.map(([x, y]) => [common(x, y), common(y, x)] as const);
  const left = scoredPairs.map(([x]) => x);
  const right = scoredPairs.map(([, y]) => y);
  const ma = runMetrics(type, left);
  const mb = runMetrics(type, right);
  const worse: CaseChange[] = [];
  const better: CaseChange[] = [];
  for (const [x, y] of scoredPairs) {
    const checksB = new Map(y.fields.map((check) => [check.key, check]));
    for (const checkA of x.fields) {
      const checkB = checksB.get(checkA.key);
      if (!checkB) continue;
      const outcomeA = outcomeOf(checkA);
      const outcomeB = outcomeOf(checkB);
      if (outcomeA === null || outcomeB === null) continue;
      const change: CaseChange = {
        sampleId: x.sampleId,
        fileName: x.fileName,
        group: x.group ?? null,
        field: checkA.key,
        label: checkA.label,
        expected: checkA.expected,
        readA: checkA.read,
        readB: checkB.read,
        outcomeA,
        outcomeB,
      };
      if (isRight(outcomeA) && !isRight(outcomeB)) worse.push(change);
      else if (!isRight(outcomeA) && isRight(outcomeB)) better.push(change);
    }
  }
  const fieldsB = new Map(mb.byField.map((field) => [field.key, field]));
  return {
    samples: pairs.length,
    accuracy: {
      a: ma.global.accuracy,
      b: mb.global.accuracy,
      delta: delta(ma.global.accuracy, mb.global.accuracy),
    },
    costPerDocUsd: {
      a: ma.cost.perDocUsd,
      b: mb.cost.perDocUsd,
      delta: roundUsd(mb.cost.perDocUsd - ma.cost.perDocUsd),
    },
    p50LatencyMs: {
      a: ma.latency.p50Ms,
      b: mb.latency.p50Ms,
      delta: mb.latency.p50Ms - ma.latency.p50Ms,
    },
    p95LatencyMs: {
      a: ma.latency.p95Ms,
      b: mb.latency.p95Ms,
      delta: mb.latency.p95Ms - ma.latency.p95Ms,
    },
    fields: ma.byField.map((field) => {
      const other = fieldsB.get(field.key);
      return {
        key: field.key,
        label: field.label,
        scored: field.scored,
        a: field.accuracy,
        b: other?.accuracy ?? null,
        delta: delta(field.accuracy, other?.accuracy ?? null),
      };
    }),
    worse,
    better,
  };
}

// ---------------------------------------------------------------------------------------------
// Export

const CSV_COLUMNS = [
  "sampleId",
  "sampleKey",
  "fileName",
  "split",
  "group",
  "status",
  "failed",
  "skipped",
  "retries",
  "durationMs",
  "costUsd",
  "inputTokens",
  "cachedInputTokens",
  "outputTokens",
  "field",
  "scored",
  "expected",
  "read",
  "confidence",
  "outcome",
] as const;

/** One CSV cell. Text that a spreadsheet would run as a formula is prefixed with `'`. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "string" ? value : JSON.stringify(value);
  if (
    /^[=+@\t\r]/u.test(text) ||
    (text.startsWith("-") && !/^-\d+(?:\.\d+)?(?:e[+-]?\d+)?$/iu.test(text))
  )
    text = `'${text}`;
  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** One row per sample and field, plus the sample's attributes as `attr.<name>` columns. */
export function resultsToCsv(results: readonly SampleResult[]): string {
  const attributes = [
    ...new Set(results.flatMap((result) => Object.keys(result.attributes ?? {}))),
  ].sort((a, b) => a.localeCompare(b));
  const header = [...CSV_COLUMNS, ...attributes.map((name) => `attr.${name}`)];
  const rows = [header.map((cell) => csvCell(cell)).join(",")];
  for (const result of results) {
    const sample = [
      result.sampleId,
      result.sampleKey ?? "",
      result.fileName,
      result.split ?? "",
      result.group ?? "",
      result.status,
      result.failed === true,
      result.skipped ?? "",
      result.retries ?? 0,
      result.durationMs,
      result.costUsd,
      result.inputTokens ?? 0,
      result.cachedInputTokens ?? 0,
      result.outputTokens ?? 0,
    ];
    const attrs = attributes.map((name) =>
      Object.hasOwn(result.attributes ?? {}, name) ? result.attributes?.[name] : "",
    );
    for (const check of result.fields) {
      rows.push(
        [
          ...sample,
          check.key,
          check.scored !== false,
          check.expected,
          check.read,
          check.confidence,
          outcomeOf(check) ?? "",
          ...attrs,
        ]
          .map((cell) => csvCell(cell))
          .join(","),
      );
    }
  }
  return `${rows.join("\n")}\n`;
}
