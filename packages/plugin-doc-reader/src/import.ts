/**
 * Bulk import of samples: files with their expected values and attributes, keyed by a sample
 * key. Importing the same key again updates the sample (its file only when the bytes changed)
 * and never moves it to another split.
 */
import { ValidationError } from "@quickben/core";

import { DOC_SAMPLES, DOC_TYPES } from "./collections";
import { getDocReader } from "./options";
import { parseParams, readUpload, storageRef } from "./readings";
import { splitFieldsFor } from "./splits";
import { findAll, toDefinition } from "./store";
import { groupOf, parseAttributes, parseExpected } from "./studio";

import type { DocumentType, ExtractionParams } from "./definition";
import type { SampleAttributes } from "./metrics";
import type { DocumentFile } from "./readings";
import type { DocTypeRecord, SampleRecord } from "./records";
import type { Quickben, RequestContext } from "@quickben/core";

/** One sample to import. */
export interface ImportItem {
  /** Unique within the type, e.g. the file's path in the dataset. */
  readonly key: string;
  readonly file: DocumentFile;
  /**
   * Expected values: `{ fieldKey: value }`, or any JSON when `map` turns it into that. `null`,
   * `""`, `"-"` and `-1` mean "expected empty"; an absent key is not checked.
   */
  readonly expected?: unknown;
  readonly group?: string | null;
  readonly attributes?: SampleAttributes;
  readonly params?: ExtractionParams;
  readonly note?: string;
}

/** Expected values a mapping returns: by field key. */
export type ExpectedValues = Readonly<Record<string, string | number | boolean | null | undefined>>;

/** Turns a dataset's expected JSON (nested, other names) into values by field key. */
export type ExpectedMapper = (
  raw: unknown,
  item: {
    readonly key: string;
    readonly group: string | null;
    readonly attributes: SampleAttributes;
  },
) => ExpectedValues;

export interface ImportOptions {
  /** Map each item's `expected` to field values. Default: `expected` is that already. */
  readonly map?: ExpectedMapper;
  /** Called after each item. */
  readonly onProgress?: (progress: { done: number; key: string; outcome: ImportOutcome }) => void;
  /** Check every item and report, without writing. */
  readonly dryRun?: boolean;
}

export type ImportOutcome = "created" | "updated" | "unchanged" | "failed";

export interface ImportReport {
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly failed: readonly { readonly key: string; readonly error: string }[];
  /** Keys of the mapped values that are not fields of the type. They are left out. */
  readonly unknownFields: readonly string[];
}

const SAMPLE_KEY = /^[\w./:@+-]{1,200}$/u;

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const isEmptyRaw = (value: unknown) =>
  value === null || value === "" || value === "-" || value === -1 || value === "-1";

/**
 * Expected values as stored: text by field key. Empty values become the type's first empty
 * marker (default `-`), so they are checked as "expected empty".
 */
export function expectedValues(
  type: DocumentType,
  values: ExpectedValues,
  unknown: Set<string>,
): Record<string, string> {
  const fields = new Set(type.fields.map((field) => field.key));
  const marker = type.evaluation.emptyValues[0];
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (!fields.has(key)) {
      unknown.add(key);
      continue;
    }
    if (isEmptyRaw(value)) {
      if (marker !== undefined) out[key] = marker;
      continue;
    }
    out[key] = typeof value === "string" ? value : String(value);
  }
  return out;
}

async function newestType(qb: Quickben, ctx: RequestContext, key: string): Promise<DocumentType> {
  const records = await findAll<DocTypeRecord>(qb, DOC_TYPES, { key: { eq: key } }, ctx, {
    sort: "-version",
  });
  const record = records[0];
  if (!record) throw new ValidationError([{ path: "type", message: `Unknown type ${key}` }]);
  return toDefinition(record);
}

function errorText(error: unknown): string {
  if (error instanceof ValidationError) {
    return error.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Import samples into a type, by key: new keys are added, known keys updated. Items that fail
 * are reported and do not stop the import.
 */
export async function importSamples(
  qb: Quickben,
  ctx: RequestContext,
  typeKey: string,
  items: Iterable<ImportItem> | AsyncIterable<ImportItem>,
  options: ImportOptions = {},
): Promise<ImportReport> {
  const state = getDocReader(qb);
  const type = await newestType(qb, ctx, typeKey);
  const counts = { created: 0, updated: 0, unchanged: 0 };
  const failed: { key: string; error: string }[] = [];
  const unknown = new Set<string>();
  let done = 0;
  for await (const item of items) {
    let outcome: ImportOutcome;
    try {
      outcome = await importOne(qb, ctx, type, item, options, unknown);
      counts[outcome] += 1;
    } catch (error) {
      outcome = "failed";
      const message = errorText(error);
      failed.push({ key: item.key, error: message.slice(0, 300) });
      state.log("import-failed", { typeKey, key: item.key, error: message });
    }
    done += 1;
    options.onProgress?.({ done, key: item.key, outcome });
  }
  return { ...counts, failed, unknownFields: [...unknown].sort((a, b) => a.localeCompare(b)) };
}

/** What an item stores besides its file, checked. */
function sampleData(
  type: DocumentType,
  item: ImportItem,
  options: ImportOptions,
  unknown: Set<string>,
) {
  if (typeof item.key !== "string" || !SAMPLE_KEY.test(item.key)) {
    throw new ValidationError([
      { path: "key", message: "Keys are 1-200 letters, digits and . / : @ + - _" },
    ]);
  }
  const group = groupOf(item.group);
  const attributes = parseAttributes(item.attributes);
  const mapped = options.map
    ? options.map(item.expected, { key: item.key, group, attributes })
    : ((item.expected ?? {}) as ExpectedValues);
  const note = item.note?.trim().slice(0, 500) ?? "";
  return {
    expected: parseExpected(expectedValues(type, mapped, unknown)),
    params: parseParams(item.params),
    note: note === "" ? null : note,
    group,
    attributes,
  };
}

async function importOne(
  qb: Quickben,
  ctx: RequestContext,
  type: DocumentType,
  item: ImportItem,
  options: ImportOptions,
  unknown: Set<string>,
): Promise<Exclude<ImportOutcome, "failed">> {
  const state = getDocReader(qb);
  const data = sampleData(type, item, options, unknown);
  const { group, attributes } = data;
  const upload = await readUpload(state, item.file);
  const fileHash = await sha256(upload.bytes);
  const sampleUid = `${type.key}/${item.key}`;
  const existing = (
    await qb.find(DOC_SAMPLES, { where: { sampleUid: { eq: sampleUid } }, limit: 1 }, ctx)
  ).docs[0] as unknown as SampleRecord | undefined;

  if (!existing) {
    if (options.dryRun) return "created";
    const fileRef = storageRef(`samples/${type.key}`, upload.mime);
    const split = await splitFieldsFor(qb, type.key, { key: item.key, group, attributes });
    await state.files.put(fileRef, upload.bytes, { contentType: upload.mime });
    await qb.create(
      DOC_SAMPLES,
      {
        typeKey: type.key,
        fileRef,
        fileName: upload.name ?? item.key.split("/").at(-1) ?? item.key,
        mime: upload.mime,
        size: upload.bytes.byteLength,
        sampleKey: item.key,
        sampleUid,
        fileHash,
        createdBy: ctx.user?.email ?? ctx.user?.id ?? null,
        ...data,
        ...split,
      },
      ctx,
    );
    return "created";
  }

  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!sameJson(existing[key as keyof SampleRecord] ?? null, value)) changes[key] = value;
  }
  const newFile = existing.fileHash !== fileHash;
  if (!newFile && Object.keys(changes).length === 0) return "unchanged";
  if (options.dryRun) return "updated";
  if (newFile) {
    const fileRef = storageRef(`samples/${type.key}`, upload.mime);
    await state.files.put(fileRef, upload.bytes, { contentType: upload.mime });
    Object.assign(changes, {
      fileRef,
      fileHash,
      mime: upload.mime,
      size: upload.bytes.byteLength,
      ...(upload.name ? { fileName: upload.name } : {}),
    });
  }
  await qb.update(DOC_SAMPLES, existing.id, changes, ctx);
  if (newFile) await state.files.delete(existing.fileRef).catch(() => undefined);
  return "updated";
}
