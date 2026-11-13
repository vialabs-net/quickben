/**
 * What the `text-layer` extractor runs over a document's text: the regex template engine, or a
 * reader function you register. Pure functions over text.
 *
 * A step picks one with `config.template` (a registered template key, or an inline template)
 * or `config.reader` (a registered reader key).
 */
import { requiredFields } from "./definition";
import { cleanValues } from "./field-values";
import { applyTemplate, templateSchema } from "./templates";

import type { DocumentType, ExtractionParams } from "./definition";
import type { ExtractionResult, FieldValue } from "./extractor";
import type { ExtractionTemplate } from "./templates";

/** Fewer non-blank characters than this and the PDF is a scan. */
export const MIN_TEXT_CHARS = 50;

/**
 * Regex reads are exact when they match but say nothing about a value that looks right and is
 * not. Below 1, so a stricter pipeline threshold can still ask a second extractor.
 */
export const TEXT_LAYER_CONFIDENCE = 0.9;

/** Your own code that reads raw values out of a document's text. */
export type TextReader = (
  text: string,
  context: { type: DocumentType; params: ExtractionParams },
) => Readonly<Record<string, string | undefined>>;

/** Templates and readers a `text-layer` step can name. */
export interface TextReaders {
  readonly templates?: Readonly<Record<string, ExtractionTemplate>>;
  readonly readers?: Readonly<Record<string, TextReader>>;
}

export function hasTextLayer(text: string): boolean {
  return text.replaceAll(/\s+/gu, "").length >= MIN_TEXT_CHARS;
}

function scored(
  type: DocumentType,
  params: ExtractionParams,
  values: Readonly<Record<string, string | undefined>>,
): Record<string, FieldValue> {
  const raw: Record<string, FieldValue> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value) raw[key] = { value, confidence: TEXT_LAYER_CONFIDENCE };
  }
  return cleanValues(type, params, raw);
}

/** `OK`, `INCOMPLETE` or `NO_MATCH` for the fields read. */
export function statusOf(type: DocumentType, fields: Readonly<Record<string, FieldValue>>) {
  if (Object.keys(fields).length === 0) return { status: "NO_MATCH" as const };
  const missing = requiredFields(type).filter((key) => !Object.hasOwn(fields, key));
  return missing.length === 0
    ? { status: "OK" as const }
    : { status: "INCOMPLETE" as const, problems: { missing } };
}

function failure(error: string): ExtractionResult {
  return { status: "ERROR", fields: {}, problems: { error } };
}

function lookup<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return record && Object.hasOwn(record, key) ? record[key] : undefined;
}

function resolveTemplate(
  value: unknown,
  readers: TextReaders,
): { template: ExtractionTemplate } | { error: string } {
  if (typeof value === "string") {
    const template = lookup(readers.templates, value);
    return template ? { template } : { error: `unknown template ${value}` };
  }
  const parsed = templateSchema.safeParse(value);
  return parsed.success ? { template: parsed.data } : { error: "invalid inline template" };
}

/** Read a document's text with the reader or template a step's config names. */
export function readText(
  text: string,
  type: DocumentType,
  params: ExtractionParams,
  config: Readonly<Record<string, unknown>>,
  readers: TextReaders = {},
): ExtractionResult {
  if (!hasTextLayer(text)) return { status: "NO_TEXT", fields: {} };

  if (typeof config.reader === "string") {
    const reader = lookup(readers.readers, config.reader);
    if (!reader) return failure(`unknown reader ${config.reader}`);
    const fields = scored(type, params, reader(text, { type, params }));
    return { ...statusOf(type, fields), fields };
  }
  if (config.template !== undefined) {
    const resolved = resolveTemplate(config.template, readers);
    if ("error" in resolved) return failure(resolved.error);
    const values = applyTemplate(resolved.template, text);
    if (!values) return { status: "NO_MATCH", fields: {} };
    const fields = scored(type, params, values);
    return { ...statusOf(type, fields), fields };
  }
  return failure("a text-layer step needs config.template or config.reader");
}
