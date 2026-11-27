import { ValidationError } from "@quickben/core";
import { describe, expect, it, vi } from "vitest";

import {
  addSample,
  assignSplits,
  compareTestRuns,
  createDraft,
  currentSplit,
  DOC_SAMPLES,
  DOC_TEST_RESULTS,
  exportTestRun,
  getTestRun,
  getVersion,
  importSamples,
  inProcessRunner,
  listSamples,
  listSplits,
  publishCheck,
  publishDraft,
  saveDraft,
  splitSamples,
  startTestRun,
  StudioError,
} from "../src";

import {
  byKey,
  CALL_COST,
  dataset,
  expectedOutcomes,
  fakeModels,
  GROUPS,
  importItems,
  isBroken,
  isFlaky,
  mapReceipt,
  receiptInput,
  SIZE,
  TOKENS,
} from "./dataset";
import { as, setup, staff, system } from "./helpers";

import type { Split, TestRun } from "../src";

const admin = as(staff);

async function rule(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof StudioError ? error.rule : (error as Error).name;
  }
}

async function bench(options: { concurrency?: number } = {}) {
  const models = fakeModels();
  const runner = inProcessRunner({ concurrency: options.concurrency ?? 8 });
  const log = vi.fn();
  const made = await setup({
    types: [receiptInput],
    resolveModel: models.resolveModel,
    runner,
    testRetryDelayMs: 0,
    log,
  });
  return { ...made, runner, models, log };
}

type Bench = Awaited<ReturnType<typeof bench>>;

async function loaded(options: { concurrency?: number } = {}): Promise<Bench> {
  const made = await bench(options);
  const report = await importSamples(made.qb, admin, "receipt", importItems(), { map: mapReceipt });
  expect(report).toMatchObject({ created: SIZE, updated: 0, unchanged: 0, failed: [] });
  await splitSamples(made.qb, admin, "receipt", { seed: "seed-1", unseenGroups: ["g9"] });
  return made;
}

async function finished(made: Bench, runs: TestRun[]): Promise<TestRun[]> {
  await made.runner.idle();
  return Promise.all(runs.map((run) => getTestRun(made.qb, admin, run.id)));
}

describe("import", () => {
  it("keeps explicit empty expectations without configured markers", async () => {
    const made = await setup({ types: [{ ...receiptInput, evaluation: { emptyValues: [] } }] });
    await importSamples(made.qb, admin, "receipt", [
      { ...importItems()[0]!, expected: { code: null } },
    ]);
    expect((await listSamples(made.qb, admin, "receipt"))[0]?.expected).toEqual({ code: "" });
  });

  it("imports by key with a mapping, and updates instead of adding twice", async () => {
    const { qb } = await bench();
    const progress = vi.fn();
    const first = await importSamples(qb, admin, "receipt", importItems(), {
      map: mapReceipt,
      onProgress: progress,
    });
    expect(first).toEqual({
      created: SIZE,
      updated: 0,
      unchanged: 0,
      failed: [],
      unknownFields: ["pages"],
      corrected: 0,
    });
    expect(progress).toHaveBeenCalledTimes(SIZE);
    const samples = await listSamples(qb, admin, "receipt");
    expect(samples).toHaveLength(SIZE);
    const eighth = dataset[8]?.key ?? "";
    const sample = samples.find((s) => s.key === eighth);
    // A null date is "expected empty"; an unknown key is left out.
    expect(sample).toMatchObject({
      group: "g8",
      attributes: { hasTextLayer: false },
      split: null,
      expected: { code: "C-1008", issuedOn: "-", amount: "56.5", reference: "R8" },
    });

    const again = await importSamples(qb, admin, "receipt", importItems(), { map: mapReceipt });
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: SIZE });

    const [changed] = importItems(dataset.slice(0, 1));
    const dry = await importSamples(qb, admin, "receipt", [{ ...changed!, group: "moved" }], {
      map: mapReceipt,
      dryRun: true,
    });
    expect(dry).toMatchObject({ updated: 1 });
    expect(
      (await listSamples(qb, admin, "receipt")).find((s) => s.key === changed!.key)?.group,
    ).toBe("g0");
    const update = await importSamples(
      qb,
      admin,
      "receipt",
      [
        {
          ...changed!,
          group: "moved",
          file: { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]) },
        },
        { ...changed!, key: "../bad key" },
      ],
      { map: mapReceipt },
    );
    expect(update).toMatchObject({ updated: 1, failed: [{ key: "../bad key" }] });
    expect(await qb.count(DOC_SAMPLES, {}, system)).toBe(SIZE);
  });
});

describe("splits", () => {
  it("rolls back assignments when saving a split fails", async () => {
    const { qb } = await bench();
    await importSamples(qb, admin, "receipt", importItems(dataset.slice(0, 10)), {
      map: mapReceipt,
    });
    const transaction = qb.transaction.bind(qb);
    vi.spyOn(qb, "transaction").mockImplementationOnce((work) =>
      transaction(async (tx) => {
        const update = tx.update.bind(tx);
        let writes = 0;
        vi.spyOn(tx, "update").mockImplementation(async (...args) => {
          if (args[0] === DOC_SAMPLES && ++writes === 2) throw new Error("write failed");
          return update(...args);
        });
        return work(tx);
      }),
    );
    await expect(splitSamples(qb, admin, "receipt", { seed: "rollback" })).rejects.toThrow(
      "write failed",
    );
    expect(await currentSplit(qb, admin, "receipt")).toBeNull();
    expect((await listSamples(qb, admin, "receipt")).every((sample) => sample.split === null)).toBe(
      true,
    );
  });

  it("uses the same stratum order for Unicode groups on every host", () => {
    const subjects = [
      { key: "accented", group: "ä", attributes: {} },
      { key: "ascii", group: "z", attributes: {} },
    ];
    const settings = {
      seed: "unicode",
      ratios: { dev: 0.5, validation: 0.5, test: 0 },
      stratifyBy: ["group"],
      unseenGroups: [],
    };
    const expected = new Map([
      ["ascii", "dev"],
      ["accented", "validation"],
    ]);
    expect(assignSplits(subjects, settings)).toEqual(expected);
    expect(assignSplits([...subjects].reverse(), settings)).toEqual(expected);
  });

  it("splits by a saved seed, stratified by group, with unseen groups apart", async () => {
    const { qb } = await bench();
    await importSamples(qb, admin, "receipt", importItems(), { map: mapReceipt });
    expect(await rule(splitSamples(qb, admin, "nothing"))).toBe("no-samples");
    const split = await splitSamples(qb, admin, "receipt", {
      seed: "seed-1",
      unseenGroups: ["g9"],
      note: "first",
    });
    expect(split).toMatchObject({
      version: 1,
      seed: "seed-1",
      ratios: { dev: 0.6, validation: 0.2, test: 0.2 },
      stratifyBy: ["group"],
      counts: { dev: 108, validation: 36, test: 36, unseen: 20 },
      note: "first",
    });
    const samples = await listSamples(qb, admin, "receipt");
    // Every other group appears in every split, near its share.
    for (let g = 0; g < GROUPS - 1; g += 1) {
      const group = samples.filter((s) => s.group === `g${String(g)}`);
      const count = (name: Split) => group.filter((s) => s.split === name).length;
      expect(count("dev")).toBeGreaterThanOrEqual(11);
      expect(count("validation")).toBeGreaterThanOrEqual(3);
      expect(count("test")).toBeGreaterThanOrEqual(3);
      expect(count("unseen")).toBe(0);
    }
    expect(samples.filter((s) => s.group === "g9").every((s) => s.split === "unseen")).toBe(true);

    // Reproducible: the same seed and samples give the same split, in any order.
    const subjects = samples.map((s) => ({
      key: s.key ?? s.id,
      group: s.group,
      attributes: s.attributes,
    }));
    const settings = { ...split, stratifyBy: ["group"], unseenGroups: ["g9"] };
    const again = assignSplits([...subjects].reverse(), settings);
    expect(samples.every((s) => (again.get(s.key ?? "") ?? null) === s.split)).toBe(true);

    // Never silent: a second split needs the flag, and is a new version.
    expect(await rule(splitSamples(qb, admin, "receipt"))).toBe("split-exists");
    const second = await splitSamples(qb, admin, "receipt", {
      resplit: true,
      seed: "seed-2",
      ratios: { dev: 0.5, validation: 0.5, test: 0 },
      stratifyBy: ["hasTextLayer"],
    });
    expect(second).toMatchObject({ version: 2, counts: { test: 0, unseen: 0 } });
    expect((await listSplits(qb, admin, "receipt")).map((s) => s.version)).toEqual([2, 1]);
    await expect(
      splitSamples(qb, admin, "receipt", {
        resplit: true,
        ratios: { dev: 0, validation: 0, test: 0 },
      }),
    ).rejects.toThrow(ValidationError);

    // A sample added later gets a split from its key, under the current version.
    const added = await addSample(qb, admin, "receipt", {
      file: { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]) },
      group: "g1",
      attributes: { hasTextLayer: true },
    });
    expect(added).toMatchObject({ splitVersion: 2, group: "g1" });
    expect(["dev", "validation"]).toContain(added.split);
    expect((await currentSplit(qb, admin, "receipt"))?.version).toBe(2);
  });
});

describe("runs at scale", () => {
  it("does not read queued samples moved into a held-out split", async () => {
    const tasks: (() => Promise<void>)[] = [];
    const runner = inProcessRunner({
      defer: (task) => {
        tasks.push(task);
      },
    });
    const models = fakeModels();
    const { qb } = await setup({
      types: [receiptInput],
      resolveModel: models.resolveModel,
      runner,
    });
    await importSamples(qb, admin, "receipt", importItems(dataset.slice(0, 5)), {
      map: mapReceipt,
    });
    await splitSamples(qb, admin, "receipt", { ratios: { dev: 1, validation: 0, test: 0 } });
    const [started] = await startTestRun(qb, admin, "receipt", 1);
    await splitSamples(qb, admin, "receipt", {
      resplit: true,
      ratios: { dev: 0, validation: 0, test: 1 },
    });
    while (tasks.length > 0) await tasks.shift()!();
    const run = await getTestRun(qb, admin, started!.id);
    expect(run.results.every((result) => result.skipped === "held-out")).toBe(true);
    expect(run.results).toHaveLength(5);
    expect(models.calls.size).toBe(0);
  });

  it("fails the run when a result cannot be persisted", async () => {
    const made = await loaded();
    const create = made.qb.create.bind(made.qb);
    vi.spyOn(made.qb, "create").mockImplementation((...args) => {
      if (args[0] === DOC_TEST_RESULTS) return Promise.reject(new Error("storage offline"));
      return create(...args);
    });
    const [run] = await finished(
      made,
      await startTestRun(made.qb, admin, "receipt", 1, { split: "dev" }),
    );
    expect(run?.state).toBe("failed");
    expect(run?.error).toContain("storage offline");
  });

  it("bounds result rows transferred while checking a large run's budget", async () => {
    const made = await loaded();
    const find = made.qb.find.bind(made.qb);
    let transferred = 0;
    vi.spyOn(made.qb, "find").mockImplementation(async (...args) => {
      const page = await find(...args);
      if (args[0] === DOC_TEST_RESULTS) transferred += page.docs.length;
      return page;
    });
    const [run] = await finished(
      made,
      await startTestRun(made.qb, admin, "receipt", 1, { split: "dev", maxCostUsd: 100 }),
    );
    expect(run?.state).toBe("done");
    expect(transferred).toBeLessThan(10 * run!.total);
  });

  it("reads a split through the queue, retries the provider and scores against the oracle", async () => {
    const made = await loaded();
    const { qb, models } = made;
    const [started] = await startTestRun(qb, admin, "receipt", 1, {
      split: "validation",
      concurrency: 4,
    });
    expect(started).toMatchObject({
      state: "running",
      total: 36,
      concurrency: 4,
      splits: ["validation"],
    });
    const [run] = await finished(made, [started!]);
    expect(run?.state).toBe("done");
    expect(models.peak.value).toBeLessThanOrEqual(4);
    expect(models.peak.value).toBeGreaterThan(1);

    const results = run!.results;
    expect(results).toHaveLength(36);
    expect(results.every((r) => r.split === "validation")).toBe(true);
    const items = results.map((r) => byKey.get(r.sampleKey ?? "")!);
    const broken = items.filter((item) => isBroken(item));
    const flaky = items.filter((item) => isFlaky(item));
    const metrics = run!.metrics!;
    expect(metrics.failed).toBe(broken.length);
    expect(metrics.retries).toBe(broken.length + flaky.length);
    expect(metrics.scored).toBe(36 - broken.length);

    // The oracle: every scored field's outcome, from the fake model's known mistakes.
    const counted = { correct: 0, correctEmpty: 0, wrong: 0, missed: 0, hallucinated: 0 };
    for (const item of items.filter((i) => !isBroken(i))) {
      for (const outcome of Object.values(expectedOutcomes(item, "good"))) {
        if (outcome === "correct") counted.correct += 1;
        else if (outcome === "correct-empty") counted.correctEmpty += 1;
        else if (outcome === "wrong") counted.wrong += 1;
        else if (outcome === "missed") counted.missed += 1;
        else counted.hallucinated += 1;
      }
    }
    const checked = Object.values(counted).reduce((a, b) => a + b, 0);
    expect(metrics.global).toEqual({
      ...counted,
      near: 0,
      checked,
      accuracy: (counted.correct + counted.correctEmpty) / checked,
    });
    expect(run!.summary).toMatchObject({
      checked,
      matched: counted.correct + counted.correctEmpty,
      failed: broken.length,
    });
    // "reference" is always wrong but not scored: reported, not counted.
    expect(metrics.byField.find((f) => f.key === "reference")).toMatchObject({
      scored: false,
      accuracy: 0,
    });
    // Group g3 reads every amount wrong.
    const g3 = metrics.byGroup.find((g) => g.value === "g3");
    expect(g3?.wrong).toBe(g3?.samples);
    expect(Object.keys(metrics.byAttribute)).toEqual(["hasTextLayer"]);
    expect(metrics.bySplit.map((s) => s.value)).toEqual(["validation"]);

    // Tokens and cost: cached input at its own price; retries are billed too.
    const calls = 36 - broken.length + flaky.length + broken.length * 2;
    expect(models.calls.get("good")).toBe(calls);
    expect(metrics.tokens.input).toBe((36 - broken.length) * TOKENS.input);
    expect(metrics.tokens.cachedInput).toBe((36 - broken.length) * TOKENS.cached);
    expect(metrics.cost.totalUsd).toBeCloseTo((36 - broken.length) * CALL_COST, 6);
    expect(metrics.cost.perDocUsd).toBeCloseTo(((36 - broken.length) * CALL_COST) / 36, 6);
    expect(metrics.latency.p95Ms).toBeGreaterThanOrEqual(metrics.latency.p50Ms);
    expect(metrics.wallMs).toBeGreaterThanOrEqual(0);

    // Export: one CSV row per sample and field.
    const csv = await exportTestRun(qb, admin, run!.id, "csv");
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(36 * 4 + 1);
    expect(lines[0]).toContain("outcome");
    expect(lines[0]).toContain("attr.hasTextLayer");
    const json = JSON.parse(await exportTestRun(qb, admin, run!.id, "json")) as TestRun;
    expect(json.metrics?.global.checked).toBe(checked);
  });

  it("keeps test and unseen for publishing, and stops at the spending limit", async () => {
    const made = await loaded();
    const { qb, log } = made;
    expect(await rule(startTestRun(qb, admin, "receipt", 1, { split: "test" }))).toBe("held-out");
    expect(await rule(startTestRun(qb, admin, "receipt", 1, { split: ["dev", "unseen"] }))).toBe(
      "held-out",
    );
    const unseenIds = (await listSamples(qb, admin, "receipt", "unseen")).map((s) => s.id);
    expect(await rule(startTestRun(qb, admin, "receipt", 1, { sampleIds: unseenIds }))).toBe(
      "held-out",
    );
    // Default: everything outside test and unseen.
    const [all] = await startTestRun(qb, admin, "receipt", 1, { maxCostUsd: 0, concurrency: 2 });
    expect(all).toMatchObject({ total: 144, splits: ["dev", "validation"], heldOut: false });
    const [held] = await startTestRun(qb, admin, "receipt", 1, {
      split: "unseen",
      heldOut: true,
      maxCostUsd: 0.05,
      concurrency: 1,
      retries: 0,
    });
    expect(held).toMatchObject({ heldOut: true, total: 20, createdBy: "staff@example.com" });
    expect(log).toHaveBeenCalledWith(
      "held-out-run",
      expect.objectContaining({ runId: held!.id, by: "staff@example.com", splits: ["unseen"] }),
    );
    const [budgeted, capped] = await finished(made, [all!, held!]);
    // A limit of 0 skips everything: nothing is billed, nothing scored.
    expect(budgeted!.metrics).toMatchObject({ skipped: 144, scored: 0, cost: { totalUsd: 0 } });
    expect(budgeted!.summary?.accuracy).toBeNull();
    const read = capped!.results.filter((r) => r.skipped === undefined).length;
    expect(read).toBe(Math.ceil(0.05 / CALL_COST));
    expect(capped!.metrics?.skipped).toBe(20 - read);
  });

  it("compares runs field by field and lists what got worse", async () => {
    const made = await loaded();
    const { qb } = made;
    const runs = await startTestRun(qb, admin, "receipt", 1, {
      split: "validation",
      variants: [
        { connectionId: "conn-1", model: "good" },
        { connectionId: "conn-1", model: "bad" },
      ],
    });
    expect(runs).toHaveLength(2);
    expect(runs[0]?.compareGroup).toBe(runs[1]?.compareGroup);
    const [good, bad] = await finished(made, runs);
    const comparison = await compareTestRuns(qb, admin, good!.id, bad!.id);
    expect(comparison.accuracy.delta).toBeLessThan(0);
    const amount = comparison.fields.find((f) => f.key === "amount");
    expect(amount?.delta).toBeLessThan(0);
    expect(comparison.fields.find((f) => f.key === "code")?.delta).toBe(0);
    expect(comparison.worse.length).toBeGreaterThan(0);
    expect(comparison.worse.every((c) => c.field === "amount")).toBe(true);
    const change = comparison.worse[0]!;
    const item = dataset.find((i) => i.key.endsWith(change.fileName));
    expect(change).toMatchObject({
      expected: item?.amount,
      readA: item?.amount,
      outcomeB: "wrong",
    });
    expect(comparison.costPerDocUsd.delta).toBe(0);
  });
});

describe("publishing", () => {
  it("needs a validation run no worse than the published one, then runs test and unseen", async () => {
    const made = await loaded();
    const { qb } = made;
    const draft = await createDraft(qb, admin, "receipt");
    const bad = {
      ...draft.definition,
      pipeline: {
        ...draft.definition.pipeline,
        steps: [
          { extractor: "vision-llm", config: { connectionId: "conn-1", model: "bad", repair: 0 } },
        ],
      },
    };
    await saveDraft(qb, admin, "receipt", 2, bad);
    expect(await rule(publishDraft(qb, admin, "receipt", 2))).toBe("not-validated");

    // An empty budget or a hand-picked subset is not a validation of the dataset.
    await finished(
      made,
      await startTestRun(qb, admin, "receipt", 2, { split: "validation", maxCostUsd: 0 }),
    );
    expect(await rule(publishDraft(qb, admin, "receipt", 2))).toBe("not-validated");
    const [sample] = await listSamples(qb, admin, "receipt", "validation");
    await finished(
      made,
      await startTestRun(qb, admin, "receipt", 2, {
        split: "validation",
        sampleIds: [sample!.id],
      }),
    );
    expect(await rule(publishDraft(qb, admin, "receipt", 2))).toBe("not-validated");

    // A dev-only run does not count.
    await finished(made, await startTestRun(qb, admin, "receipt", 2, { split: "dev" }));
    expect(await rule(publishDraft(qb, admin, "receipt", 2))).toBe("not-validated");

    await finished(made, await startTestRun(qb, admin, "receipt", 2, { split: "validation" }));
    expect(await rule(publishDraft(qb, admin, "receipt", 2))).toBe("no-baseline");

    await finished(
      made,
      await startTestRun(qb, admin, "receipt", 1, { split: "validation", maxCostUsd: 0 }),
    );
    expect(await rule(publishDraft(qb, admin, "receipt", 2))).toBe("no-baseline");

    // The baseline: the published version on the same split.
    const runs = await startTestRun(qb, admin, "receipt", 2, {
      split: "validation",
      baseline: true,
    });
    expect(runs.map((run) => [run.typeVersion, run.purpose])).toEqual([
      [2, "bench"],
      [1, "baseline"],
    ]);
    await finished(made, runs);
    const check = await publishCheck(qb, admin, "receipt", 2);
    expect(check).toMatchObject({ ok: false, rule: "gate", baselineVersion: 1 });
    expect(check.reasons[0]).toMatch(/^accuracy/u);
    let refusal: unknown;
    try {
      await publishDraft(qb, admin, "receipt", 2);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(StudioError);
    expect((refusal as StudioError).reasons).toEqual(check.reasons);

    // Allow a bigger drop: a save is a new revision, so it needs a new validation run.
    const lenient = {
      ...bad,
      evaluation: {
        ...draft.definition.evaluation,
        gate: { ...draft.definition.evaluation.gate, maxAccuracyDrop: 0.5, maxFieldDrop: 0.9 },
      },
    };
    await saveDraft(qb, admin, "receipt", 2, lenient);
    expect(await rule(publishDraft(qb, admin, "receipt", 2))).toBe("not-validated");
    await finished(made, await startTestRun(qb, admin, "receipt", 2));
    expect((await publishCheck(qb, admin, "receipt", 2)).ok).toBe(true);

    await expect(publishDraft(qb, admin, "receipt", 2, { concurrency: 0 })).rejects.toThrow(
      ValidationError,
    );
    expect((await getVersion(qb, admin, "receipt", 2)).state).toBe("draft");
    const enqueue = vi
      .spyOn(made.runner, "enqueue")
      .mockRejectedValueOnce(new Error("queue offline"));
    await expect(publishDraft(qb, admin, "receipt", 2)).rejects.toThrow("queue offline");
    enqueue.mockRestore();
    const published = await publishDraft(qb, admin, "receipt", 2, { concurrency: 4 });
    expect(published).toMatchObject({
      state: "published",
      evaluation: {
        splitVersion: 1,
        validation: { summary: { samples: 36 } },
        baseline: { version: 1 },
        test: { summary: null },
        unseen: { summary: null },
      },
    });
    await made.runner.idle();
    const after = await getVersion(qb, admin, "receipt", 2);
    expect(after.evaluation?.test).toMatchObject({ state: "done", summary: { samples: 36 } });
    expect(after.evaluation?.unseen).toMatchObject({ state: "done", summary: { samples: 20 } });
    const testRun = await getTestRun(qb, admin, after.evaluation!.test!.runId);
    expect(testRun).toMatchObject({
      purpose: "publish",
      heldOut: true,
      createdBy: "staff@example.com",
    });
  });

  it("takes few-shot examples only from dev and shows them to the model", async () => {
    const made = await loaded();
    const { qb, models } = made;
    const [dev] = await listSamples(qb, admin, "receipt", "dev");
    const [validation] = await listSamples(qb, admin, "receipt", "validation");
    const draft = await createDraft(qb, admin, "receipt");
    await expect(
      saveDraft(qb, admin, "receipt", 2, {
        ...draft.definition,
        examples: [{ sampleId: validation!.id }],
      }),
    ).rejects.toThrow(ValidationError);
    await expect(
      saveDraft(qb, admin, "receipt", 2, { ...draft.definition, examples: [{ sampleId: "nope" }] }),
    ).rejects.toThrow(ValidationError);
    await saveDraft(qb, admin, "receipt", 2, {
      ...draft.definition,
      examples: [{ sampleId: dev!.id }],
    });
    const before = models.prompts.length;
    await finished(
      made,
      await startTestRun(qb, admin, "receipt", 2, { sampleIds: [validation!.id] }),
    );
    const prompt = models.prompts[before] as { role: string; content: unknown }[];
    expect(prompt.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    const answer = prompt[2]?.content as { type: string; text: string }[];
    expect(JSON.parse(answer[0]!.text)).toMatchObject({
      code: { value: byKey.get(dev!.key ?? "")?.code },
    });

    // A re-split can move the example out of dev: publishing checks again.
    await splitSamples(qb, admin, "receipt", {
      resplit: true,
      seed: "other",
      ratios: { dev: 0, validation: 1, test: 0 },
    });
    const beforeResplitRun = models.prompts.length;
    const [rerun] = await finished(
      made,
      await startTestRun(qb, admin, "receipt", 2, { split: "validation" }),
    );
    expect(rerun?.state).toBe("done");
    expect((models.prompts[beforeResplitRun] as { role: string }[]).map((m) => m.role)).toEqual([
      "system",
      "user",
    ]);
    await finished(made, await startTestRun(qb, admin, "receipt", 1, { split: "validation" }));
    expect((await publishCheck(qb, admin, "receipt", 2)).ok).toBe(true);
    await expect(publishDraft(qb, admin, "receipt", 2)).rejects.toThrow(ValidationError);
  });

  it("keeps the old rule before the type is split", async () => {
    const made = await bench();
    const { qb } = made;
    await importSamples(qb, admin, "receipt", importItems(dataset.slice(0, 5)), {
      map: mapReceipt,
    });
    await createDraft(qb, admin, "receipt");
    expect(await rule(publishDraft(qb, admin, "receipt", 2))).toBe("not-tested");
    await finished(made, await startTestRun(qb, admin, "receipt", 2));
    const published = await publishDraft(qb, admin, "receipt", 2);
    expect(published).toMatchObject({ state: "published", evaluation: null });
  });
});
