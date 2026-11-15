import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Select,
  Table,
  Td,
  Th,
  Tr,
} from "@quickben/admin/ui";
import { getQuickben } from "@quickben/core";
import { getRequestContext } from "@quickben/next";

import { getDocReader } from "../options";
import { monthOf, monthRange } from "../quotas";
import { usageReport } from "../usage-report";

import { removeBudgetAction, setBudgetAction, setCapAction } from "./actions";
import { docReaderT } from "./messages";
import {
  AlignedSubmit,
  Feedback,
  Field,
  first,
  formatCount,
  formatUsd,
  Heading,
  Meter,
  Notice,
  Stat,
} from "./shared";

import type { UsageReport, UsageTotals } from "../usage-report";
import type { DocReaderT } from "./messages";
import type { AdminI18n, PageProps } from "@quickben/admin";
import type { Quickben, QuickbenConfig, RequestContext } from "@quickben/core";

const ORGANIZATIONS = "organizations";

/** Names of tenants that are organizations of the tenancy plugin. */
async function tenantNames(qb: Quickben, ctx: RequestContext): Promise<Map<string, string>> {
  if (!Object.hasOwn(qb.collections, ORGANIZATIONS)) return new Map();
  const page = await qb.find(
    ORGANIZATIONS,
    { limit: 500, select: ["name"] },
    { ...ctx, overrideAccess: true },
  );
  return new Map(
    page.docs.map((doc) => [doc.id, typeof doc.name === "string" ? doc.name : doc.id]),
  );
}

/** `Nov 2026` for `2026-11`, in the admin's locale. */
function monthLabel(i18n: AdminI18n, month: string): string {
  return i18n.date(`${month}-01`, { month: "short", year: "numeric" });
}

function lastMonths(current: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => monthOf(new Date(monthRange(current, -i).from)));
}

function Trend({ report, i18n }: Readonly<{ report: UsageReport; i18n: AdminI18n }>) {
  const max = Math.max(...report.trend.map((point) => point.costUsd), 0.000001);
  return (
    <div
      className="qb:flex qb:items-end qb:gap-3"
      style={{ height: "7rem" }}
      role="list"
      aria-label={docReaderT(i18n)("usage.trend")}
    >
      {report.trend.map((point) => (
        <div
          key={point.month}
          role="listitem"
          className="qb:flex qb:h-full qb:flex-1 qb:flex-col qb:items-center qb:gap-1"
          style={{ justifyContent: "flex-end" }}
          title={`${monthLabel(i18n, point.month)}: ${formatUsd(i18n, point.costUsd)}`}
        >
          <span className="qb:text-xs qb:text-fg-muted qb:tabular-nums">
            {formatUsd(i18n, point.costUsd)}
          </span>
          <div
            className="qb:w-full qb:rounded"
            style={{
              height: `${String(Math.max(2, (point.costUsd / max) * 100))}%`,
              background:
                point.month === report.month
                  ? "var(--qb-accent)"
                  : "color-mix(in oklab, var(--qb-text-muted) 30%, var(--qb-surface))",
            }}
          />
          <span className="qb:text-xs qb:text-fg-muted">{monthLabel(i18n, point.month)}</span>
        </div>
      ))}
    </div>
  );
}

function Totals({ totals, i18n }: Readonly<{ totals: UsageTotals; i18n: AdminI18n }>) {
  return (
    <>
      <Td className="qb:tabular-nums">{formatCount(i18n, totals.calls)}</Td>
      <Td className="qb:tabular-nums">{formatCount(i18n, totals.pages)}</Td>
      <Td className="qb:tabular-nums">{formatUsd(i18n, totals.costUsd)}</Td>
    </>
  );
}

/** Build the Usage page: spend of a month, budgets and the platform cap. */
export function createUsagePage(config: QuickbenConfig, key: string) {
  const setBudget = setBudgetAction.bind(null, key);
  const removeBudget = removeBudgetAction.bind(null, key);
  const setCap = setCapAction.bind(null, key);

  return async function DocumentUsagePage({ searchParams, i18n }: Readonly<PageProps>) {
    const t: DocReaderT = docReaderT(i18n);
    const qb = await getQuickben(config);
    const ctx = await getRequestContext(config);
    const params = searchParams;
    const feedback = <Feedback searchParams={params} i18n={i18n} />;
    if (!ctx.user || !getDocReader(qb).isStaff(ctx.user)) {
      return (
        <>
          <Heading title={t("usage.title")} />
          <Notice>{t("usage.staffOnly")}</Notice>
        </>
      );
    }
    const current = monthOf(new Date());
    const asked = first(params.month);
    const month = asked && /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(asked) ? asked : current;
    const [report, names] = await Promise.all([usageReport(qb, ctx, month), tenantNames(qb, ctx)]);
    const nameOf = (tenant: string | null) =>
      tenant === null ? t("usage.noTenant") : (names.get(tenant) ?? tenant);
    const { totals, platform } = report;

    return (
      <>
        <Heading
          title={t("usage.title")}
          description={t("usage.description")}
          actions={
            <form method="get" className="qb:flex qb:items-end qb:gap-2">
              <Field label={t("usage.month")} htmlFor="qb-dr-month">
                <Select id="qb-dr-month" name="month" defaultValue={month}>
                  {lastMonths(current, 12).map((m) => (
                    <option key={m} value={m}>
                      {monthLabel(i18n, m)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" variant="secondary">
                {t("usage.show")}
              </Button>
            </form>
          }
        />
        <div className="qb:space-y-4">
          <Card>
            <CardHeader title={t("usage.summary", { month: monthLabel(i18n, month) })} />
            <CardBody className="qb:space-y-8">
              <div className="qb:grid qb:grid-cols-1 qb:gap-4 qb:sm:grid-cols-2 qb:2xl:grid-cols-4">
                <Stat label={t("col.spend")}>{formatUsd(i18n, totals.costUsd)}</Stat>
                <Stat label={t("col.paidReads")}>{formatCount(i18n, totals.calls)}</Stat>
                <Stat label={t("col.pages")}>{formatCount(i18n, totals.pages)}</Stat>
                <Stat label={t("col.tokens")}>
                  {t("usage.tokens", { input: totals.inputTokens, output: totals.outputTokens })}
                </Stat>
              </div>
              <div className="qb:space-y-2">
                <p className="qb:text-sm qb:font-medium qb:text-fg">
                  {t("usage.cap", {
                    cap:
                      platform.limitUsd === null
                        ? t("usage.capNone")
                        : t("usage.capMonthly", { amount: formatUsd(i18n, platform.limitUsd) }),
                  })}
                </p>
                {platform.limitUsd === null ? null : (
                  <Meter ratio={platform.ratio} label={t("usage.capUsed")} i18n={i18n} />
                )}
                <form action={setCap} className="qb:flex qb:flex-wrap qb:items-start qb:gap-2">
                  <Field label={t("usage.capField")} htmlFor="qb-dr-cap" hint={t("usage.capHint")}>
                    <Input
                      id="qb-dr-cap"
                      name="monthlyUsd"
                      type="number"
                      min={0}
                      step={0.01}
                      defaultValue={platform.limitUsd ?? ""}
                    />
                  </Field>
                  <AlignedSubmit>
                    <Button type="submit" variant="secondary">
                      {t("usage.capSave")}
                    </Button>
                  </AlignedSubmit>
                </form>
              </div>
              <Trend report={report} i18n={i18n} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("usage.byTenant")} description={t("usage.byTenantDescription")} />
            <Table>
              <thead>
                <tr>
                  <Th>{t("col.tenant")}</Th>
                  <Th>{t("col.paidReads")}</Th>
                  <Th>{t("col.pages")}</Th>
                  <Th>{t("col.spend")}</Th>
                  <Th>{t("col.budget")}</Th>
                  <Th>{t("col.changeBudget")}</Th>
                </tr>
              </thead>
              <tbody>
                {report.byTenant.map((row) => (
                  <Tr key={row.tenant ?? "none"}>
                    <Td>
                      <p className="qb:font-medium qb:text-fg">{nameOf(row.tenant)}</p>
                      {row.tenant && names.has(row.tenant) ? (
                        <p className="qb:text-xs qb:text-fg-muted qb:font-mono">{row.tenant}</p>
                      ) : null}
                    </Td>
                    <Totals totals={row} i18n={i18n} />
                    <Td>
                      {row.quota ? (
                        <div className="qb:space-y-1">
                          <span className="qb:text-sm">
                            {formatUsd(i18n, row.quota.limitUsd ?? 0)}
                          </span>
                          <Meter
                            ratio={row.quota.ratio}
                            label={t("usage.budgetUsed", { tenant: nameOf(row.tenant) })}
                            i18n={i18n}
                          />
                        </div>
                      ) : (
                        <span className="qb:text-sm qb:text-fg-subtle">
                          {row.tenant === null ? t("usage.capOnly") : t("meter.noBudget")}
                        </span>
                      )}
                    </Td>
                    <Td>
                      {row.tenant === null ? null : (
                        <div className="qb:flex qb:flex-wrap qb:items-center qb:gap-2">
                          <form action={setBudget} className="qb:flex qb:items-center qb:gap-2">
                            <input type="hidden" name="tenant" value={row.tenant} />
                            <input type="hidden" name="month" value={month} />
                            <Input
                              name="monthlyUsd"
                              type="number"
                              min={0}
                              step={0.01}
                              required
                              defaultValue={row.quota?.limitUsd ?? ""}
                              aria-label={t("usage.budgetOf", { tenant: nameOf(row.tenant) })}
                              style={{ width: "7rem" }}
                            />
                            <Button type="submit" size="sm" variant="secondary">
                              {t("usage.save")}
                            </Button>
                          </form>
                          {row.quota ? (
                            <form action={removeBudget}>
                              <input type="hidden" name="tenant" value={row.tenant} />
                              <Button
                                type="submit"
                                size="sm"
                                variant="ghost"
                                aria-label={t("usage.removeBudgetOf", {
                                  tenant: nameOf(row.tenant),
                                })}
                              >
                                {t("usage.remove")}
                              </Button>
                            </form>
                          ) : null}
                        </div>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <CardBody>
              <form action={setBudget} className="qb:flex qb:flex-wrap qb:items-start qb:gap-4">
                <input type="hidden" name="month" value={month} />
                <Field label={t("col.tenant")} htmlFor="qb-dr-tenant">
                  {names.size > 0 ? (
                    <Select id="qb-dr-tenant" name="tenant" required>
                      <option value="">{t("usage.choose")}</option>
                      {[...names.entries()].map(([tenantId, name]) => (
                        <option key={tenantId} value={tenantId}>
                          {name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input id="qb-dr-tenant" name="tenant" required />
                  )}
                </Field>
                <Field
                  label={t("usage.budgetField")}
                  htmlFor="qb-dr-budget"
                  hint={t("usage.budgetHint")}
                >
                  <Input
                    id="qb-dr-budget"
                    name="monthlyUsd"
                    type="number"
                    min={0}
                    step={0.01}
                    required
                  />
                </Field>
                <AlignedSubmit>
                  <Button type="submit">{t("usage.setBudget")}</Button>
                </AlignedSubmit>
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("usage.byModel")} />
            <Table>
              <thead>
                <tr>
                  <Th>{t("col.model")}</Th>
                  <Th>{t("col.paidReads")}</Th>
                  <Th>{t("col.pages")}</Th>
                  <Th>{t("col.spend")}</Th>
                  <Th>{t("col.tokens")}</Th>
                </tr>
              </thead>
              <tbody>
                {report.byModel.map((row) => (
                  <Tr key={`${row.connectionId}|${row.model}`}>
                    <Td>
                      <p className="qb:font-medium qb:text-fg">{row.model}</p>
                      <p className="qb:text-xs qb:text-fg-muted">
                        {row.connectionName ?? row.connectionId}
                      </p>
                    </Td>
                    <Totals totals={row} i18n={i18n} />
                    <Td className="qb:tabular-nums">
                      {t("usage.tokens", { input: row.inputTokens, output: row.outputTokens })}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {report.byModel.length === 0 ? (
              <CardBody>
                <p className="qb:text-sm qb:text-fg-muted">{t("usage.noPaidReads")}</p>
              </CardBody>
            ) : null}
          </Card>

          <Card>
            <CardHeader title={t("usage.byType")} />
            <Table>
              <thead>
                <tr>
                  <Th>{t("col.type")}</Th>
                  <Th>{t("col.paidReads")}</Th>
                  <Th>{t("col.pages")}</Th>
                  <Th>{t("col.spend")}</Th>
                </tr>
              </thead>
              <tbody>
                {report.byType.map((row) => (
                  <Tr key={row.typeKey}>
                    <Td className="qb:font-mono">{row.typeKey}</Td>
                    <Totals totals={row} i18n={i18n} />
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
        {feedback}
      </>
    );
  };
}
