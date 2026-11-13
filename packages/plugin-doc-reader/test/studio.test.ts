import { ForbiddenError, NotFoundError, ValidationError } from "@quickben/core";
import { describe, expect, it, vi } from "vitest";

import {
  addSample,
  canPublish,
  createDocType,
  createDraft,
  deleteDraft,
  DOC_TEST_RUNS,
  DOC_USAGE,
  getTestRun,
  getVersion,
  listDocTypes,
  listSamples,
  listTestRuns,
  listVersions,
  publishDraft,
  readDocument,
  removeSample,
  sampleFile,
  saveDraft,
  startTestRun,
  StudioError,
  summarize,
  updateSample,
} from "../src";
import { failInterruptedRuns, variantPipeline } from "../src/studio";

import {
  alice,
  as,
  INVOICE_TEXT,
  invoice,
  invoiceReply,
  makePdf,
  PNG,
  setup,
  staff,
  system,
} from "./helpers";

const admin = as(staff);

async function rule(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof StudioError ? error.rule : (error as Error).name;
  }
}

describe("types and versions", () => {
  it("creates a type as a draft, saves, tests and publishes it", async () => {
    const { qb, runner } = await setup();
    const created = await createDocType(qb, admin, { key: "receipt", label: "Receipt" });
    expect(created).toMatchObject({
      key: "receipt",
      version: 1,
      state: "draft",
      definition: { fields: [{ key: "number" }] },
    });
    expect(await rule(createDocType(qb, admin, { key: "receipt", label: "Again" }))).toBe(
      "type-exists",
    );
    expect(await rule(createDocType(qb, admin, { key: "Bad Key", label: "x" }))).toBe(
      "ValidationError",
    );
    expect(await rule(createDocType(qb, admin, { key: "auto", label: "x" }))).toBe(
      "ValidationError",
    );
    expect(await rule(createDocType(qb, admin, { key: "ok", label: "  " }))).toBe(
      "ValidationError",
    );

    const definition = {
      ...invoice,
      key: "ignored",
      label: "Receipt",
      pipeline: { steps: [{ extractor: "text-layer", config: { template: "invoice" } }] },
    };
    const saved = await saveDraft(qb, admin, "receipt", 1, definition);
    expect(saved).toMatchObject({
      key: "receipt",
      label: "Receipt",
      definition: { key: "receipt", version: 1 },
    });
    expect(saved.revision).not.toBe(created.revision);
    await expect(saveDraft(qb, admin, "receipt", 1, { ...definition, fields: [] })).rejects.toThrow(
      ValidationError,
    );

    expect(await rule(publishDraft(qb, admin, "receipt", 1))).toBe("not-tested");
    expect(await rule(startTestRun(qb, admin, "receipt", 1))).toBe("no-samples");

    const sample = await addSample(qb, admin, "receipt", {
      file: new File([await makePdf([INVOICE_TEXT])], "r1.pdf"),
      expected: { number: "A-1043", issuedOn: "05/03/2026", total: "" },
      note: "  clean scan  ",
    });
    expect(sample).toMatchObject({
      fileName: "r1.pdf",
      expected: { number: "A-1043", issuedOn: "05/03/2026" },
      note: "clean scan",
    });

    const [run] = await startTestRun(qb, admin, "receipt", 1);
    expect(run).toMatchObject({ state: "running", variant: null, compareGroup: null });
    await runner.idle();
    const finished = await getTestRun(qb, admin, run!.id);
    expect(finished).toMatchObject({
      state: "done",
      summary: { samples: 1, checked: 2, matched: 2, accuracy: 1, costUsd: 0 },
    });
    expect(finished.results[0]?.fields.find((f) => f.key === "total")).toMatchObject({
      expected: null,
      read: "1234.5",
      match: null,
    });

    const runs = await listTestRuns(qb, admin, "receipt", 1);
    expect(canPublish(await getVersion(qb, admin, "receipt", 1), runs)).toBe(true);
    const published = await publishDraft(qb, admin, "receipt", 1);
    expect(published).toMatchObject({ state: "published", publishedBy: "staff@example.com" });
    expect(await rule(publishDraft(qb, admin, "receipt", 1))).toBe("published");
    expect(await rule(saveDraft(qb, admin, "receipt", 1, definition))).toBe("published");
    expect(await rule(deleteDraft(qb, admin, "receipt", 1))).toBe("published");

    // Jobs can now use it.
    const reading = await readDocument(
      qb,
      { type: "receipt", file: { bytes: await makePdf([INVOICE_TEXT]) }, wait: 5000 },
      as(alice),
    );
    expect(reading).toMatchObject({ status: "OK", type: { key: "receipt", version: 1 } });

    const draft = await createDraft(qb, admin, "receipt");
    expect(draft).toMatchObject({ version: 2, state: "draft", label: "Receipt" });
    expect(await rule(createDraft(qb, admin, "receipt"))).toBe("draft-exists");
    expect(await listVersions(qb, admin, "receipt")).toMatchObject([
      { version: 2 },
      { version: 1 },
    ]);
    const types = await listDocTypes(qb, admin);
    expect(types.find((t) => t.key === "receipt")).toMatchObject({
      published: { version: 1 },
      draft: { version: 2 },
      versions: 2,
      samples: 1,
      builtin: false,
    });
    expect(types.find((t) => t.key === "invoice")).toMatchObject({ builtin: true, draft: null });

    // An edit after the test run means it must be tested again.
    await saveDraft(qb, admin, "receipt", 2, definition);
    expect(await rule(publishDraft(qb, admin, "receipt", 2))).toBe("not-tested");
    await deleteDraft(qb, admin, "receipt", 2);
    expect(await listVersions(qb, admin, "receipt")).toHaveLength(1);
    const fromOld = await createDraft(qb, admin, "receipt", 1);
    expect(fromOld.version).toBe(2);
    await expect(createDraft(qb, admin, "nope")).rejects.toThrow(NotFoundError);
    await deleteDraft(qb, admin, "receipt", 2);
    await expect(createDraft(qb, admin, "receipt", 7)).rejects.toThrow(NotFoundError);
    await expect(getVersion(qb, admin, "receipt", 9)).rejects.toThrow(NotFoundError);
    await expect(listVersions(qb, admin, "nope")).rejects.toThrow(NotFoundError);
  });

  it("is for platform staff only", async () => {
    const { qb } = await setup();
    await expect(listDocTypes(qb, as(alice))).rejects.toThrow(ForbiddenError);
    await expect(createDocType(qb, as(alice), { key: "x", label: "X" })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("refuses to publish a draft that changed after its test", async () => {
    const { qb, runner } = await setup();
    await createDraft(qb, admin, "invoice");
    await addSample(qb, admin, "invoice", {
      file: { bytes: await makePdf([INVOICE_TEXT]), name: "a.pdf" },
    });
    await startTestRun(qb, admin, "invoice", 2);
    await runner.idle();
    const version = await getVersion(qb, admin, "invoice", 2);
    const runs = await listTestRuns(qb, admin, "invoice");
    expect(canPublish(version, runs)).toBe(true);
    expect(canPublish({ ...version, revision: "other" }, runs)).toBe(false);
    expect(canPublish({ ...version, state: "published" }, runs)).toBe(false);
  });
});

describe("samples", () => {
  it("adds, edits, previews and removes samples", async () => {
    const { qb, files } = await setup();
    const sample = await addSample(qb, admin, "invoice", {
      file: { bytes: PNG },
      params: { issuerTaxIds: ["1"] },
    });
    expect(sample).toMatchObject({
      fileName: "sample.png",
      mime: "image/png",
      expected: {},
      note: null,
      params: { issuerTaxIds: ["1"] },
    });
    const edited = await updateSample(qb, admin, sample.id, {
      expected: { number: "A1", total: " " },
      note: "x",
      params: {},
    });
    expect(edited).toMatchObject({ expected: { number: "A1" }, note: "x", params: {} });
    expect((await updateSample(qb, admin, sample.id, { note: null })).note).toBeNull();
    await expect(
      updateSample(qb, admin, sample.id, { expected: { a: 1 } as never }),
    ).rejects.toThrow(ValidationError);
    expect((await sampleFile(qb, admin, sample.id)).mime).toBe("image/png");
    expect(await listSamples(qb, admin, "invoice")).toHaveLength(1);
    await expect(addSample(qb, admin, "nope", { file: { bytes: PNG } })).rejects.toThrow(
      NotFoundError,
    );
    files.files.clear();
    await expect(sampleFile(qb, admin, sample.id)).rejects.toThrow(NotFoundError);
    await removeSample(qb, admin, sample.id);
    expect(await listSamples(qb, admin, "invoice")).toEqual([]);
  });
});

describe("test runs", () => {
  it("compares two models side by side, each alone, and bills the platform", async () => {
    const { qb, runner, mock } = await setup({
      answer: invoiceReply({
        number: { value: "A-1043", confidence: 0.9 },
        issuedOn: { value: "2026-03-05", confidence: 0.9 },
      }),
    });
    await addSample(qb, admin, "invoice", {
      file: { bytes: PNG, name: "scan.png" },
      expected: { number: "A1043", issuedOn: "2026-03-06" },
    });
    const runs = await startTestRun(qb, admin, "invoice", 1, {
      variants: [{ connectionId: "conn-1" }, { connectionId: "conn-2", model: "other" }],
    });
    expect(runs).toHaveLength(2);
    expect(runs[0]?.compareGroup).toBeTruthy();
    expect(runs[0]?.compareGroup).toBe(runs[1]?.compareGroup);
    await runner.idle();
    const [a, b] = await Promise.all(runs.map((run) => getTestRun(qb, admin, run.id)));
    if (!a || !b) throw new Error("expected two runs");
    expect(a).toMatchObject({
      state: "done",
      variant: { connectionId: "conn-1" },
      summary: { checked: 2, matched: 1, accuracy: 0.5, costUsd: 0.0105 },
    });
    expect(b).toMatchObject({ state: "done", variant: { connectionId: "conn-2", model: "other" } });
    expect(mock.calls).toHaveLength(2);
    const usage = await qb.find(DOC_USAGE, {}, system);
    expect(usage.docs.map((row) => [row.tenant, row.model, row.testRun !== null])).toEqual(
      expect.arrayContaining([
        [null, "vision-test", true],
        [null, "other", true],
      ]),
    );
    // Comparisons do not count as a test of the version.
    expect(
      canPublish({ state: "draft", revision: a.typeRevision, updatedAt: "2000-01-01" }, [a, b]),
    ).toBe(false);
    await expect(
      startTestRun(qb, admin, "invoice", 1, { variants: [{ connectionId: "" }] }),
    ).rejects.toThrow(ValidationError);
  });

  it("isolates the model in a comparison", () => {
    expect(
      variantPipeline(
        {
          steps: [
            { extractor: "text-layer", config: {} },
            { extractor: "vision-llm", config: { connectionId: "a", model: "m", maxPages: 1 } },
          ],
          threshold: 0.8,
          stopWhen: "required",
        },
        { connectionId: "b" },
      ).steps,
    ).toEqual([{ extractor: "vision-llm", config: { connectionId: "b", maxPages: 1 } }]);
  });

  it("records samples that cannot be read and fails stale runs", async () => {
    const log = vi.fn();
    const { qb, runner, files } = await setup({ log });
    const kept = await addSample(qb, admin, "invoice", { file: { bytes: PNG, name: "kept.png" } });
    await addSample(qb, admin, "invoice", { file: { bytes: PNG, name: "lost.png" } });
    for (const [ref] of [...files.files.entries()].slice(1)) files.files.delete(ref);
    const [run] = await startTestRun(qb, admin, "invoice", 1, { sampleIds: [kept.id, "other"] });
    await runner.idle();
    expect((await getTestRun(qb, admin, run!.id)).results).toHaveLength(1);
    const broken = await addSample(qb, admin, "invoice", {
      file: { bytes: PNG, name: "broken.png" },
    });
    const read = files.read.bind(files);
    vi.spyOn(files, "read").mockImplementation(async (ref) => {
      const samples = await listSamples(qb, admin, "invoice");
      const target = samples.find((sample) => sample.id === broken.id);
      if (target && ref.endsWith(".png") && ref === [...files.files.keys()].at(-1))
        throw new Error("disk error");
      return read(ref);
    });
    const [all] = await startTestRun(qb, admin, "invoice", 1);
    await runner.idle();
    const done = await getTestRun(qb, admin, all!.id);
    expect(done.state).toBe("failed");
    expect(done.results.map((r) => r.error)).toEqual([
      undefined,
      "file not found",
      "the sample could not be read",
    ]);
    expect(log).toHaveBeenCalledWith("test-run-sample-failed", expect.anything());

    await qb.create(
      DOC_TEST_RUNS,
      { typeKey: "invoice", typeVersion: 1, typeRevision: "r", pipeline: {} },
      system,
    );
    expect(await failInterruptedRuns(qb, -1000)).toBe(1);
  });

  it("summarizes results", () => {
    expect(summarize([])).toEqual({
      samples: 0,
      checked: 0,
      matched: 0,
      accuracy: null,
      costUsd: 0,
      avgLatencyMs: 0,
    });
  });
});
