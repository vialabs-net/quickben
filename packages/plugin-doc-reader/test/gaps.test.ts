/**
 * What the first app on the doc reader needed: dotted field keys, the text layer and provider
 * options in `vision-llm`, connections by name, the instance in extractor contexts, drafts for
 * types changed in code, large schemas in groups and repairs of incomplete answers.
 */
import { createQuickben, defineConfig, devAuth, memoryStorage } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import {
  answerSchemaFor,
  createDraft,
  createVisionLlmExtractor,
  describeProviderError,
  DOC_TYPES,
  docReader,
  fieldGroups,
  flattenValues,
  formatTextLayer,
  inProcessRunner,
  nestValues,
  parseDocumentType,
  runMetrics,
  runPipeline,
} from "../src";
import { variantPipeline, variantSchema } from "../src/bench";
import { expectedValues } from "../src/import";
import { definitionFingerprint } from "../src/store";

import { invoice, invoiceInput, invoiceReply, makePdf, modelInfo, PNG, system } from "./helpers";

import type {
  DocumentType,
  DocumentTypeInput,
  Extractor,
  ExtractorContext,
  ModelInfo,
  ResolvedModel,
  SampleResult,
} from "../src";

type LanguageModelV4CallOptions = MockLanguageModelV4["doGenerateCalls"][number];

const png = { page: 1, bytes: PNG, mime: "image/png" };
const imageInput = { bytes: PNG, mime: "image/png", pages: [1] };

interface Answer {
  value: string;
  confidence: number;
  page: number;
  evidence: string;
  box: string;
}
const answer = (value: string): Answer => ({
  value,
  confidence: value ? 0.95 : 0,
  page: value ? 1 : 0,
  evidence: "",
  box: "0,0,0,0",
});

/** The field keys a call asked for, from its prompt. */
function askedKeys(options: LanguageModelV4CallOptions): string[] {
  const system = options.prompt.find((message) => message.role === "system");
  const text = typeof system?.content === "string" ? system.content : "";
  const fields = text.split("Fields:\n")[1]?.split("\n\n")[0] ?? "";
  return [...fields.matchAll(/^- (\S+) \(/gmu)].map((match) => match[1] ?? "");
}

/** A model that answers each asked field with `values[key]` (missing: absent from the reply). */
function fieldModel(
  reply: (keys: string[], options: LanguageModelV4CallOptions, call: number) => unknown,
) {
  const calls: LanguageModelV4CallOptions[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: (options) => {
      calls.push(options);
      const body = reply(askedKeys(options), options, calls.length);
      if (body instanceof Error) return Promise.reject(body);
      return Promise.resolve({
        content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1000, noCache: 1000, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 100, text: 100, reasoning: undefined },
        },
        warnings: [],
      });
    },
  });
  return { model, calls };
}

function extractorFor(
  languageModel: MockLanguageModelV4,
  model: Partial<ModelInfo> = {},
  extra: { resolveConnectionId?: (name: string) => Promise<string> } = {},
) {
  const resolveModel = vi.fn((connectionId: string): Promise<ResolvedModel> =>
    Promise.resolve({
      connection: { id: connectionId, name: "Main" },
      model: modelInfo(model),
      languageModel,
    }),
  );
  const extractor = createVisionLlmExtractor({
    resolveModel,
    rasterize: () => Promise.resolve([png]),
    ...extra,
  });
  return { extractor, resolveModel };
}

const ctx = (config: Record<string, unknown>): ExtractorContext => ({
  tenant: null,
  config: { connectionId: "conn-1", ...config },
});

/** A type with `count` text fields `f1`…`fN`; the first is required. */
function wideType(count: number): DocumentType {
  return parseDocumentType({
    key: "wide",
    version: 1,
    label: "Wide",
    fields: Array.from({ length: count }, (_, index) => ({
      key: `group${String(index % 3)}.f${String(index + 1)}`,
      label: `Field ${String(index + 1)}`,
      type: "text",
      required: index === 0,
    })),
    pipeline: { steps: [{ extractor: "vision-llm", config: {} }] },
  });
}

describe("dotted field keys", () => {
  it("accepts camelCase segments joined by dots and nothing else", () => {
    const type = wideType(3);
    expect(type.fields.map((field) => field.key)).toEqual(["group0.f1", "group1.f2", "group2.f3"]);
    for (const key of ["vehicle..make", ".make", "vehicle.", "Vehicle.make", "vehicle.make_x"]) {
      expect(() =>
        parseDocumentType({ ...invoiceInput, fields: [{ key, label: "X", type: "text" }] }),
      ).toThrow();
    }
    expect(Object.keys(answerSchemaFor(type).shape)).toEqual([
      "group0.f1",
      "group1.f2",
      "group2.f3",
    ]);
  });

  it("nests and flattens values by dotted key", () => {
    const values = { "vehicle.make": "Kia", "vehicle.engine.number": "E1", total: "10" };
    const nested = nestValues(values);
    expect(nested).toEqual({ vehicle: { make: "Kia", engine: { number: "E1" } }, total: "10" });
    expect(flattenValues(nested)).toEqual(values);
    // A value and a parent with the same key: the value wins.
    expect(nestValues({ a: "1", "a.b": "2" })).toEqual({ a: "1" });
    expect(flattenValues({ list: [1, 2], none: null })).toEqual({ list: [1, 2], none: null });
  });

  it("imports nested expected values into dotted fields", () => {
    const type = parseDocumentType({
      ...invoiceInput,
      fields: [
        { key: "vehicle.make", label: "Make", type: "text" },
        { key: "vehicle.year", label: "Year", type: "number" },
      ],
      params: [],
    });
    const unknown = new Set<string>();
    const flat = flattenValues({ vehicle: { make: "Kia", year: 2026, color: "red" } });
    expect(expectedValues(type, flat as never, unknown)).toEqual({
      "vehicle.make": "Kia",
      "vehicle.year": "2026",
    });
    expect([...unknown]).toEqual(["vehicle.color"]);
  });
});

describe("vision-llm: text layer", () => {
  it("formats text runs as lines, with or without boxes", () => {
    const pages = [
      {
        page: 1,
        items: [
          { str: "TOTAL:", box: { x0: 0.1, y0: 0.5, x1: 0.2, y1: 0.52 } },
          { str: "$10", box: { x0: 0.25, y0: 0.501, x1: 0.3, y1: 0.521 } },
          { str: "INVOICE", box: { x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.12 } },
          { str: " ", box: { x0: 0, y0: 0, x1: 0, y1: 0 } },
        ],
      },
    ];
    expect(formatTextLayer(pages, true)).toBe(
      [
        'Page 1 (each line starts with its box "x0,y0,x1,y1" in thousandths):',
        "100,100,300,120 INVOICE",
        "100,500,300,521 TOTAL: $10",
      ].join("\n"),
    );
    expect(formatTextLayer(pages, false)).toBe("Page 1:\nINVOICE\nTOTAL: $10");
    expect(formatTextLayer([{ page: 1, items: [] }], true)).toBeNull();
  });

  it("sends the PDF's text with the images when the step asks for it", async () => {
    const { model, calls } = fieldModel((keys) =>
      Object.fromEntries(keys.map((key) => [key, answer(key === "number" ? "A-1" : "")])),
    );
    const { extractor } = extractorFor(model);
    const pdf = {
      bytes: await makePdf(["INVOICE NO. A-1043"]),
      mime: "application/pdf",
      pages: [1],
    };
    await extractor.extract(pdf, invoice, {}, ctx({ includeText: true, repair: 0 }));
    const sent = JSON.stringify(calls[0]?.prompt);
    expect(sent).toContain("INVOICE NO. A-1043");
    expect(sent).toContain("text layer comes with the images");
    expect(sent).toMatch(/\d{1,4},\d{1,4},\d{1,4},\d{1,4} INVOICE NO\. A-1043/u);

    await extractor.extract(
      pdf,
      invoice,
      {},
      ctx({ includeText: true, textBoxes: false, repair: 0 }),
    );
    expect(JSON.stringify(calls[1]?.prompt)).toContain("Page 1:\\nINVOICE NO. A-1043");
    // Off by default, and an image has no text layer.
    await extractor.extract(pdf, invoice, {}, ctx({ repair: 0 }));
    await extractor.extract(imageInput, invoice, {}, ctx({ includeText: true, repair: 0 }));
    expect(JSON.stringify(calls[2]?.prompt)).not.toContain("A-1043");
    expect(JSON.stringify(calls[3]?.prompt)).not.toContain("text layer comes");
  });
});

describe("vision-llm: provider options and connections by name", () => {
  it("passes the output cap, reasoning, provider options and temperature", async () => {
    const { model, calls } = fieldModel((keys) =>
      Object.fromEntries(keys.map((key) => [key, answer("")])),
    );
    const { extractor } = extractorFor(model);
    await extractor.extract(
      imageInput,
      invoice,
      {},
      ctx({
        maxOutputTokens: 8000,
        reasoning: "low",
        providerOptions: { anthropic: { effort: "low" } },
        temperature: null,
        repair: 0,
      }),
    );
    expect(calls[0]).toMatchObject({
      maxOutputTokens: 8000,
      reasoning: "low",
      providerOptions: { anthropic: { effort: "low" } },
    });
    expect(calls[0]?.temperature).toBeUndefined();
    await extractor.extract(imageInput, invoice, {}, ctx({ repair: 0 }));
    expect(calls[1]?.temperature).toBe(0);
    const bad = await extractor.extract(imageInput, invoice, {}, ctx({ reasoning: "lots" }));
    expect(bad.problems?.error).toContain("invalid vision-llm config: reasoning");
  });

  it("resolves a connection by its name", async () => {
    const { model } = fieldModel((keys) =>
      Object.fromEntries(keys.map((key) => [key, answer("")])),
    );
    const resolveConnectionId = vi.fn((name: string) => Promise.resolve(`id-of-${name}`));
    const { extractor, resolveModel } = extractorFor(model, {}, { resolveConnectionId });
    const config = { connection: "anthropic", repair: 0 };
    const result = await extractor.extract(imageInput, invoice, {}, { tenant: null, config });
    expect(resolveConnectionId).toHaveBeenCalledWith("anthropic");
    expect(resolveModel).toHaveBeenCalledWith("id-of-anthropic", undefined);
    expect(result.usage?.connectionId).toBe("id-of-anthropic");

    const bare = extractorFor(model).extractor;
    expect(
      (await bare.extract(imageInput, invoice, {}, { tenant: null, config })).problems?.error,
    ).toContain("resolveConnectionId");
  });

  it("lets a variant name a connection and set step options", () => {
    const pipeline = parseDocumentType(invoiceInput).pipeline;
    const named = variantSchema.parse({
      connection: "gemini",
      model: "flash",
      options: { maxOutputTokens: 4000, providerOptions: { google: { thinkingBudget: 0 } } },
    });
    expect(variantPipeline(pipeline, named).steps).toEqual([
      {
        extractor: "vision-llm",
        config: {
          connection: "gemini",
          model: "flash",
          maxOutputTokens: 4000,
          providerOptions: { google: { thinkingBudget: 0 } },
        },
      },
    ]);
    const optionsOnly = variantPipeline(pipeline, variantSchema.parse({ options: { repair: 0 } }));
    expect(optionsOnly.steps).toEqual([
      pipeline.steps[0],
      { extractor: "vision-llm", config: { connectionId: "conn-1", repair: 0 } },
    ]);
    expect(variantSchema.safeParse({ connectionId: "a", connection: "b" }).success).toBe(false);
    expect(variantSchema.safeParse({ options: { unknown: 1 } }).success).toBe(false);
    expect(variantSchema.safeParse({ model: "x" }).success).toBe(false);
  });
});

describe("extractor context", () => {
  it("gets the instance and the user who asked", async () => {
    const seen: ExtractorContext[] = [];
    const own: Extractor = {
      key: "own",
      paid: false,
      extract: (_input, _type, _params, context) => {
        seen.push(context);
        return Promise.resolve({ status: "NO_MATCH", fields: {} });
      },
    };
    const type = parseDocumentType({
      ...invoiceInput,
      pipeline: { steps: [{ extractor: "own", config: {} }] },
    });
    const qb = { marker: true } as never;
    await runPipeline({
      type,
      input: imageInput,
      params: {},
      tenant: "t1",
      qb,
      user: { id: "u1", email: "u1@example.com" },
      extractors: { own },
    });
    expect(seen[0]).toMatchObject({ tenant: "t1", user: { id: "u1", email: "u1@example.com" } });
    expect(seen[0]?.qb).toBe(qb);
  });
});

describe("large schemas", () => {
  it("reads many fields in groups, in parallel, and adds up the cost", async () => {
    const { model, calls } = fieldModel((keys) =>
      Object.fromEntries(keys.map((key) => [key, answer(`v-${key}`)])),
    );
    const { extractor } = extractorFor(model);
    const type = wideType(50);
    const result = await extractor.extract(imageInput, type, {}, ctx({}));
    expect(calls.map((call) => askedKeys(call).length)).toEqual([17, 17, 16]);
    expect(result.status).toBe("OK");
    expect(Object.keys(result.fields)).toHaveLength(50);
    expect(result.usage).toMatchObject({ inputTokens: 3000, outputTokens: 300, calls: 3 });
    expect(result.problems).toEqual({ groups: 3 });
    expect(fieldGroups([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("splits a group the provider finds too large, then asks plain JSON", async () => {
    const tooLarge = new APICallError({
      message: "Bad Request",
      url: "https://api.example.test/v1/messages",
      requestBodyValues: {},
      statusCode: 400,
      responseBody: JSON.stringify({
        type: "error",
        error: { type: "invalid_request_error", message: "The compiled grammar is too large" },
      }),
      isRetryable: false,
    });
    const { model, calls } = fieldModel((keys, options) => {
      // Strict schemas of more than 6 fields are refused; plain JSON always works.
      if (options.responseFormat?.type === "json" && keys.length > 6) return tooLarge;
      return Object.fromEntries(keys.map((key) => [key, answer(`v-${key}`)]));
    });
    const { extractor } = extractorFor(model);
    const result = await extractor.extract(imageInput, wideType(20), {}, ctx({ groupSize: 20 }));
    expect(result.status).toBe("OK");
    expect(Object.keys(result.fields)).toHaveLength(20);
    // 20 → 10 + 10 → 5 + 5 + 5 + 5: three refused calls, four billed.
    expect(calls).toHaveLength(7);
    expect(result.usage?.calls).toBe(4);
    expect(result.problems).toEqual({ groups: 4 });

    // Small groups still refused: the last split asks plain JSON.
    const always = fieldModel((keys, options) =>
      options.responseFormat?.type === "json"
        ? tooLarge
        : Object.fromEntries(keys.map((key) => [key, answer(`v-${key}`)])),
    );
    const plain = await extractorFor(always.model).extractor.extract(
      imageInput,
      wideType(4),
      {},
      ctx({}),
    );
    expect(plain.status).toBe("OK");
    expect(always.calls.map((call) => call.responseFormat?.type ?? "text")).toEqual([
      "json",
      "text",
    ]);
  });

  it("reads plain JSON when the step asks for it, with no grammar", async () => {
    const { model, calls } = fieldModel((keys) =>
      Object.fromEntries(keys.map((key) => [key, answer(`v-${key}`)])),
    );
    const result = await extractorFor(model).extractor.extract(
      imageInput,
      wideType(48),
      {},
      ctx({ output: "json" }),
    );
    expect(result.status).toBe("OK");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.responseFormat?.type).not.toBe("json");
    expect(JSON.stringify(calls[0]?.prompt)).toContain("Reply with JSON only");
  });

  it("shows a provider error in the step, with its status and without secrets", async () => {
    const refused = (status: number, message: string) =>
      new APICallError({
        message: "failed",
        url: "https://api.example.test",
        requestBodyValues: {},
        statusCode: status,
        responseBody: JSON.stringify({ error: { message } }),
        isRetryable: status === 429 || status >= 500,
      });
    expect(describeProviderError(refused(400, "max_tokens: too big"), false)).toEqual({
      message: "the model provider rejected the request (HTTP 400): max_tokens: too big",
      transient: false,
      status: 400,
    });
    expect(describeProviderError(refused(429, "slow down"), false).transient).toBe(true);
    expect(
      describeProviderError(refused(400, "key sk-ant-abc123456789 is not valid"), false).message,
    ).toBe("the model provider rejected the request (HTTP 400): key … is not valid");
    expect(describeProviderError(refused(401, "bad key"), false).message).toBe(
      "the model provider rejected the request (HTTP 401)",
    );
    expect(describeProviderError(new Error("boom"), true)).toEqual({
      message: "the model did not answer in time",
      transient: true,
    });

    const { model } = fieldModel(() => refused(400, "The compiled grammar is too large"));
    const result = await extractorFor(model).extractor.extract(
      imageInput,
      invoice,
      {},
      ctx({ output: "json" }),
    );
    expect(result).toMatchObject({
      status: "ERROR",
      problems: {
        error:
          "the model provider rejected the request (HTTP 400): The compiled grammar is too large",
      },
    });
    // Not transient: a test run counts it as read and wrong, it does not hide it as a retry.
    expect(result.problems?.transient).toBeUndefined();
  });
});

describe("repairs", () => {
  it("asks again only for the fields left out or required and empty, and bills both calls", async () => {
    const { model, calls } = fieldModel((keys, _options, call) => {
      if (call === 1) {
        // Leaves out `total`, and the required `issuedOn` is empty.
        return Object.fromEntries(
          keys
            .filter((key) => key !== "total")
            .map((key) => [key, answer(key === "number" ? "A-1" : "")]),
        );
      }
      return Object.fromEntries(
        keys.map((key) => [key, answer(key === "issuedOn" ? "2026-03-05" : "10")]),
      );
    });
    const result = await extractorFor(model).extractor.extract(imageInput, invoice, {}, ctx({}));
    expect(askedKeys(calls[1] ?? ({} as never))).toEqual(["issuedOn", "total"]);
    expect(JSON.stringify(calls[1]?.prompt)).toContain("- total: missing");
    expect(result).toMatchObject({
      status: "OK",
      repairs: 1,
      problems: { repairs: 1, repaired: ["issuedOn", "total"] },
      usage: { inputTokens: 2000, calls: 2 },
      fields: {
        number: { value: "A1" },
        issuedOn: { value: "2026-03-05" },
        total: { value: "10" },
      },
    });
  });

  it("repairs an answer that is not JSON and stops at the limit", async () => {
    const { model, calls } = fieldModel(() => "sorry, I cannot");
    const result = await extractorFor(model, { structuredOutput: false }).extractor.extract(
      imageInput,
      invoice,
      {},
      ctx({ repair: 2 }),
    );
    expect(calls).toHaveLength(3);
    expect(result).toMatchObject({
      status: "ERROR",
      problems: { error: "the model did not return the fields", repairs: 2 },
      usage: { calls: 3 },
    });
    const none = fieldModel(() => invoiceReply({ number: { value: "A1", confidence: 0.9 } }));
    await extractorFor(none.model).extractor.extract(imageInput, invoice, {}, ctx({ repair: 0 }));
    expect(none.calls).toHaveLength(1);
  });

  it("counts repaired readings and step errors in run metrics", () => {
    const base = {
      fileName: "a.pdf",
      status: "OK" as const,
      durationMs: 1,
      costUsd: 0,
      fields: [],
    };
    const results: SampleResult[] = [
      { ...base, sampleId: "1", repairs: 1 },
      { ...base, sampleId: "2", repairs: 2 },
      { ...base, sampleId: "3", error: "text-llm: the model provider rejected the request" },
      { ...base, sampleId: "4" },
    ];
    expect(runMetrics(invoice, results)).toMatchObject({ repaired: 2, repairs: 3, stepErrors: 1 });
  });
});

describe("types defined in code", () => {
  async function start(db: ReturnType<typeof memoryAdapter>, type: DocumentTypeInput) {
    const log = vi.fn();
    const config = defineConfig({
      db,
      auth: devAuth(),
      collections: [],
      plugins: [
        docReader({ files: memoryStorage(), runner: inProcessRunner(), types: [type], log }),
      ],
    });
    return { qb: await createQuickben(config), log };
  }

  async function versions(qb: Awaited<ReturnType<typeof start>>["qb"]) {
    const page = await qb.find(
      DOC_TYPES,
      { where: { key: { eq: "invoice" } }, sort: "version" },
      system,
    );
    return (page.docs as unknown as Record<string, unknown>[]).map((doc) => ({
      version: doc.version,
      state: doc.state,
      builtin: doc.builtin,
      instructions: (doc.definition as { instructions?: string }).instructions,
    }));
  }

  it("turns a change into a draft, never touching the published version", async () => {
    const db = memoryAdapter();
    const first = await start(db, invoiceInput);
    expect(await versions(first.qb)).toEqual([
      { version: 1, state: "published", builtin: true, instructions: invoiceInput.instructions },
    ]);

    // Same code: nothing changes.
    const same = await start(db, invoiceInput);
    expect(await versions(same.qb)).toHaveLength(1);
    expect(same.log).not.toHaveBeenCalledWith("type-changed-in-code", expect.anything());

    const changed = await start(db, { ...invoiceInput, instructions: "Read the total in words." });
    expect(await versions(changed.qb)).toEqual([
      { version: 1, state: "published", builtin: true, instructions: invoiceInput.instructions },
      { version: 2, state: "draft", builtin: true, instructions: "Read the total in words." },
    ]);
    expect(changed.log).toHaveBeenCalledWith(
      "type-changed-in-code",
      expect.objectContaining({ type: "invoice", draft: 2, applied: true }),
    );

    // Another change updates that draft instead of adding one.
    const again = await start(db, { ...invoiceInput, instructions: "Third take." });
    expect((await versions(again.qb)).map((v) => v.instructions)).toEqual([
      invoiceInput.instructions,
      "Third take.",
    ]);
  });

  it("leaves a draft made in the admin alone and says so", async () => {
    const db = memoryAdapter();
    const first = await start(db, invoiceInput);
    await createDraft(first.qb, system, "invoice");
    const changed = await start(db, { ...invoiceInput, instructions: "Changed in code." });
    expect((await versions(changed.qb)).map((v) => v.instructions)).toEqual([
      invoiceInput.instructions,
      invoiceInput.instructions,
    ]);
    expect(changed.log).toHaveBeenCalledWith(
      "type-changed-in-code",
      expect.objectContaining({ applied: false, draft: 2 }),
    );
  });

  it("compares definitions without their version and state", () => {
    const type = parseDocumentType(invoiceInput);
    expect(definitionFingerprint({ ...type, version: 9, state: "draft" })).toBe(
      definitionFingerprint(type),
    );
    expect(definitionFingerprint({ ...type, label: "Other" })).not.toBe(
      definitionFingerprint(type),
    );
  });
});
