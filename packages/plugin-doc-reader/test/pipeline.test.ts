import { describe, expect, it } from "vitest";

import { mergeFields, parseDocumentType, pendingFields, runPipeline } from "../src";
import { attemptsCost } from "../src/pipeline";

import type { ExtractionResult, Extractor } from "../src";

const type = parseDocumentType({
  key: "demo",
  version: 1,
  label: "Demo",
  fields: [
    { key: "taxId", label: "Tax id", type: "text", required: true },
    { key: "code", label: "Code", type: "text", required: true },
    { key: "email", label: "Email", type: "email" },
  ],
  pipeline: {
    steps: [{ extractor: "free" }, { extractor: "paid", config: { model: "m" } }],
    threshold: 0.8,
  },
});

const input = { bytes: new Uint8Array(), mime: "application/pdf", pages: [1] };
const v = (value: string, confidence: number) => ({ value, confidence });

function fake(
  key: string,
  result: ExtractionResult | Error,
  paid = false,
): Extractor & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    key,
    paid,
    calls,
    extract(_input, _type, _params, ctx) {
      calls.push(ctx.config);
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result);
    },
  };
}

const run = (
  extractors: Record<string, Extractor>,
  extra: Partial<Parameters<typeof runPipeline>[0]> = {},
) => {
  let clock = 0;
  return runPipeline({
    type,
    input,
    params: {},
    tenant: "t1",
    extractors,
    now: () => (clock += 5),
    ...extra,
  });
};

describe("mergeFields", () => {
  it("keeps the first confident value and upgrades a weak one", () => {
    const merged = mergeFields(
      { a: v("1", 0.9), b: v("x", 0.3) },
      { a: v("2", 1), b: v("y", 0.6), c: v("", 1), d: v("z", 0.1) },
      0.8,
    );
    expect(merged).toEqual({ a: v("1", 0.9), b: v("y", 0.6), d: v("z", 0.1) });
    expect(mergeFields({ b: v("y", 0.6) }, { b: v("w", 0.5) }, 0.8).b).toEqual(v("y", 0.6));
  });

  it("reads a field whose key also exists on Object.prototype", async () => {
    const custom = parseDocumentType({
      ...type,
      fields: [{ key: "constructor", label: "Constructor", type: "text", required: true }],
    });
    const free = fake("free", { status: "OK", fields: { constructor: v("Acme", 0.9) } });
    const result = await run({ free }, { type: custom });
    expect(result).toMatchObject({
      status: "OK",
      fields: { constructor: v("Acme", 0.9) },
      missing: [],
    });
  });
});

describe("pendingFields", () => {
  it("waits for required or for all fields", () => {
    const fields = { taxId: v("1", 0.9), code: v("AB", 0.5) };
    expect(pendingFields(type, fields)).toEqual(["code"]);
    expect(pendingFields(type, fields, "all")).toEqual(["code", "email"]);
  });
});

describe("runPipeline", () => {
  it.each(["NO_TEXT", "NO_MATCH", "ERROR"] as const)(
    "keeps %s when every field is optional and nothing was read",
    async (status) => {
      const optional = parseDocumentType({
        ...type,
        fields: type.fields.map((field) => ({ ...field, required: false })),
      });
      const result = await run({ free: fake("free", { status, fields: {} }) }, { type: optional });
      expect(result.status).toBe(status);
      expect(result.fields).toEqual({});
    },
  );

  it("stops once the free extractor reads every required field", async () => {
    const free = fake("free", { status: "OK", fields: { taxId: v("1", 0.9), code: v("AB", 0.9) } });
    const paid = fake("paid", { status: "OK", fields: {} }, true);
    const result = await run({ free, paid });
    expect(result.status).toBe("OK");
    expect(paid.calls).toEqual([]);
    expect(result.attempts).toEqual([
      { step: 0, extractor: "free", status: "OK", fields: result.fields, durationMs: 5 },
    ]);
  });

  it("falls through and merges, passing each step its config and recording usage", async () => {
    const usage = {
      inputTokens: 10,
      outputTokens: 2,
      pages: 1,
      costUsd: 0.01,
      model: "m",
      connectionId: "c",
    };
    const free = fake("free", {
      status: "INCOMPLETE",
      fields: { taxId: v("1", 0.9) },
      problems: { missing: ["code"] },
    });
    const paid = fake(
      "paid",
      { status: "OK", fields: { taxId: v("2", 0.95), code: v("AB", 0.85) }, usage },
      true,
    );
    const result = await run(
      { free, paid },
      { jobId: "job-1", signal: new AbortController().signal },
    );
    expect(result.status).toBe("OK");
    expect(result.fields).toEqual({ taxId: v("1", 0.9), code: v("AB", 0.85) });
    expect(paid.calls).toEqual([{ model: "m" }]);
    expect(
      result.attempts.map((a) => [a.extractor, a.status, a.usage?.costUsd, a.problems]),
    ).toEqual([
      ["free", "INCOMPLETE", undefined, { missing: ["code"] }],
      ["paid", "OK", 0.01, undefined],
    ]);
    expect(attemptsCost(result.attempts)).toBeCloseTo(0.01);
  });

  it("skips a paid step when told to, and reports what is missing", async () => {
    const free = fake("free", { status: "INCOMPLETE", fields: { taxId: v("1", 0.9) } });
    const paid = fake("paid", { status: "OK", fields: {} }, true);
    const result = await run({ free, paid }, { skip: (e) => (e.paid ? "over budget" : undefined) });
    expect(result.status).toBe("INCOMPLETE");
    expect(result.missing).toEqual(["code"]);
    expect(result.attempts[1]).toMatchObject({
      status: "SKIPPED",
      problems: { skipped: "over budget" },
    });
    expect(paid.calls).toEqual([]);
  });

  it("records a throw or an unknown extractor as ERROR and reports the worst failure", async () => {
    const free = fake("free", { status: "NO_TEXT", fields: {} });
    const result = await run({ free, paid: fake("paid", new Error("boom")) });
    expect(result.status).toBe("ERROR");
    expect(result.attempts[1]).toMatchObject({ status: "ERROR", problems: { error: "boom" } });
    const throwsText: Extractor = {
      key: "paid",
      paid: true,
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error throw
      extract: () => Promise.reject("text"),
    };
    const thrown = await run({ free, paid: throwsText });
    expect(thrown.attempts[1]).toMatchObject({ status: "ERROR", problems: { error: "text" } });

    const unknown = await run({ free });
    expect(unknown.attempts[1]).toMatchObject({
      status: "ERROR",
      problems: { error: "unknown extractor paid" },
    });
  });

  it("stops when the signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const free = fake("free", { status: "OK", fields: {} });
    const result = await run({ free }, { signal: controller.signal });
    expect(result.attempts).toEqual([]);
    expect(result.status).toBe("NO_MATCH");
  });
});
