import {
  Button,
  ButtonLink,
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
import { getQuickben, NotFoundError } from "@quickben/core";
import { getRequestContext } from "@quickben/next";
import Link from "next/link";

import { JOB_STATES } from "../collections";
import { getDocReader } from "../options";
import { getReading, listReadings, readingFile } from "../readings";
import { newestPublished } from "../store";

import { cancelReadingAction, retryReadingAction, tryReadingAction } from "./actions";
import { AutoRefresh, FilePreview } from "./client";
import { docReaderT, stateLabel } from "./messages";
import {
  EMPTY,
  Feedback,
  Field,
  first,
  formatMs,
  formatPercent,
  formatUsd,
  formatWhen,
  Heading,
  linkClass,
  Notice,
  PREVIEW_MAX_BYTES,
  StateBadge,
  Stat,
  StatusBadge,
  toBase64,
} from "./shared";

import type { JobState } from "../collections";
import type { Reading, ReadingFilters } from "../readings";
import type { PreviewBox } from "./client";
import type { DocReaderT } from "./messages";
import type { SearchParams } from "./shared";
import type { AdminI18n, PageProps } from "@quickben/admin";
import type { Quickben, QuickbenConfig, RequestContext } from "@quickben/core";
import type { ReactNode } from "react";

type Action = (formData: FormData) => Promise<void>;

const PAGE_SIZE = 25;

function filtersOf(params: SearchParams): ReadingFilters {
  const state = first(params.state);
  const date = (value: string | undefined) =>
    value && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : undefined;
  const to = date(first(params.to));
  const filters: Record<string, string> = {};
  if (state && (JOB_STATES as readonly string[]).includes(state)) filters.state = state;
  for (const name of ["type", "tenant", "actor"] as const) {
    const value = first(params[name])?.trim();
    if (value) filters[name] = value.slice(0, 200);
  }
  const from = date(first(params.from));
  if (from) filters.from = from;
  // `to` is inclusive in the form: readings before the next day.
  if (to) filters.to = new Date(Date.parse(to) + 86_400_000).toISOString().slice(0, 10);
  return filters;
}

function typeText(t: DocReaderT, reading: Reading): string {
  if (reading.type) return `${reading.type.key} v${String(reading.type.version)}`;
  return reading.requestedType === "auto" ? t("queue.autoUnrecognized") : reading.requestedType;
}

function TryForm({
  types,
  action,
  t,
}: Readonly<{ types: readonly { key: string; label: string }[]; action: Action; t: DocReaderT }>) {
  return (
    <Card className="qb:mt-5">
      <CardHeader title={t("try.title")} description={t("try.description")} />
      <CardBody>
        <form action={action} className="qb:flex qb:flex-wrap qb:items-end qb:gap-4">
          <Field label={t("try.type")} htmlFor="qb-dr-try-type">
            <Select id="qb-dr-try-type" name="type" defaultValue="auto">
              <option value="auto">{t("try.auto")}</option>
              {types.map((type) => (
                <option key={type.key} value={type.key}>
                  {type.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("try.file")} htmlFor="qb-dr-try-file">
            <Input
              id="qb-dr-try-file"
              name="file"
              type="file"
              required
              accept="application/pdf,image/jpeg,image/png,image/webp"
            />
          </Field>
          <Button type="submit">{t("try.submit")}</Button>
        </form>
      </CardBody>
    </Card>
  );
}

function Filters({
  params,
  basePath,
  staff,
  t,
}: Readonly<{ params: SearchParams; basePath: string; staff: boolean; t: DocReaderT }>) {
  const value = (name: string) => first(params[name]) ?? "";
  return (
    <form method="get" className="qb:mb-6 qb:flex qb:flex-wrap qb:items-end qb:gap-3">
      <Field label={t("filter.state")} htmlFor="qb-dr-state">
        <Select id="qb-dr-state" name="state" defaultValue={value("state")}>
          <option value="">{t("filter.all")}</option>
          {JOB_STATES.map((state) => (
            <option key={state} value={state}>
              {stateLabel(t, state)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("filter.type")} htmlFor="qb-dr-type">
        <Input
          id="qb-dr-type"
          name="type"
          defaultValue={value("type")}
          placeholder={t("filter.typePlaceholder")}
          style={{ width: "9rem" }}
        />
      </Field>
      {staff ? (
        <>
          <Field label={t("filter.tenant")} htmlFor="qb-dr-tenant-filter">
            <Input
              id="qb-dr-tenant-filter"
              name="tenant"
              defaultValue={value("tenant")}
              style={{ width: "10rem" }}
            />
          </Field>
          <Field label={t("filter.actor")} htmlFor="qb-dr-actor">
            <Input
              id="qb-dr-actor"
              name="actor"
              defaultValue={value("actor")}
              placeholder={t("filter.actorPlaceholder")}
              style={{ width: "12rem" }}
            />
          </Field>
        </>
      ) : null}
      <Field label={t("filter.from")} htmlFor="qb-dr-from">
        <Input id="qb-dr-from" name="from" type="date" defaultValue={value("from")} />
      </Field>
      <Field label={t("filter.to")} htmlFor="qb-dr-to">
        <Input id="qb-dr-to" name="to" type="date" defaultValue={value("to")} />
      </Field>
      <Button type="submit" variant="secondary">
        {t("filter.submit")}
      </Button>
      <ButtonLink href={`${basePath}/document-queue`} variant="ghost">
        {t("filter.clear")}
      </ButtonLink>
    </form>
  );
}

function pageHref(basePath: string, params: SearchParams, page: number): string {
  const query = new URLSearchParams();
  for (const name of ["state", "type", "tenant", "actor", "from", "to"]) {
    const value = first(params[name]);
    if (value) query.set(name, value);
  }
  query.set("page", String(page));
  return `${basePath}/document-queue?${query.toString()}`;
}

async function QueueList({
  qb,
  ctx,
  params,
  basePath,
  staff,
  tryAction,
  i18n,
}: Readonly<{
  qb: Quickben;
  ctx: RequestContext;
  params: SearchParams;
  basePath: string;
  staff: boolean;
  tryAction: Action;
  i18n: AdminI18n;
}>) {
  const t = docReaderT(i18n);
  const page = Math.max(1, Number(first(params.page)) || 1);
  const [result, types] = await Promise.all([
    listReadings(qb, filtersOf(params), ctx, { limit: PAGE_SIZE, page }),
    newestPublished(qb),
  ]);
  const active = result.readings.some(
    (reading) => reading.state === "queued" || reading.state === "running",
  );
  return (
    <>
      <Heading
        title={t("queue.title")}
        description={staff ? t("queue.descriptionStaff") : t("queue.descriptionOwn")}
      />
      <Filters params={params} basePath={basePath} staff={staff} t={t} />
      {active ? <AutoRefresh every={3000} /> : null}
      <Card>
        {result.readings.length === 0 ? (
          <CardBody>
            <p className="qb:text-sm qb:text-fg-muted">{t("queue.empty")}</p>
          </CardBody>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("col.document")}</Th>
                <Th>{t("col.type")}</Th>
                <Th>{t("col.state")}</Th>
                <Th>{t("col.result")}</Th>
                {staff ? <Th>{t("col.tenant")}</Th> : null}
                {staff ? <Th>{t("col.requestedBy")}</Th> : null}
                <Th>{t("col.cost")}</Th>
                <Th>{t("col.created")}</Th>
              </tr>
            </thead>
            <tbody>
              {result.readings.map((reading) => (
                <Tr key={reading.id}>
                  <Td>
                    <Link href={`${basePath}/document-queue/${reading.id}`} className={linkClass}>
                      {reading.fileName ?? t("queue.fileFallback")}
                    </Link>
                  </Td>
                  <Td className="qb:font-mono qb:text-xs">{typeText(t, reading)}</Td>
                  <Td>
                    <StateBadge state={reading.state} i18n={i18n} />
                  </Td>
                  <Td>
                    <StatusBadge status={reading.status} i18n={i18n} />
                  </Td>
                  {staff ? (
                    <Td className="qb:text-xs qb:font-mono">{reading.tenant ?? EMPTY}</Td>
                  ) : null}
                  {staff ? (
                    <Td className="qb:text-sm">
                      {reading.actor.email ?? reading.actor.userId ?? EMPTY}
                    </Td>
                  ) : null}
                  <Td className="qb:tabular-nums">{formatUsd(i18n, reading.costUsd)}</Td>
                  <Td className="qb:whitespace-nowrap qb:text-sm">
                    <time dateTime={reading.createdAt} title={formatWhen(i18n, reading.createdAt)}>
                      {i18n.relativeTime(reading.createdAt)}
                    </time>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {result.totalPages > 1 ? (
        <nav
          aria-label={t("queue.pagination")}
          className="qb:mt-5 qb:flex qb:items-center qb:gap-3 qb:text-sm"
        >
          {page > 1 ? (
            <ButtonLink href={pageHref(basePath, params, page - 1)} variant="secondary" size="sm">
              {t("queue.previous")}
            </ButtonLink>
          ) : null}
          <span className="qb:text-fg-muted">
            {t("queue.page", { page, pages: result.totalPages, count: result.totalDocs })}
          </span>
          {page < result.totalPages ? (
            <ButtonLink href={pageHref(basePath, params, page + 1)} variant="secondary" size="sm">
              {t("queue.next")}
            </ButtonLink>
          ) : null}
        </nav>
      ) : null}
      {staff ? (
        <TryForm
          types={types.map((type) => ({ key: type.key, label: type.label }))}
          action={tryAction}
          t={t}
        />
      ) : null}
    </>
  );
}

function evidenceText(t: DocReaderT, field: Reading["fields"][string]): string {
  const evidence = field.evidence;
  if (!evidence) return EMPTY;
  return evidence.text
    ? t("reading.evidenceText", { page: evidence.page, text: evidence.text })
    : t("reading.evidencePage", { page: evidence.page });
}

function FieldsCard({ reading, i18n }: Readonly<{ reading: Reading; i18n: AdminI18n }>) {
  const t = docReaderT(i18n);
  const entries = Object.entries(reading.fields);
  return (
    <Card>
      <CardHeader
        title={t("reading.fieldsTitle")}
        description={
          reading.missing.length > 0
            ? t("reading.missing", { fields: i18n.list(reading.missing) })
            : undefined
        }
      />
      {entries.length === 0 ? (
        <CardBody>
          <p className="qb:text-sm qb:text-fg-muted">{t("reading.nothingRead")}</p>
        </CardBody>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("col.field")}</Th>
              <Th>{t("col.value")}</Th>
              <Th>{t("col.confidence")}</Th>
              <Th>{t("col.evidence")}</Th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, field]) => (
              <Tr key={key}>
                <Td className="qb:font-mono qb:text-xs">{key}</Td>
                <Td className="qb:font-medium qb:text-fg">{field.value}</Td>
                <Td className="qb:tabular-nums">{formatPercent(i18n, field.confidence)}</Td>
                <Td className="qb:text-xs qb:text-fg-muted">{evidenceText(t, field)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function AttemptsCard({ reading, i18n }: Readonly<{ reading: Reading; i18n: AdminI18n }>) {
  const t = docReaderT(i18n);
  return (
    <Card>
      <CardHeader
        title={t("reading.attemptsTitle")}
        description={t("reading.attemptsDescription")}
      />
      {reading.attempts.length === 0 ? (
        <CardBody>
          <p className="qb:text-sm qb:text-fg-muted">{t("reading.noAttempts")}</p>
        </CardBody>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("col.step")}</Th>
              <Th>{t("col.status")}</Th>
              <Th>{t("col.fields")}</Th>
              <Th>{t("col.time")}</Th>
              <Th>{t("col.model")}</Th>
              <Th>{t("col.cost")}</Th>
              <Th>{t("col.problems")}</Th>
            </tr>
          </thead>
          <tbody>
            {reading.attempts.map((attempt) => (
              <Tr key={attempt.step}>
                <Td>
                  {attempt.step + 1}.{" "}
                  <span className="qb:font-mono qb:text-xs">{attempt.extractor}</span>
                </Td>
                <Td>
                  <StatusBadge status={attempt.status} i18n={i18n} />
                </Td>
                <Td className="qb:tabular-nums">
                  {i18n.number(Object.keys(attempt.fields).length)}
                </Td>
                <Td className="qb:tabular-nums">{formatMs(i18n, attempt.durationMs)}</Td>
                <Td className="qb:text-xs">
                  {attempt.usage
                    ? t("reading.usage", {
                        model: attempt.usage.model,
                        pages: attempt.usage.pages,
                        input: attempt.usage.inputTokens,
                        output: attempt.usage.outputTokens,
                      })
                    : EMPTY}
                </Td>
                <Td className="qb:tabular-nums">
                  {attempt.usage ? formatUsd(i18n, attempt.usage.costUsd) : EMPTY}
                </Td>
                <Td className="qb:font-mono qb:text-xs qb:break-all">
                  {attempt.problems ? JSON.stringify(attempt.problems) : ""}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

async function previewOf(
  qb: Quickben,
  ctx: RequestContext,
  reading: Reading,
  t: DocReaderT,
): Promise<ReactNode> {
  if ((reading.size ?? 0) > PREVIEW_MAX_BYTES)
    return <p className="qb:text-sm qb:text-fg-muted">{t("preview.tooLarge")}</p>;
  try {
    const file = await readingFile(qb, reading.id, ctx);
    const boxes: PreviewBox[] = Object.entries(reading.fields).flatMap(([key, field]) =>
      field.evidence?.box && field.evidence.page === 1
        ? [{ label: `${key}: ${field.value}`, ...field.evidence.box }]
        : [],
    );
    return (
      <FilePreview
        base64={toBase64(file.bytes)}
        mime={file.mime}
        name={file.fileName}
        boxes={boxes}
      />
    );
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    return <p className="qb:text-sm qb:text-danger-strong">{t("reading.fileGone")}</p>;
  }
}

async function ReadingDetail({
  qb,
  ctx,
  id,
  basePath,
  staff,
  retry,
  cancel,
  i18n,
}: Readonly<{
  qb: Quickben;
  ctx: RequestContext;
  id: string;
  basePath: string;
  staff: boolean;
  retry: Action;
  cancel: Action;
  i18n: AdminI18n;
}>) {
  const t = docReaderT(i18n);
  let reading: Reading;
  try {
    reading = await getReading(qb, id, ctx);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    return (
      <>
        <Heading title={t("reading.notFound")} />
        <Notice>{t("reading.notFoundBody")}</Notice>
      </>
    );
  }
  const live: JobState[] = ["queued", "running"];
  const running = live.includes(reading.state);
  return (
    <>
      <p className="qb:mb-3 qb:text-sm">
        <Link href={`${basePath}/document-queue`} className={linkClass}>
          {t("reading.back")}
        </Link>
      </p>
      <Heading
        title={reading.fileName ?? t("queue.fileFallback")}
        description={typeText(t, reading)}
        actions={
          staff ? (
            <>
              {running ? (
                <form action={cancel}>
                  <input type="hidden" name="id" value={reading.id} />
                  <Button type="submit" variant="danger">
                    {t("reading.cancel")}
                  </Button>
                </form>
              ) : (
                <form action={retry}>
                  <input type="hidden" name="id" value={reading.id} />
                  <Button type="submit" variant="secondary">
                    {t("reading.retry")}
                  </Button>
                </form>
              )}
            </>
          ) : null
        }
      />
      {running ? <AutoRefresh /> : null}
      <div className="qb:space-y-4">
        <Card>
          <CardBody>
            <div className="qb:grid qb:grid-cols-1 qb:gap-4 qb:sm:grid-cols-2 qb:2xl:grid-cols-4">
              <Stat label={t("col.state")}>
                <StateBadge state={reading.state} i18n={i18n} />{" "}
                <StatusBadge status={reading.status} i18n={i18n} />
              </Stat>
              <Stat label={t("col.tenant")}>{reading.tenant ?? EMPTY}</Stat>
              <Stat label={t("col.requestedBy")}>
                {reading.actor.email ?? reading.actor.userId ?? EMPTY}
              </Stat>
              <Stat label={t("col.created")}>{formatWhen(i18n, reading.createdAt)}</Stat>
              <Stat label={t("reading.duration")}>{formatMs(i18n, reading.durationMs)}</Stat>
              <Stat label={t("col.cost")}>{formatUsd(i18n, reading.costUsd)}</Stat>
              <Stat label={t("reading.runs")}>{i18n.number(reading.runs)}</Stat>
            </div>
            {reading.error ? (
              <p className="qb:mt-5 qb:text-sm qb:text-danger-strong">{reading.error}</p>
            ) : null}
          </CardBody>
        </Card>
        <FieldsCard reading={reading} i18n={i18n} />
        <AttemptsCard reading={reading} i18n={i18n} />
        <Card>
          <CardHeader
            title={t("reading.documentTitle")}
            description={t("reading.documentDescription")}
          />
          <CardBody>{await previewOf(qb, ctx, reading, t)}</CardBody>
        </Card>
      </div>
    </>
  );
}

/** Build the Readings page: the queue with filters, and one reading at `/<id>`. */
export function createQueuePage(config: QuickbenConfig, key: string) {
  const retry = retryReadingAction.bind(null, key);
  const cancel = cancelReadingAction.bind(null, key);
  const tryAction = tryReadingAction.bind(null, key);

  return async function DocumentQueuePage({
    segments,
    searchParams,
    basePath,
    i18n,
  }: Readonly<PageProps>) {
    const t = docReaderT(i18n);
    const qb = await getQuickben(config);
    const ctx = await getRequestContext(config);
    const params = searchParams;
    if (!ctx.user) {
      return (
        <>
          <Heading title={t("queue.title")} />
          <Notice>{t("queue.signIn")}</Notice>
        </>
      );
    }
    const staff = getDocReader(qb).isStaff(ctx.user);
    const [id] = segments;
    return (
      <>
        {id
          ? await ReadingDetail({ qb, ctx, id, basePath, staff, retry, cancel, i18n })
          : await QueueList({ qb, ctx, params, basePath, staff, tryAction, i18n })}
        <Feedback searchParams={params} i18n={i18n} />
      </>
    );
  };
}
