import { describe, expect, it } from "vitest";

import {
  applyCorrections,
  canPublish,
  compareFieldValue,
  correctExpected,
  correctExpectedBulk,
  exportCorrections,
  fieldOutcome,
  findSuspects,
  getSample,
  getTestRun,
  getVersion,
  importSamples,
  inText,
  listCorrections,
  listSamples,
  listVersions,
  looseText,
  nationalNumber,
  normalizeFieldValue,
  toE164,
  markSystemField,
  parseCorrections,
  parseDocumentType,
  printedForms,
  readableType,
  rescoreTestRun,
  runMetrics,
  runPipeline,
  saveDraft,
  createDraft,
  searchable,
  similarity,
  startTestRun,
} from "../src";

import { as, invoice, invoiceInput, invoiceReply, PNG, setup, staff } from "./helpers";

import type { Extractor, FieldCheck, SampleResult } from "../src";

// Invented data only.
const admin = as(staff);
const name = { type: "text" as const };
const rules = {
  ignoreAccents: true,
  ignorePunctuation: true,
  equivalents: [["SOCIEDAD ANONIMA", "S.A."]] as [string, string][],
};

describe("comparison rules", () => {
  it("leaves fields without rules as they were", () => {
    expect(compareFieldValue(name, "ACME S.A.", "acme s.a.")).toBe("same");
    expect(compareFieldValue(name, "ÁCME S.A.", "ACME SA")).toBe("different");
    expect(fieldOutcome(name, "ÁCME", "ACME", ["-"])).toBe("wrong");
  });

  it("scores values equal under the field's rules as near", () => {
    const field = { ...name, compare: rules };
    expect(compareFieldValue(field, "TALLERES ÑANDÚ S.A.", "TALLERES NANDU SA")).toBe("near");
    expect(compareFieldValue(field, "TALLERES NANDU SOCIEDAD ANONIMA", "Talleres Nandu S.A.")).toBe(
      "near",
    );
    expect(compareFieldValue(field, "TALLERES NANDU", "TALLERES PANDU")).toBe("different");
    expect(
      compareFieldValue(
        { ...name, compare: { minSimilarity: 0.9 } },
        "TALLERES NANDU",
        "TALLERES PANDU",
      ),
    ).toBe("near");
    expect(fieldOutcome(field, "ÁCME", "ACME", ["-"])).toBe("near");
    expect(looseText(" a.b  ç ", { ignoreAccents: true, ignorePunctuation: true })).toBe("A B C");
    expect(similarity("", "")).toBe(1);
    expect(similarity("ABCD", "ABCE")).toBe(0.75);
  });

  it("counts near reads as right, and apart", () => {
    const check = (outcome: FieldCheck["outcome"]): FieldCheck => ({
      key: "number",
      label: "Invoice number",
      expected: "x",
      read: "x",
      confidence: 1,
      match: true,
      outcome,
    });
    const result: SampleResult = {
      sampleId: "s",
      fileName: "s.png",
      status: "OK",
      durationMs: 1,
      costUsd: 0,
      fields: [check("correct"), check("near"), { ...check("wrong"), match: false }],
    };
    const metrics = runMetrics(invoice, [result]);
    expect(metrics.global).toMatchObject({ checked: 3, correct: 1, near: 1, wrong: 1 });
    expect(metrics.global.accuracy).toBeCloseTo(2 / 3);
  });

  it("parses rules and system origin as type data", () => {
    const type = parseDocumentType({
      ...invoiceInput,
      params: [],
      fields: [
        { key: "number", label: "Number", type: "text", compare: rules },
        { key: "total", label: "Total", type: "number", origin: "system" },
      ],
    });
    expect(type.fields[0]?.compare?.equivalents).toEqual([["SOCIEDAD ANONIMA", "S.A."]]);
    expect(readableType(type).fields.map((field) => field.key)).toEqual(["number"]);
    expect(() =>
      parseDocumentType({
        ...invoiceInput,
        params: [],
        fields: [{ key: "a", label: "A", type: "text", compare: { minSimilarity: 2 } }],
      }),
    ).toThrow();
  });
});

describe("phones", () => {
  const phone = { type: "phone" as const, phoneCountry: "CL" as const };

  it("writes numbers of the field's country in E.164", () => {
    for (const raw of [
      "+56 9 1111 2222",
      "56911112222",
      "911112222",
      "0911112222",
      "0056911112222",
    ]) {
      expect(normalizeFieldValue(phone, raw)).toBe("+56911112222");
    }
    expect(normalizeFieldValue(phone, "(2) 2333 4444")).toBe("+56223334444");
    expect(normalizeFieldValue(phone, "223334444")).toBe("+56223334444");
    // Does not fit the plan: kept as digits, never guessed.
    expect(normalizeFieldValue(phone, "23334444")).toBe("23334444");
    expect(normalizeFieldValue(phone, "+54 11 2222 3333")).toBe("+541122223333");
    expect(normalizeFieldValue(phone, "1")).toBeNull();
    expect(normalizeFieldValue({ type: "phone" }, "911112222")).toBe("911112222");
    expect(toE164("+1 202 555 0100", "US")).toBe("+12025550100");
    expect(nationalNumber("+56911112222", "CL")).toBe("911112222");
    expect(nationalNumber("+12025550100", "CL")).toBeNull();
    expect(fieldOutcome(phone, "56911112222", "9 1111 2222", ["-"])).toBe("correct");
  });

  it("takes a field's own placeholders as empty", () => {
    const field = { ...phone, emptyValues: ["1", "0"] };
    expect(fieldOutcome(field, "1", null, ["-"])).toBe("correct-empty");
    expect(fieldOutcome(field, "0", "911112222", ["-"])).toBe("hallucinated");
    expect(fieldOutcome(phone, "1", null, ["-"])).toBe("missed");
    const type = parseDocumentType({
      ...invoiceInput,
      params: [],
      fields: [
        { key: "phone", label: "Phone", type: "phone", phoneCountry: "CL", emptyValues: ["1"] },
      ],
    });
    expect(type.fields[0]?.phoneCountry).toBe("CL");
    expect(() =>
      parseDocumentType({
        ...invoiceInput,
        params: [],
        fields: [{ key: "phone", label: "Phone", type: "phone", phoneCountry: "XX" }],
      }),
    ).toThrow();
  });
});

describe("system fields", () => {
  it("are never asked of extractors", async () => {
    const asked: string[][] = [];
    const extractor: Extractor = {
      key: "probe",
      paid: false,
      extract: (_input, type) => {
        asked.push(type.fields.map((field) => field.key));
        return Promise.resolve({ status: "OK", fields: {} });
      },
    };
    const type = parseDocumentType({
      ...invoiceInput,
      fields: invoiceInput.fields.map((field) =>
        field.key === "total" ? { ...field, origin: "system" } : field,
      ),
      pipeline: { steps: [{ extractor: "probe" }] },
    });
    await runPipeline({
      type,
      input: { bytes: PNG, mime: "image/png", pages: [1] },
      params: {},
      extractors: { probe: extractor },
      tenant: "t",
    });
    expect(asked).toEqual([["number", "issuedOn", "buyerTaxId"]]);
  });
});

async function benchWith(answer = invoiceReply({ number: { value: "A-1043", confidence: 0.9 } })) {
  const made = await setup({ answer });
  const items = ["a", "b", "c"].map((key) => ({
    key: `north/${key}`,
    file: { bytes: PNG, name: `${key}.png` },
    group: "north",
    expected: { number: "A-1048", total: "12" },
  }));
  await importSamples(made.qb, admin, "invoice", items);
  return made;
}

describe("re-scoring", () => {
  it("scores a run again with today's rules and expected values, as a new run", async () => {
    const made = await benchWith();
    const [run] = await startTestRun(made.qb, admin, "invoice", 1);
    await made.runner.idle();
    const before = await getTestRun(made.qb, admin, run?.id ?? "");
    expect(before.metrics?.global).toMatchObject({ wrong: 3, near: 0 });

    const draft = await createDraft(made.qb, admin, "invoice");
    const definition = (await getVersion(made.qb, admin, "invoice", draft.version)).definition;
    await saveDraft(made.qb, admin, "invoice", draft.version, {
      ...definition,
      fields: definition.fields.map((field) =>
        field.key === "number" ? { ...field, compare: { minSimilarity: 0.8 } } : field,
      ),
    });
    const [first] = await listSamples(made.qb, admin, "invoice");
    await correctExpected(made.qb, admin, {
      sampleId: first?.id ?? "",
      field: "number",
      value: "A-1043",
    });

    const after = await rescoreTestRun(made.qb, admin, before.id, { version: draft.version });
    expect(after).toMatchObject({ purpose: "rescore", rescoredFrom: before.id, typeVersion: 2 });
    expect(after.metrics?.global).toMatchObject({ correct: 1, near: 2, wrong: 0 });
    expect(after.costUsd).toBe(before.costUsd);
    // Never a reason to publish.
    const version = await getVersion(made.qb, admin, "invoice", draft.version);
    expect(canPublish(version, [after])).toBe(false);
    await expect(rescoreTestRun(made.qb, admin, "missing")).rejects.toThrow();
  });
});

describe("corrections", () => {
  it("corrects, keeps and logs each decision", async () => {
    const made = await benchWith();
    const [a, b] = await listSamples(made.qb, admin, "invoice");
    const edit = await correctExpected(made.qb, admin, {
      sampleId: a?.id ?? "",
      field: "number",
      value: " A-1043 ",
      action: "use-read",
      reason: "printed so",
    });
    expect(edit).toMatchObject({
      before: "A-1048",
      after: "A-1043",
      action: "use-read",
      by: staff.email,
    });
    expect((await getSample(made.qb, admin, a?.id ?? "")).expected.number).toBe("A-1043");
    const keep = await correctExpected(made.qb, admin, {
      sampleId: b?.id ?? "",
      field: "total",
      action: "keep",
      value: "99",
    });
    expect(keep).toMatchObject({ before: "12", after: "12" });
    const cleared = await correctExpected(made.qb, admin, {
      sampleId: b?.id ?? "",
      field: "total",
      value: "",
    });
    expect(cleared.after).toBeNull();
    await expect(
      correctExpected(made.qb, admin, {
        sampleId: b?.id ?? "",
        field: "total",
        action: "bulk" as never,
      }),
    ).rejects.toThrow();

    const bulk = await correctExpectedBulk(made.qb, admin, {
      typeKey: "invoice",
      field: "number",
      from: "A-1048",
      value: "A-1043",
      reason: "master data typo",
    });
    expect(bulk).toHaveLength(2);
    await expect(
      correctExpectedBulk(made.qb, admin, {
        typeKey: "invoice",
        field: "nope",
        from: "x",
        value: "y",
      }),
    ).rejects.toThrow();

    const [, , c] = await listSamples(made.qb, admin, "invoice");
    await correctExpected(made.qb, admin, { sampleId: c?.id ?? "", field: "total", value: "7" });
    const own = await correctExpectedBulk(made.qb, admin, {
      typeKey: "invoice",
      field: "total",
      from: "12",
      values: { [a?.id ?? ""]: "13", [c?.id ?? ""]: "99" },
    });
    // Only samples still at "12" and listed change, each to its own value.
    expect(own.map((item) => item.after)).toEqual(["13"]);
    await expect(
      correctExpectedBulk(made.qb, admin, { typeKey: "invoice", field: "total", from: "12" }),
    ).rejects.toThrow();

    const log = await listCorrections(made.qb, admin, "invoice");
    expect(log.map((item) => item.action)).toEqual([
      "use-read",
      "keep",
      "edit",
      "bulk",
      "bulk",
      "edit",
      "bulk",
    ]);
    expect(await listCorrections(made.qb, admin, "invoice", { action: "bulk" })).toHaveLength(3);
    const csv = exportCorrections(log, "csv");
    expect(csv.split("\n")[0]).toBe(
      "at,typeKey,sampleKey,sampleId,field,action,before,after,reason,by,runId",
    );
    expect(csv).toContain("master data typo");
    const json = parseCorrections(JSON.parse(exportCorrections(log, "json")));
    expect(json[0]).toMatchObject({ sampleKey: "north/a", before: "A-1048", after: "A-1043" });
    expect(() => parseCorrections({})).toThrow();
    expect(() => parseCorrections([{ typeKey: "invoice" }])).toThrow();
  });

  it("keeps corrections through a re-import and applies an exported log elsewhere", async () => {
    const made = await benchWith();
    const samples = await listSamples(made.qb, admin, "invoice");
    await correctExpectedBulk(made.qb, admin, {
      typeKey: "invoice",
      field: "number",
      from: "A-1048",
      value: "A-1043",
    });
    const reimport = await importSamples(made.qb, admin, "invoice", [
      {
        key: "north/a",
        file: { bytes: PNG, name: "a.png" },
        group: "north",
        expected: { number: "A-1048", total: "12" },
      },
    ]);
    expect(reimport).toMatchObject({ unchanged: 1, corrected: 1 });
    const raw = await importSamples(
      made.qb,
      admin,
      "invoice",
      [
        {
          key: "north/a",
          file: { bytes: PNG, name: "a.png" },
          group: "north",
          expected: { number: "A-1048", total: "12" },
        },
      ],
      { corrections: false },
    );
    expect(raw).toMatchObject({ updated: 1, corrected: 0 });

    const exported = parseCorrections(
      JSON.parse(exportCorrections(await listCorrections(made.qb, admin, "invoice"), "json")),
    );
    const elsewhere = await benchWith();
    const decision = { ...exported[0]!, action: "keep" as const, after: "A-1048" };
    const report = await applyCorrections(elsewhere.qb, admin, "invoice", [
      ...exported,
      { ...exported[0]!, sampleKey: "gone" },
      { ...exported[1]!, before: "Z", after: "Y" },
      decision,
      { ...decision, typeKey: "other" },
    ]);
    expect(report).toMatchObject({ applied: 3, already: 0, missing: 1, logged: 1 });
    expect(report.conflicts).toHaveLength(1);
    const again = await applyCorrections(elsewhere.qb, admin, "invoice", exported);
    expect(again).toMatchObject({ applied: 0, already: 3 });
    expect(samples).toHaveLength(3);
  });

  it("marks a field as system in a draft, never in the published version", async () => {
    const made = await benchWith();
    const version = await markSystemField(made.qb, admin, {
      typeKey: "invoice",
      field: "total",
      reason: "lookup",
    });
    expect(version).toBe(2);
    const draft = await getVersion(made.qb, admin, "invoice", 2);
    expect(draft.definition.fields.find((f) => f.key === "total")?.origin).toBe("system");
    expect(
      (await getVersion(made.qb, admin, "invoice", 1)).definition.fields.find(
        (f) => f.key === "total",
      )?.origin,
    ).toBeUndefined();
    expect(await markSystemField(made.qb, admin, { typeKey: "invoice", field: "number" })).toBe(2);
    expect(await listVersions(made.qb, admin, "invoice")).toHaveLength(2);
    await expect(
      markSystemField(made.qb, admin, { typeKey: "invoice", field: "nope" }),
    ).rejects.toThrow();
    expect(
      await listCorrections(made.qb, admin, "invoice", { action: "mark-system" }),
    ).toHaveLength(2);
  });
});

describe("suspects", () => {
  it("finds values in the text and repeated differences, and skips kept decisions", async () => {
    const made = await benchWith();
    const [run] = await startTestRun(made.qb, admin, "invoice", 1);
    await made.runner.idle();
    const text = () =>
      Promise.resolve(
        "ACME SUPPLIES INVOICE NO. A-1043 TOTAL 1.234,50 issued 05/03/2026 and more words",
      );
    const found = await findSuspects(made.qb, admin, "invoice", { runId: run?.id ?? "", text });
    const by = (detector: string) => found.filter((item) => item.detector === detector);
    expect(by("read-in-text").map((item) => item.field)).toEqual(["number", "number", "number"]);
    expect(by("expected-not-in-text").map((item) => item.field)).toEqual([
      "total",
      "total",
      "total",
    ]);
    expect(by("repeated-difference")).toHaveLength(3);
    expect(by("repeated-difference")[0]?.count).toBe(3);
    expect(by("constant-in-group").map((item) => [item.field, item.count])).toEqual([
      ["number", 3],
      ["total", 3],
    ]);

    const [first] = await listSamples(made.qb, admin, "invoice");
    await correctExpected(made.qb, admin, {
      sampleId: first?.id ?? "",
      field: "total",
      action: "keep",
    });
    const after = await findSuspects(made.qb, admin, "invoice", {
      runId: run?.id ?? "",
      text,
      detectors: ["expected-not-in-text"],
    });
    expect(after).toHaveLength(2);
    await correctExpected(made.qb, admin, {
      sampleId: first?.id ?? "",
      field: "number",
      value: "A-1043",
      action: "use-read",
    });
    const fixed = await findSuspects(made.qb, admin, "invoice", {
      runId: run?.id ?? "",
      text,
      detectors: ["read-in-text", "repeated-difference"],
    });
    expect(fixed.filter((item) => item.sampleId === first?.id)).toEqual([]);
    const noText = await findSuspects(made.qb, admin, "invoice", {
      text: () => Promise.resolve(null),
    });
    expect(noText.every((item) => item.detector === "constant-in-group")).toBe(true);
    const images = await findSuspects(made.qb, admin, "invoice", { detectors: ["read-in-text"] });
    expect(images).toEqual([]);
  });

  it("matches values the way they are printed", () => {
    const date = invoice.fields.find((field) => field.key === "issuedOn")!;
    const total = invoice.fields.find((field) => field.key === "total")!;
    const text = searchable("Fecha: 5/3/2026 · Total $ 1.234,50 · Nº ab");
    expect(inText(date, "05/03/2026", text)).toBe(true);
    expect(inText(total, "1234.50", text)).toBe(true);
    expect(inText(total, "999", text)).toBe(false);
    expect(inText({ type: "text" }, "ab", text)).toBeNull();
    expect(printedForms(date, "2026-03-05")).toContain("05032026");
  });
});
