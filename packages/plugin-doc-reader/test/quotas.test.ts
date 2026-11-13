import { ForbiddenError, ValidationError } from "@quickben/core";
import { describe, expect, it, vi } from "vitest";

import {
  DOC_USAGE,
  getReading,
  listQuotas,
  quotaStatus,
  readDocument,
  removeQuota,
  setPlatformCap,
  setQuota,
  usageReport,
} from "../src";
import { monthOf, monthRange, quotaState, skipHook } from "../src/quotas";

import { alice, as, invoiceReply, PNG, setup, staff, system } from "./helpers";

import type { Extractor } from "../src";

const admin = as(staff);
const paid = { key: "vision-llm", paid: true } as Extractor;
const free = { key: "text-layer", paid: false } as Extractor;
const step = { extractor: "x", config: {} };

const usageRow = (tenant: string | null, costUsd: number, extra: Record<string, unknown> = {}) => ({
  tenant,
  typeKey: "invoice",
  extractor: "vision-llm",
  connectionId: "conn-1",
  model: "vision-test",
  inputTokens: 100,
  outputTokens: 10,
  pages: 1,
  costUsd,
  ...extra,
});

describe("quota states", () => {
  it("warns at 80 % and stops at 100 %; zero means no paid reads", () => {
    expect(quotaState(null, 5)).toEqual({
      limitUsd: null,
      spentUsd: 5,
      ratio: null,
      warning: false,
      exceeded: false,
    });
    expect(quotaState(10, 8)).toMatchObject({ ratio: 0.8, warning: true, exceeded: false });
    expect(quotaState(10, 10)).toMatchObject({ exceeded: true });
    expect(quotaState(0, 0)).toMatchObject({ ratio: 1, exceeded: true });
  });

  it("works in UTC months", () => {
    expect(monthOf(new Date("2026-11-30T23:59:59Z"))).toBe("2026-11");
    expect(monthRange("2026-12")).toEqual({
      from: "2026-12-01T00:00:00.000Z",
      to: "2027-01-01T00:00:00.000Z",
    });
    expect(monthRange("2026-01", -1).from).toBe("2025-12-01T00:00:00.000Z");
    expect(() => monthRange("2026-13")).toThrow(ValidationError);
  });
});

describe("budgets", () => {
  it("sets, lists and removes budgets; staff only", async () => {
    const { qb } = await setup();
    await setQuota(qb, admin, "acme", 10);
    await setQuota(qb, admin, "acme", 12.5);
    expect(await setPlatformCap(qb, admin, 100)).toBe(100);
    expect(await setPlatformCap(qb, admin, 50)).toBe(50);
    expect(await listQuotas(qb, admin)).toMatchObject({
      tenants: [{ tenant: "acme", monthlyUsd: 12.5, updatedBy: "staff@example.com" }],
      platformCapUsd: 50,
    });
    await expect(setQuota(qb, admin, "*", 1)).rejects.toThrow(ValidationError);
    await expect(setQuota(qb, admin, " ", 1)).rejects.toThrow(ValidationError);
    await expect(setQuota(qb, admin, "acme", -1)).rejects.toThrow(ValidationError);
    await expect(setQuota(qb, admin, "acme", Number.NaN)).rejects.toThrow(ValidationError);
    await expect(setQuota(qb, as(alice), "acme", 1)).rejects.toThrow(ForbiddenError);
    expect(await setPlatformCap(qb, admin, null)).toBeNull();
    await removeQuota(qb, admin, "acme");
    await removeQuota(qb, admin, "acme");
    expect(await listQuotas(qb, admin)).toEqual({ tenants: [], platformCapUsd: null });
  });

  it("skips paid steps for a tenant over budget and for everyone over the platform cap", async () => {
    const { qb } = await setup();
    const log = vi.fn();
    expect(await skipHook(qb, "acme", log)).toBeUndefined();
    await qb.create(DOC_USAGE, usageRow("acme", 9), system);
    await qb.create(DOC_USAGE, usageRow(null, 1), system);
    await setQuota(qb, admin, "acme", 9);
    expect(await quotaStatus(qb, "acme")).toMatchObject({
      tenant: { spentUsd: 9, exceeded: true },
      platform: { spentUsd: 10, limitUsd: null },
    });
    const hook = await skipHook(qb, "acme", log);
    expect(hook?.(paid, step)).toBe("tenant-quota");
    expect(hook?.(free, step)).toBeUndefined();
    expect(await skipHook(qb, "globex", log)).toBeUndefined();
    await setPlatformCap(qb, admin, 10);
    expect((await skipHook(qb, null, log))?.(paid, step)).toBe("platform-cap");
    expect((await quotaStatus(qb, null)).tenant).toBeNull();
    // Next month starts from zero.
    expect((await quotaStatus(qb, "acme", new Date("2999-01-15"))).tenant?.spentUsd).toBe(0);
  });

  it("lets a run go on when the check fails", async () => {
    const { qb } = await setup();
    const log = vi.fn();
    vi.spyOn(qb, "find").mockRejectedValueOnce(new Error("db down"));
    expect(await skipHook(qb, "acme", log)).toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      "quota-check-failed",
      expect.objectContaining({ tenant: "acme" }),
    );
  });

  it("reads with the free steps only when the tenant is over budget", async () => {
    const { qb, mock } = await setup({
      answer: invoiceReply({ number: { value: "A1", confidence: 1 } }),
    });
    await setQuota(qb, admin, "acme", 0);
    const reading = await readDocument(
      qb,
      { type: "invoice", file: { bytes: PNG }, tenant: "acme", wait: 5000 },
      as(alice),
    );
    expect(reading.attempts.map((a) => [a.extractor, a.status, a.problems])).toEqual([
      ["text-layer", "NO_TEXT", { mime: "image/png" }],
      ["vision-llm", "SKIPPED", { skipped: "tenant-quota" }],
    ]);
    expect(mock.calls).toHaveLength(0);
    expect((await getReading(qb, reading.id, as(alice))).status).toBe("NO_TEXT");
  });
});

describe("usageReport", () => {
  it("totals a month by tenant, model and type, with budgets and a trend", async () => {
    const { qb } = await setup();
    await setQuota(qb, admin, "acme", 10);
    await setQuota(qb, admin, "idle", 5);
    await setPlatformCap(qb, admin, 100);
    await qb.create(DOC_USAGE, usageRow("acme", 8, { connectionName: "Main" }), system);
    await qb.create(DOC_USAGE, usageRow("acme", 1, { model: "small", typeKey: "receipt" }), system);
    await qb.create(DOC_USAGE, usageRow(null, 0.5, { testRun: "run-1" }), system);
    const report = await usageReport(qb, admin);
    expect(report.totals).toEqual({
      costUsd: 9.5,
      calls: 3,
      pages: 3,
      inputTokens: 300,
      outputTokens: 30,
    });
    expect(report.platform).toMatchObject({ limitUsd: 100, spentUsd: 9.5 });
    expect(
      report.byTenant.map((row) => [
        row.tenant,
        row.costUsd,
        row.calls,
        row.quota?.limitUsd,
        row.quota?.warning,
      ]),
    ).toEqual([
      ["acme", 9, 2, 10, true],
      [null, 0.5, 1, undefined, undefined],
      ["idle", 0, 0, 5, false],
    ]);
    expect(report.byModel.map((m) => [m.model, m.connectionName, m.costUsd])).toEqual([
      ["vision-test", "Main", 8.5],
      ["small", null, 1],
    ]);
    expect(report.byType.map((t) => [t.typeKey, t.calls])).toEqual([
      ["invoice", 2],
      ["receipt", 1],
    ]);
    expect(report.trend).toHaveLength(6);
    expect(report.trend.at(-1)).toEqual({ month: report.month, costUsd: 9.5, calls: 3 });
    const past = await usageReport(qb, system, "2020-01");
    expect(past.totals.calls).toBe(0);
    await expect(usageReport(qb, as(alice))).rejects.toThrow(ForbiddenError);
    await expect(usageReport(qb, admin, "bad")).rejects.toThrow(ValidationError);
  });
});
