/**
 * Paid: page images through a vision model, answered as a structured object built from the
 * type's fields. Values are normalized by field type and a value that is not valid for its
 * field is dropped, so the model cannot invent a well-formed answer the user trusts.
 */
import { QuickbenError } from "@quickben/core";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";

import { listParam } from "../definition";
import { cleanValues } from "../field-values";
import { callCost } from "../models";
import { statusOf } from "../text-readers";

import { rasterize as defaultRasterize, UnsupportedFileError } from "./page-images";

import type { DocumentType, ExtractionParams } from "../definition";
import type {
  ExtractionResult,
  ExtractionUsage,
  Extractor,
  FieldBox,
  FieldValue,
} from "../extractor";
import type { ResolvedModel } from "../models";
import type { PageImage, Rasterize } from "./page-images";

export const VISION_LLM = "vision-llm";

/** Provider failures show this, never the provider's message (it may echo a credential). */
export const PROVIDER_ERROR = "the model provider rejected the request";
const NO_FIELDS = "the model did not return the fields";

/** A `vision-llm` step's `config`. */
export const visionConfigSchema = z.object({
  connectionId: z.string().min(1),
  /** A model id of the connection. Absent: the connection's default model. */
  model: z.string().min(1).optional(),
  maxPages: z.number().int().min(1).optional(),
});

export interface VisionLlmOptions {
  /** Called with the connection and model of a step. */
  readonly resolveModel?: (connectionId: string, modelId?: string) => Promise<ResolvedModel>;
  readonly rasterize?: Rasterize;
  /** Deadline of one call. Default 60 seconds. */
  readonly timeoutMs?: number;
}

// No nullable or union types: Anthropic rejects structured-output schemas with more than 16
// union-typed parameters, and every field has five properties. Absent is an empty string, page
// 0 and box "0,0,0,0". The box is a string of four integers: an integer array per field makes
// Anthropic refuse the schema ("compiled grammar is too large").
const answerSchema = z.object({
  value: z.string(),
  confidence: z.number(),
  page: z.number().int(),
  evidence: z.string(),
  box: z.string(),
});
type Answer = z.infer<typeof answerSchema>;

/** One entry per field. Every key is present, so strict structured outputs accept it. */
export function answerSchemaFor(type: DocumentType) {
  const shape: Record<string, typeof answerSchema> = {};
  for (const field of type.fields) {
    shape[field.key] = answerSchema.describe(
      [field.label, field.description, `type: ${field.type}`].filter(Boolean).join(". "),
    );
  }
  return z.object(shape);
}

const formats: Partial<Record<DocumentType["fields"][number]["type"], string>> = {
  date: "YYYY-MM-DD",
  number: "digits with . as the decimal separator, no thousands separators",
  phone: "digits, with a leading + when a country code is printed",
};

function fieldLine(field: DocumentType["fields"][number]): string {
  const notes = [field.description, formats[field.type]].filter(Boolean).join("; ");
  const suffix = notes ? `: ${notes}` : "";
  return `- ${field.key} (${field.label})${suffix}`;
}

/** The system prompt of one call. */
export function buildPrompt(
  type: DocumentType,
  params: ExtractionParams,
  pages: readonly PageImage[],
  jsonHint: boolean,
): string {
  const lines = [
    `You read a document of type "${type.label}" from page images.`,
    "For each field return the value exactly as printed, or an empty string when it is not there. Never guess.",
    "confidence is 0..1: how sure you are that the value is right. page is the page number (0 when absent); evidence is the short text around the value (empty when absent).",
    'box is the tight rectangle around the printed value only (not its label) on that page, as "x0,y0,x1,y1": four integers from 0 to 1000 for left, top, right and bottom, in thousandths of the page width and height, origin at the top left. "0,0,0,0" when absent.',
    "",
    "Fields:",
    ...type.fields.map((field) => fieldLine(field)),
    "",
    `Pages shown: ${pages.map((p) => p.page).join(", ")}.`,
  ];
  for (const param of type.params) {
    const values = listParam(params, param.key);
    if (values.length === 0) continue;
    const rule =
      param.excludes.length > 0
        ? ` These are never the value of ${param.excludes.join(", ")}.`
        : "";
    lines.push(`${param.label} (${param.key}): ${values.join(", ")}.${rule}`);
  }
  if (type.instructions.trim()) lines.push("", type.instructions.trim());
  if (jsonHint) {
    lines.push(
      "",
      `Reply with JSON only: an object with keys ${type.fields.map((f) => f.key).join(", ")}, each {value, confidence, page, evidence, box}.`,
    );
  }
  return lines.join("\n");
}

// A box smaller than this (a fraction of the page) is a point, not a value.
const MIN_SIDE = 0.002;

/** A model box (`"x0,y0,x1,y1"` in thousandths) as page fractions, or `undefined`. */
export function toBox(raw: string | undefined): FieldBox | undefined {
  const numbers = raw?.match(/-?\d+(?:\.\d+)?/gu)?.map(Number);
  if (numbers?.length !== 4) return undefined;
  const [a = 0, b = 0, c = 0, d = 0] = numbers.map((n) => Math.min(1, Math.max(0, n / 1000)));
  const box = { x0: Math.min(a, c), y0: Math.min(b, d), x1: Math.max(a, c), y1: Math.max(b, d) };
  if (box.x1 - box.x0 < MIN_SIDE || box.y1 - box.y0 < MIN_SIDE) return undefined;
  return box;
}

function toFieldValue(answer: Answer): FieldValue {
  const confidence = Math.min(1, Math.max(0, answer.confidence || 0));
  const box = answer.page > 0 ? toBox(answer.box) : undefined;
  const evidence =
    answer.page > 0 && (answer.evidence || box)
      ? { page: answer.page, text: answer.evidence.slice(0, 200), ...(box ? { box } : {}) }
      : undefined;
  return { value: answer.value, confidence, ...(evidence ? { evidence } : {}) };
}

/** Normalized fields. Invalid and excluded values are dropped. */
export function toFields(
  type: DocumentType,
  answers: Readonly<Record<string, Answer | undefined>>,
  params: ExtractionParams,
): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  for (const [key, answer] of Object.entries(answers)) {
    if (answer) values[key] = toFieldValue(answer);
  }
  return cleanValues(type, params, values);
}

/** A reply wrapped in a Markdown code fence, unwrapped. */
function stripFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```") || !trimmed.endsWith("```")) return trimmed;
  const body = trimmed.slice(3, -3);
  return body.startsWith("json") ? body.slice(4) : body;
}

/** A JSON reply without structured outputs. A missing box, or one given as a list, is fine. */
export function parseAnswer(text: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(text));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return parsed;
  return Object.fromEntries(
    Object.entries(parsed).map(([key, answer]: [string, unknown]) => {
      if (!answer || typeof answer !== "object") return [key, answer];
      const box: unknown = (answer as { box?: unknown }).box;
      if (typeof box === "string") return [key, answer];
      return [key, { ...answer, box: Array.isArray(box) ? box.join(",") : "" }];
    }),
  );
}

function failure(error: string): ExtractionResult {
  return { status: "ERROR", fields: {}, problems: { error } };
}

async function resolve(
  resolveModel: VisionLlmOptions["resolveModel"],
  config: z.infer<typeof visionConfigSchema>,
): Promise<ResolvedModel | string> {
  if (!resolveModel)
    return "no models are configured: pass resolveModel, e.g. connectionModels() from @quickben/plugin-doc-reader/connections";
  try {
    return await resolveModel(config.connectionId, config.model);
  } catch (error) {
    return error instanceof QuickbenError ? error.message : "could not initialize the model";
  }
}

async function pageImages(
  rasterize: Rasterize,
  bytes: Uint8Array,
  mime: string,
  pages: readonly number[],
): Promise<PageImage[] | ExtractionResult> {
  try {
    const images = await rasterize(bytes, mime, pages);
    return images.length > 0 ? images : { status: "NO_TEXT", fields: {}, problems: { pages } };
  } catch (error) {
    if (error instanceof UnsupportedFileError) {
      return { status: "NO_TEXT", fields: {}, problems: { mime } };
    }
    throw error;
  }
}

/** The vision-LLM extractor. Without `resolveModel` every step returns `ERROR`. */
export function createVisionLlmExtractor(options: VisionLlmOptions = {}): Extractor {
  const rasterize = options.rasterize ?? defaultRasterize;
  const timeoutMs = options.timeoutMs ?? 60_000;
  return {
    key: VISION_LLM,
    paid: true,
    async extract(input, type, params, ctx) {
      const config = visionConfigSchema.safeParse(ctx.config);
      if (!config.success) return failure("vision-llm needs config.connectionId");
      const resolved = await resolve(options.resolveModel, config.data);
      if (typeof resolved === "string") return failure(resolved);
      const { model, connection, languageModel } = resolved;
      if (!model.vision) return failure(`model ${model.id} cannot read images`);

      const limit = Math.min(config.data.maxPages ?? model.maxPages, model.maxPages);
      const images = await pageImages(
        rasterize,
        input.bytes,
        input.mime,
        input.pages.slice(0, limit),
      );
      if (!Array.isArray(images)) return images;

      const usageOf = (tokens: {
        inputTokens?: number;
        outputTokens?: number;
      }): ExtractionUsage => {
        const inputTokens = tokens.inputTokens ?? 0;
        const outputTokens = tokens.outputTokens ?? 0;
        return {
          inputTokens,
          outputTokens,
          pages: images.length,
          costUsd: callCost(model, inputTokens, outputTokens),
          model: model.id,
          connectionId: connection.id,
          ...(connection.name === undefined ? {} : { connectionName: connection.name }),
        };
      };

      const timeout = AbortSignal.timeout(timeoutMs);
      const schema = answerSchemaFor(type);
      try {
        const result = await generateText({
          model: languageModel,
          ...(model.structuredOutput ? { output: Output.object({ schema }) } : {}),
          instructions: buildPrompt(type, params, images, !model.structuredOutput),
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Read the fields from these pages." },
                ...images.map((image) => ({
                  type: "file" as const,
                  data: image.bytes,
                  mediaType: image.mime,
                })),
              ],
            },
          ],
          temperature: 0,
          // A retry would bill the call twice; the job can be retried instead.
          maxRetries: 0,
          abortSignal: ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout,
        });
        const parsed = schema.safeParse(
          model.structuredOutput ? result.output : parseAnswer(result.text),
        );
        // The model answered but not in shape: the tokens were still billed.
        if (!parsed.success) return { ...failure(NO_FIELDS), usage: usageOf(result.usage) };
        const fields = toFields(type, parsed.data, params);
        return { ...statusOf(type, fields), fields, usage: usageOf(result.usage) };
      } catch (error) {
        if (NoObjectGeneratedError.isInstance(error)) {
          return { ...failure(NO_FIELDS), usage: usageOf(error.usage ?? {}) };
        }
        return failure(timeout.aborted ? "the model did not answer in time" : PROVIDER_ERROR);
      }
    },
  };
}
