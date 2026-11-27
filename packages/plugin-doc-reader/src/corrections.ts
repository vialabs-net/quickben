/**
 * Corrections of expected values, with a log. A dataset exported from another system is not a
 * human reading of each document: reviewers correct expected values to what the document says,
 * and every decision is kept (sample, field, value before and after, reason, who, when). The
 * log exports as JSON or CSV and applies again after a re-import or in another database.
 */
import { NotFoundError, ValidationError } from "@quickben/core";

import { DOC_CORRECTIONS, DOC_SAMPLES } from "./collections";
import { datasetWrite } from "./eval-state";
import { csvCell } from "./metrics";
import { findAll } from "./store";
import {
  createDraft,
  getSample,
  getVersion,
  listVersions,
  parseExpected,
  saveDraft,
} from "./studio";

import type { Split } from "./collections";
import type { SampleRecord } from "./records";
import type { Quickben, RequestContext } from "@quickben/core";

/**
 * What a reviewer did. `use-read`: took the value read. `edit`: typed a value. `keep`: the
 * expected value is right (nothing changes). `mark-system`: the field is filled by systems,
 * not printed (the type's draft changes). `bulk`: one value changed on every sample that had
 * it.
 */
export const CORRECTION_ACTIONS = ["use-read", "edit", "keep", "mark-system", "bulk"] as const;
export type CorrectionAction = (typeof CORRECTION_ACTIONS)[number];

/** Actions that change an expected value. */
const CHANGES: readonly CorrectionAction[] = ["use-read", "edit", "bulk"];

/** One logged decision. */
export interface Correction {
  readonly id: string;
  readonly typeKey: string;
  /** `null` for a decision about a field (`mark-system`). */
  readonly sampleId: string | null;
  /** The sample's import key: how the log finds it again after a re-import. */
  readonly sampleKey: string | null;
  readonly field: string;
  /** Expected value before; `null`: none. */
  readonly before: string | null;
  /** Expected value after; `null`: removed. Same as `before` for `keep`. */
  readonly after: string | null;
  readonly reason: string | null;
  readonly action: CorrectionAction;
  readonly runId: string | null;
  readonly by: string | null;
  readonly at: string;
}

/** A correction as exported and applied again: no id. */
export type CorrectionInput = Omit<Correction, "id" | "at"> & { readonly at?: string };

interface CorrectionRecord {
  readonly id: string;
  readonly typeKey: string;
  readonly sampleId?: string | null;
  readonly sampleKey?: string | null;
  readonly field: string;
  readonly before?: string | null;
  readonly after?: string | null;
  readonly reason?: string | null;
  readonly action: CorrectionAction;
  readonly runId?: string | null;
  readonly by?: string | null;
  readonly createdAt: string;
}

const toCorrection = (record: CorrectionRecord): Correction => ({
  id: record.id,
  typeKey: record.typeKey,
  sampleId: record.sampleId ?? null,
  sampleKey: record.sampleKey ?? null,
  field: record.field,
  before: record.before ?? null,
  after: record.after ?? null,
  reason: record.reason ?? null,
  action: record.action,
  runId: record.runId ?? null,
  by: record.by ?? null,
  at: record.createdAt,
});

const actorOf = (ctx: RequestContext) => ctx.user?.email ?? ctx.user?.id ?? null;
const cleanReason = (reason: string | null | undefined) => {
  const text = (reason ?? "").trim().slice(0, 1000);
  return text === "" ? null : text;
};

async function log(
  qb: Quickben,
  ctx: RequestContext,
  entry: Omit<CorrectionInput, "by"> & { by?: string | null },
): Promise<Correction> {
  const record = (await qb.create(
    DOC_CORRECTIONS,
    {
      typeKey: entry.typeKey,
      sampleId: entry.sampleId,
      sampleKey: entry.sampleKey,
      field: entry.field,
      before: entry.before,
      after: entry.after,
      reason: cleanReason(entry.reason),
      action: entry.action,
      runId: entry.runId,
      by: entry.by ?? actorOf(ctx),
    },
    ctx,
  )) as unknown as CorrectionRecord;
  return toCorrection(record);
}

const expectedOf = (expected: Readonly<Record<string, string>>, field: string) =>
  Object.hasOwn(expected, field) ? (expected[field] ?? null) : null;

async function setExpected(
  qb: Quickben,
  ctx: RequestContext,
  sampleId: string,
  expected: Readonly<Record<string, string>>,
  field: string,
  value: string | null,
): Promise<void> {
  const next: Record<string, string> = { ...expected };
  if (value === null) Reflect.deleteProperty(next, field);
  else next[field] = value;
  await qb.update(DOC_SAMPLES, sampleId, { expected: parseExpected(next, true) }, ctx);
}

function assertField(type: { fields: readonly { key: string }[] }, field: string) {
  if (!type.fields.some((candidate) => candidate.key === field)) {
    throw new ValidationError([{ path: "field", message: `Unknown field ${field}` }]);
  }
}

/** A new expected value: trimmed, `null` when blank; `undefined` keeps `fallback`. */
function cleanValue(value: string | null | undefined, fallback: string | null): string | null {
  if (value === undefined) return fallback;
  const text = value?.trim() ?? "";
  return text === "" ? null : text;
}

/** Input of {@link correctExpected}. */
export interface CorrectInput {
  readonly sampleId: string;
  readonly field: string;
  /** The new expected value; `null` removes it. Ignored by `keep`. */
  readonly value?: string | null;
  /** Default `edit`. */
  readonly action?: "use-read" | "edit" | "keep";
  readonly reason?: string | null;
  /** The run whose read prompted the decision. */
  readonly runId?: string | null;
}

/** Correct (or, with `keep`, confirm) one expected value and log it. */
export async function correctExpected(
  qb: Quickben,
  ctx: RequestContext,
  input: CorrectInput,
): Promise<Correction> {
  const action = input.action ?? "edit";
  if (!["use-read", "edit", "keep"].includes(action)) {
    throw new ValidationError([{ path: "action", message: "Use use-read, edit or keep" }]);
  }
  const { typeKey } = await getSample(qb, ctx, input.sampleId);
  return datasetWrite(qb, typeKey, () =>
    qb.transaction(async (tx) => {
      const sample = await getSample(tx, ctx, input.sampleId);
      const before = expectedOf(sample.expected, input.field);
      const after = action === "keep" ? before : cleanValue(input.value, before);
      if (after !== before) {
        await setExpected(tx, ctx, sample.id, sample.expected, input.field, after);
      }
      return log(tx, ctx, {
        typeKey,
        sampleId: sample.id,
        sampleKey: sample.key,
        field: input.field,
        before,
        after,
        reason: input.reason ?? null,
        action,
        runId: input.runId ?? null,
      });
    }),
  );
}

/** Input of {@link correctExpectedBulk}. */
export interface BulkCorrectInput {
  readonly typeKey: string;
  readonly field: string;
  /** Samples whose expected value is exactly this one change. */
  readonly from: string;
  /** One new value for all of them; `null` removes it. */
  readonly value?: string | null;
  /**
   * A value of its own per sample id, e.g. each sample's own read. Only these samples change
   * (and only while their expected value is still `from`). Takes the place of `value`.
   */
  readonly values?: Readonly<Record<string, string | null>>;
  readonly reason?: string | null;
  /** Only these splits. Default: every sample of the type. */
  readonly splits?: readonly Split[];
  readonly runId?: string | null;
}

/** The new value of one sample in a bulk change; `undefined`: the sample is left alone. */
function bulkValue(input: BulkCorrectInput, sampleId: string): string | null | undefined {
  if (!input.values) return cleanValue(input.value, null);
  if (!Object.hasOwn(input.values, sampleId)) return undefined;
  return cleanValue(input.values[sampleId], null);
}

/**
 * Change one expected value on every sample that has it, to one value or to a value per
 * sample, one log row each (`bulk`).
 */
export async function correctExpectedBulk(
  qb: Quickben,
  ctx: RequestContext,
  input: BulkCorrectInput,
): Promise<Correction[]> {
  if (input.value === undefined && input.values === undefined) {
    throw new ValidationError([{ path: "value", message: "Give value or values" }]);
  }
  return datasetWrite(qb, input.typeKey, () => qb.transaction((tx) => applyBulk(tx, ctx, input)));
}

async function applyBulk(
  qb: Quickben,
  ctx: RequestContext,
  input: BulkCorrectInput,
): Promise<Correction[]> {
  const versions = await listVersions(qb, ctx, input.typeKey);
  const newest = versions[0];
  if (!newest) throw new NotFoundError(`Unknown document type ${input.typeKey}`);
  assertField((await getVersion(qb, ctx, input.typeKey, newest.version)).definition, input.field);
  const samples = await findAll<SampleRecord>(
    qb,
    DOC_SAMPLES,
    {
      typeKey: { eq: input.typeKey },
      ...(input.splits ? { split: { in: [...input.splits] } } : {}),
    },
    ctx,
  );
  const out: Correction[] = [];
  for (const sample of samples) {
    if (expectedOf(sample.expected, input.field) !== input.from) continue;
    const value = bulkValue(input, sample.id);
    if (value === undefined || value === input.from) continue;
    await setExpected(qb, ctx, sample.id, sample.expected, input.field, value);
    out.push(
      await log(qb, ctx, {
        typeKey: input.typeKey,
        sampleId: sample.id,
        sampleKey: sample.sampleKey ?? null,
        field: input.field,
        before: input.from,
        after: value,
        reason: input.reason ?? null,
        action: "bulk",
        runId: input.runId ?? null,
      }),
    );
  }
  return out;
}

/**
 * Mark a field as filled by systems (`origin: "system"`) in the type's draft, creating the
 * draft from the newest version when there is none. Published versions never change. Logged as
 * `mark-system`. Returns the draft's version.
 */
export async function markSystemField(
  qb: Quickben,
  ctx: RequestContext,
  input: { typeKey: string; field: string; reason?: string | null },
): Promise<number> {
  return datasetWrite(qb, input.typeKey, () =>
    qb.transaction((tx) => markSystemDraft(tx, ctx, input)),
  );
}

async function markSystemDraft(
  qb: Quickben,
  ctx: RequestContext,
  input: Parameters<typeof markSystemField>[2],
): Promise<number> {
  const versions = await listVersions(qb, ctx, input.typeKey);
  const latest = versions.find((v) => v.state === "draft") ?? versions[0];
  if (!latest) throw new NotFoundError(`Unknown document type ${input.typeKey}`);
  const base = await getVersion(qb, ctx, input.typeKey, latest.version);
  assertField(base.definition, input.field);
  const version =
    latest.state === "draft" ? latest : await createDraft(qb, ctx, input.typeKey, base.version);
  const definition = {
    ...base.definition,
    fields: base.definition.fields.map((field) =>
      field.key === input.field ? { ...field, origin: "system" as const } : field,
    ),
  };
  await saveDraft(qb, ctx, input.typeKey, version.version, definition);
  await log(qb, ctx, {
    typeKey: input.typeKey,
    sampleId: null,
    sampleKey: null,
    field: input.field,
    before: null,
    after: null,
    reason: input.reason ?? null,
    action: "mark-system",
    runId: null,
  });
  return version.version;
}

/** Filters of {@link listCorrections}. */
export interface CorrectionFilters {
  readonly field?: string;
  readonly action?: CorrectionAction;
  readonly sampleId?: string;
  readonly sampleKey?: string;
}

/** The log of a type, oldest first. */
export async function listCorrections(
  qb: Quickben,
  ctx: RequestContext,
  typeKey: string,
  filters: CorrectionFilters = {},
): Promise<Correction[]> {
  const records = await findAll<CorrectionRecord>(
    qb,
    DOC_CORRECTIONS,
    {
      typeKey: { eq: typeKey },
      ...(filters.field ? { field: { eq: filters.field } } : {}),
      ...(filters.action ? { action: { eq: filters.action } } : {}),
      ...(filters.sampleId ? { sampleId: { eq: filters.sampleId } } : {}),
      ...(filters.sampleKey ? { sampleKey: { eq: filters.sampleKey } } : {}),
    },
    ctx,
    { sort: "createdAt" },
  );
  return records.map((record) => toCorrection(record));
}

const CSV_COLUMNS = [
  "at",
  "typeKey",
  "sampleKey",
  "sampleId",
  "field",
  "action",
  "before",
  "after",
  "reason",
  "by",
  "runId",
] as const;

/** The log as JSON (an array) or CSV (one row per decision). */
export function exportCorrections(list: readonly Correction[], format: "json" | "csv"): string {
  if (format === "json") {
    const rows = list.map((item) =>
      Object.fromEntries(CSV_COLUMNS.map((column) => [column, item[column]])),
    );
    return JSON.stringify(rows, null, 2);
  }
  const rows = list.map((item) => CSV_COLUMNS.map((column) => csvCell(item[column])).join(","));
  return [CSV_COLUMNS.join(","), ...rows].join("\n");
}

const isAction = (value: unknown): value is CorrectionAction =>
  CORRECTION_ACTIONS.includes(value as CorrectionAction);
const textOrNull = (value: unknown) => (typeof value === "string" ? value : null);
const isTextOrNull = (value: unknown) => value === null || typeof value === "string";

/** Check exported corrections read back from JSON. Invalid rows throw. */
export function parseCorrections(raw: unknown): CorrectionInput[] {
  if (!Array.isArray(raw)) throw new ValidationError([{ path: "", message: "Expected a list" }]);
  return raw.map((row: unknown, index) => {
    const item = (row ?? {}) as Record<string, unknown>;
    if (
      typeof item.typeKey !== "string" ||
      typeof item.field !== "string" ||
      !isAction(item.action)
    ) {
      throw new ValidationError([
        { path: String(index), message: "typeKey, field and action are required" },
      ]);
    }
    if (
      CHANGES.includes(item.action) &&
      (!isTextOrNull(item.before) || !isTextOrNull(item.after))
    ) {
      throw new ValidationError([
        { path: String(index), message: "before and after must be text or null" },
      ]);
    }
    return {
      typeKey: item.typeKey,
      sampleId: textOrNull(item.sampleId),
      sampleKey: textOrNull(item.sampleKey),
      field: item.field,
      before: textOrNull(item.before),
      after: textOrNull(item.after),
      reason: textOrNull(item.reason),
      action: item.action,
      runId: textOrNull(item.runId),
      by: textOrNull(item.by),
      ...(typeof item.at === "string" ? { at: item.at } : {}),
    };
  });
}

/** What {@link applyCorrections} did. */
export interface ApplyReport {
  /** Expected values changed. */
  readonly applied: number;
  /** Already as corrected. */
  readonly already: number;
  /** Decisions (`keep`, `mark-system`) added to the log. */
  readonly logged: number;
  /** The expected value is neither the one before nor the one after: left alone. */
  readonly conflicts: readonly {
    readonly sampleKey: string | null;
    readonly field: string;
    readonly current: string | null;
  }[];
  /** No sample with that key or id. */
  readonly missing: number;
}

const sameEntry = (a: Correction, b: CorrectionInput) =>
  (b.sampleKey === null ? a.sampleId === b.sampleId : a.sampleKey === b.sampleKey) &&
  a.field === b.field &&
  a.action === b.action &&
  a.before === b.before &&
  a.after === b.after;

/**
 * Apply exported corrections to a type's samples: after a re-import, or in another database.
 * Samples are found by key, else by id. A value changes only while it is still the one
 * corrected (`before`); entries missing from this database's log are added, keeping who and
 * why. `mark-system` entries are only logged: field origins live in the type's versions.
 */
export async function applyCorrections(
  qb: Quickben,
  ctx: RequestContext,
  typeKey: string,
  corrections: readonly CorrectionInput[],
): Promise<ApplyReport> {
  return datasetWrite(qb, typeKey, () =>
    qb.transaction((tx) => applyLog(tx, ctx, typeKey, corrections)),
  );
}

async function applyLog(
  qb: Quickben,
  ctx: RequestContext,
  typeKey: string,
  corrections: readonly CorrectionInput[],
): Promise<ApplyReport> {
  const samples = await findAll<SampleRecord>(qb, DOC_SAMPLES, { typeKey: { eq: typeKey } }, ctx);
  const state: ApplyState = {
    byKey: new Map(samples.map((sample) => [sample.sampleKey ?? "", sample])),
    byId: new Map(samples.map((sample) => [sample.id, sample])),
    logged: await listCorrections(qb, ctx, typeKey),
    report: { applied: 0, already: 0, logged: 0, missing: 0 },
    conflicts: [],
  };
  for (const entry of corrections) {
    if (entry.typeKey !== typeKey) continue;
    if (entry.action === "mark-system" || entry.action === "keep") {
      await logDecision(qb, ctx, state, entry);
    } else {
      await applyChange(qb, ctx, state, entry);
    }
  }
  return { ...state.report, conflicts: state.conflicts };
}

interface ApplyState {
  readonly byKey: Map<string, SampleRecord>;
  readonly byId: Map<string, SampleRecord>;
  readonly logged: Correction[];
  readonly report: { applied: number; already: number; logged: number; missing: number };
  readonly conflicts: { sampleKey: string | null; field: string; current: string | null }[];
}

async function logDecision(
  qb: Quickben,
  ctx: RequestContext,
  state: ApplyState,
  entry: CorrectionInput,
): Promise<void> {
  const sample = entry.sampleKey === null ? undefined : state.byKey.get(entry.sampleKey);
  if (entry.sampleKey !== null && !sample) {
    state.report.missing += 1;
    return;
  }
  const resolved = { ...entry, sampleId: sample?.id ?? entry.sampleId };
  if (state.logged.some((item) => sameEntry(item, resolved))) return;
  state.logged.push(await log(qb, ctx, resolved));
  state.report.logged += 1;
}

async function applyChange(
  qb: Quickben,
  ctx: RequestContext,
  state: ApplyState,
  entry: CorrectionInput,
): Promise<void> {
  const sample =
    entry.sampleKey !== null
      ? state.byKey.get(entry.sampleKey)
      : state.byId.get(entry.sampleId ?? "");
  if (!sample) {
    state.report.missing += 1;
    return;
  }
  const current = expectedOf(sample.expected, entry.field);
  if (current !== entry.after && current !== entry.before) {
    state.conflicts.push({ sampleKey: sample.sampleKey ?? null, field: entry.field, current });
    return;
  }
  if (current === entry.after) state.report.already += 1;
  else {
    await setExpected(qb, ctx, sample.id, sample.expected, entry.field, entry.after);
    const fresh = { ...sample, expected: (await getSample(qb, ctx, sample.id)).expected };
    state.byKey.set(sample.sampleKey ?? "", fresh);
    state.byId.set(sample.id, fresh);
    state.report.applied += 1;
  }
  const resolved = { ...entry, sampleId: sample.id, sampleKey: sample.sampleKey ?? null };
  if (!state.logged.some((item) => sameEntry(item, resolved))) {
    state.logged.push(await log(qb, ctx, resolved));
  }
}

type CorrectionValues = Map<string | null, string | null>;
type CorrectionsByField = Map<string, CorrectionValues>;

/** Corrected values by sample key, field and incoming value. */
export async function correctionOverrides(
  qb: Quickben,
  ctx: RequestContext,
  typeKey: string,
  sampleKey?: string,
): Promise<Map<string, CorrectionsByField>> {
  const out = new Map<string, CorrectionsByField>();
  const corrections = await listCorrections(qb, ctx, typeKey, { sampleKey });
  for (const item of corrections.toReversed()) {
    if (!CHANGES.includes(item.action) || item.sampleKey === null) continue;
    const fields = out.get(item.sampleKey) ?? new Map<string, CorrectionValues>();
    const values = fields.get(item.field) ?? new Map<string | null, string | null>();
    if (!values.has(item.before)) {
      values.set(
        item.before,
        values.has(item.after) ? (values.get(item.after) ?? null) : item.after,
      );
    }
    fields.set(item.field, values);
    out.set(item.sampleKey, fields);
  }
  return out;
}
