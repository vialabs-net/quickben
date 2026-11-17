/**
 * Headless helpers for apps that build their own review UI on test runs: how each field came
 * out, the errors of a run per sample and as a list, and the fields of one sample with the
 * expected value saved now next to what a run read.
 */
import { HELD_OUT_SPLITS } from "./collections";
import { isScored } from "./definition";
import { isEmptyValue } from "./metrics";

import type { TestRunHead } from "./bench";
import type { Split } from "./collections";
import type { DocumentType } from "./definition";
import type { CheckEvidence, FieldCheck, SampleResult } from "./metrics";

/** How a field came out. `unchecked`: no expected value, or not read. */
export type FieldStatus = "correct" | "near" | "wrong" | "missed" | "hallucinated" | "unchecked";

/** The status of a field check. */
export function fieldStatus(check: FieldCheck): FieldStatus {
  switch (check.outcome ?? null) {
    case "correct":
    case "correct-empty":
      return "correct";
    case "near":
      return "near";
    case "wrong":
      return "wrong";
    case "missed":
      return "missed";
    case "hallucinated":
      return "hallucinated";
    default:
      return check.match === false ? "wrong" : "unchecked";
  }
}

/** Wrong, missed or hallucinated. */
export const isWrongStatus = (status: FieldStatus): boolean =>
  status === "wrong" || status === "missed" || status === "hallucinated";

/** `test` and `unseen`. */
export const isHeldOutSplit = (split: Split | null | undefined): boolean =>
  split !== null && split !== undefined && HELD_OUT_SPLITS.includes(split);

/** Wrong reads among the scored fields of a result. */
export function sampleErrors(result: SampleResult): number {
  return result.fields.filter(
    (check) => check.scored !== false && isWrongStatus(fieldStatus(check)),
  ).length;
}

/** Errors per sample of a run's results; `null` for samples it skipped or that failed. */
export function errorsBySample(results: readonly SampleResult[]): Map<string, number | null> {
  return new Map(
    results.map((result) => [
      result.sampleId,
      result.skipped || result.failed ? null : sampleErrors(result),
    ]),
  );
}

/** A wrong scored field of a run. */
export interface RunProblem {
  readonly sampleId: string;
  /** The sample's key, else its file name. */
  readonly sampleName: string;
  readonly split: Split | null;
  readonly group: string | null;
  readonly field: string;
  readonly label: string;
  readonly expected: string | null;
  readonly read: string | null;
  readonly status: FieldStatus;
}

/**
 * Every wrong scored field of a run's results, in result order. `heldOut: false` leaves out
 * `test` and `unseen` samples. Skipped and failed samples have no problems.
 */
export function runProblems(
  results: readonly SampleResult[],
  options: { heldOut?: boolean } = {},
): RunProblem[] {
  return results.flatMap((result) => {
    if (result.skipped || result.failed) return [];
    if (options.heldOut === false && isHeldOutSplit(result.split)) return [];
    return result.fields.flatMap((check): RunProblem[] => {
      const status = fieldStatus(check);
      if (check.scored === false || !isWrongStatus(status)) return [];
      return [
        {
          sampleId: result.sampleId,
          sampleName: result.sampleKey ?? result.fileName,
          split: result.split ?? null,
          group: result.group ?? null,
          field: check.key,
          label: check.label,
          expected: check.expected,
          read: check.read,
          status,
        },
      ];
    });
  });
}

/** A field of one sample: the expected value saved now and what a run read. */
export interface SampleFieldView {
  readonly key: string;
  readonly label: string;
  /** First segment of the key (`vehicle` of `vehicle.make`), or `""`. */
  readonly group: string;
  /** Expected value saved on the sample now. */
  readonly expected: string | null;
  /** Expected value when the run read it; differs after a correction. */
  readonly runExpected: string | null;
  readonly read: string | null;
  readonly status: FieldStatus;
  readonly confidence: number | null;
  /** Read below the type's threshold. */
  readonly low: boolean;
  readonly scored: boolean;
  /** Page, nearby text and, when known, the box (page fractions). */
  readonly evidence: CheckEvidence | null;
  readonly step: { readonly index: number; readonly extractor: string } | null;
}

const groupOf = (key: string) => {
  const at = key.indexOf(".");
  return at < 0 ? "" : key.slice(0, at);
};

/**
 * The fields of a sample in definition order, with a result's reads and statuses. Fields the
 * result has but the definition no longer has come last. Without a result every field is
 * `unchecked`.
 */
export function sampleFieldViews(
  type: DocumentType,
  expected: Readonly<Record<string, string>>,
  result: SampleResult | null,
): SampleFieldView[] {
  const checks = new Map((result?.fields ?? []).map((check) => [check.key, check]));
  const defined = new Map(type.fields.map((field) => [field.key, field]));
  const keys = [...defined.keys(), ...[...checks.keys()].filter((key) => !defined.has(key))];
  return keys.map((key) => {
    const field = defined.get(key);
    const check = checks.get(key);
    const read = check?.read ?? null;
    return {
      key,
      label: field?.label ?? check?.label ?? key,
      group: groupOf(key),
      expected: expected[key] ?? null,
      runExpected: check ? check.expected : null,
      read,
      status: check ? fieldStatus(check) : "unchecked",
      confidence: check?.confidence ?? null,
      low:
        read !== null &&
        !isEmptyValue(read, type.evaluation.emptyValues) &&
        (check?.confidence ?? 0) < type.pipeline.threshold,
      scored: field ? isScored(field) : check?.scored !== false,
      evidence: check?.evidence ?? null,
      step: check?.step ?? null,
    };
  });
}

/**
 * The run to show for a sample from `listSampleRuns`: the first of `prefer` that read it, else
 * the newest of `version`, else the newest.
 */
export function pickSampleRun<T extends { readonly run: Pick<TestRunHead, "id" | "typeVersion"> }>(
  history: readonly T[],
  prefer: readonly string[],
  version?: number,
): T | null {
  for (const id of prefer) {
    const entry = history.find((candidate) => candidate.run.id === id);
    if (entry) return entry;
  }
  return history.find((entry) => entry.run.typeVersion === version) ?? history[0] ?? null;
}
