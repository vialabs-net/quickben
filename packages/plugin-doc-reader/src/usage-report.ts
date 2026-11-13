/**
 * What paid extractors cost in a month: totals, by tenant (with its budget), by model and by
 * document type, plus the trend of the months before.
 */
import { ForbiddenError } from "@quickben/core";

import { getDocReader } from "./options";
import { listQuotas, monthOf, monthRange, quotaState, usageOf } from "./quotas";

import type { QuotaState } from "./quotas";
import type { UsageRecord } from "./records";
import type { Quickben, RequestContext } from "@quickben/core";

export const TREND_MONTHS = 6;

export interface UsageTotals {
  readonly costUsd: number;
  readonly calls: number;
  readonly pages: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface TenantUsage extends UsageTotals {
  /** `null`: the test bench and readings without a tenant. */
  readonly tenant: string | null;
  /** `null` without a budget. */
  readonly quota: QuotaState | null;
}

export interface ModelUsage extends UsageTotals {
  readonly connectionId: string;
  readonly connectionName: string | null;
  readonly model: string;
}

export interface TypeUsage extends UsageTotals {
  readonly typeKey: string;
}

export interface TrendPoint {
  readonly month: string;
  readonly costUsd: number;
  readonly calls: number;
}

export interface UsageReport {
  readonly month: string;
  readonly totals: UsageTotals;
  readonly platform: QuotaState;
  readonly byTenant: TenantUsage[];
  readonly byModel: ModelUsage[];
  readonly byType: TypeUsage[];
  readonly trend: TrendPoint[];
}

const round = (usd: number) => Math.round(usd * 1e6) / 1e6;

function totalsOf(rows: readonly UsageRecord[]): UsageTotals {
  return {
    costUsd: round(rows.reduce((total, row) => total + row.costUsd, 0)),
    calls: rows.length,
    pages: rows.reduce((total, row) => total + row.pages, 0),
    inputTokens: rows.reduce((total, row) => total + row.inputTokens, 0),
    outputTokens: rows.reduce((total, row) => total + row.outputTokens, 0),
  };
}

function groupBy<K>(
  rows: readonly UsageRecord[],
  key: (row: UsageRecord) => K,
): Map<K, UsageRecord[]> {
  const groups = new Map<K, UsageRecord[]>();
  for (const row of rows) {
    const id = key(row);
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  return groups;
}

const byCost = (a: UsageTotals, b: UsageTotals) => b.costUsd - a.costUsd;

/** Usage of a month (`YYYY-MM`, default: this one). Staff only. */
export async function usageReport(
  qb: Quickben,
  ctx: RequestContext,
  month: string = monthOf(new Date()),
): Promise<UsageReport> {
  const state = getDocReader(qb);
  if (!ctx.overrideAccess && !(ctx.user && state.isStaff(ctx.user))) {
    throw new ForbiddenError("Only platform staff can see document reading usage");
  }
  monthRange(month);
  const [rows, quotas] = await Promise.all([usageOf(qb, month), listQuotas(qb, ctx)]);
  const limits = new Map(quotas.tenants.map((quota) => [quota.tenant, quota.monthlyUsd]));

  const tenants = groupBy(rows, (row) => row.tenant);
  // A tenant with a budget shows up even before it spends anything.
  for (const tenant of limits.keys()) if (!tenants.has(tenant)) tenants.set(tenant, []);
  const byTenant = [...tenants.entries()]
    .map(([tenant, group]) => {
      const totals = totalsOf(group);
      const limit = tenant === null ? undefined : limits.get(tenant);
      return {
        tenant,
        ...totals,
        quota: limit === undefined ? null : quotaState(limit, totals.costUsd),
      };
    })
    .sort(byCost);

  const byModel = [...groupBy(rows, (row) => `${row.connectionId}\u0000${row.model}`).values()]
    .flatMap((group) => {
      const first = group[0];
      if (!first) return [];
      return [
        {
          connectionId: first.connectionId,
          connectionName: group.findLast((row) => row.connectionName)?.connectionName ?? null,
          model: first.model,
          ...totalsOf(group),
        },
      ];
    })
    .sort(byCost);

  const byType = [...groupBy(rows, (row) => row.typeKey).entries()]
    .map(([typeKey, group]) => ({ typeKey, ...totalsOf(group) }))
    .sort(byCost);

  const trend: TrendPoint[] = [];
  for (let offset = -(TREND_MONTHS - 1); offset < 0; offset += 1) {
    const point = monthOf(new Date(monthRange(month, offset).from));
    const monthRows = await usageOf(qb, point);
    trend.push({ month: point, costUsd: totalsOf(monthRows).costUsd, calls: monthRows.length });
  }
  const totals = totalsOf(rows);
  trend.push({ month, costUsd: totals.costUsd, calls: totals.calls });

  return {
    month,
    totals,
    platform: quotaState(quotas.platformCapUsd, totals.costUsd),
    byTenant,
    byModel,
    byType,
    trend,
  };
}
