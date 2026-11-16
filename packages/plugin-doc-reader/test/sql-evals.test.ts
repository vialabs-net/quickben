import { createQuickben } from "@quickben/core";
import { drizzleAdapter as pglite } from "@quickben/db-drizzle/pglite";
import { drizzleAdapter as sqlite } from "@quickben/db-drizzle/sqlite";
import { expect, it } from "vitest";

import {
  createDraft,
  getTestRun,
  importSamples,
  listSamples,
  saveDraft,
  splitSamples,
  startTestRun,
} from "../src";

import { dataset, fakeModels, importItems, mapReceipt, receiptInput } from "./dataset";
import { as, makeConfig, staff } from "./helpers";

it.each(["sqlite", "pglite"] as const)(
  "launches runs with examples on %s without a root-connection deadlock",
  async (dialect) => {
    const models = fakeModels();
    const made = makeConfig({
      types: [receiptInput],
      resolveModel: models.resolveModel,
      testRetryDelayMs: 0,
    });
    const db = dialect === "sqlite" ? sqlite({ push: true }) : pglite({ push: true });
    const qb = await createQuickben({ ...made.config, db });
    const ctx = as(staff);
    try {
      await importSamples(qb, ctx, "receipt", importItems(dataset.slice(1, 4)), {
        map: mapReceipt,
      });
      await splitSamples(qb, ctx, "receipt", {
        seed: "sql",
        ratios: { dev: 0.5, validation: 0.5, test: 0 },
      });
      const draft = await createDraft(qb, ctx, "receipt");
      const [example] = await listSamples(qb, ctx, "receipt", "dev");
      await saveDraft(qb, ctx, "receipt", 2, {
        ...draft.definition,
        examples: [{ sampleId: example!.id }],
      });
      const [run] = await startTestRun(qb, ctx, "receipt", 2, { split: "validation" });
      await made.runner.idle();
      expect((await getTestRun(qb, ctx, run!.id)).state).toBe("done");
    } finally {
      await made.runner.close?.();
      await db.close?.();
    }
  },
);
