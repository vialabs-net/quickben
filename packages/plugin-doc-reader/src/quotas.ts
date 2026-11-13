/**
 * Monthly USD budgets for paid extractors, and the usage rows they are checked against.
 *
 * A tenant at 100 % of its budget, or the platform at its cap, gets its paid steps skipped;
 * free steps still run. The check happens once, before a run: concurrent runs can all pass
 * against the same recorded spend and overshoot by their combined cost. These are soft budgets
 * without reservations. Months are UTC calendar months.
 */
import { ValidationError } from "@quickben/core";

import { DOC_QUOTAS, DOC_USAGE } from "./collections";
import { findAll, SYSTEM } from "./store";

import type { PipelineAttempt, SkipHook } from "./pipeline";
import type { QuotaRecord, UsageRecord } from "./records";
import type { Quickben, RequestContext } from "@quickben/core";

/** The `tenant` of the platform cap in `doc-quotas`. */
export const PLATFORM = "*";
/** Share of a budget at which it shows a warning. */
export const WARN_RATIO = 0.8;
export const SKIP_TENANT_QUOTA = "tenant-quota";
export const SKIP_PLATFORM_CAP = "platform-cap";

export interface QuotaState {
  readonly limitUsd: number | null;
  readonly spentUsd: number;
  /** spent / limit, or `null` without a limit. */
  readonly ratio: number | null;
  /** At or over 80 %. */
  readonly warning: boolean;
  /** At or over 100 %: paid extractors are skipped. */
  readonly exceeded: boolean;
}

export function quotaState(limitUsd: number | null, spentUsd: number): QuotaState {
  if (limitUsd === null) {
    return { limitUsd, spentUsd, ratio: null, warning: false, exceeded: false };
  }
  // A zero budget means "no paid reads".
  const ratio = limitUsd === 0 ? 1 : spentUsd / limitUsd;
  return { limitUsd, spentUsd, ratio, warning: ratio >= WARN_RATIO, exceeded: ratio >= 1 };
}

/** `"2026-11"` for a date, in UTC. */
export function monthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/u;

/** `[from, to)` of a UTC month as ISO strings; `offset` moves it by whole months. */
export function monthRange(month: string, offset = 0): { from: string; to: string } {
  if (!MONTH.test(month)) {
    throw new ValidationError([{ path: "month", message: "Use YYYY-MM" }]);
  }
  const [year = 0, index = 1] = month.split("-").map(Number);
  return {
    from: new Date(Date.UTC(year, index - 1 + offset, 1)).toISOString(),
    to: new Date(Date.UTC(year, index + offset, 1)).toISOString(),
  };
}

export interface UsageContext {
  readonly tenant: string | null;
  readonly actorUserId?: string | null;
  readonly job?: string | null;
  readonly testRun?: string | null;
  readonly typeKey: string;
  readonly typeVersion?: number | null;
}

/** One `doc-usage` row per paid call of a run. */
export async function recordUsage(
  qb: Quickben,
  context: UsageContext,
  attempts: readonly PipelineAttempt[],
): Promise<void> {
  for (const attempt of attempts) {
    const usage = attempt.usage;
    if (!usage) continue;
    await qb.create(
      DOC_USAGE,
      {
        tenant: context.tenant,
        actorUserId: context.actorUserId ?? null,
        job: context.job ?? null,
        testRun: context.testRun ?? null,
        typeKey: context.typeKey,
        typeVersion: context.typeVersion ?? null,
        extractor: attempt.extractor,
        connectionId: usage.connectionId,
        connectionName: usage.connectionName ?? null,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        pages: usage.pages,
        costUsd: usage.costUsd,
        latencyMs: Math.max(0, Math.round(attempt.durationMs)),
        outcome: attempt.status,
      },
      SYSTEM,
    );
  }
}

/** Usage rows of a month. With `tenant`, only that tenant's. */
export function usageOf(
  qb: Quickben,
  month: string,
  filter: { tenant?: string } = {},
): Promise<UsageRecord[]> {
  const { from, to } = monthRange(month);
  return findAll<UsageRecord>(
    qb,
    DOC_USAGE,
    {
      createdAt: { gte: from, lt: to },
      ...(filter.tenant === undefined ? {} : { tenant: { eq: filter.tenant } }),
    },
    SYSTEM,
    {
      select: [
        "tenant",
        "costUsd",
        "pages",
        "inputTokens",
        "outputTokens",
        "connectionId",
        "connectionName",
        "model",
        "typeKey",
        "createdAt",
      ],
    },
  );
}

const sum = (rows: readonly UsageRecord[]) =>
  Math.round(rows.reduce((total, row) => total + row.costUsd, 0) * 1e6) / 1e6;

/** Budgets: tenants and the platform cap. */
export async function listQuotas(
  qb: Quickben,
  ctx: RequestContext,
): Promise<{ tenants: QuotaRecord[]; platformCapUsd: number | null }> {
  const rows = await findAll<QuotaRecord>(qb, DOC_QUOTAS, {}, ctx, { sort: "tenant" });
  return {
    tenants: rows.filter((row) => row.tenant !== PLATFORM),
    platformCapUsd: rows.find((row) => row.tenant === PLATFORM)?.monthlyUsd ?? null,
  };
}

async function limitOf(qb: Quickben, tenant: string): Promise<number | null> {
  const page = await qb.find(DOC_QUOTAS, { where: { tenant: { eq: tenant } }, limit: 1 }, SYSTEM);
  return (page.docs[0] as unknown as QuotaRecord | undefined)?.monthlyUsd ?? null;
}

export interface QuotaStatus {
  /** `null` for test runs and readings without a tenant. */
  readonly tenant: QuotaState | null;
  readonly platform: QuotaState;
}

/** Spend against budgets this month. */
export async function quotaStatus(
  qb: Quickben,
  tenant: string | null,
  now: Date = new Date(),
): Promise<QuotaStatus> {
  const month = monthOf(now);
  const [platformLimit, rows] = await Promise.all([limitOf(qb, PLATFORM), usageOf(qb, month)]);
  const platform = quotaState(platformLimit, sum(rows));
  if (tenant === null) return { tenant: null, platform };
  const tenantLimit = await limitOf(qb, tenant);
  return {
    tenant: quotaState(tenantLimit, sum(rows.filter((row) => row.tenant === tenant))),
    platform,
  };
}

/**
 * The pipeline's skip hook for one run, or `undefined` when paid steps may run. A failed check
 * lets the run go on: a budget problem never fails a reading.
 */
export async function skipHook(
  qb: Quickben,
  tenant: string | null,
  log: (event: string, data: Record<string, unknown>) => void,
): Promise<SkipHook | undefined> {
  let reason: string | undefined;
  try {
    const status = await quotaStatus(qb, tenant);
    if (status.platform.exceeded) reason = SKIP_PLATFORM_CAP;
    else if (status.tenant?.exceeded) reason = SKIP_TENANT_QUOTA;
  } catch (error) {
    log("quota-check-failed", { tenant, error: String(error) });
  }
  if (!reason) return undefined;
  const skipped = reason;
  return (extractor) => (extractor.paid ? skipped : undefined);
}

function assertAmount(monthlyUsd: number): void {
  if (!Number.isFinite(monthlyUsd) || monthlyUsd < 0 || monthlyUsd > 1_000_000) {
    throw new ValidationError([
      { path: "monthlyUsd", message: "Use an amount from 0 to 1,000,000" },
    ]);
  }
}

async function upsertQuota(
  qb: Quickben,
  ctx: RequestContext,
  tenant: string,
  monthlyUsd: number,
): Promise<QuotaRecord> {
  assertAmount(monthlyUsd);
  const updatedBy = ctx.user?.email ?? ctx.user?.id ?? null;
  const page = await qb.find(DOC_QUOTAS, { where: { tenant: { eq: tenant } }, limit: 1 }, ctx);
  const existing = page.docs[0];
  const data = { tenant, monthlyUsd, updatedBy };
  const saved = existing
    ? await qb.update(DOC_QUOTAS, existing.id, data, ctx)
    : await qb.create(DOC_QUOTAS, data, ctx);
  return saved as unknown as QuotaRecord;
}

/** Set a tenant's monthly budget in USD. `0` means no paid reads. */
export async function setQuota(
  qb: Quickben,
  ctx: RequestContext,
  tenant: string,
  monthlyUsd: number,
): Promise<QuotaRecord> {
  const id = tenant.trim();
  if (!id || id === PLATFORM) {
    throw new ValidationError([{ path: "tenant", message: "Choose a tenant" }]);
  }
  return upsertQuota(qb, ctx, id, monthlyUsd);
}

/** Remove a budget: the tenant (or with `*`, the platform) has no limit. */
export async function removeQuota(
  qb: Quickben,
  ctx: RequestContext,
  tenant: string,
): Promise<void> {
  const page = await qb.find(DOC_QUOTAS, { where: { tenant: { eq: tenant } }, limit: 1 }, ctx);
  const existing = page.docs[0];
  if (existing) await qb.delete(DOC_QUOTAS, existing.id, ctx);
}

/** Set the platform cap in USD per month, or remove it with `null`. */
export async function setPlatformCap(
  qb: Quickben,
  ctx: RequestContext,
  monthlyUsd: number | null,
): Promise<number | null> {
  if (monthlyUsd === null) {
    await removeQuota(qb, ctx, PLATFORM);
    return null;
  }
  return (await upsertQuota(qb, ctx, PLATFORM, monthlyUsd)).monthlyUsd;
}
