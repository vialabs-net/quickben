/**
 * A synthetic dataset of 200 receipts and a fake vision model whose mistakes are known, so the
 * tests can check every metric against an oracle.
 */
import { MockLanguageModelV4 } from "ai/test";

import { PNG, modelInfo } from "./helpers";

import type { DocumentTypeInput, ImportItem, ResolveModel } from "../src";

export const SIZE = 200;
export const GROUPS = 10;

export const receiptInput: DocumentTypeInput = {
  key: "receipt",
  version: 1,
  label: "Receipt",
  fields: [
    { key: "code", label: "Code", type: "text", required: true },
    { key: "issuedOn", label: "Issued on", type: "date" },
    { key: "amount", label: "Amount", type: "number" },
    { key: "reference", label: "Reference", type: "text", scored: false },
  ],
  pipeline: {
    steps: [{ extractor: "vision-llm", config: { connectionId: "conn-1", model: "good" } }],
  },
};

export interface Truth {
  readonly key: string;
  readonly index: number;
  readonly group: string;
  readonly hasTextLayer: boolean;
  readonly code: string;
  /** `null`: the document has no date. */
  readonly issuedOn: string | null;
  readonly amount: string;
  readonly reference: string;
}

export function truth(index: number): Truth {
  return {
    key: `docs/receipt-${String(index).padStart(3, "0")}.png`,
    index,
    group: `g${String(index % GROUPS)}`,
    hasTextLayer: index % 3 === 0,
    code: `C-${String(1000 + index)}`,
    issuedOn: index % 8 === 0 ? null : `2026-0${String((index % 9) + 1)}-1${String(index % 10)}`,
    amount: String(((index * 7) % 500) + 0.5),
    reference: `R${String(index)}`,
  };
}

export const dataset: Truth[] = Array.from({ length: SIZE }, (_, index) => truth(index));
export const byKey = new Map(dataset.map((item) => [item.key, item]));

/** A PNG with the sample key after its end, so the fake model knows which sample it reads. */
export function fileOf(key: string): Uint8Array {
  const tail = new TextEncoder().encode(`#${key}`);
  const bytes = new Uint8Array(PNG.length + tail.length);
  bytes.set(PNG);
  bytes.set(tail, PNG.length);
  return bytes;
}

function keyOf(bytes: Uint8Array): string {
  const text = new TextDecoder().decode(bytes.slice(PNG.length));
  return text.startsWith("#") ? text.slice(1) : "";
}

/** Nested, as a dataset might keep it: the import maps it with `mapReceipt`. */
export function rawExpected(item: Truth) {
  return {
    header: { code: item.code, date: item.issuedOn },
    totals: { amount: Number(item.amount) },
    ref: item.reference,
  };
}

export function mapReceipt(raw: unknown) {
  const value = raw as ReturnType<typeof rawExpected>;
  return {
    code: value.header.code,
    issuedOn: value.header.date,
    amount: value.totals.amount,
    reference: value.ref,
    // Not a field of the type: reported by the import.
    pages: 1,
  };
}

export const importItems = (items: readonly Truth[] = dataset): ImportItem[] =>
  items.map((item) => ({
    key: item.key,
    file: { bytes: fileOf(item.key), name: item.key.split("/").at(-1) ?? item.key },
    expected: rawExpected(item),
    group: item.group,
    attributes: { hasTextLayer: item.hasTextLayer },
  }));

// ---------------------------------------------------------------------------------------------
// What the fake model reads

/** Group g3: every amount is off by one. */
const wrongAmount = (item: Truth, model: string) =>
  model === "bad" ? item.index % 2 === 0 : item.group === "g3";
/** Every 10th from 7: the code is not read. */
const missesCode = (item: Truth) => item.index % 10 === 7;
/** No date printed, and the model makes one up. */
const inventsDate = (item: Truth) => item.issuedOn === null && item.index % 16 === 0;
/** The provider fails once, then answers. */
export const isFlaky = (item: Truth) => item.index % 25 === 5;
/** The provider always fails. */
export const isBroken = (item: Truth) => item.index % 50 === 11;

/** The bytes of a prompt's file part: `data` is the bytes, or `{ type: "data", data }`. */
function fileBytes(part: unknown): Uint8Array {
  const data = (part as { data?: unknown } | undefined)?.data;
  if (data instanceof Uint8Array) return data;
  const inner = (data as { data?: unknown } | undefined)?.data;
  return inner instanceof Uint8Array ? inner : new Uint8Array();
}

export function readValues(item: Truth, model: string): Record<string, string> {
  return {
    code: missesCode(item) ? "" : item.code,
    issuedOn: inventsDate(item) ? "2026-12-31" : (item.issuedOn ?? ""),
    amount: wrongAmount(item, model) ? String(Number(item.amount) + 1) : item.amount,
    // Always wrong: the field is not scored, so it must not lower accuracy.
    reference: "X",
  };
}

function dateOutcome(item: Truth, read: Record<string, string>): string {
  if (item.issuedOn !== null) return "correct";
  return read.issuedOn ? "hallucinated" : "correct-empty";
}

/** Outcomes the metrics must report for one sample, scored fields only. */
export function expectedOutcomes(item: Truth, model: string): Record<string, string> {
  const read = readValues(item, model);
  return {
    code: read.code ? "correct" : "missed",
    issuedOn: dateOutcome(item, read),
    amount: read.amount === item.amount ? "correct" : "wrong",
  };
}

export const TOKENS = { input: 2000, cached: 500, output: 300 };
/** (1500 × 3 + 500 × 0.3 + 300 × 15) / 1e6 */
export const CALL_COST = 0.00915;

export interface FakeModels {
  readonly resolveModel: ResolveModel;
  /** Calls per model id. */
  readonly calls: Map<string, number>;
  /** Most calls in flight at once. */
  readonly peak: { value: number };
  /** Prompts of every call, to check few-shot examples. */
  readonly prompts: unknown[];
}

export function fakeModels(): FakeModels {
  const calls = new Map<string, number>();
  const tries = new Map<string, number>();
  const peak = { value: 0 };
  const prompts: unknown[] = [];
  let inFlight = 0;
  const models = new Map<string, MockLanguageModelV4>();
  const modelFor = (id: string) => {
    const existing = models.get(id);
    if (existing) return existing;
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        calls.set(id, (calls.get(id) ?? 0) + 1);
        prompts.push(options.prompt);
        inFlight += 1;
        peak.value = Math.max(peak.value, inFlight);
        try {
          await new Promise((resolve) => setTimeout(resolve, 2));
          const users = options.prompt.filter((message) => message.role === "user");
          const last = users.at(-1);
          const file = Array.isArray(last?.content)
            ? last.content.find((part) => part.type === "file")
            : undefined;
          const key = keyOf(fileBytes(file));
          const item = byKey.get(key);
          if (!item) throw new Error(`unknown sample ${key}`);
          const tried = (tries.get(`${id}:${key}`) ?? 0) + 1;
          tries.set(`${id}:${key}`, tried);
          // A flaky sample fails the first try of every run (with one retry, odd tries).
          if (isBroken(item) || (isFlaky(item) && tried % 2 === 1)) {
            throw new Error("503 upstream unavailable");
          }
          const values = readValues(item, id);
          const answer = Object.fromEntries(
            Object.entries(values).map(([field, value]) => [
              field,
              {
                value,
                confidence: value ? 0.95 : 0,
                page: value ? 1 : 0,
                evidence: "",
                box: "0,0,0,0",
              },
            ]),
          );
          return {
            content: [{ type: "text", text: JSON.stringify(answer) }],
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: {
                total: TOKENS.input,
                noCache: TOKENS.input - TOKENS.cached,
                cacheRead: TOKENS.cached,
                cacheWrite: undefined,
              },
              outputTokens: { total: TOKENS.output, text: TOKENS.output, reasoning: undefined },
            },
            warnings: [],
          };
        } finally {
          inFlight -= 1;
        }
      },
    });
    models.set(id, model);
    return model;
  };
  return {
    calls,
    peak,
    prompts,
    resolveModel: (connectionId, modelId) =>
      Promise.resolve({
        connection: { id: connectionId, name: "Fake" },
        model: modelInfo({
          id: modelId ?? "good",
          maxPages: 1,
          inputPerMTokUsd: 3,
          outputPerMTokUsd: 15,
          cachedInputPerMTokUsd: 0.3,
        }),
        languageModel: modelFor(modelId ?? "good"),
      }),
  };
}
