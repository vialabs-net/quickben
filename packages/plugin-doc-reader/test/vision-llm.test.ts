import { NotFoundError } from "@quickben/core";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  answerSchemaFor,
  buildPrompt,
  callCost,
  createVisionLlmExtractor,
  UnsupportedFileError,
} from "../src";
import { parseAnswer, PROVIDER_ERROR, toBox, toFields } from "../src/extractors/vision-llm";

import { invoice, invoiceReply, mockModel, modelInfo, PNG } from "./helpers";

import type { ModelInfo, Rasterize, ResolvedModel } from "../src";

const png = { page: 1, bytes: PNG, mime: "image/png" };
const input = { bytes: new Uint8Array([9]), mime: "application/pdf", pages: [1, 2, 3] };

function setup(
  output: string | Error,
  options: { model?: Partial<ModelInfo>; rasterize?: Rasterize; timeoutMs?: number } = {},
) {
  const { model: languageModel, calls } = mockModel(output, { input: 2000, output: 300 });
  const resolve = vi.fn((): Promise<ResolvedModel> =>
    Promise.resolve({
      connection: { id: "conn-1", name: "Main" },
      model: modelInfo(options.model),
      languageModel,
    }),
  );
  const rasterize = vi.fn(options.rasterize ?? (() => Promise.resolve([png])));
  const extractor = createVisionLlmExtractor({
    resolveModel: resolve,
    rasterize,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  const ctx = { tenant: "t1", config: { connectionId: "conn-1", model: "vision-test" } };
  return { extractor, calls, resolve, rasterize, ctx };
}

const full = invoiceReply({
  number: {
    value: "a-1043",
    confidence: 0.95,
    page: 1,
    evidence: "INVOICE NO. A-1043",
    box: "100,200,300,230",
  },
  issuedOn: { value: "2026-03-05", confidence: 0.9, page: 1, evidence: "DATE: 05/03/2026" },
  total: { value: "1234.50", confidence: 0.6, page: 0, evidence: "x" },
});

describe("vision-llm extractor", () => {
  it("reads the fields, normalizes them and prices the call from the model", async () => {
    const { extractor, calls, rasterize, ctx } = setup(full);
    const result = await extractor.extract(input, invoice, { issuerTaxIds: ["76.543.210-K"] }, ctx);
    expect(result.status).toBe("OK");
    expect(result.fields.number).toEqual({
      value: "A1043",
      confidence: 0.95,
      evidence: {
        page: 1,
        text: "INVOICE NO. A-1043",
        box: { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.23 },
      },
    });
    expect(result.fields.issuedOn?.evidence).toEqual({ page: 1, text: "DATE: 05/03/2026" });
    expect(result.fields.total).toEqual({ value: "1234.5", confidence: 0.6 });
    expect(result.fields.buyerTaxId).toBeUndefined();
    // 2000 in at $3/M + 300 out at $15/M.
    expect(result.usage).toEqual({
      inputTokens: 2000,
      outputTokens: 300,
      pages: 1,
      costUsd: 0.0105,
      model: "vision-test",
      connectionId: "conn-1",
      connectionName: "Main",
    });
    // Capped by the model's maxPages.
    expect(rasterize).toHaveBeenCalledWith(input.bytes, "application/pdf", [1, 2]);
    const prompt = JSON.stringify(calls[0]?.prompt);
    expect(prompt).toContain("76.543.210-K");
    expect(prompt).toContain("image/png");
    expect(calls[0]?.responseFormat?.type).toBe("json");
  });

  it("drops excluded and invalid values and reports what is missing", async () => {
    const { extractor, ctx } = setup(
      invoiceReply({
        number: { value: "A1", confidence: 0.9 },
        issuedOn: { value: "31/02/2026", confidence: 0.9 },
        buyerTaxId: { value: "76.543.210-K", confidence: 0.9 },
      }),
    );
    const result = await extractor.extract(input, invoice, { issuerTaxIds: "76543210-K" }, ctx);
    expect(result).toMatchObject({ status: "INCOMPLETE", problems: { missing: ["issuedOn"] } });
    expect(Object.keys(result.fields)).toEqual(["number"]);
  });

  it("says NO_MATCH when nothing was read", async () => {
    const { extractor, ctx } = setup(invoiceReply());
    expect((await extractor.extract(input, invoice, {}, ctx)).status).toBe("NO_MATCH");
  });

  it("keeps the billed tokens when the model answers out of shape", async () => {
    const { extractor, ctx } = setup('{"number": 3}');
    expect(await extractor.extract(input, invoice, {}, ctx)).toMatchObject({
      status: "ERROR",
      problems: { error: "the model did not return the fields" },
      usage: { costUsd: 0.0105 },
    });
    const plain = setup("not json", { model: { structuredOutput: false } });
    expect(await plain.extractor.extract(input, invoice, {}, plain.ctx)).toMatchObject({
      status: "ERROR",
      usage: { inputTokens: 2000 },
    });
  });

  it("asks for JSON in the prompt when the model has no structured output", async () => {
    const { extractor, calls, ctx } = setup(`\`\`\`json\n${full}\n\`\`\``, {
      model: { structuredOutput: false },
    });
    const result = await extractor.extract(input, invoice, {}, ctx);
    expect(result.status).toBe("OK");
    expect(calls[0]?.responseFormat?.type).not.toBe("json");
    expect(JSON.stringify(calls[0]?.prompt)).toContain("Reply with JSON only");
  });

  it("calls the provider once and never exposes its error", async () => {
    const { extractor, ctx } = setup(new Error("401 invalid key sk-secret"));
    const result = await extractor.extract(input, invoice, {}, ctx);
    expect(result).toEqual({ status: "ERROR", fields: {}, problems: { error: PROVIDER_ERROR } });
    expect(JSON.stringify(result)).not.toContain("sk-secret");
  });

  it("refuses a bad config, a missing resolver, an unusable connection and a model without vision", async () => {
    const { extractor, resolve, ctx } = setup(full);
    expect((await extractor.extract(input, invoice, {}, { ...ctx, config: {} })).problems).toEqual({
      error: "vision-llm needs config.connectionId",
    });
    const bare = createVisionLlmExtractor();
    expect((await bare.extract(input, invoice, {}, ctx)).problems).toEqual({
      error: "no model resolver is configured (resolveModel)",
    });
    resolve.mockRejectedValueOnce(new NotFoundError("Connection conn-1 not found"));
    expect((await extractor.extract(input, invoice, {}, ctx)).problems).toEqual({
      error: "Connection conn-1 not found",
    });
    resolve.mockRejectedValueOnce(new Error("socket hang up"));
    expect((await extractor.extract(input, invoice, {}, ctx)).problems).toEqual({
      error: "could not initialize the model",
    });
    const blind = setup(full, { model: { vision: false } });
    expect((await blind.extractor.extract(input, invoice, {}, blind.ctx)).problems).toEqual({
      error: "model vision-test cannot read images",
    });
  });

  it("returns NO_TEXT for an unsupported file or a page past the end", async () => {
    const unsupported = setup(full, {
      rasterize: (_bytes, mime) => Promise.reject(new UnsupportedFileError(mime)),
    });
    expect(
      await unsupported.extractor.extract(
        { ...input, mime: "text/plain" },
        invoice,
        {},
        unsupported.ctx,
      ),
    ).toMatchObject({
      status: "NO_TEXT",
      problems: { mime: "text/plain" },
    });
    const empty = setup(full, { rasterize: () => Promise.resolve([]) });
    expect(await empty.extractor.extract(input, invoice, {}, empty.ctx)).toMatchObject({
      status: "NO_TEXT",
      problems: { pages: [1, 2] },
    });
    const broken = setup(full, { rasterize: () => Promise.reject(new Error("canvas missing")) });
    await expect(broken.extractor.extract(input, invoice, {}, broken.ctx)).rejects.toThrow(
      "canvas missing",
    );
  });

  it("times out a stalled provider without retrying", async () => {
    const { extractor, resolve, ctx } = setup(full, { timeoutMs: 20 });
    const generate = vi.fn(
      (options: { abortSignal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          options.abortSignal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    resolve.mockResolvedValueOnce({
      connection: { id: "conn-1" },
      model: modelInfo(),
      languageModel: new MockLanguageModelV4({ doGenerate: generate }),
    });
    const result = await extractor.extract(
      input,
      invoice,
      {},
      { ...ctx, signal: new AbortController().signal },
    );
    expect(result.problems).toEqual({ error: "the model did not answer in time" });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("prompt and schema", () => {
  it("describes every field and carries the parameters and instructions", () => {
    const prompt = buildPrompt(invoice, { issuerTaxIds: ["1-9"] }, [png], false);
    expect(prompt).toContain('type "Invoice"');
    expect(prompt).toContain("- issuedOn (Issue date): YYYY-MM-DD");
    expect(prompt).toContain(
      "Issuer tax ids (issuerTaxIds): 1-9. These are never the value of buyerTaxId.",
    );
    expect(prompt).toContain(invoice.instructions);
    expect(prompt).not.toContain("Reply with JSON");
    expect(Object.keys(answerSchemaFor(invoice).shape)).toEqual(invoice.fields.map((f) => f.key));
  });

  it("has no union or nullable types: Anthropic allows at most 16 union-typed parameters", () => {
    const many = {
      ...invoice,
      fields: Array.from({ length: 40 }, (_, i) => ({
        ...invoice.fields[0]!,
        key: `f${String(i)}`,
      })),
    };
    for (const type of [invoice, many]) {
      const json = JSON.stringify(z.toJSONSchema(answerSchemaFor(type)));
      expect(json).not.toMatch(/anyOf|oneOf|"type":\[|null/u);
    }
  });

  it("clamps confidence and keeps evidence only with a page", () => {
    const fields = toFields(
      invoice,
      {
        number: { value: "A1", confidence: 7, page: 0, evidence: "x", box: "1,1,500,500" },
        total: {
          value: "12",
          confidence: Number.NaN,
          page: 2,
          evidence: "",
          box: "500, 500, 100, 450",
        },
        issuedOn: undefined,
      },
      {},
    );
    expect(fields.number).toEqual({ value: "A1", confidence: 1 });
    expect(fields.total).toEqual({
      value: "12",
      confidence: 0,
      evidence: { page: 2, text: "", box: { x0: 0.1, y0: 0.45, x1: 0.5, y1: 0.5 } },
    });
  });

  it("converts model boxes to page fractions and drops degenerate ones", () => {
    expect(toBox("0,0,1000,1000")).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
    expect(toBox("[-50, 100, 1200, 300.0]")).toEqual({ x0: 0, y0: 0.1, x1: 1, y1: 0.3 });
    expect(toBox("0,0,0,0")).toBeUndefined();
    expect(toBox("100,100,101,400")).toBeUndefined();
    expect(toBox("100,100,400")).toBeUndefined();
    expect(toBox(undefined)).toBeUndefined();
  });

  it("parses a plain JSON answer, filling the box", () => {
    expect(parseAnswer("nope")).toBeNull();
    expect(parseAnswer("3")).toBe(3);
    expect(parseAnswer('```{"a":{"box":"1,2,3,4"}}```')).toEqual({ a: { box: "1,2,3,4" } });
    expect(
      parseAnswer(
        JSON.stringify({
          a: { value: "x" },
          b: { box: [1, 2, 3, 4] },
          c: null,
          d: { box: "1,2,3,4" },
        }),
      ),
    ).toEqual({
      a: { value: "x", box: "" },
      b: { box: "1,2,3,4" },
      c: null,
      d: { box: "1,2,3,4" },
    });
  });

  it("prices calls from the connection's prices", () => {
    expect(callCost({ inputPerMTokUsd: 3, outputPerMTokUsd: 15 }, 1_000_000, 0)).toBeCloseTo(3);
    expect(callCost({ inputPerMTokUsd: 0.15, outputPerMTokUsd: 0.6 }, 1234, 56)).toBeCloseTo(
      0.000219,
      9,
    );
  });
});
