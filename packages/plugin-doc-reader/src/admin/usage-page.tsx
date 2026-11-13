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
import type { PageProps } from "@quickben/admin";
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

function monthLabel(month: string): string {
  return new Date(monthRange(month).from).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function lastMonths(current: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => monthOf(new Date(monthRange(current, -i).from)));
}

function Trend({ report }: Readonly<{ report: UsageReport }>) {
  const max = Math.max(...report.trend.map((point) => point.costUsd), 0.000001);
  return (
    <div
      className="qb:flex qb:items-end qb:gap-3"
      style={{ height: "7rem" }}
      role="list"
      aria-label="Spend by month"
    >
      {report.trend.map((point) => (
        <div
          key={point.month}
          role="listitem"
          className="qb:flex qb:h-full qb:flex-1 qb:flex-col qb:items-center qb:gap-1"
          style={{ justifyContent: "flex-end" }}
          title={`${monthLabel(point.month)}: ${formatUsd(point.costUsd)}`}
        >
          <span className="qb:text-xs qb:text-zinc-500 qb:tabular-nums">
            {formatUsd(point.costUsd)}
          </span>
          <div
            className="qb:w-full qb:rounded"
            style={{
              height: `${String(Math.max(2, (point.costUsd / max) * 100))}%`,
              background: point.month === report.month ? "rgb(24 24 27)" : "rgb(212 212 216)",
            }}
          />
          <span className="qb:text-xs qb:text-zinc-500">{monthLabel(point.month)}</span>
        </div>
      ))}
    </div>
  );
}

function Totals({ totals }: Readonly<{ totals: UsageTotals }>) {
  return (
    <>
      <Td className="qb:tabular-nums">{formatCount(totals.calls)}</Td>
      <Td className="qb:tabular-nums">{formatCount(totals.pages)}</Td>
      <Td className="qb:tabular-nums">{formatUsd(totals.costUsd)}</Td>
    </>
  );
}

/** Build the Usage page: spend of a month, budgets and the platform cap. */
export function createUsagePage(config: QuickbenConfig, key: string) {
  const setBudget = setBudgetAction.bind(null, key);
  const removeBudget = removeBudgetAction.bind(null, key);
  const setCap = setCapAction.bind(null, key);

  return async function DocumentUsagePage({ searchParams }: Readonly<PageProps>) {
    const qb = await getQuickben(config);
    const ctx = await getRequestContext(config);
    const params = searchParams;
    const feedback = <Feedback searchParams={params} />;
    if (!ctx.user || !getDocReader(qb).isStaff(ctx.user)) {
      return (
        <>
          <Heading title="Document reading usage" />
          <Notice>Only platform staff can see document reading usage.</Notice>
        </>
      );
    }
    const current = monthOf(new Date());
    const asked = first(params.month);
    const month = asked && /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(asked) ? asked : current;
    const [report, names] = await Promise.all([usageReport(qb, ctx, month), tenantNames(qb, ctx)]);
    const nameOf = (tenant: string | null) =>
      tenant === null ? "Test bench and readings without a tenant" : (names.get(tenant) ?? tenant);
    const { totals, platform } = report;

    return (
      <>
        <Heading
          title="Document reading usage"
          description="What paid extractors cost, from the prices of each connection's models. Budgets are monthly and soft: a reading checks them once, before it starts."
          actions={
            <form method="get" className="qb:flex qb:items-end qb:gap-2">
              <Field label="Month" htmlFor="qb-dr-month">
                <Select id="qb-dr-month" name="month" defaultValue={month}>
                  {lastMonths(current, 12).map((m) => (
                    <option key={m} value={m}>
                      {monthLabel(m)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" variant="secondary">
                Show
              </Button>
            </form>
          }
        />
        <div className="qb:space-y-4">
          <Card>
            <CardHeader title={`Summary of ${monthLabel(month)}`} />
            <CardBody className="qb:space-y-8">
              <div className="qb:grid qb:grid-cols-1 qb:gap-4 qb:sm:grid-cols-2 qb:2xl:grid-cols-4">
                <Stat label="Spend">{formatUsd(totals.costUsd)}</Stat>
                <Stat label="Paid reads">{formatCount(totals.calls)}</Stat>
                <Stat label="Pages">{formatCount(totals.pages)}</Stat>
                <Stat label="Tokens">
                  {formatCount(totals.inputTokens)} in · {formatCount(totals.outputTokens)} out
                </Stat>
              </div>
              <div className="qb:space-y-2">
                <p className="qb:text-sm qb:font-medium qb:text-zinc-900">
                  Platform cap:{" "}
                  {platform.limitUsd === null ? "none" : `${formatUsd(platform.limitUsd)} a month`}
                </p>
                {platform.limitUsd === null ? null : (
                  <Meter ratio={platform.ratio} label="Platform cap used" />
                )}
                <form action={setCap} className="qb:flex qb:flex-wrap qb:items-start qb:gap-2">
                  <Field
                    label="Monthly cap (US$)"
                    htmlFor="qb-dr-cap"
                    hint="Empty removes the cap. At 100 % paid steps stop for everyone."
                  >
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
                      Save cap
                    </Button>
                  </AlignedSubmit>
                </form>
              </div>
              <Trend report={report} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="By tenant"
              description="At 100 % of its budget a tenant's paid steps are skipped; free steps still run."
            />
            <Table>
              <thead>
                <tr>
                  <Th>Tenant</Th>
                  <Th>Paid reads</Th>
                  <Th>Pages</Th>
                  <Th>Spend</Th>
                  <Th>Budget</Th>
                  <Th>Change budget</Th>
                </tr>
              </thead>
              <tbody>
                {report.byTenant.map((row) => (
                  <Tr key={row.tenant ?? "none"}>
                    <Td>
                      <p className="qb:font-medium qb:text-zinc-900">{nameOf(row.tenant)}</p>
                      {row.tenant && names.has(row.tenant) ? (
                        <p className="qb:text-xs qb:text-zinc-500 qb:font-mono">{row.tenant}</p>
                      ) : null}
                    </Td>
                    <Totals totals={row} />
                    <Td>
                      {row.quota ? (
                        <div className="qb:space-y-1">
                          <span className="qb:text-sm">{formatUsd(row.quota.limitUsd ?? 0)}</span>
                          <Meter
                            ratio={row.quota.ratio}
                            label={`Budget used by ${nameOf(row.tenant)}`}
                          />
                        </div>
                      ) : (
                        <span className="qb:text-sm qb:text-zinc-400">
                          {row.tenant === null ? "Platform cap only" : "No budget"}
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
                              aria-label={`Monthly budget of ${nameOf(row.tenant)}`}
                              style={{ width: "7rem" }}
                            />
                            <Button type="submit" size="sm" variant="secondary">
                              Save
                            </Button>
                          </form>
                          {row.quota ? (
                            <form action={removeBudget}>
                              <input type="hidden" name="tenant" value={row.tenant} />
                              <Button
                                type="submit"
                                size="sm"
                                variant="ghost"
                                aria-label={`Remove the budget of ${nameOf(row.tenant)}`}
                              >
                                Remove
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
                <Field label="Tenant" htmlFor="qb-dr-tenant">
                  {names.size > 0 ? (
                    <Select id="qb-dr-tenant" name="tenant" required>
                      <option value="">Choose…</option>
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
                  label="Monthly budget (US$)"
                  htmlFor="qb-dr-budget"
                  hint="0 means no paid reads."
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
                  <Button type="submit">Set budget</Button>
                </AlignedSubmit>
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="By model" />
            <Table>
              <thead>
                <tr>
                  <Th>Model</Th>
                  <Th>Paid reads</Th>
                  <Th>Pages</Th>
                  <Th>Spend</Th>
                  <Th>Tokens</Th>
                </tr>
              </thead>
              <tbody>
                {report.byModel.map((row) => (
                  <Tr key={`${row.connectionId}|${row.model}`}>
                    <Td>
                      <p className="qb:font-medium qb:text-zinc-900">{row.model}</p>
                      <p className="qb:text-xs qb:text-zinc-500">
                        {row.connectionName ?? row.connectionId}
                      </p>
                    </Td>
                    <Totals totals={row} />
                    <Td className="qb:tabular-nums">
                      {formatCount(row.inputTokens)} in · {formatCount(row.outputTokens)} out
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {report.byModel.length === 0 ? (
              <CardBody>
                <p className="qb:text-sm qb:text-zinc-500">No paid reads this month.</p>
              </CardBody>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="By document type" />
            <Table>
              <thead>
                <tr>
                  <Th>Type</Th>
                  <Th>Paid reads</Th>
                  <Th>Pages</Th>
                  <Th>Spend</Th>
                </tr>
              </thead>
              <tbody>
                {report.byType.map((row) => (
                  <Tr key={row.typeKey}>
                    <Td className="qb:font-mono">{row.typeKey}</Td>
                    <Totals totals={row} />
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
