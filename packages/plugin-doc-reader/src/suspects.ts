/**
 * Expected values that look wrong, found without a model: from the samples, a run's reads and
 * the PDFs' own text. Each row is a lead for a reviewer, not a verdict.
 *
 * | Detector               | Signal                                                        |
 * | ---------------------- | ------------------------------------------------------------- |
 * | `constant-in-group`    | A field has the same expected value on every sample of a group |
 * | `read-in-text`         | The value read is in the PDF's text and the expected one is not |
 * | `expected-not-in-text` | The expected value is not in the PDF's text                   |
 * | `repeated-difference`  | The same expected → read difference on several samples         |
 *
 * Text detectors skip samples without a text layer and values shorter than 3 characters.
 * A run's reads are scored again with today's expected values and the version's rules, so a
 * corrected value stops being a suspect. Fields that are not scored (`scored: false`, `system`
 * origin) and decisions logged as `keep`
 * for the same value are left out. `test` and `unseen` samples are left out unless asked.
 */
import { getTestRun } from "./bench";
import { DOC_SAMPLES, HELD_OUT_SPLITS } from "./collections";
import { listCorrections } from "./corrections";
import { isScored } from "./definition";
import { pdfPagesText } from "./extractors/text-layer";
import { looseText, normalizeFieldValue } from "./field-values";
import { isEmptyValue } from "./metrics";
import { getDocReader } from "./options";
import { rescoreResult } from "./rescore";
import { fieldStatus } from "./review";
import { findAll } from "./store";
import { getVersion, listVersions } from "./studio";

import type { Split } from "./collections";
import type { DocumentType, FieldDefinition } from "./definition";
import type { FieldCheck, SampleResult } from "./metrics";
import type { SampleRecord } from "./records";
import type { Quickben, RequestContext } from "@quickben/core";

export const SUSPECT_DETECTORS = [
  "constant-in-group",
  "read-in-text",
  "expected-not-in-text",
  "repeated-difference",
] as const;
export type SuspectDetector = (typeof SUSPECT_DETECTORS)[number];

/** A suspect expected value. */
export interface Suspect {
  readonly detector: SuspectDetector;
  readonly sampleId: string;
  readonly sampleKey: string | null;
  readonly group: string | null;
  readonly split: Split | null;
  readonly field: string;
  readonly label: string;
  readonly expected: string | null;
  /** The run's read, when there is a run. */
  readonly read: string | null;
  /** Why it was flagged, e.g. `12 samples of the group` or `read found in the text`. */
  readonly evidence: string;
  /** Samples that share the signal (group size, repeats); 1 for single-sample signals. */
  readonly count: number;
}

/** Options of {@link findSuspects}. */
export interface SuspectOptions {
  /** Run whose reads feed `read-in-text` and `repeated-difference`; its samples are the scope. */
  readonly runId?: string;
  /** Version whose fields decide what is scored. Default: the run's version, else the newest. */
  readonly version?: number;
  /** Include `test` and `unseen` samples. Default `false`. */
  readonly heldOut?: boolean;
  /** Smallest group for `constant-in-group`. Default 3. */
  readonly minGroupSize?: number;
  /** Fewest samples for `repeated-difference`. Default 2. */
  readonly minRepeats?: number;
  /** Only these detectors. Default all. */
  readonly detectors?: readonly SuspectDetector[];
  /**
   * The text layer of a sample, or `null` without one. Default: the PDF's text from the
   * plugin's file store (cached per file), `null` for images.
   */
  readonly text?: (sample: SampleRecord) => Promise<string | null>;
}

/** Shortest text that counts as a text layer. */
const MIN_TEXT = 40;
/** Shortest value searched in the text. */
const MIN_VALUE = 3;

const TEXT_CACHE = new Map<string, string | null>();
const TEXT_CACHE_MAX = 5000;

async function pdfText(qb: Quickben, sample: SampleRecord): Promise<string | null> {
  if (sample.mime !== "application/pdf") return null;
  const key = `${sample.id}:${sample.fileHash ?? sample.fileRef}`;
  if (TEXT_CACHE.has(key)) return TEXT_CACHE.get(key) ?? null;
  let text: string | null = null;
  try {
    const bytes = await getDocReader(qb).files.getBytes(sample.fileRef);
    if (bytes)
      text = await pdfPagesText(
        bytes,
        Array.from({ length: 20 }, (_, i) => i + 1),
      );
  } catch {
    text = null;
  }
  if (TEXT_CACHE.size >= TEXT_CACHE_MAX) TEXT_CACHE.clear();
  TEXT_CACHE.set(key, text);
  return text;
}

/** Uppercase, no accents, no punctuation, no spaces: how text and values are matched. */
export function searchable(value: string): string {
  return looseText(value, { ignoreAccents: true, ignorePunctuation: true }).replaceAll(" ", "");
}

const pad = (n: string) => n.padStart(2, "0");

/** The ways a value may be printed, as {@link searchable} text. */
export function printedForms(
  field: Pick<FieldDefinition, "type" | "transform" | "pattern" | "dateOrder" | "decimalSeparator">,
  value: string,
): string[] {
  const forms = new Set([searchable(value)]);
  const canonical = normalizeFieldValue(field, value);
  if (canonical) forms.add(searchable(canonical));
  if (field.type === "date" && canonical) {
    const [year = "", month = "", day = ""] = canonical.split("-");
    const d = String(Number(day));
    const m = String(Number(month));
    for (const form of [
      `${pad(day)}${pad(month)}${year}`,
      `${d}${m}${year}`,
      `${pad(day)}${pad(month)}${year.slice(2)}`,
      `${year}${pad(month)}${pad(day)}`,
    ]) {
      forms.add(form);
    }
  }
  if (field.type === "number" && canonical) {
    const [whole = "", decimals = ""] = canonical.replace("-", "").split(".");
    forms.add(whole + decimals);
    if (decimals === "") forms.add(`${whole}00`);
  }
  return [...forms].filter((form) => form.length >= MIN_VALUE);
}

/** Whether a value is printed in a text (as {@link searchable} text); `null` when too short. */
export function inText(
  field: Pick<FieldDefinition, "type" | "transform" | "pattern" | "dateOrder" | "decimalSeparator">,
  value: string,
  text: string,
): boolean | null {
  const forms = printedForms(field, value);
  if (forms.length === 0) return null;
  return forms.some((form) => text.includes(form));
}

interface Context {
  readonly type: DocumentType;
  readonly samples: readonly SampleRecord[];
  readonly results: ReadonlyMap<string, SampleResult>;
  readonly kept: ReadonlySet<string>;
  readonly options: SuspectOptions;
}

const keptKey = (sampleId: string, field: string, value: string | null) =>
  `${sampleId}\u0000${field}\u0000${value ?? ""}`;

function row(
  ctx: Context,
  sample: SampleRecord,
  field: FieldDefinition,
  detector: SuspectDetector,
  extra: { read: string | null; evidence: string; count: number },
): Suspect | null {
  const expected = Object.hasOwn(sample.expected, field.key)
    ? (sample.expected[field.key] ?? null)
    : null;
  if (ctx.kept.has(keptKey(sample.id, field.key, expected))) return null;
  return {
    detector,
    sampleId: sample.id,
    sampleKey: sample.sampleKey ?? null,
    group: sample.group ?? null,
    split: sample.split ?? null,
    field: field.key,
    label: field.label,
    expected,
    ...extra,
  };
}

const hasValue = (type: DocumentType, value: string | null | undefined): value is string =>
  !isEmptyValue(value, type.evaluation.emptyValues);

const expectedIn = (sample: SampleRecord, key: string) =>
  Object.hasOwn(sample.expected, key) ? sample.expected[key] : undefined;

function groupsOf(samples: readonly SampleRecord[], min: number): [string, SampleRecord[]][] {
  const groups = new Map<string, SampleRecord[]>();
  for (const sample of samples) {
    if (sample.group) groups.set(sample.group, [...(groups.get(sample.group) ?? []), sample]);
  }
  return [...groups].filter(([, members]) => members.length >= min);
}

/** The value every member has, or `undefined`. */
function sharedValue(ctx: Context, members: readonly SampleRecord[], key: string) {
  const first = members[0] ? expectedIn(members[0], key) : undefined;
  if (!hasValue(ctx.type, first)) return undefined;
  return members.every((sample) => expectedIn(sample, key) === first) ? first : undefined;
}

function constantInGroup(ctx: Context, fields: readonly FieldDefinition[]): Suspect[] {
  const out: Suspect[] = [];
  for (const [group, members] of groupsOf(ctx.samples, ctx.options.minGroupSize ?? 3)) {
    const head = members[0];
    if (!head) continue;
    for (const field of fields) {
      if (sharedValue(ctx, members, field.key) === undefined) continue;
      const suspect = row(ctx, head, field, "constant-in-group", {
        read: checkOf(ctx.results.get(head.id), field.key)?.read ?? null,
        evidence: `same value on all ${String(members.length)} samples of ${group}`,
        count: members.length,
      });
      if (suspect) out.push(suspect);
    }
  }
  return out;
}

const checkOf = (result: SampleResult | undefined, key: string): FieldCheck | undefined =>
  result?.fields.find((check) => check.key === key);

/** The text detector that fires for one field of a sample, if any. */
function textSignal(
  ctx: Context,
  sample: SampleRecord,
  field: FieldDefinition,
  text: string,
): { detector: SuspectDetector; read: string | null } | null {
  const expected = expectedIn(sample, field.key);
  if (!hasValue(ctx.type, expected) || inText(field, expected, text) !== false) return null;
  const check = checkOf(ctx.results.get(sample.id), field.key);
  const read = check?.read ?? null;
  const wrong = check !== undefined && fieldStatus(check) === "wrong";
  const readFound = wrong && hasValue(ctx.type, read) && inText(field, read, text) === true;
  return { detector: readFound ? "read-in-text" : "expected-not-in-text", read };
}

const TEXT_EVIDENCE: Record<string, string> = {
  "read-in-text": "the value read is in the document's text; the expected one is not",
  "expected-not-in-text": "the expected value is not in the document's text",
};

async function textDetectors(
  qb: Quickben,
  ctx: Context,
  fields: readonly FieldDefinition[],
  wanted: ReadonlySet<SuspectDetector>,
): Promise<Suspect[]> {
  const out: Suspect[] = [];
  const read = ctx.options.text ?? ((sample: SampleRecord) => pdfText(qb, sample));
  for (const sample of ctx.samples) {
    const text = searchable((await read(sample)) ?? "");
    if (text.length < MIN_TEXT) continue;
    for (const field of fields) {
      const signal = textSignal(ctx, sample, field, text);
      if (!signal || !wanted.has(signal.detector)) continue;
      const suspect = row(ctx, sample, field, signal.detector, {
        read: signal.read,
        evidence: TEXT_EVIDENCE[signal.detector] ?? "",
        count: 1,
      });
      if (suspect) out.push(suspect);
    }
  }
  return out;
}

interface Difference {
  readonly sample: SampleRecord;
  readonly field: FieldDefinition;
  readonly read: string;
}

function differences(ctx: Context, fields: readonly FieldDefinition[]): Map<string, Difference[]> {
  const byDiff = new Map<string, Difference[]>();
  const samples = new Map(ctx.samples.map((sample) => [sample.id, sample]));
  for (const [sampleId, result] of ctx.results) {
    const sample = samples.get(sampleId);
    if (!sample || result.skipped !== undefined || result.failed === true) continue;
    for (const field of fields) {
      const check = checkOf(result, field.key);
      if (check?.expected == null || check.read === null || fieldStatus(check) !== "wrong")
        continue;
      const key = `${field.key}\u0000${searchable(check.expected)}\u0000${searchable(check.read)}`;
      byDiff.set(key, [...(byDiff.get(key) ?? []), { sample, field, read: check.read }]);
    }
  }
  return byDiff;
}

function repeatedDifference(ctx: Context, fields: readonly FieldDefinition[]): Suspect[] {
  const min = ctx.options.minRepeats ?? 2;
  const out: Suspect[] = [];
  for (const items of differences(ctx, fields).values()) {
    if (items.length < min) continue;
    for (const item of items) {
      const suspect = row(ctx, item.sample, item.field, "repeated-difference", {
        read: item.read,
        evidence: `the same difference on ${String(items.length)} samples`,
        count: items.length,
      });
      if (suspect) out.push(suspect);
    }
  }
  return out;
}

async function versionOf(
  qb: Quickben,
  ctx: RequestContext,
  typeKey: string,
  asked: number | undefined,
): Promise<DocumentType> {
  if (asked !== undefined) return (await getVersion(qb, ctx, typeKey, asked)).definition;
  const newest = (await listVersions(qb, ctx, typeKey))[0];
  return (await getVersion(qb, ctx, typeKey, newest?.version ?? 1)).definition;
}

/**
 * Suspect expected values of a type: with `runId`, over the run's samples and reads; else over
 * every sample, with the detectors that need no reads.
 */
export async function findSuspects(
  qb: Quickben,
  ctx: RequestContext,
  typeKey: string,
  options: SuspectOptions = {},
): Promise<Suspect[]> {
  const run = options.runId ? await getTestRun(qb, ctx, options.runId) : null;
  const type = await versionOf(qb, ctx, typeKey, options.version ?? run?.typeVersion);
  const fields = type.fields.filter((field) => isScored(field));
  const all = await findAll<SampleRecord>(qb, DOC_SAMPLES, { typeKey: { eq: typeKey } }, ctx);
  const inRun = run ? new Set(run.results.map((result) => result.sampleId)) : null;
  const samples = all.filter(
    (sample) =>
      (options.heldOut === true || !HELD_OUT_SPLITS.includes(sample.split ?? "dev")) &&
      (!inRun || inRun.has(sample.id)),
  );
  const expectedById = new Map(all.map((sample) => [sample.id, sample.expected]));
  const kept = new Set(
    (await listCorrections(qb, ctx, typeKey, { action: "keep" })).map((item) =>
      keptKey(item.sampleId ?? "", item.field, item.after),
    ),
  );
  const context: Context = {
    type,
    samples,
    // The run's reads, scored with today's expected values and rules.
    results: new Map(
      (run?.results ?? []).map((result) => [
        result.sampleId,
        rescoreResult(type, expectedById.get(result.sampleId) ?? {}, result),
      ]),
    ),
    kept,
    options,
  };
  const wanted = new Set(options.detectors ?? SUSPECT_DETECTORS);
  const out: Suspect[] = [];
  if (wanted.has("constant-in-group")) out.push(...constantInGroup(context, fields));
  if (wanted.has("read-in-text") || wanted.has("expected-not-in-text")) {
    out.push(...(await textDetectors(qb, context, fields, wanted)));
  }
  if (wanted.has("repeated-difference")) out.push(...repeatedDifference(context, fields));
  return out;
}
