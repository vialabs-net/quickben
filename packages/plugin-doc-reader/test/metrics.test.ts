import { describe, expect, it } from "vitest";

import {
  callCost,
  compareResults,
  fieldOutcome,
  gateReasons,
  hashFraction,
  isEmptyValue,
  parseDocumentType,
  percentile,
  resultsToCsv,
  runMetrics,
  splitForNewSample,
} from "../src";
import { csvCell } from "../src/metrics";

import { receiptInput } from "./dataset";

import type { RunComparison, SampleResult } from "../src";

const type = parseDocumentType(receiptInput);
const number = { type: "number" as const };

describe("field outcomes", () => {
  it("treats null, blank and the type's empty values as empty", () => {
    const empty = type.evaluation.emptyValues;
    expect(empty).toEqual(["-", "-1"]);
    for (const value of [null, undefined, "", "  ", "-", "-1"]) {
      expect(isEmptyValue(value, empty)).toBe(true);
    }
    expect(isEmptyValue("0", empty)).toBe(false);
    expect(isEmptyValue("-", [])).toBe(false);
  });

  it("tells right, wrong, missed and hallucinated apart, after normalizing", () => {
    const empty = ["-", "-1"];
    expect(fieldOutcome(number, null, "1", empty)).toBeNull();
    expect(fieldOutcome(number, "1,234.50", "1234.5", empty)).toBe("correct");
    expect(fieldOutcome(number, "12", "13", empty)).toBe("wrong");
    expect(fieldOutcome(number, "12", null, empty)).toBe("missed");
    expect(fieldOutcome(number, "12", "-1", empty)).toBe("missed");
    expect(fieldOutcome(number, "-", null, empty)).toBe("correct-empty");
    expect(fieldOutcome(number, "-1", "", empty)).toBe("correct-empty");
    expect(fieldOutcome(number, "", "7", empty)).toBe("hallucinated");
  });
});

const result = (overrides: Partial<SampleResult>): SampleResult => ({
  sampleId: "s",
  fileName: "s.png",
  status: "OK",
  durationMs: 10,
  costUsd: 0.01,
  fields: [],
  ...overrides,
});

describe("metrics", () => {
  it("computes nearest-rank percentiles", () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([5], 95)).toBe(5);
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 100)).toBe(100);
  });

  it("reads runs written before outcomes existed", () => {
    const legacy = [
      result({
        sampleId: "a",
        fields: [
          { key: "code", label: "Code", expected: "1", read: "1", confidence: 1, match: true },
          { key: "amount", label: "Amount", expected: "2", read: "3", confidence: 1, match: false },
          {
            key: "issuedOn",
            label: "Date",
            expected: null,
            read: null,
            confidence: null,
            match: null,
          },
        ],
      }),
    ];
    const metrics = runMetrics(type, legacy);
    expect(metrics.global).toMatchObject({ checked: 2, correct: 1, wrong: 1, accuracy: 0.5 });
    expect(metrics.byGroup).toEqual([]);
    const csv = resultsToCsv(legacy);
    expect(csv.split("\n")[1]).toContain(",correct");
  });

  it("compares runs over the samples both read", () => {
    const check = (read: string) => [
      {
        key: "code",
        label: "Code",
        expected: "1",
        read,
        confidence: 1,
        match: read === "1",
        outcome: read === "1" ? ("correct" as const) : ("wrong" as const),
        scored: true,
      },
    ];
    const a = [
      result({ sampleId: "x", fields: check("1") }),
      result({ sampleId: "y", fields: check("2") }),
      result({ sampleId: "z", fields: check("1"), failed: true }),
    ];
    const b = [
      result({ sampleId: "x", fields: check("2"), costUsd: 0.02, durationMs: 30 }),
      result({ sampleId: "y", fields: check("1"), costUsd: 0.02, durationMs: 30 }),
    ];
    const comparison = compareResults(type, a, b);
    expect(comparison.samples).toBe(2);
    expect(comparison.accuracy).toEqual({ a: 0.5, b: 0.5, delta: 0 });
    expect(comparison.worse).toMatchObject([{ sampleId: "x", readA: "1", readB: "2" }]);
    expect(comparison.better).toMatchObject([{ sampleId: "y" }]);
    expect(comparison.costPerDocUsd.delta).toBeCloseTo(0.01, 9);
    expect(comparison.p95LatencyMs.delta).toBe(20);
    expect(comparison.fields.find((f) => f.key === "amount")).toMatchObject({
      a: null,
      delta: null,
    });
  });

  it("escapes CSV cells and defuses formulas", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(3)).toBe("3");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("-1")).toBe("-1");
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });
});

describe("publish gate", () => {
  const comparison = (overrides: Partial<RunComparison>): RunComparison => ({
    samples: 10,
    accuracy: { a: 0.9, b: 0.9, delta: 0 },
    costPerDocUsd: { a: 0.01, b: 0.01, delta: 0 },
    p50LatencyMs: { a: 100, b: 100, delta: 0 },
    p95LatencyMs: { a: 200, b: 200, delta: 0 },
    fields: [
      { key: "code", label: "Code", scored: true, a: 0.9, b: 0.9, delta: 0 },
      { key: "reference", label: "Ref", scored: false, a: 0.9, b: 0.1, delta: -0.8 },
    ],
    worse: [],
    better: [],
    ...overrides,
  });
  const gate = {
    maxAccuracyDrop: 0.01,
    maxFieldDrop: 0.05,
    maxCostIncrease: 0.1,
    maxLatencyIncrease: 0.5,
  };

  it("passes within the thresholds and ignores unscored fields", () => {
    expect(
      gateReasons(gate, comparison({ accuracy: { a: 0.9, b: 0.895, delta: -0.005 } })),
    ).toEqual([]);
  });

  it("names every failed check", () => {
    const reasons = gateReasons(
      gate,
      comparison({
        accuracy: { a: 0.9, b: 0.8, delta: -0.1 },
        costPerDocUsd: { a: 0.01, b: 0.02, delta: 0.01 },
        p95LatencyMs: { a: 200, b: 400, delta: 200 },
        fields: [{ key: "code", label: "Code", scored: true, a: 0.9, b: 0.7, delta: -0.2 }],
      }),
    );
    expect(reasons).toHaveLength(4);
    expect(reasons.map((reason) => reason.split(" ")[0])).toEqual([
      "accuracy",
      "code:",
      "cost",
      "p95",
    ]);
    // Checks turned off.
    expect(
      gateReasons(
        { maxAccuracyDrop: 1, maxFieldDrop: null, maxCostIncrease: null, maxLatencyIncrease: null },
        comparison({ costPerDocUsd: { a: 0.01, b: 1, delta: 1 } }),
      ),
    ).toEqual([]);
  });
});

describe("pricing and hashing", () => {
  it("bills cached input at its own price, and at the input price without one", () => {
    const model = { inputPerMTokUsd: 2, outputPerMTokUsd: 8, cachedInputPerMTokUsd: 0.5 };
    expect(callCost(model, 1_000_000, 0, 400_000)).toBeCloseTo(1.4, 9);
    expect(callCost({ inputPerMTokUsd: 2, outputPerMTokUsd: 8 }, 1_000_000, 0, 400_000)).toBe(2);
    // More cached tokens than input tokens are capped.
    expect(callCost(model, 100, 0, 1000)).toBeCloseTo(0.00005, 9);
  });

  it("hashes to the same fraction everywhere and spreads new samples by the ratios", () => {
    expect(hashFraction("seed", "key")).toBe(hashFraction("seed", "key"));
    expect(hashFraction("seed", "key")).not.toBe(hashFraction("seed", "key2"));
    const settings = {
      seed: "s",
      ratios: { dev: 0.6, validation: 0.4, test: 0 },
      stratifyBy: [],
      unseenGroups: ["hidden"],
    };
    const counts = { dev: 0, validation: 0, test: 0, unseen: 0 };
    for (let i = 0; i < 1000; i += 1) {
      counts[splitForNewSample({ key: `k${String(i)}`, group: null, attributes: {} }, settings)] +=
        1;
    }
    expect(counts.test).toBe(0);
    expect(counts.dev).toBeGreaterThan(540);
    expect(counts.dev).toBeLessThan(660);
    expect(splitForNewSample({ key: "x", group: "hidden", attributes: {} }, settings)).toBe(
      "unseen",
    );
  });
});
