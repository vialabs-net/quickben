/**
 * Paid: page images through a vision model, answered as an object built from the type's fields.
 * Values are normalized by field type and a value that is not valid for its field is dropped,
 * so the model cannot invent a well-formed answer the user trusts.
 *
 * Large types are read in groups of fields (one call per group, in parallel), because providers
 * cap the size of a structured-output schema. Fields the model leaves out, answers that are not
 * valid and required fields left empty are asked again, once by default, in a smaller call.
 */
import { QuickbenError } from "@quickben/core";
import { APICallError, generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";

import { listParam } from "../definition";
import { cleanValues } from "../field-values";
import { callCost } from "../models";
import { statusOf } from "../text-readers";

import { rasterize as defaultRasterize, UnsupportedFileError } from "./page-images";
import { PDF, pdfPagesItems } from "./text-layer";

import type { DocumentType, ExtractionParams, FieldDefinition } from "../definition";
import type {
  ExtractionResult,
  ExtractionUsage,
  Extractor,
  ExtractorExample,
  FieldBox,
  FieldValue,
} from "../extractor";
import type { ResolvedModel } from "../models";
import type { PageImage, Rasterize } from "./page-images";
import type { PageText } from "./text-boxes";
import type { ModelMessage } from "ai";

export const VISION_LLM = "vision-llm";

/** Provider failures start with this. The provider's own text follows, with secrets cut out. */
export const PROVIDER_ERROR = "the model provider rejected the request";
export const NO_FIELDS = "the model did not return the fields";
const TIMEOUT = "the model did not answer in time";

/** Fields per call with structured outputs when the step does not set `groupSize`. */
export const DEFAULT_GROUP_SIZE = 24;
/** Text-layer characters sent with `includeText`, at most. */
export const MAX_TEXT_CHARS = 40_000;

/** Values of `reasoning`, as the AI SDK takes them. */
export const REASONING_LEVELS = [
  "provider-default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

/** A `vision-llm` step's `config`. */
export const visionConfigSchema = z
  .object({
    /** Connection id. */
    connectionId: z.string().min(1).optional(),
    /** Connection name: stable across databases, unlike the id. Used when `connectionId` is absent. */
    connection: z.string().trim().min(1).max(120).optional(),
    /** A model id of the connection. Absent: the connection's default model. */
    model: z.string().min(1).optional(),
    maxPages: z.number().int().min(1).optional(),
    /** Send the PDF's text layer with the images. Scans have none and send images only. */
    includeText: z.boolean().optional(),
    /** With `includeText`: each text line with its box. Default `true`. */
    textBoxes: z.boolean().optional(),
    /** Output token cap of one call. */
    maxOutputTokens: z.number().int().min(1).max(200_000).optional(),
    /** Default 0. `null` sends none (some models reject or ignore it). */
    temperature: z.number().min(0).max(2).nullable().optional(),
    /** Reasoning effort, mapped by the AI SDK to each provider. */
    reasoning: z.enum(REASONING_LEVELS).optional(),
    /** Passed as is, e.g. `{ anthropic: { effort: "low" } }`. */
    providerOptions: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    /**
     * `structured`: the provider enforces the schema (when the model supports it). `json`: the
     * reply is JSON checked here, with no grammar on the provider side. Default: `structured`
     * when the model supports it, else `json`.
     */
    output: z.enum(["structured", "json"]).optional(),
    /**
     * Most fields in one call. More fields make more calls in parallel; each call sends the
     * pages again. Default 24 with structured outputs, all fields with `json`.
     */
    groupSize: z.number().int().min(1).max(100).optional(),
    /** Extra calls for fields missing, invalid or required and empty. Default 1. */
    repair: z.number().int().min(0).max(3).optional(),
  })
  .refine((config) => config.connectionId !== undefined || config.connection !== undefined, {
    message: "vision-llm needs config.connectionId or config.connection",
  });
export type VisionConfig = z.infer<typeof visionConfigSchema>;

/** Step options a test-run variant may change. */
export const CALL_OPTION_KEYS = [
  "maxOutputTokens",
  "temperature",
  "reasoning",
  "providerOptions",
  "output",
  "groupSize",
  "repair",
  "includeText",
  "textBoxes",
] as const;

export interface VisionLlmOptions {
  /** Called with the connection and model of a step. */
  readonly resolveModel?: (connectionId: string, modelId?: string) => Promise<ResolvedModel>;
  /** Turns a connection name into its id, for steps that name a connection. */
  readonly resolveConnectionId?: (name: string) => Promise<string>;
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

// A JSON reply is checked by this looser schema: numbers for text, a missing box or page.
const jsonAnswerSchema = z.object({
  value: z
    .union([z.string(), z.number(), z.null()])
    .transform((value) => (value === null ? "" : String(value))),
  confidence: z.coerce.number(),
  page: z.coerce.number().int().default(0),
  evidence: z
    .string()
    .nullable()
    .default("")
    .transform((value) => value ?? ""),
  box: z.string().default("0,0,0,0"),
});

type Field = DocumentType["fields"][number];

/** One entry per field (default: all of the type's). Every key is present, so strict structured outputs accept it. */
export function answerSchemaFor(type: DocumentType, fields: readonly Field[] = type.fields) {
  const shape: Record<string, typeof answerSchema> = {};
  for (const field of fields) {
    shape[field.key] = answerSchema.describe(
      [field.label, field.description, `type: ${field.type}`].filter(Boolean).join(". "),
    );
  }
  return z.object(shape);
}

const formats: Partial<Record<Field["type"], string>> = {
  date: "YYYY-MM-DD",
  number: "digits with . as the decimal separator, no thousands separators",
  phone: "digits, with a leading + when a country code is printed",
};

function fieldLine(field: Field): string {
  const notes = [field.description, formats[field.type]].filter(Boolean).join("; ");
  const suffix = notes ? `: ${notes}` : "";
  return `- ${field.key} (${field.label})${suffix}`;
}

/** Options of {@link buildPrompt}. */
export interface PromptOptions {
  /** Fields asked in this call. Default: all of the type's. */
  readonly fields?: readonly Field[];
  /** The page text layer is sent too. */
  readonly withText?: boolean;
}

/** The system prompt of one call. */
export function buildPrompt(
  type: DocumentType,
  params: ExtractionParams,
  pages: readonly PageImage[],
  jsonHint: boolean,
  options: PromptOptions = {},
): string {
  const fields = options.fields ?? type.fields;
  const lines = [
    `You read a document of type "${type.label}" from page images.`,
    "For each field return the value exactly as printed, or an empty string when it is not there. Never guess.",
    "confidence is 0..1: how sure you are that the value is right. page is the page number (0 when absent); evidence is the short text around the value (empty when absent).",
    'box is the tight rectangle around the printed value only (not its label) on that page, as "x0,y0,x1,y1": four integers from 0 to 1000 for left, top, right and bottom, in thousandths of the page width and height, origin at the top left. "0,0,0,0" when absent.',
    ...(options.withText
      ? [
          "The PDF's text layer comes with the images. Use it for exact characters; the images show the layout and what the text layer lacks.",
        ]
      : []),
    "",
    "Fields:",
    ...fields.map((field) => fieldLine(field)),
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
      `Reply with JSON only: an object with keys ${fields.map((f) => f.key).join(", ")}, each {value, confidence, page, evidence, box}.`,
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
  const open = trimmed.indexOf("```");
  const close = open < 0 ? -1 : trimmed.indexOf("```", open + 3);
  if (close > open) {
    const body = trimmed.slice(open + 3, close);
    return (body.startsWith("json") ? body.slice(4) : body).trim();
  }
  // Some models write a sentence around the object.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start > 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
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
      return [key, { ...answer, box: Array.isArray(box) ? box.join(",") : "0,0,0,0" }];
    }),
  );
}

/** Valid answers by key, and what is wrong with the others, of a parsed JSON reply. */
export function checkAnswers(
  parsed: unknown,
  fields: readonly Pick<FieldDefinition, "key">[],
): { answers: Record<string, Answer>; invalid: Record<string, string> } | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const answers: Record<string, Answer> = {};
  const invalid: Record<string, string> = {};
  for (const field of fields) {
    if (!Object.hasOwn(record, field.key)) {
      invalid[field.key] = "missing";
      continue;
    }
    const checked = jsonAnswerSchema.safeParse(record[field.key]);
    if (checked.success) answers[field.key] = checked.data;
    else invalid[field.key] = checked.error.issues[0]?.message ?? "invalid";
  }
  return { answers, invalid };
}

function failure(error: string): ExtractionResult {
  return { status: "ERROR", fields: {}, problems: { error } };
}

// Provider text is untrusted and may echo any credential, even an ordinary word. Only emit
// fixed diagnostics we recognize; never persist fragments of the raw message.
function safeProviderDetail(status: number | undefined, message: string): string {
  if (status === 400 && isSchemaTooLarge({ status, message }))
    return "The compiled grammar is too large";
  if (status === 400 && /^max_tokens: too big$/iu.test(message)) return "max_tokens: too big";
  return "";
}

/** A provider error as shown in runs and readings: status and message, never a secret. */
export function describeProviderError(
  error: unknown,
  timedOut: boolean,
): { message: string; transient: boolean; status?: number } {
  if (timedOut) return { message: TIMEOUT, transient: true };
  if (!APICallError.isInstance(error)) return { message: PROVIDER_ERROR, transient: true };
  const status = error.statusCode;
  let detail = error.message;
  try {
    const body = JSON.parse(error.responseBody ?? "") as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string") detail = body.error.message;
  } catch {
    // Not JSON: keep the SDK's message.
  }
  const clean = safeProviderDetail(status, detail);
  const code = status === undefined ? "" : ` (HTTP ${String(status)})`;
  return {
    message: clean ? `${PROVIDER_ERROR}${code}: ${clean}` : `${PROVIDER_ERROR}${code}`,
    // A request the provider refuses (400, 401, 404) fails the same way when sent again.
    transient: error.isRetryable || status === undefined || status === 429 || status >= 500,
    ...(status === undefined ? {} : { status }),
  };
}

async function resolve(
  options: VisionLlmOptions,
  config: VisionConfig,
): Promise<ResolvedModel | string> {
  if (!options.resolveModel)
    return "no models are configured: pass resolveModel, e.g. connectionModels() from @quickben/plugin-doc-reader/connections";
  try {
    let connectionId = config.connectionId;
    if (connectionId === undefined && config.connection !== undefined) {
      if (!options.resolveConnectionId) {
        return "connections by name need resolveConnectionId, e.g. connectionModels() from @quickben/plugin-doc-reader/connections";
      }
      connectionId = await options.resolveConnectionId(config.connection);
    }
    return await options.resolveModel(connectionId ?? "", config.model);
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

const thousandths = (n: number) => String(Math.round(n * 1000));

/**
 * A page's text runs as lines, top to bottom: runs whose vertical centers are close join one
 * line, left to right, with the box around them.
 */
export function textLines(page: PageText): { text: string; box: FieldBox }[] {
  const center = (box: FieldBox) => (box.y0 + box.y1) / 2;
  const items = page.items
    .filter((item) => item.str.trim() !== "")
    .toSorted((a, b) => center(a.box) - center(b.box) || a.box.x0 - b.box.x0);
  const lines: { items: typeof items; box: FieldBox }[] = [];
  for (const item of items) {
    const line = lines.at(-1);
    const height = Math.min(item.box.y1 - item.box.y0, line ? line.box.y1 - line.box.y0 : 1);
    if (line && Math.abs(center(item.box) - center(line.box)) <= height / 2) {
      line.items.push(item);
      line.box = {
        x0: Math.min(line.box.x0, item.box.x0),
        y0: Math.min(line.box.y0, item.box.y0),
        x1: Math.max(line.box.x1, item.box.x1),
        y1: Math.max(line.box.y1, item.box.y1),
      };
    } else {
      lines.push({ items: [item], box: item.box });
    }
  }
  return lines.map((line) => ({
    text: line.items
      .toSorted((a, b) => a.box.x0 - b.box.x0)
      .map((item) => item.str.trim())
      .join(" "),
    box: line.box,
  }));
}

/** The text layer as sent to the model, or `null` when there is none. */
export function formatTextLayer(pages: readonly PageText[], boxes: boolean): string | null {
  const parts: string[] = [];
  for (const page of pages) {
    const lines = textLines(page);
    if (lines.length === 0) continue;
    parts.push(
      `Page ${String(page.page)}${boxes ? ' (each line starts with its box "x0,y0,x1,y1" in thousandths)' : ""}:`,
      ...lines.map((line) =>
        boxes
          ? `${[line.box.x0, line.box.y0, line.box.x1, line.box.y1].map(thousandths).join(",")} ${line.text}`
          : line.text,
      ),
      "",
    );
  }
  if (parts.length === 0) return null;
  const text = parts.join("\n").trim();
  return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n[cut]` : text;
}

async function textLayer(
  bytes: Uint8Array,
  mime: string,
  pages: readonly number[],
  boxes: boolean,
): Promise<string | null> {
  if (mime !== PDF) return null;
  try {
    return formatTextLayer(await pdfPagesItems(bytes, pages), boxes);
  } catch {
    // A PDF whose text cannot be read is still read from its images.
    return null;
  }
}

interface TokenUsage {
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly inputTokenDetails?: { readonly cacheReadTokens: number | undefined };
}

const NO_USAGE: TokenUsage = { inputTokens: undefined, outputTokens: undefined };

/** The answer an example should get, as the model would write it. */
export function exampleAnswer(
  type: DocumentType,
  values: Readonly<Record<string, string>>,
  fields: readonly Field[] = type.fields,
) {
  return Object.fromEntries(
    fields.map((field) => {
      const value = Object.hasOwn(values, field.key) ? (values[field.key] ?? "") : "";
      return [
        field.key,
        { value, confidence: value ? 1 : 0, page: value ? 1 : 0, evidence: "", box: "0,0,0,0" },
      ];
    }),
  );
}

interface ShownExample {
  readonly images: readonly PageImage[];
  readonly values: Readonly<Record<string, string>>;
}

/** Few-shot examples' first pages. An example whose file cannot be shown is left out. */
async function exampleImages(
  rasterize: Rasterize,
  type: DocumentType,
  examples: readonly ExtractorExample[],
): Promise<ShownExample[]> {
  const shown: ShownExample[] = [];
  for (const example of examples) {
    try {
      const images = await rasterize(example.bytes, example.mime, type.pages.slice(0, 1));
      if (images.length > 0) shown.push({ images, values: example.values });
    } catch {
      continue;
    }
  }
  return shown;
}

const filePart = (image: PageImage) => ({
  type: "file" as const,
  data: image.bytes,
  mediaType: image.mime,
});

/** Few-shot examples as earlier turns: the example's first page, then the answer. */
function exampleMessages(
  type: DocumentType,
  examples: readonly ShownExample[],
  fields: readonly Field[],
): ModelMessage[] {
  return examples.flatMap((example): ModelMessage[] => [
    {
      role: "user",
      content: [
        { type: "text", text: "Example document. Read the fields from these pages." },
        ...example.images.map(filePart),
      ],
    },
    { role: "assistant", content: JSON.stringify(exampleAnswer(type, example.values, fields)) },
  ]);
}

/** Fields in groups of at most `size`, as even as possible. */
export function fieldGroups<T>(fields: readonly T[], size: number): T[][] {
  if (fields.length === 0) return [];
  const count = Math.ceil(fields.length / Math.max(1, size));
  const per = Math.ceil(fields.length / count);
  const groups: T[][] = [];
  for (let at = 0; at < fields.length; at += per) groups.push(fields.slice(at, at + per));
  return groups;
}

/** What one call returned. */
interface CallOutcome {
  readonly answers: Record<string, Answer>;
  /** Keys asked and not answered validly, with the reason. */
  readonly invalid: Record<string, string>;
  readonly usage: TokenUsage | null;
  readonly error?: { readonly message: string; readonly transient: boolean };
  /** The provider refused the schema as too large. */
  readonly tooLarge?: boolean;
}

/** Smallest group split further when the provider finds its schema too large. */
const MIN_SPLIT = 4;

/** A 400 about the size of a structured-output schema or grammar. */
export function isSchemaTooLarge(error: { message: string; status?: number }): boolean {
  return (
    error.status === 400 &&
    /grammar|schema/iu.test(error.message) &&
    /too (?:large|complex|many|big)|exceed/iu.test(error.message)
  );
}

type GenerateSettings = Pick<
  Parameters<typeof generateText>[0],
  "temperature" | "maxOutputTokens" | "reasoning" | "providerOptions"
>;

function callSettings(config: VisionConfig): GenerateSettings {
  return {
    ...(config.temperature === null ? {} : { temperature: config.temperature ?? 0 }),
    ...(config.maxOutputTokens === undefined ? {} : { maxOutputTokens: config.maxOutputTokens }),
    ...(config.reasoning === undefined ? {} : { reasoning: config.reasoning }),
    ...(config.providerOptions === undefined
      ? {}
      : { providerOptions: config.providerOptions as GenerateSettings["providerOptions"] }),
  };
}

const allInvalid = (fields: readonly Field[], reason: string) =>
  Object.fromEntries(fields.map((field) => [field.key, reason]));

/** Everything one read needs, resolved once and shared by its calls. */
interface ReadJob {
  readonly type: DocumentType;
  readonly params: ExtractionParams;
  readonly config: VisionConfig;
  readonly resolved: ResolvedModel;
  readonly images: readonly PageImage[];
  readonly examples: readonly ShownExample[];
  readonly text: string | null;
  readonly structured: boolean;
  readonly groupSize: number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal | undefined;
}

/** The messages of one call: the examples, then the pages (and their text). */
function callMessages(job: ReadJob, fields: readonly Field[], note: string | undefined) {
  const user: ModelMessage = {
    role: "user",
    content: [
      { type: "text", text: note ?? "Read the fields from these pages." },
      ...(job.text === null ? [] : [{ type: "text" as const, text: job.text }]),
      ...job.images.map(filePart),
    ],
  };
  return [...exampleMessages(job.type, job.examples, fields), user];
}

/** What a failed call still gives: the valid fields of a reply off the schema, or the error. */
function failedCall(
  error: unknown,
  fields: readonly Field[],
  timedOut: boolean,
  strict: boolean,
): CallOutcome {
  if (NoObjectGeneratedError.isInstance(error)) {
    // The reply did not match the schema as a whole; keep the fields that are valid.
    const usage = error.usage ?? NO_USAGE;
    const salvaged =
      error.text === undefined ? null : checkAnswers(parseAnswer(error.text), fields);
    if (salvaged) return { ...salvaged, usage };
    return { answers: {}, invalid: allInvalid(fields, NO_FIELDS), usage };
  }
  const described = describeProviderError(error, timedOut);
  return {
    answers: {},
    invalid: allInvalid(fields, described.message),
    usage: null,
    error: { message: described.message, transient: described.transient },
    ...(strict && isSchemaTooLarge(described) ? { tooLarge: true } : {}),
  };
}

/** One model call for some fields. Never throws. */
async function callModel(
  job: ReadJob,
  fields: readonly Field[],
  note: string | undefined,
  strict: boolean,
): Promise<CallOutcome> {
  const timeout = AbortSignal.timeout(job.timeoutMs);
  const schema = answerSchemaFor(job.type, fields);
  try {
    const result = await generateText({
      model: job.resolved.languageModel,
      ...(strict ? { output: Output.object({ schema }) } : {}),
      instructions: buildPrompt(job.type, job.params, job.images, !strict, {
        fields,
        withText: job.text !== null,
      }),
      messages: callMessages(job, fields, note),
      ...callSettings(job.config),
      // A retry would bill the call twice; repairs and job retries are counted instead.
      maxRetries: 0,
      abortSignal: job.signal ? AbortSignal.any([job.signal, timeout]) : timeout,
    });
    const checked = checkAnswers(strict ? result.output : parseAnswer(result.text), fields);
    // The model answered but not in shape: the tokens were still billed.
    if (!checked) {
      return { answers: {}, invalid: allInvalid(fields, NO_FIELDS), usage: result.usage };
    }
    return { ...checked, usage: result.usage };
  } catch (error) {
    return failedCall(error, fields, timeout.aborted, strict);
  }
}

/**
 * One group of fields. A schema the provider finds too large is split in two, down to a few
 * fields, and then asked as plain JSON. The refused calls are not billed.
 */
async function readGroup(
  job: ReadJob,
  fields: readonly Field[],
  note: string | undefined,
  strict: boolean,
): Promise<CallOutcome[]> {
  const outcome = await callModel(job, fields, note, strict);
  if (!outcome.tooLarge) return [outcome];
  if (fields.length <= MIN_SPLIT) return readGroup(job, fields, note, false);
  const half = Math.ceil(fields.length / 2);
  const parts = await Promise.all([
    readGroup(job, fields.slice(0, half), note, strict),
    readGroup(job, fields.slice(half), note, strict),
  ]);
  return parts.flat();
}

/** Fields in groups, read in parallel. */
async function readFields(
  job: ReadJob,
  fields: readonly Field[],
  note?: string,
): Promise<CallOutcome[]> {
  const groups = fieldGroups(fields, job.groupSize);
  const outcomes = await Promise.all(
    groups.map((group) => readGroup(job, group, note, job.structured)),
  );
  return outcomes.flat();
}

/** Answers, problems and token use gathered over the calls of one read. */
class Tally {
  readonly answers: Record<string, Answer> = {};
  readonly usages: (TokenUsage | null)[] = [];
  readonly errors: { message: string; transient: boolean }[] = [];
  invalid = new Map<string, string>();

  add(outcomes: readonly CallOutcome[], repair: boolean): void {
    for (const outcome of outcomes) {
      this.usages.push(outcome.usage);
      if (outcome.error) this.errors.push(outcome.error);
      for (const [key, reason] of Object.entries(outcome.invalid)) this.invalid.set(key, reason);
      for (const [key, answer] of Object.entries(outcome.answers)) {
        // A repair keeps an earlier value it could not improve on.
        if (!repair || answer.value.trim() !== "" || !Object.hasOwn(this.answers, key)) {
          this.answers[key] = answer;
        }
        this.invalid.delete(key);
      }
    }
  }

  /** Calls that reached the model. */
  get calls(): number {
    return this.usages.filter((usage) => usage !== null).length;
  }

  usage(job: ReadJob): ExtractionUsage | undefined {
    if (this.calls === 0) return undefined;
    const { model, connection } = job.resolved;
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;
    for (const usage of this.usages) {
      inputTokens += usage?.inputTokens ?? 0;
      outputTokens += usage?.outputTokens ?? 0;
      cachedInputTokens += usage?.inputTokenDetails?.cacheReadTokens ?? 0;
    }
    return {
      inputTokens,
      outputTokens,
      ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
      pages: job.images.length * this.calls,
      costUsd: callCost(model, inputTokens, outputTokens, cachedInputTokens),
      model: model.id,
      connectionId: connection.id,
      ...(connection.name === undefined ? {} : { connectionName: connection.name }),
      ...(this.calls > 1 ? { calls: this.calls } : {}),
    };
  }
}

const REPAIR_NOTE =
  "An earlier answer missed these fields or gave values that are not valid. Read only these fields again; leave a value empty only when it is not printed.";

/**
 * Ask again, up to `config.repair` times (default 1), for fields left out or invalid and for
 * required fields left empty. Stops on a provider error. Returns the repaired keys and calls.
 */
async function repair(job: ReadJob, tally: Tally): Promise<{ repairs: number; keys: string[] }> {
  const limit = job.config.repair ?? 1;
  const keys = new Set<string>();
  let rounds = 0;
  let repairs = 0;
  while (rounds < limit && tally.errors.length === 0) {
    const current = toFields(job.type, tally.answers, job.params);
    const ask = job.type.fields.filter(
      (field) =>
        tally.invalid.has(field.key) ||
        (!Object.hasOwn(current, field.key) &&
          (field.required || (tally.answers[field.key]?.value ?? "").trim() !== "")),
    );
    if (ask.length === 0) break;
    rounds += 1;
    const reasons = ask.map((field) => {
      keys.add(field.key);
      const reason = field.required
        ? "required, and empty or not valid"
        : "value is not valid or is excluded";
      return `- ${field.key}: ${tally.invalid.get(field.key) ?? reason}`;
    });
    tally.invalid = new Map();
    const outcomes = await readFields(job, ask, [REPAIR_NOTE, ...reasons].join("\n"));
    repairs += outcomes.filter((outcome) => outcome.usage !== null).length;
    tally.add(outcomes, true);
  }
  return { repairs, keys: [...keys] };
}

/** The step's result from what the calls gathered. */
function finish(
  job: ReadJob,
  tally: Tally,
  firstCalls: number,
  repaired: { repairs: number; keys: string[] },
): ExtractionResult {
  const fields = toFields(job.type, tally.answers, job.params);
  const usage = tally.usage(job);
  const extra = {
    ...(firstCalls > 1 ? { groups: firstCalls } : {}),
    ...(repaired.repairs > 0 ? { repairs: repaired.repairs, repaired: repaired.keys } : {}),
  };
  const common = {
    ...(usage ? { usage } : {}),
    ...(repaired.repairs > 0 ? { repairs: repaired.repairs } : {}),
  };
  const [firstError] = tally.errors;
  if (firstError) {
    const transient = tally.errors.every((error) => error.transient);
    return {
      status: Object.keys(fields).length > 0 ? statusOf(job.type, fields).status : "ERROR",
      fields,
      problems: { error: firstError.message, ...(transient ? { transient: true } : {}), ...extra },
      ...common,
    };
  }
  if (Object.keys(tally.answers).length === 0) {
    return { status: "ERROR", fields: {}, problems: { error: NO_FIELDS, ...extra }, ...common };
  }
  const outcome = statusOf(job.type, fields);
  const problems = { ...outcome.problems, ...extra };
  return {
    status: outcome.status,
    fields,
    ...(Object.keys(problems).length > 0 ? { problems } : {}),
    ...common,
  };
}

function configError(config: Readonly<Record<string, unknown>>, error: z.ZodError): string {
  if (config.connectionId === undefined && config.connection === undefined) {
    return "vision-llm needs config.connectionId or config.connection";
  }
  const issues = error.issues.map((issue) => [issue.path.join("."), issue.message].join(" "));
  return `invalid vision-llm config: ${issues.join("; ")}`;
}

/** The vision-LLM extractor. Without `resolveModel` every step returns `ERROR`. */
export function createVisionLlmExtractor(options: VisionLlmOptions = {}): Extractor {
  const rasterize = options.rasterize ?? defaultRasterize;
  const timeoutMs = options.timeoutMs ?? 60_000;
  return {
    key: VISION_LLM,
    paid: true,
    async extract(input, type, params, ctx) {
      const parsed = visionConfigSchema.safeParse(ctx.config);
      if (!parsed.success) return failure(configError(ctx.config, parsed.error));
      const config = parsed.data;
      const resolved = await resolve(options, config);
      if (typeof resolved === "string") return failure(resolved);
      const { model } = resolved;
      if (!model.vision) return failure(`model ${model.id} cannot read images`);

      const limit = Math.min(config.maxPages ?? model.maxPages, model.maxPages);
      const shownPages = input.pages.slice(0, limit);
      const images = await pageImages(rasterize, input.bytes, input.mime, shownPages);
      if (!Array.isArray(images)) return images;
      const structured = model.structuredOutput && config.output !== "json";
      const job: ReadJob = {
        type,
        params,
        config,
        resolved,
        images,
        examples: await exampleImages(rasterize, type, ctx.examples ?? []),
        text:
          config.includeText === true
            ? await textLayer(input.bytes, input.mime, shownPages, config.textBoxes !== false)
            : null,
        structured,
        groupSize: config.groupSize ?? (structured ? DEFAULT_GROUP_SIZE : type.fields.length),
        timeoutMs,
        signal: ctx.signal,
      };

      const tally = new Tally();
      const first = await readFields(job, type.fields);
      tally.add(first, false);
      const repaired = await repair(job, tally);
      return finish(job, tally, first.length, repaired);
    },
  };
}
