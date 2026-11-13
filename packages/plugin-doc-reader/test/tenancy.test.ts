import { createQuickben, defineConfig } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { tenancy } from "@quickben/plugin-tenancy";
import { describe, expect, it } from "vitest";

import {
  docReader,
  DOC_USAGE,
  inProcessRunner,
  listReadings,
  readDocument,
  setQuota,
  usageReport,
} from "../src";

import {
  alice,
  bob,
  invoiceInput,
  invoiceReply,
  mockModel,
  modelInfo,
  PNG,
  staff,
  system,
} from "./helpers";

describe("with tenancy", () => {
  it("bills readings to the active organization and keeps them inside it", async () => {
    const runner = inProcessRunner();
    const { model } = mockModel(
      invoiceReply({
        number: { value: "A1", confidence: 1 },
        issuedOn: { value: "2026-01-02", confidence: 1 },
      }),
    );
    const config = defineConfig({
      db: memoryAdapter(),
      collections: [],
      plugins: [
        docReader({
          runner,
          types: [invoiceInput],
          isStaff: (user) => user.roles?.includes("platform-admin") === true,
          resolveModel: (id) =>
            Promise.resolve({ connection: { id }, model: modelInfo(), languageModel: model }),
          rasterize: (bytes, mime) => Promise.resolve([{ page: 1, bytes, mime }]),
          log: () => undefined,
        }),
        tenancy({ scope: ["doc-jobs"] }),
      ],
    });
    const qb = await createQuickben(config);
    const acme = await qb.create("organizations", { name: "Acme", slug: "acme" }, { user: alice });
    const globex = await qb.create(
      "organizations",
      { name: "Globex", slug: "globex" },
      { user: bob },
    );
    await qb.create(
      "memberships",
      {
        organization: acme.id,
        user: "bob",
        email: bob.email ?? null,
        role: "member",
        status: "active",
      },
      system,
    );

    const atAcme = { user: alice, organizationId: acme.id };
    const reading = await readDocument(
      qb,
      { type: "invoice", file: { bytes: PNG }, wait: 5000 },
      atAcme,
    );
    expect(reading).toMatchObject({ state: "done", status: "OK", tenant: acme.id });
    const usage = await qb.find(DOC_USAGE, {}, system);
    expect(usage.docs[0]?.tenant).toBe(acme.id);

    // Bob is a member of Acme too, but readings are per user by default.
    expect((await listReadings(qb, {}, { user: bob, organizationId: acme.id })).totalDocs).toBe(0);
    const atGlobex = { user: bob, organizationId: globex.id };
    await readDocument(qb, { type: "invoice", file: { bytes: PNG }, wait: 5000 }, atGlobex);
    const all = await listReadings(qb, {}, { user: staff });
    expect(all.totalDocs).toBe(2);
    expect((await listReadings(qb, { tenant: acme.id }, { user: staff })).totalDocs).toBe(1);

    await setQuota(qb, { user: staff }, acme.id, 0);
    const blocked = await readDocument(
      qb,
      { type: "invoice", file: { bytes: PNG }, wait: 5000 },
      atAcme,
    );
    expect(blocked.attempts.at(-1)).toMatchObject({
      status: "SKIPPED",
      problems: { skipped: "tenant-quota" },
    });
    const report = await usageReport(qb, { user: staff });
    expect(new Set(report.byTenant.map((row) => row.tenant))).toEqual(
      new Set([acme.id, globex.id]),
    );
  });
});
