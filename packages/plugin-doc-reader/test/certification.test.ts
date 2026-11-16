import { mkdir, mkdtemp, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  DOC_TEST_RUNS,
  annotateSample,
  compareResults,
  createDraft,
  getTestRun,
  getVersion,
  importSamples,
  listSamples,
  publishCheck,
  publishDraft,
  saveDraft,
  splitSamples,
  startTestRun,
  updateSample,
} from "../src";
import { processTestRunItem, TEST_RUN_JOB } from "../src/bench";
import { datasetWrite } from "../src/eval-state";
import { loadExamples } from "../src/examples";
import { loadFolder, loadManifest } from "../src/node";
import { isTransientFailure } from "../src/pipeline";

import { dataset, fakeModels, importItems, mapReceipt, receiptInput } from "./dataset";
import { as, setup, staff } from "./helpers";

const admin = as(staff);

async function ready() {
  const models = fakeModels();
  const made = await setup({
    types: [receiptInput],
    resolveModel: models.resolveModel,
    testRetryDelayMs: 0,
  });
  await importSamples(made.qb, admin, "receipt", importItems(dataset.slice(1, 10)), {
    map: mapReceipt,
  });
  await splitSamples(made.qb, admin, "receipt", { seed: "certification" });
  await createDraft(made.qb, admin, "receipt");
  return { ...made, models };
}

describe("certification regressions", () => {
  it("claims concurrent deliveries before billing and serializes dataset writers", async () => {
    const made = await ready();
    const read = made.qb.findById.bind(made.qb);
    let transferred = 0;
    vi.spyOn(made.qb, "findById").mockImplementation(async (...args) => {
      const row = await read(...args);
      if (args[0] === DOC_TEST_RUNS)
        transferred +=
          (("sampleIds" in row ? row.sampleIds : undefined) as unknown[] | undefined)?.length ?? 0;
      return row;
    });
    const [run] = await startTestRun(made.qb, admin, "receipt", 2, {
      split: "validation",
      concurrency: 1,
    });
    await Promise.all(
      Array.from({ length: 4 }, () => processTestRunItem(made.qb, `${TEST_RUN_JOB}${run!.id}`, 1)),
    );
    await made.runner.idle();
    expect(transferred).toBe(0);
    const done = await getTestRun(made.qb, admin, run!.id);
    expect(done.state).toBe("done");
    expect(made.models.calls.get("good")).toBe(done.total);
    await datasetWrite(made.qb, "receipt", async () => {
      await expect(splitSamples(made.qb, admin, "receipt", { resplit: true })).rejects.toThrow(
        "dataset is being changed",
      );
    });
  });

  it("invalidates validation after relabeling and preserves explicit empty expectations", async () => {
    const made = await ready();
    await startTestRun(made.qb, admin, "receipt", 2, { split: "validation", baseline: true });
    await made.runner.idle();
    expect((await publishCheck(made.qb, admin, "receipt", 2)).ok).toBe(true);
    const [sample] = await listSamples(made.qb, admin, "receipt", "validation");
    const updated = await updateSample(made.qb, admin, sample!.id, {
      expected: { ...sample!.expected, code: "", amount: "999" },
    });
    expect(updated.expected.code).toBe("");
    expect((await publishCheck(made.qb, admin, "receipt", 2)).rule).toBe("not-validated");
  });

  it("freezes published example values and files", async () => {
    const made = await ready();
    const [sample] = await listSamples(made.qb, admin, "receipt", "dev");
    const draft = await getVersion(made.qb, admin, "receipt", 2);
    await saveDraft(made.qb, admin, "receipt", 2, {
      ...draft.definition,
      examples: [{ sampleId: sample!.id }],
    });
    await startTestRun(made.qb, admin, "receipt", 2, { split: "validation", baseline: true });
    await made.runner.idle();
    const version = await publishDraft(made.qb, admin, "receipt", 2);
    await made.runner.idle();
    const before = await loadExamples(made.qb, version.definition);
    await updateSample(made.qb, admin, sample!.id, { expected: { code: "changed" } });
    expect(await loadExamples(made.qb, version.definition)).toEqual(before);
    await expect(
      splitSamples(made.qb, admin, "receipt", {
        resplit: true,
        ratios: { dev: 0, validation: 1, test: 0 },
      }),
    ).rejects.toThrow("Published examples must remain in dev");
  });

  it("rescales both sides with common scoring and detects incomplete provider failures", () => {
    const field = { key: "code", label: "Code", type: "text" as const, required: true };
    const sample = {
      sampleId: "s",
      fileName: "s",
      status: "OK" as const,
      durationMs: 1,
      costUsd: 0,
    };
    const check = {
      key: "code",
      label: "Code",
      expected: "1",
      read: "1",
      match: true,
      confidence: 1,
    };
    const comparison = compareResults(
      { fields: [field] },
      [{ ...sample, fields: [{ ...check, scored: false }] }],
      [{ ...sample, fields: [{ ...check, read: "2", match: false }] }],
    );
    expect(comparison.accuracy).toEqual({ a: 1, b: 0, delta: -1 });
    const attempts = [
      {
        step: 1,
        extractor: "provider",
        status: "ERROR" as const,
        fields: {},
        durationMs: 1,
        problems: { transient: true },
      },
    ];
    expect(isTransientFailure({ status: "INCOMPLETE", attempts })).toBe(true);
    expect(isTransientFailure({ status: "OK", attempts })).toBe(false);
  });

  it("refuses symlinks escaping manifest documents, folder documents and sidecars", async () => {
    const root = await mkdtemp(join(tmpdir(), "qb-eval-confine-"));
    const collect = async (items: AsyncIterable<unknown>) => {
      const collected: unknown[] = [];
      for await (const item of items) collected.push(item);
      return collected;
    };
    try {
      const dir = join(root, "dataset");
      await mkdir(dir);
      await writeFile(join(root, "outside.png"), "private");
      await symlink(join(root, "outside.png"), join(dir, "escape.png"));
      await writeFile(join(dir, "manifest.json"), JSON.stringify([{ file: "escape.png" }]));
      await expect(collect(loadManifest(join(dir, "manifest.json")))).rejects.toThrow("outside");
      await expect(collect(loadFolder(dir))).rejects.toThrow("outside");
      await rm(join(dir, "escape.png"));
      await writeFile(join(dir, "safe.png"), "document");
      await writeFile(join(root, "outside.json"), "{}");
      await symlink(join(root, "outside.json"), join(dir, "safe.json"));
      await expect(collect(loadFolder(dir))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

it("keeps both concurrently submitted annotations", async () => {
  const made = await ready();
  const [sample] = await listSamples(made.qb, admin, "receipt", "dev");
  await Promise.all(
    ["first", "second"].map((text) => annotateSample(made.qb, admin, sample!.id, { text })),
  );
  const saved = (await listSamples(made.qb, admin, "receipt")).find(
    (entry) => entry.id === sample!.id,
  )!;
  expect(saved.annotations.map((note) => note.text).sort((a, b) => a.localeCompare(b))).toEqual([
    "first",
    "second",
  ]);
});

it("reads publication evaluations directly even beyond the 200-run history window", async () => {
  const made = await ready();
  await startTestRun(made.qb, admin, "receipt", 2, { split: "validation", baseline: true });
  await made.runner.idle();
  const version = await publishDraft(made.qb, admin, "receipt", 2);
  await made.runner.idle();
  for (let index = 0; index < 201; index += 1) {
    await made.qb.create(
      DOC_TEST_RUNS,
      { typeKey: "receipt", typeVersion: 2, typeRevision: "later", pipeline: {}, state: "done" },
      admin,
    );
  }
  const history = await getVersion(made.qb, admin, "receipt", 2);
  expect(history.evaluation?.test?.runId).toBe(version.evaluation?.test?.runId);
  expect(history.evaluation?.test?.state).toBe("done");
});
