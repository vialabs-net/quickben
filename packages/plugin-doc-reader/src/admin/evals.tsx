/**
 * Test bench parts for datasets: splits, run options, metrics, run comparison, history by
 * version and the publish check.
 */
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Input,
  Select,
  Table,
  Td,
  Th,
  Tr,
} from "@quickben/admin/ui";
import Link from "next/link";

import { resultsToCsv } from "../metrics";

import { docReaderT } from "./messages";
import {
  AlignedSubmit,
  EMPTY,
  Field,
  formatCount,
  formatMs,
  formatPercent,
  formatUsd,
  formatWhen,
  linkClass,
  Stat,
  toBase64,
} from "./shared";

import type { Split } from "../collections";
import type { FieldOutcome, RunComparison, RunMetrics } from "../metrics";
import type { PublishCheck } from "../publish";
import type { SplitVersion } from "../splits";
import type { Sample, TestRun, TypeVersion } from "../studio";
import type { DocReaderT } from "./messages";
import type { AdminI18n } from "@quickben/admin";
import type { ReactNode } from "react";

type Action = (formData: FormData) => Promise<void>;

export const SPLIT_NAMES: readonly Split[] = ["dev", "validation", "test", "unseen"];
const splitTones: Record<Split, "green" | "blue" | "amber" | "neutral"> = {
  dev: "green",
  validation: "blue",
  test: "amber",
  unseen: "neutral",
};

const id = (...parts: (string | number)[]) => `qb-dr-eval-${parts.join("-")}`;

function Hidden({ values }: Readonly<{ values: Record<string, string | number> }>) {
  return (
    <>
      {Object.entries(values).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={String(value)} />
      ))}
    </>
  );
}

export function SplitBadge({ split, t }: Readonly<{ split: Split | null; t: DocReaderT }>) {
  if (!split) return <span className="qb:text-fg-muted">{EMPTY}</span>;
  return <Badge tone={splitTones[split]}>{t(`split.${split}`)}</Badge>;
}

const percent = (ratio: number) => String(Math.round(ratio * 100));

/** The split in force and the form to split (again). */
export function SplitCard({
  version,
  split,
  unsplit,
  action,
  i18n,
}: Readonly<{
  version: TypeVersion;
  split: SplitVersion | null;
  /** Samples without a split. */
  unsplit: number;
  action: Action;
  i18n: AdminI18n;
}>) {
  const t = docReaderT(i18n);
  const ratios = split?.ratios ?? { dev: 0.6, validation: 0.2, test: 0.2 };
  return (
    <Card>
      <CardHeader
        title={t("split.title")}
        description={
          split
            ? t("split.current", {
                version: split.version,
                when: formatWhen(i18n, split.createdAt),
                seed: split.seed,
              })
            : t("split.none")
        }
      />
      <CardBody className="qb:space-y-4">
        {split ? (
          <div className="qb:flex qb:flex-wrap qb:gap-2 qb:text-sm">
            {SPLIT_NAMES.map((name) => (
              <span key={name} className="qb:flex qb:items-center qb:gap-1">
                <SplitBadge split={name} t={t} /> {formatCount(i18n, split.counts[name])}
              </span>
            ))}
            {unsplit > 0 ? <span>{t("split.unsplit", { count: unsplit })}</span> : null}
          </div>
        ) : null}
        <form action={action} className="qb:space-y-3">
          <Hidden values={{ typeKey: version.key, version: version.version }} />
          <div className="qb:flex qb:flex-wrap qb:items-start qb:gap-4">
            {(["dev", "validation", "test"] as const).map((name) => (
              <Field
                key={name}
                label={t("split.ratio", { split: t(`split.${name}`) })}
                htmlFor={id("ratio", name)}
              >
                <Input
                  id={id("ratio", name)}
                  name={`ratio.${name}`}
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={percent(ratios[name])}
                  className="qb:w-28"
                />
              </Field>
            ))}
            <Field
              label={t("split.stratifyBy")}
              htmlFor={id("stratify")}
              hint={t("split.stratifyHint")}
            >
              <Input
                id={id("stratify")}
                name="stratifyBy"
                defaultValue={(split?.stratifyBy ?? ["group"]).join(", ")}
              />
            </Field>
            <Field
              label={t("split.unseenGroups")}
              htmlFor={id("unseen")}
              hint={t("split.unseenHint")}
            >
              <Input
                id={id("unseen")}
                name="unseenGroups"
                defaultValue={(split?.unseenGroups ?? []).join(", ")}
              />
            </Field>
            <Field label={t("split.seed")} htmlFor={id("seed")} hint={t("split.seedHint")}>
              <Input id={id("seed")} name="seed" defaultValue={split?.seed ?? ""} />
            </Field>
          </div>
          <div className="qb:flex qb:flex-wrap qb:items-center qb:gap-4">
            {split ? (
              <label className="qb:flex qb:items-center qb:gap-2 qb:text-sm">
                <Checkbox name="resplit" />
                {t("split.resplit")}
              </label>
            ) : null}
            <Button type="submit" variant="secondary">
              {split ? t("split.again") : t("split.make")}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/** Splits, held-out flag and limits of a run. Inside the run forms. */
export function RunOptions({
  split,
  t,
  baseline,
}: Readonly<{ split: SplitVersion | null; t: DocReaderT; baseline: boolean }>) {
  return (
    <div className="qb:flex qb:flex-wrap qb:items-end qb:gap-4">
      {split ? (
        <fieldset className="qb:flex qb:flex-wrap qb:items-center qb:gap-3 qb:text-sm">
          <legend className="qb:mb-1 qb:font-medium">{t("run.splits")}</legend>
          {SPLIT_NAMES.map((name) => (
            <label key={name} className="qb:flex qb:items-center qb:gap-1">
              <Checkbox name="split" value={name} defaultChecked={name === "validation"} />
              {t(`split.${name}`)}
            </label>
          ))}
          <label className="qb:flex qb:items-center qb:gap-1">
            <Checkbox name="heldOut" />
            {t("run.heldOut")}
          </label>
          {baseline ? (
            <label className="qb:flex qb:items-center qb:gap-1">
              <Checkbox name="baseline" defaultChecked />
              {t("run.baseline")}
            </label>
          ) : null}
        </fieldset>
      ) : null}
      <Field label={t("run.concurrency")} htmlFor={id("concurrency")}>
        <Input
          id={id("concurrency")}
          name="concurrency"
          type="number"
          min={1}
          max={32}
          placeholder="3"
          className="qb:w-28"
        />
      </Field>
      <Field label={t("run.maxCost")} htmlFor={id("maxCost")}>
        <Input
          id={id("maxCost")}
          name="maxCostUsd"
          type="number"
          min={0}
          step="0.01"
          className="qb:w-28"
        />
      </Field>
      <Field label={t("run.retries")} htmlFor={id("retries")}>
        <Input
          id={id("retries")}
          name="retries"
          type="number"
          min={0}
          max={5}
          placeholder="1"
          className="qb:w-28"
        />
      </Field>
    </div>
  );
}

/** Latency, wall time, tokens, failures and cost per document of a run. */
export function RunStats({ run, i18n }: Readonly<{ run: TestRun; i18n: AdminI18n }>) {
  const t = docReaderT(i18n);
  const m = run.metrics;
  if (!m) {
    return run.state === "running" ? (
      <p className="qb:text-sm qb:text-fg-muted">
        {t("run.progress", { done: run.results.length, total: run.total })}
      </p>
    ) : null;
  }
  return (
    <div className="qb:grid qb:grid-cols-1 qb:gap-4 qb:sm:grid-cols-2 qb:xl:grid-cols-3">
      <Stat label={t("run.latency")}>
        {t("run.p50p95", {
          p50: formatMs(i18n, m.latency.p50Ms),
          p95: formatMs(i18n, m.latency.p95Ms),
        })}
      </Stat>
      <Stat label={t("run.wall")}>{formatMs(i18n, m.wallMs)}</Stat>
      <Stat label={t("run.perDoc")}>{formatUsd(i18n, m.cost.perDocUsd)}</Stat>
      <Stat label={t("run.tokens")}>
        {t("run.tokensValue", {
          input: formatCount(i18n, m.tokens.input),
          cached: formatCount(i18n, m.tokens.cachedInput),
          output: formatCount(i18n, m.tokens.output),
        })}
      </Stat>
      <Stat label={t("run.missed")}>{formatCount(i18n, m.global.missed)}</Stat>
      <Stat label={t("run.hallucinated")}>{formatCount(i18n, m.global.hallucinated)}</Stat>
      <Stat label={t("run.failed")}>
        {t("run.failedValue", { failed: m.failed, retries: m.retries, skipped: m.skipped })}
      </Stat>
      <Stat label={t("run.repaired")}>
        {t("run.repairedValue", {
          repaired: m.repaired ?? 0,
          repairs: m.repairs ?? 0,
          stepErrors: m.stepErrors ?? 0,
        })}
      </Stat>
      <Stat label={t("run.scope")}>
        {run.splits ? run.splits.map((s) => t(`split.${s}`)).join(", ") : t("run.allSamples")}
        {run.heldOut ? ` · ${t("run.heldOutMark")}` : ""}
      </Stat>
    </div>
  );
}

/** Accuracy, misses and hallucinations by field, then slices by group and attribute. */
export function MetricsTables({
  metrics,
  i18n,
}: Readonly<{ metrics: RunMetrics; i18n: AdminI18n }>) {
  const t = docReaderT(i18n);
  const slices: { name: string; rows: RunMetrics["byGroup"] }[] = [
    { name: t("metrics.split"), rows: metrics.bySplit },
    { name: t("metrics.group"), rows: metrics.byGroup.slice(0, 20) },
    ...Object.entries(metrics.byAttribute).map(([name, rows]) => ({
      name,
      rows: rows.slice(0, 20),
    })),
  ].filter((slice) => slice.rows.length > 0);
  return (
    <>
      <Table aria-label={t("metrics.byField")}>
        <thead>
          <tr>
            <Th>{t("metrics.field")}</Th>
            <Th>{t("metrics.accuracy")}</Th>
            <Th>{t("metrics.checked")}</Th>
            <Th>{t("metrics.wrong")}</Th>
            <Th>{t("run.missed")}</Th>
            <Th>{t("run.hallucinated")}</Th>
          </tr>
        </thead>
        <tbody>
          {metrics.byField.map((field) => (
            <Tr key={field.key}>
              <Td>
                {field.label}
                {field.scored ? null : (
                  <>
                    {" "}
                    <Badge tone="neutral">{t("metrics.unscored")}</Badge>
                  </>
                )}
              </Td>
              <Td>{formatPercent(i18n, field.accuracy)}</Td>
              <Td>{formatCount(i18n, field.checked)}</Td>
              <Td>{formatCount(i18n, field.wrong)}</Td>
              <Td>{formatCount(i18n, field.missed)}</Td>
              <Td>{formatCount(i18n, field.hallucinated)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {slices.map((slice) => (
        <Table key={slice.name} aria-label={t("metrics.by", { name: slice.name })}>
          <thead>
            <tr>
              <Th>{slice.name}</Th>
              <Th>{t("metrics.samples")}</Th>
              <Th>{t("metrics.accuracy")}</Th>
              <Th>{t("run.missed")}</Th>
              <Th>{t("run.hallucinated")}</Th>
            </tr>
          </thead>
          <tbody>
            {slice.rows.map((row) => (
              <Tr key={row.value}>
                <Td>{row.value}</Td>
                <Td>{formatCount(i18n, row.samples)}</Td>
                <Td>{formatPercent(i18n, row.accuracy)}</Td>
                <Td>{formatCount(i18n, row.missed)}</Td>
                <Td>{formatCount(i18n, row.hallucinated)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      ))}
    </>
  );
}

const dataUrl = (mime: string, text: string) =>
  `data:${mime};base64,${toBase64(new TextEncoder().encode(text))}`;

/** Most results a page embeds as a download. Larger runs: the CLI's `export`. */
export const EXPORT_MAX_RESULTS = 5000;

export function ExportLinks({ run, t }: Readonly<{ run: TestRun; t: DocReaderT }>) {
  if (run.state === "running" || run.results.length === 0) return null;
  if (run.results.length > EXPORT_MAX_RESULTS) {
    return <p className="qb:text-sm qb:text-fg-muted">{t("export.tooLarge")}</p>;
  }
  return (
    <p className="qb:flex qb:gap-4 qb:text-sm">
      <a
        className={linkClass}
        href={dataUrl("text/csv", resultsToCsv(run.results))}
        download={`test-run-${run.id}.csv`}
      >
        {t("export.csv")}
      </a>
      <a
        className={linkClass}
        href={dataUrl("application/json", JSON.stringify(run, null, 2))}
        download={`test-run-${run.id}.json`}
      >
        {t("export.json")}
      </a>
    </p>
  );
}

function delta(i18n: AdminI18n, value: number | null, format: (n: number) => string): ReactNode {
  if (value === null) return EMPTY;
  const sign = value > 0 ? "+" : "";
  return `${sign}${format(value)}`;
}

const outcomeTone: Record<FieldOutcome, "green" | "red" | "amber" | "neutral"> = {
  correct: "green",
  "correct-empty": "green",
  wrong: "red",
  missed: "amber",
  hallucinated: "red",
};

function Outcome({ outcome, t }: Readonly<{ outcome: FieldOutcome | null; t: DocReaderT }>) {
  if (!outcome) return null;
  return <Badge tone={outcomeTone[outcome]}>{t(`outcome.${outcome}`)}</Badge>;
}

/** Two runs field by field, and the cases that got worse. */
export function ComparisonView({
  comparison,
  labelA,
  labelB,
  sampleHref,
  i18n,
}: Readonly<{
  comparison: RunComparison;
  labelA: string;
  labelB: string;
  sampleHref: (sampleId: string) => string;
  i18n: AdminI18n;
}>) {
  const t = docReaderT(i18n);
  const points = (n: number) => `${(n * 100).toFixed(1)} pp`;
  return (
    <Card>
      <CardHeader
        title={t("compare.title")}
        description={t("compare.description", {
          a: labelA,
          b: labelB,
          samples: comparison.samples,
        })}
      />
      <CardBody className="qb:grid qb:grid-cols-1 qb:gap-4 qb:sm:grid-cols-2">
        <Stat label={t("metrics.accuracy")}>
          {formatPercent(i18n, comparison.accuracy.b)} (
          {delta(i18n, comparison.accuracy.delta, points)})
        </Stat>
        <Stat label={t("run.perDoc")}>
          {formatUsd(i18n, comparison.costPerDocUsd.b)} (
          {delta(i18n, comparison.costPerDocUsd.delta, (n) => formatUsd(i18n, n))})
        </Stat>
        <Stat label="p50">
          {formatMs(i18n, comparison.p50LatencyMs.b)} (
          {delta(i18n, comparison.p50LatencyMs.delta, (n) => formatMs(i18n, n))})
        </Stat>
        <Stat label="p95">
          {formatMs(i18n, comparison.p95LatencyMs.b)} (
          {delta(i18n, comparison.p95LatencyMs.delta, (n) => formatMs(i18n, n))})
        </Stat>
      </CardBody>
      <Table aria-label={t("compare.byField")}>
        <thead>
          <tr>
            <Th>{t("metrics.field")}</Th>
            <Th>{labelA}</Th>
            <Th>{labelB}</Th>
            <Th>{t("compare.delta")}</Th>
          </tr>
        </thead>
        <tbody>
          {comparison.fields.map((field) => (
            <Tr key={field.key}>
              <Td>{field.label}</Td>
              <Td>{formatPercent(i18n, field.a)}</Td>
              <Td>{formatPercent(i18n, field.b)}</Td>
              <Td>
                {field.delta !== null && field.delta < 0 ? (
                  <Badge tone="red">{delta(i18n, field.delta, points)}</Badge>
                ) : (
                  delta(i18n, field.delta, points)
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <CardBody>
        <h3 className="qb:text-sm qb:font-semibold">
          {t("compare.worse", { count: comparison.worse.length })} ·{" "}
          {t("compare.better", { count: comparison.better.length })}
        </h3>
      </CardBody>
      {comparison.worse.length > 0 ? (
        <Table aria-label={t("compare.worseTable")}>
          <thead>
            <tr>
              <Th>{t("col.sample")}</Th>
              <Th>{t("metrics.field")}</Th>
              <Th>{t("col.expected")}</Th>
              <Th>{labelA}</Th>
              <Th>{labelB}</Th>
            </tr>
          </thead>
          <tbody>
            {comparison.worse.slice(0, 200).map((change) => (
              <Tr key={`${change.sampleId}-${change.field}`}>
                <Td>
                  <Link href={sampleHref(change.sampleId)} className={linkClass}>
                    {change.fileName}
                  </Link>
                  {change.group ? (
                    <p className="qb:text-xs qb:text-fg-muted">{change.group}</p>
                  ) : null}
                </Td>
                <Td>{change.label}</Td>
                <Td className="qb:font-mono qb:text-sm">{change.expected ?? EMPTY}</Td>
                <Td className="qb:font-mono qb:text-sm">
                  {change.readA ?? EMPTY} <Outcome outcome={change.outcomeA} t={t} />
                </Td>
                <Td className="qb:font-mono qb:text-sm">
                  {change.readB ?? EMPTY} <Outcome outcome={change.outcomeB} t={t} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : null}
    </Card>
  );
}

/** Pick two runs to compare. A GET form: the choice is in the URL. */
export function ComparePicker({
  runs,
  label,
  hidden,
  reference,
  candidate,
  t,
  i18n,
}: Readonly<{
  runs: readonly TestRun[];
  label: (run: TestRun) => string;
  hidden: Record<string, string>;
  reference: string | undefined;
  candidate: string | undefined;
  t: DocReaderT;
  i18n: AdminI18n;
}>) {
  const done = runs.filter((run) => run.state !== "running");
  if (done.length < 2) return null;
  const option = (run: TestRun) => (
    <option key={run.id} value={run.id}>
      {formatWhen(i18n, run.createdAt)} · {label(run)} ·{" "}
      {formatPercent(i18n, run.summary?.accuracy ?? null)}
    </option>
  );
  return (
    <form method="get" className="qb:flex qb:flex-wrap qb:items-start qb:gap-4">
      <Hidden values={hidden} />
      <Field label={t("compare.reference")} htmlFor={id("ref")}>
        <Select id={id("ref")} name="ref" defaultValue={reference ?? done[1]?.id}>
          {done.map(option)}
        </Select>
      </Field>
      <Field label={t("compare.candidate")} htmlFor={id("cand")}>
        <Select id={id("cand")} name="cand" defaultValue={candidate ?? done[0]?.id}>
          {done.map(option)}
        </Select>
      </Field>
      <AlignedSubmit>
        <Button type="submit" variant="secondary">
          {t("compare.run")}
        </Button>
      </AlignedSubmit>
    </form>
  );
}

/** Why the draft can or cannot be published yet. */
export function PublishCheckNotice({
  check,
  i18n,
}: Readonly<{ check: PublishCheck; i18n: AdminI18n }>) {
  const t = docReaderT(i18n);
  if (check.splitVersion === null) return null;
  return (
    <Card>
      <CardHeader
        title={t("publishCheck.title")}
        description={
          check.ok
            ? t("publishCheck.ok")
            : t(`publishCheck.${check.rule ?? "gate"}` as "publishCheck.gate")
        }
      />
      {check.comparison ? (
        <CardBody className="qb:space-y-2 qb:text-sm">
          <p>
            {t("publishCheck.versus", {
              version: check.baselineVersion ?? 0,
              draft: formatPercent(i18n, check.comparison.accuracy.b),
              published: formatPercent(i18n, check.comparison.accuracy.a),
            })}
          </p>
          {check.reasons.length > 0 ? (
            <ul className="qb:text-danger-strong">
              {check.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      ) : null}
    </Card>
  );
}

/** Publication runs of each version: validation, test and unseen. */
export function HistoryCard({
  versions,
  i18n,
}: Readonly<{ versions: readonly TypeVersion[]; i18n: AdminI18n }>) {
  const t = docReaderT(i18n);
  const rows = versions.filter((version) => version.evaluation);
  if (rows.length === 0) return null;
  const cell = (entry: { summary: { accuracy: number | null } | null; state?: string } | null) => {
    if (!entry) return EMPTY;
    if (!entry.summary) return entry.state === "failed" ? t("state.failed") : t("state.running");
    return formatPercent(i18n, entry.summary.accuracy);
  };
  return (
    <Card>
      <CardHeader title={t("history.title")} description={t("history.description")} />
      <Table aria-label={t("history.title")}>
        <thead>
          <tr>
            <Th>{t("history.version")}</Th>
            <Th>{t("history.when")}</Th>
            <Th>{t("split.validation")}</Th>
            <Th>{t("history.baseline")}</Th>
            <Th>{t("split.test")}</Th>
            <Th>{t("split.unseen")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((version) => (
            <Tr key={version.version}>
              <Td>
                v{version.version}
                {version.publishedBy ? (
                  <p className="qb:text-xs qb:text-fg-muted">{version.publishedBy}</p>
                ) : null}
              </Td>
              <Td>{formatWhen(i18n, version.publishedAt)}</Td>
              <Td>{cell(version.evaluation?.validation ?? null)}</Td>
              <Td>
                {version.evaluation?.baseline
                  ? `v${String(version.evaluation.baseline.version)}: ${cell(version.evaluation.baseline)}`
                  : EMPTY}
              </Td>
              <Td>{cell(version.evaluation?.test ?? null)}</Td>
              <Td>{cell(version.evaluation?.unseen ?? null)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

/** Samples shown per page of the sample list. */
export const SAMPLES_PER_PAGE = 50;

/** Filter and paging links of the sample list. */
export function SampleFilter({
  samples,
  current,
  page,
  href,
  t,
}: Readonly<{
  samples: readonly Sample[];
  current: Split | undefined;
  page: number;
  href: (query: Record<string, string>) => string;
  t: DocReaderT;
}>) {
  const shown = current ? samples.filter((s) => s.split === current) : samples;
  const pages = Math.max(1, Math.ceil(shown.length / SAMPLES_PER_PAGE));
  const base: Record<string, string> = current ? { split: current } : {};
  return (
    <nav
      aria-label={t("bench.filter")}
      className="qb:flex qb:flex-wrap qb:items-center qb:gap-3 qb:text-sm"
    >
      <Link href={href({})} className={linkClass} aria-current={current ? undefined : "page"}>
        {t("bench.all", { count: samples.length })}
      </Link>
      {SPLIT_NAMES.map((name) => {
        const count = samples.filter((s) => s.split === name).length;
        if (count === 0) return null;
        return (
          <Link
            key={name}
            href={href({ split: name })}
            className={linkClass}
            aria-current={current === name ? "page" : undefined}
          >
            {t(`split.${name}`)} ({count})
          </Link>
        );
      })}
      {pages > 1 ? (
        <span className="qb:flex qb:gap-3">
          {page > 1 ? (
            <Link href={href({ ...base, page: String(page - 1) })} className={linkClass}>
              {t("bench.previous")}
            </Link>
          ) : null}
          <span>{t("bench.page", { page, pages })}</span>
          {page < pages ? (
            <Link href={href({ ...base, page: String(page + 1) })} className={linkClass}>
              {t("bench.next")}
            </Link>
          ) : null}
        </span>
      ) : null}
    </nav>
  );
}

/** Dev samples to pick as few-shot examples, in the editor. */
export function ExamplesPicker({
  samples,
  chosen,
  t,
}: Readonly<{ samples: readonly Sample[]; chosen: readonly string[]; t: DocReaderT }>) {
  const dev = samples.filter((sample) => sample.split === "dev");
  if (dev.length === 0) return <p className="qb:text-sm qb:text-fg-muted">{t("editor.noDev")}</p>;
  return (
    <Select
      aria-label={t("editor.examples")}
      name="examples"
      multiple
      size={Math.min(8, dev.length)}
      defaultValue={[...chosen]}
      className="qb:w-full"
    >
      {dev
        .filter((sample, index) => index < 500 || chosen.includes(sample.id))
        .map((sample) => (
          <option key={sample.id} value={sample.id}>
            {sample.key ?? sample.fileName}
            {sample.group ? ` · ${sample.group}` : ""}
          </option>
        ))}
    </Select>
  );
}
