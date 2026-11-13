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
import {
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
import type { SearchParams } from "./shared";
import type { PageProps } from "@quickben/admin";
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

function typeText(reading: Reading): string {
  if (reading.type) return `${reading.type.key} v${String(reading.type.version)}`;
  return reading.requestedType === "auto" ? "auto (not recognized)" : reading.requestedType;
}

function TryForm({
  types,
  action,
}: Readonly<{ types: readonly { key: string; label: string }[]; action: Action }>) {
  return (
    <Card className="qb:mt-5">
      <CardHeader
        title="Read a document"
        description="Try a published type on a file. The reading is billed like any other."
      />
      <CardBody>
        <form action={action} className="qb:flex qb:flex-wrap qb:items-end qb:gap-4">
          <Field label="Type" htmlFor="qb-dr-try-type">
            <Select id="qb-dr-try-type" name="type" defaultValue="auto">
              <option value="auto">Recognize it (auto)</option>
              {types.map((type) => (
                <option key={type.key} value={type.key}>
                  {type.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="File" htmlFor="qb-dr-try-file">
            <Input
              id="qb-dr-try-file"
              name="file"
              type="file"
              required
              accept="application/pdf,image/jpeg,image/png,image/webp"
            />
          </Field>
          <Button type="submit">Read</Button>
        </form>
      </CardBody>
    </Card>
  );
}

function Filters({
  params,
  basePath,
  staff,
}: Readonly<{ params: SearchParams; basePath: string; staff: boolean }>) {
  const value = (name: string) => first(params[name]) ?? "";
  return (
    <form method="get" className="qb:mb-6 qb:flex qb:flex-wrap qb:items-end qb:gap-3">
      <Field label="State" htmlFor="qb-dr-state">
        <Select id="qb-dr-state" name="state" defaultValue={value("state")}>
          <option value="">All</option>
          {JOB_STATES.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Type" htmlFor="qb-dr-type">
        <Input
          id="qb-dr-type"
          name="type"
          defaultValue={value("type")}
          placeholder="invoice"
          style={{ width: "9rem" }}
        />
      </Field>
      {staff ? (
        <>
          <Field label="Tenant" htmlFor="qb-dr-tenant-filter">
            <Input
              id="qb-dr-tenant-filter"
              name="tenant"
              defaultValue={value("tenant")}
              style={{ width: "10rem" }}
            />
          </Field>
          <Field label="Requested by" htmlFor="qb-dr-actor">
            <Input
              id="qb-dr-actor"
              name="actor"
              defaultValue={value("actor")}
              placeholder="Part of an email"
              style={{ width: "12rem" }}
            />
          </Field>
        </>
      ) : null}
      <Field label="From" htmlFor="qb-dr-from">
        <Input id="qb-dr-from" name="from" type="date" defaultValue={value("from")} />
      </Field>
      <Field label="To" htmlFor="qb-dr-to">
        <Input id="qb-dr-to" name="to" type="date" defaultValue={value("to")} />
      </Field>
      <Button type="submit" variant="secondary">
        Filter
      </Button>
      <ButtonLink href={`${basePath}/document-queue`} variant="ghost">
        Clear
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
}: Readonly<{
  qb: Quickben;
  ctx: RequestContext;
  params: SearchParams;
  basePath: string;
  staff: boolean;
  tryAction: Action;
}>) {
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
        title="Document readings"
        description={staff ? "Every reading, newest first." : "Your readings, newest first."}
      />
      <Filters params={params} basePath={basePath} staff={staff} />
      {active ? <AutoRefresh every={3000} /> : null}
      <Card>
        {result.readings.length === 0 ? (
          <CardBody>
            <p className="qb:text-sm qb:text-zinc-600">No readings match.</p>
          </CardBody>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Document</Th>
                <Th>Type</Th>
                <Th>State</Th>
                <Th>Result</Th>
                {staff ? <Th>Tenant</Th> : null}
                {staff ? <Th>Requested by</Th> : null}
                <Th>Cost</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {result.readings.map((reading) => (
                <Tr key={reading.id}>
                  <Td>
                    <Link href={`${basePath}/document-queue/${reading.id}`} className={linkClass}>
                      {reading.fileName ?? "Document"}
                    </Link>
                  </Td>
                  <Td className="qb:font-mono qb:text-xs">{typeText(reading)}</Td>
                  <Td>
                    <StateBadge state={reading.state} />
                  </Td>
                  <Td>
                    <StatusBadge status={reading.status} />
                  </Td>
                  {staff ? (
                    <Td className="qb:text-xs qb:font-mono">{reading.tenant ?? "—"}</Td>
                  ) : null}
                  {staff ? (
                    <Td className="qb:text-sm">
                      {reading.actor.email ?? reading.actor.userId ?? "—"}
                    </Td>
                  ) : null}
                  <Td className="qb:tabular-nums">{formatUsd(reading.costUsd)}</Td>
                  <Td className="qb:whitespace-nowrap qb:text-sm">
                    {formatWhen(reading.createdAt)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {result.totalPages > 1 ? (
        <nav aria-label="Pages" className="qb:mt-5 qb:flex qb:items-center qb:gap-3 qb:text-sm">
          {page > 1 ? (
            <ButtonLink href={pageHref(basePath, params, page - 1)} variant="secondary" size="sm">
              Previous
            </ButtonLink>
          ) : null}
          <span className="qb:text-zinc-500">
            Page {page} of {result.totalPages} · {result.totalDocs} readings
          </span>
          {page < result.totalPages ? (
            <ButtonLink href={pageHref(basePath, params, page + 1)} variant="secondary" size="sm">
              Next
            </ButtonLink>
          ) : null}
        </nav>
      ) : null}
      {staff ? (
        <TryForm
          types={types.map((type) => ({ key: type.key, label: type.label }))}
          action={tryAction}
        />
      ) : null}
    </>
  );
}

function evidenceText(field: Reading["fields"][string]): string {
  const evidence = field.evidence;
  if (!evidence) return "—";
  const page = `Page ${String(evidence.page)}`;
  return evidence.text ? `${page}: ${evidence.text}` : page;
}

function FieldsCard({ reading }: Readonly<{ reading: Reading }>) {
  const entries = Object.entries(reading.fields);
  return (
    <Card>
      <CardHeader
        title="Fields read"
        description={
          reading.missing.length > 0 ? `Missing: ${reading.missing.join(", ")}` : undefined
        }
      />
      {entries.length === 0 ? (
        <CardBody>
          <p className="qb:text-sm qb:text-zinc-500">Nothing was read.</p>
        </CardBody>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Field</Th>
              <Th>Value</Th>
              <Th>Confidence</Th>
              <Th>Evidence</Th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, field]) => (
              <Tr key={key}>
                <Td className="qb:font-mono qb:text-xs">{key}</Td>
                <Td className="qb:font-medium qb:text-zinc-900">{field.value}</Td>
                <Td className="qb:tabular-nums">{formatPercent(field.confidence)}</Td>
                <Td className="qb:text-xs qb:text-zinc-500">{evidenceText(field)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function AttemptsCard({ reading }: Readonly<{ reading: Reading }>) {
  return (
    <Card>
      <CardHeader
        title="Attempts"
        description="Each step of the type's pipeline that ran, in order."
      />
      {reading.attempts.length === 0 ? (
        <CardBody>
          <p className="qb:text-sm qb:text-zinc-500">No step ran.</p>
        </CardBody>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Step</Th>
              <Th>Status</Th>
              <Th>Fields</Th>
              <Th>Time</Th>
              <Th>Model</Th>
              <Th>Cost</Th>
              <Th>Problems</Th>
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
                  <StatusBadge status={attempt.status} />
                </Td>
                <Td className="qb:tabular-nums">{Object.keys(attempt.fields).length}</Td>
                <Td className="qb:tabular-nums">{formatMs(attempt.durationMs)}</Td>
                <Td className="qb:text-xs">
                  {attempt.usage
                    ? `${attempt.usage.model} · ${String(attempt.usage.pages)} p · ${String(attempt.usage.inputTokens)}/${String(attempt.usage.outputTokens)} tok`
                    : "—"}
                </Td>
                <Td className="qb:tabular-nums">
                  {attempt.usage ? formatUsd(attempt.usage.costUsd) : "—"}
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

async function previewOf(qb: Quickben, ctx: RequestContext, reading: Reading): Promise<ReactNode> {
  if ((reading.size ?? 0) > PREVIEW_MAX_BYTES)
    return <p className="qb:text-sm qb:text-zinc-500">The file is too large to preview.</p>;
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
    return <p className="qb:text-sm qb:text-red-700">The file of this reading is gone.</p>;
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
}: Readonly<{
  qb: Quickben;
  ctx: RequestContext;
  id: string;
  basePath: string;
  staff: boolean;
  retry: Action;
  cancel: Action;
}>) {
  let reading: Reading;
  try {
    reading = await getReading(qb, id, ctx);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    return (
      <>
        <Heading title="Reading not found" />
        <Notice>That reading does not exist or you cannot see it.</Notice>
      </>
    );
  }
  const live: JobState[] = ["queued", "running"];
  const running = live.includes(reading.state);
  return (
    <>
      <p className="qb:mb-3 qb:text-sm">
        <Link href={`${basePath}/document-queue`} className={linkClass}>
          ← Document readings
        </Link>
      </p>
      <Heading
        title={reading.fileName ?? "Document"}
        description={typeText(reading)}
        actions={
          staff ? (
            <>
              {running ? (
                <form action={cancel}>
                  <input type="hidden" name="id" value={reading.id} />
                  <Button type="submit" variant="danger">
                    Cancel
                  </Button>
                </form>
              ) : (
                <form action={retry}>
                  <input type="hidden" name="id" value={reading.id} />
                  <Button type="submit" variant="secondary">
                    Retry
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
              <Stat label="State">
                <StateBadge state={reading.state} /> <StatusBadge status={reading.status} />
              </Stat>
              <Stat label="Tenant">{reading.tenant ?? "—"}</Stat>
              <Stat label="Requested by">{reading.actor.email ?? reading.actor.userId ?? "—"}</Stat>
              <Stat label="Created">{formatWhen(reading.createdAt)}</Stat>
              <Stat label="Duration">{formatMs(reading.durationMs)}</Stat>
              <Stat label="Cost">{formatUsd(reading.costUsd)}</Stat>
              <Stat label="Runs">{reading.runs}</Stat>
            </div>
            {reading.error ? (
              <p className="qb:mt-5 qb:text-sm qb:text-red-700">{reading.error}</p>
            ) : null}
          </CardBody>
        </Card>
        <FieldsCard reading={reading} />
        <AttemptsCard reading={reading} />
        <Card>
          <CardHeader
            title="Document"
            description="Values read on the first page of an image are highlighted."
          />
          <CardBody>{await previewOf(qb, ctx, reading)}</CardBody>
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
  }: Readonly<PageProps>) {
    const qb = await getQuickben(config);
    const ctx = await getRequestContext(config);
    const params = searchParams;
    if (!ctx.user) {
      return (
        <>
          <Heading title="Document readings" />
          <Notice>Sign in to see document readings.</Notice>
        </>
      );
    }
    const staff = getDocReader(qb).isStaff(ctx.user);
    const [id] = segments;
    return (
      <>
        {id
          ? await ReadingDetail({ qb, ctx, id, basePath, staff, retry, cancel })
          : await QueueList({ qb, ctx, params, basePath, staff, tryAction })}
        <Feedback searchParams={params} />
      </>
    );
  };
}
