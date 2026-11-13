/**
 * Form data of the admin's forms, turned into plain values. Validation happens in the studio
 * functions; these parsers only reshape.
 */
import { ValidationError } from "@quickben/core";

import { TEXT_LAYER } from "../extractors/text-layer";
import { VISION_LLM } from "../extractors/vision-llm";

import type { DocumentType, ExtractionParams } from "../definition";

export function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function raw(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function count(formData: FormData, name: string): number {
  const n = Number(raw(formData, name));
  return Number.isInteger(n) && n >= 0 && n <= 200 ? n : 0;
}

const lines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const list = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

function fieldsOf(formData: FormData) {
  const fields: Record<string, unknown>[] = [];
  for (let i = 0; i < count(formData, "fieldCount"); i += 1) {
    const p = `fields.${String(i)}.`;
    const key = text(formData, `${p}key`);
    const label = text(formData, `${p}label`);
    if (formData.get(`${p}remove`) === "on" || (key === undefined && label === undefined)) continue;
    const field: Record<string, unknown> = {
      key: key ?? "",
      label: label ?? key ?? "",
      type: text(formData, `${p}type`) ?? "text",
      required: formData.get(`${p}required`) === "on",
    };
    const extra = {
      description: text(formData, `${p}description`),
      transform: text(formData, `${p}transform`),
      pattern: text(formData, `${p}pattern`),
      dateOrder: text(formData, `${p}dateOrder`),
      decimalSeparator: text(formData, `${p}decimalSeparator`),
    };
    for (const [name, value] of Object.entries(extra)) if (value !== undefined) field[name] = value;
    fields.push(field);
  }
  return fields;
}

function paramsOf(formData: FormData) {
  const params: Record<string, unknown>[] = [];
  for (let i = 0; i < count(formData, "paramCount"); i += 1) {
    const p = `params.${String(i)}.`;
    const key = text(formData, `${p}key`);
    if (formData.get(`${p}remove`) === "on" || key === undefined) continue;
    const description = text(formData, `${p}description`);
    params.push({
      key,
      label: text(formData, `${p}label`) ?? key,
      type: text(formData, `${p}type`) ?? "string",
      excludes: list(raw(formData, `${p}excludes`)),
      ...(description === undefined ? {} : { description }),
    });
  }
  return params;
}

function jsonConfig(formData: FormData, name: string, index: number): Record<string, unknown> {
  const source = text(formData, name);
  if (source === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(source);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  } catch {
    // Reported below.
  }
  throw new ValidationError([
    { path: `steps.${String(index)}.config`, message: "Use a JSON object" },
  ]);
}

function stepConfig(formData: FormData, extractor: string, index: number): Record<string, unknown> {
  const p = `steps.${String(index)}.`;
  const config = jsonConfig(formData, `${p}config`, index);
  const typed: Record<string, unknown> = {};
  if (extractor === TEXT_LAYER) {
    typed.template = text(formData, `${p}template`);
    typed.reader = text(formData, `${p}reader`);
  }
  if (extractor === VISION_LLM) {
    typed.connectionId = text(formData, `${p}connectionId`);
    typed.model = text(formData, `${p}model`);
    const maxPages = text(formData, `${p}maxPages`);
    typed.maxPages = maxPages === undefined ? undefined : Number(maxPages);
  }
  for (const [key, value] of Object.entries(typed)) {
    if (value === undefined) Reflect.deleteProperty(config, key);
    else config[key] = value;
  }
  return config;
}

function stepsOf(formData: FormData) {
  const steps: { order: number; extractor: string; config: Record<string, unknown> }[] = [];
  for (let i = 0; i < count(formData, "stepCount"); i += 1) {
    const p = `steps.${String(i)}.`;
    const extractor = text(formData, `${p}extractor`);
    if (formData.get(`${p}remove`) === "on" || extractor === undefined) continue;
    const order = Number(raw(formData, `${p}order`));
    steps.push({
      order: Number.isFinite(order) ? order : i + 1,
      extractor,
      config: stepConfig(formData, extractor, i),
    });
  }
  return steps
    .map((step, index) => ({ ...step, index }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ extractor, config }) => ({ extractor, config }));
}

function pagesOf(value: string): number[] | string {
  const pages = list(value).map(Number);
  return pages.length > 0 && pages.every((page) => Number.isInteger(page) && page >= 1)
    ? pages
    : value;
}

/** A draft's definition from the editor form. `key`, `version` and `state` come from the draft. */
export function definitionFromForm(
  formData: FormData,
  current: DocumentType,
): Record<string, unknown> {
  const description = text(formData, "description");
  const threshold = Number(raw(formData, "threshold"));
  return {
    label: raw(formData, "label").trim(),
    ...(description === undefined ? {} : { description }),
    pages: pagesOf(raw(formData, "pages")),
    instructions: raw(formData, "instructions").trim(),
    classification: {
      text: lines(raw(formData, "classText")),
      fileName: lines(raw(formData, "classFileName")),
    },
    fields: fieldsOf(formData),
    params: paramsOf(formData),
    pipeline: {
      steps: stepsOf(formData),
      threshold: raw(formData, "threshold").trim() === "" ? current.pipeline.threshold : threshold,
      stopWhen: text(formData, "stopWhen") ?? current.pipeline.stopWhen,
    },
  };
}

/** Expected values from a sample form: `expected.<field>` inputs. */
export function expectedFromForm(formData: FormData, type: DocumentType): Record<string, string> {
  const expected: Record<string, string> = {};
  for (const field of type.fields) {
    const value = text(formData, `expected.${field.key}`);
    if (value !== undefined) expected[field.key] = value;
  }
  return expected;
}

/** Parameters from a form: `params.<key>` inputs, lists comma-separated. */
export function paramsFromForm(formData: FormData, type: DocumentType): ExtractionParams {
  const params: Record<string, string | string[]> = {};
  for (const param of type.params) {
    const value = text(formData, `params.${param.key}`);
    if (value === undefined) continue;
    params[param.key] = param.type === "string-list" ? list(value) : value;
  }
  return params;
}

/** `connectionId|model` from a model picker, or the two text inputs. */
export function variantFromForm(
  formData: FormData,
  prefix: string,
): { connectionId: string; model?: string } | undefined {
  const picked = text(formData, `${prefix}.choice`);
  if (picked !== undefined) {
    const [connectionId = "", model] = picked.split("|");
    return model ? { connectionId, model } : { connectionId };
  }
  const connectionId = text(formData, `${prefix}.connectionId`);
  if (connectionId === undefined) return undefined;
  const model = text(formData, `${prefix}.model`);
  return model === undefined ? { connectionId } : { connectionId, model };
}

/** Files of a multi-file input, skipping the empty entry browsers send with no choice. */
export function filesOf(formData: FormData, name: string): File[] {
  return formData
    .getAll(name)
    .filter((value): value is File => value instanceof File && value.size > 0);
}
