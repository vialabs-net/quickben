/**
 * One sample: read it with a chosen version and model, then look at each field on the
 * document. The first column lists the samples of the same run (or split) with their errors.
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
} from "@quickben/admin/ui";
import { getQuickben } from "@quickben/core";
import { getRequestContext } from "@quickben/next";
import Link from "next/link";

import { getTestRun, listSampleRuns } from "../bench";
import { HELD_OUT_SPLITS } from "../collections";
import { isEmptyValue } from "../metrics";
import { getDocReader } from "../options";
import { getSample, getVersion, listSamples, listVersions, sampleFile } from "../studio";

import {
  annotateAction,
  correctExpectedAction,
  inspectSampleAction,
  inspectUploadAction,
} from "./actions";
import { AutoRefresh, FilePreview } from "./client";
import { SplitBadge } from "./evals";
import { SampleInspector } from "./inspector";
import { docReaderT } from "./messages";
import {
  AlignedSubmit,
  EMPTY,
  Field,
  first,
  formatCount,
  formatMs,
  formatPercent,
  formatUsd,
  formatWhen,
  Heading,
  linkClass,
  Notice,
  PREVIEW_MAX_BYTES,
  Stat,
  StatusBadge,
  toBase64,
} from "./shared";

import type { TestRun, TestRunHead } from "../bench";
import type { DocumentType } from "../definition";
import type { FieldCheck, SampleResult } from "../metrics";
import type { ModelChoice } from "../models";
import type { DocReaderState } from "../options";
import type { Sample } from "../studio";
import type { InspectField, InspectPage, InspectStatus } from "./inspector";
import type { DocReaderT } from "./messages";
import type { SearchParams } from "./shared";
import type { AdminI18n } from "@quickben/admin";
import type { QuickbenConfig } from "@quickben/core";
import type { ReactNode } from "react";

/** Most pages rendered in the sample view. */
const MAX_PAGES = 5;

function statusOf(check: FieldCheck): InspectStatus {
  switch (check.outcome ?? null) {
    case "correct":
    case "correct-empty":
      return "correct";
    case "wrong":
      return "wrong";
    case "missed":
      return "missed";
    case "hallucinated":
      return "hallucinated";
    default:
      return check.match === false ? "wrong" : "unchecked";
  }
}

/** The fields of a result as the inspector shows them. */
export function inspectFields(type: DocumentType, result: SampleResult): InspectField[] {
  const threshold = type.pipeline.threshold;
  return result.fields.map((check) => ({
    key: check.key,
    label: check.label,
    scored: check.scored !== false,
    expected: check.expected,
    read: check.read,
    confidence: check.confidence,
    status: statusOf(check),
    low:
      check.read !== null &&
      !isEmptyValue(check.read, type.evaluation.emptyValues) &&
      (check.confidence ?? 0) < threshold,
    evidence: check.evidence ?? null,
    step: check.step ?? null,
  }));
}

/** Wrong reads among the scored fields of a result. */
export function errorCount(result: SampleResult): number {
  return result.fields.filter((check) => {
    const status = statusOf(check);
    return check.scored !== false && status !== "correct" && status !== "unchecked";
  }).length;
}

async function renderPages(
  state: DocReaderState,
  bytes: Uint8Array,
  mime: string,
  pages: readonly number[],
): Promise<InspectPage[]> {
  try {
    const images = await state.rasterize(bytes, mime, pages.slice(0, MAX_PAGES));
    return images.map((image) => ({
      page: image.page,
      src: `data:${image.mime};base64,${toBase64(image.bytes)}`,
    }));
  } catch (error) {
    state.log("sample-pages-failed", { error: String(error) });
    return [];
  }
}

function runLabel(t: DocReaderT, i18n: AdminI18n, run: TestRunHead): string {
  const model = run.variant?.model ?? run.variant?.connectionId;
  return [
    formatWhen(i18n, run.createdAt),
    t("run.version", { version: run.typeVersion }),
    ...(model ? [model] : []),
    t("inspect.samplesInRun", { count: run.total }),
  ].join(" · ");
}

interface ListItem {
  readonly sampleId: string;
  readonly name: string;
  readonly errors: number | null;
  readonly status: SampleResult["status"] | null;
}

function SampleList({
  items,
  current,
  href,
  errorsOnly,
  toggle,
  t,
}: Readonly<{
  items: readonly ListItem[];
  current: string;
  href: (sampleId: string) => string;
  errorsOnly: boolean;
  toggle: string;
  t: DocReaderT;
}>) {
  const shown = errorsOnly ? items.filter((item) => (item.errors ?? 0) > 0) : items;
  return (
    <nav aria-label={t("inspect.list")} className="qb:space-y-2 qb:text-sm">
      <Link href={toggle} className={linkClass} aria-pressed={errorsOnly}>
        {errorsOnly ? t("inspect.showAll") : t("inspect.onlyErrors")}
      </Link>
      <ul className="qb:space-y-1">
        {shown.slice(0, 300).map((item) => (
          <li key={item.sampleId} className="qb:flex qb:items-center qb:gap-2">
            <Link
              href={href(item.sampleId)}
              className={linkClass}
              aria-current={item.sampleId === current ? "page" : undefined}
              style={{
                overflowWrap: "anywhere",
                fontWeight: item.sampleId === current ? 700 : undefined,
              }}
            >
              {item.name}
            </Link>
            {item.errors === null ? null : (
              <Badge tone={item.errors > 0 ? "red" : "green"}>
                {t("inspect.errors", { count: item.errors })}
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function ModelSelect({ models, t }: Readonly<{ models: readonly ModelChoice[]; t: DocReaderT }>) {
  if (models.length === 0) {
    return (
      <Field label={t("inspect.connection")} htmlFor="qb-dr-inspect-connection">
        <Input
          id="qb-dr-inspect-connection"
          name="m.connectionId"
          placeholder={t("inspect.asSaved")}
        />
      </Field>
    );
  }
  return (
    <Field label={t("inspect.model")} htmlFor="qb-dr-inspect-model">
      <Select id="qb-dr-inspect-model" name="m.choice" defaultValue="">
        <option value="">{t("inspect.asSaved")}</option>
        {models.flatMap((choice) =>
          choice.models.map((model) => (
            <option
              key={`${choice.connectionId}|${model.id}`}
              value={`${choice.connectionId}|${model.id}`}
            >
              {choice.connectionName} · {model.label ?? model.id}
            </option>
          )),
        )}
      </Select>
    </Field>
  );
}

async function listItems(
  qb: Awaited<ReturnType<typeof getQuickben>>,
  ctx: Awaited<ReturnType<typeof getRequestContext>>,
  sample: Sample,
  context: TestRun | null,
): Promise<ListItem[]> {
  if (context && context.results.length > 1) {
    return context.results.map((result) => ({
      sampleId: result.sampleId,
      name: result.sampleKey ?? result.fileName,
      errors: result.skipped || result.failed ? null : errorCount(result),
      status: result.status,
    }));
  }
  const samples = await listSamples(qb, ctx, sample.typeKey, sample.split ?? undefined);
  return samples.map((s) => ({
    sampleId: s.id,
    name: s.key ?? s.fileName,
    errors: null,
    status: null,
  }));
}

async function modelChoices(state: DocReaderState): Promise<readonly ModelChoice[]> {
  if (!state.listModels) return [];
  return state.listModels().catch(() => []);
}

type Qb = Awaited<ReturnType<typeof getQuickben>>;
type Ctx = Awaited<ReturnType<typeof getRequestContext>>;

async function loadSample(qb: Qb, ctx: Ctx, typeKey: string, id: string): Promise<Sample | null> {
  try {
    const sample = await getSample(qb, ctx, id);
    return sample.typeKey === typeKey ? sample : null;
  } catch {
    return null;
  }
}

interface Chosen {
  /** The run asked for in the URL. */
  readonly selected: TestRun | null;
  /** The run shown: the one asked for, else the newest that read this sample. */
  readonly run: TestRunHead | null;
  readonly result: SampleResult | null;
  /** A run of many samples, for the list. */
  readonly context: TestRun | null;
}

async function chooseRuns(
  qb: Qb,
  ctx: Ctx,
  input: {
    sampleId: string;
    version: number;
    history: Awaited<ReturnType<typeof listSampleRuns>>;
    runParam: string | undefined;
  },
): Promise<Chosen> {
  const { history } = input;
  const selected = input.runParam
    ? await getTestRun(qb, ctx, input.runParam).catch(() => null)
    : null;
  if (selected) {
    const result = selected.results.find((r) => r.sampleId === input.sampleId) ?? null;
    const context =
      selected.total > 1 ? selected : await contextRun(qb, ctx, history, selected.typeVersion);
    return { selected, run: selected, result, context };
  }
  const pick = history.find((entry) => entry.run.typeVersion === input.version) ?? history[0];
  if (!pick) return { selected: null, run: null, result: null, context: null };
  return {
    selected: null,
    run: pick.run,
    result: pick.result,
    context: await contextRun(qb, ctx, history, pick.run.typeVersion),
  };
}

async function contextRun(
  qb: Qb,
  ctx: Ctx,
  history: Awaited<ReturnType<typeof listSampleRuns>>,
  version: number,
): Promise<TestRun | null> {
  const entry = history.find((e) => e.run.total > 1 && e.run.typeVersion === version);
  return entry ? getTestRun(qb, ctx, entry.run.id) : null;
}

function RunForms({
  adminKey,
  typeKey,
  sample,
  version,
  versions,
  models,
  history,
  current,
  link,
  i18n,
}: Readonly<{
  adminKey: string;
  typeKey: string;
  sample: Sample;
  version: number;
  versions: readonly { version: number; state: string }[];
  models: readonly ModelChoice[];
  history: Awaited<ReturnType<typeof listSampleRuns>>;
  current: string | undefined;
  link: (runId: string) => string;
  i18n: AdminI18n;
}>) {
  const t = docReaderT(i18n);
  const heldOut = sample.split !== null && HELD_OUT_SPLITS.includes(sample.split);
  return (
    <Card>
      <CardHeader title={t("inspect.runTitle")} description={t("inspect.runDescription")} />
      <CardBody className="qb:space-y-4">
        <form
          action={inspectSampleAction.bind(null, adminKey)}
          className="qb:flex qb:flex-wrap qb:items-start qb:gap-4"
        >
          <input type="hidden" name="typeKey" value={typeKey} />
          <input type="hidden" name="sampleId" value={sample.id} />
          <Field label={t("inspect.version")} htmlFor="qb-dr-inspect-version">
            <Select id="qb-dr-inspect-version" name="version" defaultValue={String(version)}>
              {versions.map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version} · {v.state}
                </option>
              ))}
            </Select>
          </Field>
          <ModelSelect models={models} t={t} />
          {heldOut ? (
            <label className="qb:flex qb:items-center qb:gap-2 qb:text-sm">
              <Checkbox name="heldOut" />
              {t("run.heldOut")}
            </label>
          ) : null}
          <AlignedSubmit>
            <Button type="submit">{t("inspect.runNow")}</Button>
          </AlignedSubmit>
        </form>
        <form
          action={inspectUploadAction.bind(null, adminKey)}
          className="qb:flex qb:flex-wrap qb:items-start qb:gap-4 qb:border-t qb:border-line-soft qb:pt-4"
        >
          <input type="hidden" name="typeKey" value={typeKey} />
          <input type="hidden" name="version" value={version} />
          <Field
            label={t("inspect.upload")}
            htmlFor="qb-dr-inspect-file"
            hint={t("inspect.uploadHint")}
          >
            <Input
              id="qb-dr-inspect-file"
              name="file"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
            />
          </Field>
          <AlignedSubmit>
            <Button type="submit" variant="secondary">
              {t("inspect.uploadRun")}
            </Button>
          </AlignedSubmit>
        </form>
        {history.length > 0 ? (
          <nav
            aria-label={t("inspect.history")}
            className="qb:flex qb:flex-wrap qb:gap-3 qb:text-sm"
          >
            {history.slice(0, 10).map((entry) => (
              <Link
                key={entry.run.id}
                href={link(entry.run.id)}
                className={linkClass}
                aria-current={entry.run.id === current ? "page" : undefined}
              >
                {runLabel(t, i18n, entry.run)}
              </Link>
            ))}
          </nav>
        ) : null}
      </CardBody>
    </Card>
  );
}

function Totals({
  result,
  fields,
  running,
  i18n,
}: Readonly<{
  result: SampleResult | null;
  fields: readonly InspectField[];
  running: boolean;
  i18n: AdminI18n;
}>) {
  const t = docReaderT(i18n);
  if (!result) return <Notice>{running ? t("inspect.running") : t("inspect.noRun")}</Notice>;
  const scored = fields.filter((f) => f.scored && f.status !== "unchecked");
  const right = scored.filter((f) => f.status === "correct").length;
  return (
    <div className="qb:grid qb:grid-cols-1 qb:gap-4 qb:sm:grid-cols-2 qb:xl:grid-cols-3">
      <Stat label={t("inspect.right")}>
        {t("run.matchesValue", {
          percent: formatPercent(i18n, scored.length > 0 ? right / scored.length : null),
          matched: right,
          checked: scored.length,
        })}
      </Stat>
      <Stat label={t("inspect.time")}>{formatMs(i18n, result.durationMs)}</Stat>
      <Stat label={t("col.cost")}>{formatUsd(i18n, result.costUsd)}</Stat>
      <Stat label={t("run.tokens")}>
        {t("run.tokensValue", {
          input: formatCount(i18n, result.inputTokens ?? 0),
          cached: formatCount(i18n, result.cachedInputTokens ?? 0),
          output: formatCount(i18n, result.outputTokens ?? 0),
        })}
      </Stat>
      <Stat label={t("inspect.pages")}>{formatCount(i18n, result.pages ?? 0)}</Stat>
      <Stat label={t("col.status")}>
        <StatusBadge status={result.status} i18n={i18n} />
        {result.error ? (
          <span className="qb:text-xs qb:text-danger-strong"> {result.error}</span>
        ) : null}
      </Stat>
    </div>
  );
}

function Notes({ sample, i18n }: Readonly<{ sample: Sample; i18n: AdminI18n }>) {
  const t = docReaderT(i18n);
  if (sample.annotations.length === 0) return null;
  return (
    <Card>
      <CardHeader title={t("inspect.notes")} />
      <CardBody>
        <ul className="qb:space-y-1 qb:text-sm">
          {sample.annotations.map((note) => (
            <li key={note.at}>
              {note.field ? <span className="qb:font-mono">{note.field}: </span> : null}
              {note.text}{" "}
              <span className="qb:text-xs qb:text-fg-muted">
                {note.by ?? EMPTY} · {formatWhen(i18n, note.at)}
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function pickVersion(versions: readonly { version: number; state: string }[], asked: number) {
  if (versions.some((v) => v.version === asked)) return asked;
  return (versions.find((v) => v.state === "draft") ?? versions[0])?.version ?? 1;
}

/** `/document-types/<key>/samples/<id>` */
export async function SamplePage({
  config,
  adminKey,
  basePath,
  typeKey,
  sampleId,
  searchParams,
  i18n,
}: Readonly<{
  config: QuickbenConfig;
  adminKey: string;
  basePath: string;
  typeKey: string;
  sampleId: string;
  searchParams: SearchParams;
  i18n: AdminI18n;
}>): Promise<ReactNode> {
  const t = docReaderT(i18n);
  const qb = await getQuickben(config);
  const ctx = await getRequestContext(config);
  const state = getDocReader(qb);
  const typePath = `${basePath}/document-types/${encodeURIComponent(typeKey)}`;
  const sample = await loadSample(qb, ctx, typeKey, sampleId);
  if (!sample) {
    return (
      <>
        <Heading title={t("inspect.notFound")} />
        <Notice>
          <Link href={`${typePath}?tab=bench`} className={linkClass}>
            {t("studio.back")}
          </Link>
        </Notice>
      </>
    );
  }
  const versions = await listVersions(qb, ctx, typeKey);
  const number = pickVersion(versions, Number(first(searchParams.v)));
  const [history, models] = await Promise.all([
    listSampleRuns(qb, ctx, sampleId),
    modelChoices(state),
  ]);
  const { selected, run, result, context } = await chooseRuns(qb, ctx, {
    sampleId,
    version: number,
    history,
    runParam: first(searchParams.run),
  });
  const runType = (await getVersion(qb, ctx, typeKey, run?.typeVersion ?? number)).definition;

  const errorsOnly = first(searchParams.errors) === "1";
  const pagePath = (id: string, query: Record<string, string>) =>
    `${typePath}/samples/${encodeURIComponent(id)}?${new URLSearchParams({ v: String(number), ...query }).toString()}`;
  const listQuery = {
    ...(context ? { run: context.id } : {}),
    ...(errorsOnly ? { errors: "1" } : {}),
  };
  const here = pagePath(sampleId, run ? { run: run.id } : {});

  const file = await sampleFile(qb, ctx, sampleId).catch(() => null);
  const pages = file ? await renderPages(state, file.bytes, file.mime, runType.pages) : [];
  const fallback =
    file && (sample.size ?? 0) <= PREVIEW_MAX_BYTES ? (
      <FilePreview base64={toBase64(file.bytes)} mime={file.mime} name={file.fileName} />
    ) : (
      <p className="qb:text-sm qb:text-fg-muted">{t("studio.sampleGone")}</p>
    );
  const fields = result ? inspectFields(runType, result) : [];

  return (
    <>
      <p className="qb:mb-3 qb:text-sm">
        <Link href={`${typePath}?v=${String(number)}&tab=bench`} className={linkClass}>
          {t("inspect.back")}
        </Link>
      </p>
      <Heading
        title={sample.key ?? sample.fileName}
        description={
          <>
            <SplitBadge split={sample.split} t={t} />
            {sample.group ? ` · ${sample.group}` : ""}
          </>
        }
      />
      <RunForms
        adminKey={adminKey}
        typeKey={typeKey}
        sample={sample}
        version={number}
        versions={versions}
        models={models}
        history={history}
        current={run?.id}
        link={(runId) => pagePath(sampleId, { run: runId })}
        i18n={i18n}
      />
      <div className="qb:mt-5 qb:space-y-4">
        {selected?.state === "running" ? <AutoRefresh /> : null}
        <Totals
          result={result}
          fields={fields}
          running={selected?.state === "running"}
          i18n={i18n}
        />
        <SampleInspector
          list={
            <SampleList
              items={await listItems(qb, ctx, sample, context)}
              current={sampleId}
              href={(id) => pagePath(id, listQuery)}
              errorsOnly={errorsOnly}
              toggle={pagePath(sampleId, { ...listQuery, errors: errorsOnly ? "0" : "1" })}
              t={t}
            />
          }
          pages={pages}
          fallback={fallback}
          fields={fields}
          hidden={{ typeKey, sampleId, back: here }}
          correct={correctExpectedAction.bind(null, adminKey)}
          annotate={annotateAction.bind(null, adminKey)}
        />
        <Notes sample={sample} i18n={i18n} />
        {run ? (
          <p className="qb:text-xs qb:text-fg-muted">
            {t("inspect.fromRun", { run: runLabel(t, i18n, run) })}
          </p>
        ) : null}
      </div>
    </>
  );
}
