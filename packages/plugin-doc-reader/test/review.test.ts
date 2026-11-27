import { describe, expect, it } from "vitest";

import {
  addSample,
  errorsBySample,
  fieldStatus,
  isHeldOutSplit,
  listSampleRuns,
  listTestRunHeads,
  liveResults,
  pickSampleRun,
  runProblems,
  sampleErrors,
  sampleFieldViews,
  startTestRun,
} from "../src";

import { as, invoice, invoiceReply, PNG, setup, staff } from "./helpers";

import type { FieldCheck, SampleResult } from "../src";

const check = (overrides: Partial<FieldCheck> & Pick<FieldCheck, "key">): FieldCheck => ({
  label: overrides.key,
  expected: null,
  read: null,
  confidence: null,
  match: null,
  ...overrides,
});

const result = (overrides: Partial<SampleResult> = {}): SampleResult => ({
  sampleId: "s1",
  fileName: "one.pdf",
  status: "OK",
  durationMs: 10,
  costUsd: 0.001,
  sampleKey: "inv-1",
  split: "dev",
  group: "north",
  fields: [
    check({ key: "number", expected: "A1", read: "A1", match: true, outcome: "correct" }),
    check({ key: "total", expected: "12", read: "13", match: false, outcome: "wrong" }),
    check({ key: "issuedOn", expected: "01/02/2026", read: null, match: false, outcome: "missed" }),
    check({ key: "buyerTaxId", read: "9", match: false, outcome: "hallucinated", scored: false }),
  ],
  ...overrides,
});

describe("review helpers", () => {
  it("gives each field a status and counts scored errors", () => {
    const [right, wrong, missed, unscored] = result().fields;
    expect([right, wrong, missed, unscored].map((c) => fieldStatus(c!))).toEqual([
      "correct",
      "wrong",
      "missed",
      "hallucinated",
    ]);
    expect(fieldStatus(check({ key: "x", match: false }))).toBe("wrong");
    expect(fieldStatus(check({ key: "x", match: true }))).toBe("correct");
    expect(fieldStatus(check({ key: "x" }))).toBe("unchecked");
    expect(sampleErrors(result())).toBe(2);
    expect(isHeldOutSplit("test")).toBe(true);
    expect(isHeldOutSplit("dev")).toBe(false);
    expect(isHeldOutSplit(null)).toBe(false);
  });

  it("lists the errors of a run per sample and as problems", () => {
    const results = [
      result(),
      result({ sampleId: "s2", skipped: "budget" }),
      result({ sampleId: "s3", split: "test", sampleKey: null, fileName: "three.pdf" }),
    ];
    expect([...errorsBySample(results)]).toEqual([
      ["s1", 2],
      ["s2", null],
      ["s3", 2],
    ]);
    const all = runProblems(results);
    expect(all.map((p) => `${p.sampleName}:${p.field}:${p.status}`)).toEqual([
      "inv-1:total:wrong",
      "inv-1:issuedOn:missed",
      "three.pdf:total:wrong",
      "three.pdf:issuedOn:missed",
    ]);
    expect(all[0]).toMatchObject({ split: "dev", group: "north", expected: "12", read: "13" });
    expect(runProblems(results, { heldOut: false }).map((p) => p.sampleId)).toEqual(["s1", "s1"]);
  });

  it("shows a sample's fields with the expected values saved now", () => {
    const views = sampleFieldViews(invoice, { number: "A1", total: "14" }, result());
    expect(views.map((v) => v.key)).toEqual(["number", "issuedOn", "total", "buyerTaxId"]);
    const total = views.find((v) => v.key === "total");
    expect(total).toMatchObject({
      label: "Total",
      group: "",
      expected: "14",
      runExpected: "12",
      read: "13",
      status: "wrong",
      scored: true,
    });
    expect(views.find((v) => v.key === "buyerTaxId")?.low).toBe(true);
    const bare = sampleFieldViews(invoice, {}, null);
    expect(bare.every((v) => v.status === "unchecked" && v.read === null)).toBe(true);

    const extra = sampleFieldViews(
      invoice,
      {},
      result({ fields: [check({ key: "vehicle.make", read: "X", confidence: 0.99 })] }),
    );
    expect(extra.at(-1)).toMatchObject({ key: "vehicle.make", group: "vehicle", low: false });
  });

  it("scores reads live with today's expected values and rules", () => {
    // The run read 13 against 12; the expected value is now 13.
    const views = sampleFieldViews(invoice, { number: "A1", total: "13" }, result());
    expect(views.find((v) => v.key === "total")).toMatchObject({
      expected: "13",
      runExpected: "12",
      status: "correct",
    });
    // No expected value any more: not checked.
    expect(views.find((v) => v.key === "issuedOn")?.status).toBe("unchecked");
    const current = {
      type: {
        ...invoice,
        fields: [
          ...invoice.fields,
          { key: "added", label: "Added", type: "text" as const, required: false },
        ],
      },
      expected: new Map([
        ["s1", { number: "A1", total: "13", issuedOn: "01/02/2026", added: "X" }],
      ]),
    };
    expect([...errorsBySample([result()], current)]).toEqual([["s1", 1]]);
    expect(runProblems([result()], { current }).map((p) => p.field)).toEqual(["issuedOn"]);
    const currentViews = sampleFieldViews(current.type, current.expected.get("s1")!, result());
    expect(currentViews.find((view) => view.key === "added")?.status).toBe("unchecked");
    expect(liveResults([result()])).toHaveLength(1);
    // Samples missing from `current` keep their stored outcomes.
    expect([...errorsBySample([result({ sampleId: "s9" })], current)]).toEqual([["s9", 2]]);
  });

  it("uses only values present in the expected map", () => {
    const type = {
      ...invoice,
      fields: [
        { key: "constructor", label: "Constructor", type: "text" as const, required: false },
      ],
    };
    const stored = result({ fields: [check({ key: "constructor", read: "A1" })] });
    expect(sampleFieldViews(type, {}, stored)[0]).toMatchObject({
      expected: null,
      status: "unchecked",
    });
    expect(sampleFieldViews(type, { constructor: "A1" }, stored)[0]).toMatchObject({
      expected: "A1",
      status: "correct",
    });
  });

  it("picks the run to show for a sample", () => {
    const history = [
      { run: { id: "r3", typeVersion: 2 } },
      { run: { id: "r2", typeVersion: 1 } },
      { run: { id: "r1", typeVersion: 1 } },
    ];
    expect(pickSampleRun(history, ["nope", "r1"])?.run.id).toBe("r1");
    expect(pickSampleRun(history, [], 1)?.run.id).toBe("r2");
    expect(pickSampleRun(history, [], 9)?.run.id).toBe("r3");
    expect(pickSampleRun([], ["r1"])).toBeNull();
  });

  it("lists runs without their results", async () => {
    const made = await setup({ answer: invoiceReply() });
    const admin = as(staff);
    const sample = await addSample(made.qb, admin, "invoice", {
      file: { bytes: PNG, name: "scan.png" },
      expected: { number: "A-1" },
    });
    const [run] = await startTestRun(made.qb, admin, "invoice", 1);
    await made.runner.idle();
    const heads = await listTestRunHeads(made.qb, admin, "invoice");
    expect(heads).toHaveLength(1);
    expect(heads[0]).toMatchObject({ id: run?.id, typeVersion: 1, state: "done", total: 1 });
    expect(heads[0]).not.toHaveProperty("results");
    expect(heads[0]).not.toHaveProperty("metrics");
    const history = await listSampleRuns(made.qb, admin, sample.id);
    expect(history[0]?.run).toMatchObject({ id: run?.id, total: 1 });
  });
});
