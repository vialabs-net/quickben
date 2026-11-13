/**
 * Runs a type's extractors in order and merges what they read.
 *
 * Per field, the first value at or above the threshold wins; a later step never overwrites it.
 * Below the threshold the most confident value so far is kept, so the user still sees a
 * suggestion. The run stops as soon as the type's stop rule is met, so a free extractor that
 * reads everything spares the paid ones.
 */
import { requiredFields } from "./definition";

import type { DocumentType, ExtractionParams, PipelineStep } from "./definition";
import type {
  ExtractionResult,
  ExtractionStatus,
  ExtractionUsage,
  Extractor,
  ExtractorInput,
  FieldValue,
} from "./extractor";

export interface PipelineAttempt {
  readonly step: number;
  readonly extractor: string;
  readonly status: ExtractionStatus | "SKIPPED";
  readonly fields: Readonly<Record<string, FieldValue>>;
  readonly usage?: ExtractionUsage;
  readonly problems?: Readonly<Record<string, unknown>>;
  readonly durationMs: number;
}

export interface PipelineResult {
  readonly status: ExtractionStatus;
  readonly fields: Record<string, FieldValue>;
  /** Required fields not read at the threshold. */
  readonly missing: string[];
  readonly attempts: PipelineAttempt[];
}

/** A reason to skip a step (e.g. over budget), or `undefined` to run it. */
export type SkipHook = (extractor: Extractor, step: PipelineStep) => string | undefined;

export interface PipelineOptions {
  readonly type: DocumentType;
  readonly input: ExtractorInput;
  readonly params: ExtractionParams;
  readonly tenant: string | null;
  readonly jobId?: string;
  readonly signal?: AbortSignal;
  readonly extractors: Readonly<Record<string, Extractor>>;
  readonly skip?: SkipHook;
  readonly now?: () => number;
}

/** First confident value wins; otherwise keep the most confident one. */
export function mergeFields(
  current: Readonly<Record<string, FieldValue>>,
  next: Readonly<Record<string, FieldValue>>,
  threshold: number,
): Record<string, FieldValue> {
  const merged: Record<string, FieldValue> = { ...current };
  for (const [key, value] of Object.entries(next)) {
    if (!value.value) continue;
    const held = Object.hasOwn(merged, key) ? merged[key] : undefined;
    if (!held || (held.confidence < threshold && value.confidence > held.confidence)) {
      merged[key] = value;
    }
  }
  return merged;
}

/** Fields the stop rule still waits for. */
export function pendingFields(
  type: DocumentType,
  fields: Readonly<Record<string, FieldValue>>,
  stopWhen: "required" | "all" = type.pipeline.stopWhen,
): string[] {
  const keys = stopWhen === "all" ? type.fields.map((field) => field.key) : requiredFields(type);
  return keys.filter((key) => {
    const value = Object.hasOwn(fields, key) ? fields[key] : undefined;
    return (value?.confidence ?? -1) < type.pipeline.threshold;
  });
}

// When nothing was read, the most telling failure wins: a broken extractor beats "no text",
// which beats "not this format".
const failureRank: Record<ExtractionStatus, number> = {
  OK: 0,
  INCOMPLETE: 0,
  NO_MATCH: 1,
  NO_TEXT: 2,
  ERROR: 3,
};

function errorResult(error: unknown): ExtractionResult {
  const message = error instanceof Error ? error.message : String(error);
  return { status: "ERROR", fields: {}, problems: { error: message.slice(0, 300) } };
}

/** One step as an attempt. Never throws. */
async function runStep(
  options: PipelineOptions,
  step: PipelineStep,
  index: number,
  now: () => number,
): Promise<PipelineAttempt> {
  const base = { step: index, extractor: step.extractor, fields: {}, durationMs: 0 };
  const extractor = Object.hasOwn(options.extractors, step.extractor)
    ? options.extractors[step.extractor]
    : undefined;
  if (!extractor) {
    return { ...base, status: "ERROR", problems: { error: `unknown extractor ${step.extractor}` } };
  }
  const reason = options.skip?.(extractor, step);
  if (reason) return { ...base, status: "SKIPPED", problems: { skipped: reason } };

  const started = now();
  let result: ExtractionResult;
  try {
    result = await extractor.extract(options.input, options.type, options.params, {
      tenant: options.tenant,
      config: step.config,
      ...(options.jobId === undefined ? {} : { jobId: options.jobId }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    result = errorResult(error);
  }
  return {
    ...base,
    status: result.status,
    fields: result.fields,
    ...(result.usage ? { usage: result.usage } : {}),
    ...(result.problems ? { problems: result.problems } : {}),
    durationMs: now() - started,
  };
}

function finalStatus(
  missing: readonly string[],
  fields: Readonly<Record<string, FieldValue>>,
  failure: ExtractionStatus,
): ExtractionStatus {
  if (Object.keys(fields).length === 0) return failure;
  return missing.length === 0 ? "OK" : "INCOMPLETE";
}

/** Run the pipeline of `options.type`. Never throws for a document it cannot read. */
export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const { type } = options;
  const now = options.now ?? Date.now;
  const attempts: PipelineAttempt[] = [];
  let fields: Record<string, FieldValue> = {};
  let failure: ExtractionStatus = "NO_MATCH";

  for (const [index, step] of type.pipeline.steps.entries()) {
    // The first step always runs, so a type with nothing required still reads.
    if (index > 0 && pendingFields(type, fields).length === 0) break;
    if (options.signal?.aborted) break;
    const attempt = await runStep(options, step, index, now);
    attempts.push(attempt);
    if (attempt.status === "SKIPPED") continue;
    if (failureRank[attempt.status] > failureRank[failure]) failure = attempt.status;
    fields = mergeFields(fields, attempt.fields, type.pipeline.threshold);
  }

  const missing = pendingFields(type, fields, "required");
  return { status: finalStatus(missing, fields, failure), fields, missing, attempts };
}

/** Total cost of a run's attempts, rounded to micro-dollars. */
export function attemptsCost(attempts: readonly PipelineAttempt[]): number {
  const usd = attempts.reduce((sum, attempt) => sum + (attempt.usage?.costUsd ?? 0), 0);
  return Math.round(usd * 1e6) / 1e6;
}
