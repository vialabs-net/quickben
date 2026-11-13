/**
 * Readings: one document read with one type. `doc-jobs` keeps the record (state, result,
 * attempts, cost); the runner only carries `(jobId, run)` to a worker.
 *
 * A run claims its job by moving it `queued` → `running` for its queue version, and finishes it
 * only while it is still `running` for that version, so a job cancelled or retried mid-run keeps
 * the newer state.
 */
import { NotFoundError, ValidationError } from "@quickben/core";

import { classifyType } from "./classify";
import { DOC_JOBS } from "./collections";
import { paramsSchema, TYPE_KEY } from "./definition";
import { PDF, pdfPagesText } from "./extractors/text-layer";
import { ACCEPTED_MIMES } from "./files";
import { getDocReader } from "./options";
import { attemptsCost, runPipeline } from "./pipeline";
import { recordUsage, skipHook } from "./quotas";
import { findPublished, newestPublished, SYSTEM } from "./store";

import type { JobState } from "./collections";
import type { DocumentType, ExtractionParams } from "./definition";
import type { ExtractionStatus, FieldValue } from "./extractor";
import type { DocReaderState } from "./options";
import type { PipelineAttempt } from "./pipeline";
import type { JobRecord } from "./records";
import type { Quickben, RequestContext } from "@quickben/core";

/** A file to read: a `File`/`Blob`, or bytes with a name. */
export type DocumentFile = Blob | { readonly bytes: Uint8Array; readonly name?: string };

export interface ReadDocumentInput {
  /** A published type key, or `"auto"` to pick one by its classification hints. */
  readonly type: string;
  /** A published version. Default: the newest. */
  readonly version?: number;
  readonly file: DocumentFile;
  /** Values for the type's parameters. */
  readonly params?: ExtractionParams;
  /**
   * Wait for the result: milliseconds, or `true` for the longest wait allowed (`maxWaitMs`).
   * Default: return at once with the queued reading.
   */
  readonly wait?: number | boolean;
  /** Who the reading is billed to. Default: the organization when tenancy scopes `doc-jobs`. */
  readonly tenant?: string;
}

/** A reading as the API returns it. */
export interface Reading {
  readonly id: string;
  readonly state: JobState;
  /** Set once the reading is done. */
  readonly status: ExtractionStatus | null;
  readonly requestedType: string;
  /** The type that read it; `null` until known (`auto`) or when none matched. */
  readonly type: { readonly key: string; readonly version: number } | null;
  readonly fields: Record<string, FieldValue>;
  /** Required fields not read at the threshold. */
  readonly missing: string[];
  readonly attempts: PipelineAttempt[];
  readonly error: string | null;
  readonly costUsd: number;
  readonly durationMs: number | null;
  readonly runs: number;
  readonly fileName: string | null;
  readonly mime: string;
  readonly size: number | null;
  readonly tenant: string | null;
  readonly actor: {
    readonly userId: string | null;
    readonly email: string | null;
    readonly name: string | null;
  };
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

const TERMINAL: ReadonlySet<JobState> = new Set(["done", "failed", "cancelled"]);
const POLL_MS = 200;

/** The tenant a job is billed to. */
export function tenantOf(job: Pick<JobRecord, "tenant" | "organization">): string | null {
  return job.tenant ?? job.organization ?? null;
}

export function toReading(job: JobRecord): Reading {
  return {
    id: job.id,
    state: job.state,
    status: job.status,
    requestedType: job.requestedType,
    type:
      job.typeKey !== null && job.typeVersion !== null
        ? { key: job.typeKey, version: job.typeVersion }
        : null,
    fields: job.result?.fields ?? {},
    missing: job.result?.missing ?? [],
    attempts: job.attempts,
    error: job.error,
    costUsd: job.costUsd,
    durationMs: job.durationMs,
    runs: job.runs,
    fileName: job.fileName,
    mime: job.mime,
    size: job.size,
    tenant: tenantOf(job),
    actor: { userId: job.actorUserId, email: job.actorEmail, name: job.actorName },
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

/** The file type from its first bytes. The declared type is not trusted. */
export function sniffMime(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCodePoint(...bytes.subarray(from, to));
  if (ascii(0, 5) === "%PDF-") return PDF;
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Bytes, name and type of an uploaded file, checked against the plugin's limits. */
export async function readUpload(
  state: Pick<DocReaderState, "maxFileBytes">,
  file: DocumentFile,
): Promise<{ bytes: Uint8Array; name: string | null; mime: string }> {
  const bytes = file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : file.bytes;
  const name =
    "name" in file && typeof file.name === "string" && file.name ? file.name.slice(0, 255) : null;
  if (bytes.byteLength === 0) {
    throw new ValidationError([{ path: "file", message: "The file is empty" }]);
  }
  if (bytes.byteLength > state.maxFileBytes) {
    throw new ValidationError([
      {
        path: "file",
        message: `The file is larger than ${String(Math.floor(state.maxFileBytes / 1024 / 1024))} MB`,
      },
    ]);
  }
  const mime = sniffMime(bytes);
  if (!mime) {
    throw new ValidationError([{ path: "file", message: "Upload a PDF, JPEG, PNG or WebP file" }]);
  }
  return { bytes, name, mime };
}

export function parseParams(params: unknown): ExtractionParams {
  const parsed = paramsSchema.safeParse(params ?? {});
  if (!parsed.success) {
    throw new ValidationError([
      { path: "params", message: "Parameters are strings or lists of strings" },
    ]);
  }
  return parsed.data;
}

export function storageRef(folder: string, mime: string): string {
  return `${folder}/${globalThis.crypto.randomUUID()}${ACCEPTED_MIMES[mime] ?? ""}`;
}

async function loadJob(qb: Quickben, id: string, ctx: RequestContext): Promise<JobRecord> {
  return (await qb.findById(DOC_JOBS, id, {}, ctx)) as unknown as JobRecord;
}

async function waitFor(
  qb: Quickben,
  id: string,
  ctx: RequestContext,
  ms: number,
): Promise<JobRecord> {
  const deadline = Date.now() + ms;
  let job = await loadJob(qb, id, ctx);
  while (!TERMINAL.has(job.state) && Date.now() < deadline) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(POLL_MS, Math.max(0, deadline - Date.now()))),
    );
    job = await loadJob(qb, id, ctx);
  }
  return job;
}

function waitMs(state: DocReaderState, wait: ReadDocumentInput["wait"]): number {
  if (wait === true) return state.maxWaitMs;
  if (typeof wait !== "number" || !Number.isFinite(wait) || wait <= 0) return 0;
  return Math.min(wait, state.maxWaitMs);
}

/**
 * Read a document. Returns the reading at once (state `queued`), or, with `wait`, once it ends
 * or the wait is over. Access rules of `doc-jobs` apply: by default any signed-in user may read
 * documents and see their own readings.
 */
export async function readDocument(
  qb: Quickben,
  input: ReadDocumentInput,
  ctx: RequestContext,
): Promise<Reading> {
  const state = getDocReader(qb);
  const type = input.type.trim();
  if (type !== "auto") {
    if (!TYPE_KEY.test(type) || !(await findPublished(qb, type, input.version))) {
      const version = input.version === undefined ? "" : `@${String(input.version)}`;
      throw new ValidationError([
        { path: "type", message: `Unknown document type ${type}${version}` },
      ]);
    }
  }
  const params = parseParams(input.params);
  const upload = await readUpload(state, input.file);
  const fileRef = storageRef("readings", upload.mime);
  await state.files.write(fileRef, upload.bytes, upload.mime);

  const created = qb.create(
    DOC_JOBS,
    {
      requestedType: type,
      typeKey: type === "auto" ? null : type,
      typeVersion: type === "auto" ? null : (input.version ?? null),
      fileRef,
      fileName: upload.name,
      mime: upload.mime,
      size: upload.bytes.byteLength,
      params: params,
      tenant: input.tenant ?? null,
      actorUserId: ctx.user?.id ?? null,
      actorEmail: ctx.user?.email ?? null,
    },
    ctx,
  );
  let job: JobRecord;
  try {
    job = (await created) as unknown as JobRecord;
  } catch (error) {
    await state.files.delete?.(fileRef).catch(() => undefined);
    throw error;
  }
  await enqueue(qb, state, job);
  const ms = waitMs(state, input.wait);
  return toReading(ms > 0 ? await waitFor(qb, job.id, ctx, ms) : job);
}

async function enqueue(qb: Quickben, state: DocReaderState, job: JobRecord): Promise<void> {
  try {
    await state.runner.enqueue(job.id, job.queueVersion);
  } catch (error) {
    await qb.update(
      DOC_JOBS,
      job.id,
      { state: "failed", error: "queue unavailable", finishedAt: new Date().toISOString() },
      SYSTEM,
    );
    throw error;
  }
}

/** A reading by id. Access rules of `doc-jobs` apply. */
export async function getReading(
  qb: Quickben,
  id: string,
  ctx: RequestContext,
  options: { wait?: number | boolean } = {},
): Promise<Reading> {
  const ms = waitMs(getDocReader(qb), options.wait);
  return toReading(ms > 0 ? await waitFor(qb, id, ctx, ms) : await loadJob(qb, id, ctx));
}

/** The stored file of a reading, for a preview. Access rules of `doc-jobs` apply. */
export async function readingFile(
  qb: Quickben,
  id: string,
  ctx: RequestContext,
): Promise<{ bytes: Uint8Array; mime: string; fileName: string }> {
  const job = await loadJob(qb, id, ctx);
  const bytes = await getDocReader(qb).files.read(job.fileRef);
  if (!bytes) throw new NotFoundError("The file of this reading is gone");
  return { bytes, mime: job.mime, fileName: job.fileName ?? "document" };
}

export interface ReadingFilters {
  readonly state?: JobState;
  /** A type key, also matching `auto` readings that resolved to it. */
  readonly type?: string;
  readonly tenant?: string;
  /** Part of the requester's email. */
  readonly actor?: string;
  /** ISO dates or datetimes: created at or after `from`, before `to`. */
  readonly from?: string;
  readonly to?: string;
}

/** Readings, newest first, filtered. Access rules of `doc-jobs` apply. */
export async function listReadings(
  qb: Quickben,
  filters: ReadingFilters,
  ctx: RequestContext,
  page: { limit?: number; page?: number } = {},
): Promise<{ readings: Reading[]; totalDocs: number; totalPages: number; page: number }> {
  const and: Record<string, unknown>[] = [];
  if (filters.state) and.push({ state: { eq: filters.state } });
  if (filters.type) {
    and.push({ or: [{ typeKey: { eq: filters.type } }, { requestedType: { eq: filters.type } }] });
  }
  if (filters.tenant) {
    const byOrganization = "organization" in (qb.collections[DOC_JOBS]?.fields ?? {});
    and.push(
      byOrganization
        ? { or: [{ tenant: { eq: filters.tenant } }, { organization: { eq: filters.tenant } }] }
        : { tenant: { eq: filters.tenant } },
    );
  }
  if (filters.actor) and.push({ actorEmail: { contains: filters.actor } });
  if (filters.from) and.push({ createdAt: { gte: new Date(filters.from).toISOString() } });
  if (filters.to) and.push({ createdAt: { lt: new Date(filters.to).toISOString() } });
  const result = await qb.find(
    DOC_JOBS,
    { where: { and }, sort: "-createdAt", limit: page.limit ?? 25, page: page.page ?? 1 } as never,
    ctx,
  );
  return {
    readings: (result.docs as unknown as JobRecord[]).map((job) => toReading(job)),
    totalDocs: result.totalDocs ?? 0,
    totalPages: result.totalPages ?? 0,
    page: result.page ?? 1,
  };
}

/** Queue a finished reading again. Needs update access to `doc-jobs` (staff by default). */
export async function retryReading(
  qb: Quickben,
  id: string,
  ctx: RequestContext,
): Promise<Reading> {
  const state = getDocReader(qb);
  const job = await loadJob(qb, id, ctx);
  if (!TERMINAL.has(job.state)) {
    throw new ValidationError([{ path: "state", message: `The reading is ${job.state}` }]);
  }
  const queued = (await qb.update(
    DOC_JOBS,
    id,
    { state: "queued", error: null, queueVersion: job.queueVersion + 1, finishedAt: null },
    ctx,
  )) as unknown as JobRecord;
  await enqueue(qb, state, queued);
  return toReading(queued);
}

/** Cancel a queued or running reading. Needs update access to `doc-jobs` (staff by default). */
export async function cancelReading(
  qb: Quickben,
  id: string,
  ctx: RequestContext,
): Promise<Reading> {
  const state = getDocReader(qb);
  const job = await loadJob(qb, id, ctx);
  if (TERMINAL.has(job.state)) {
    throw new ValidationError([{ path: "state", message: `The reading is ${job.state}` }]);
  }
  const cancelled = (await qb.update(
    DOC_JOBS,
    id,
    { state: "cancelled", finishedAt: new Date().toISOString() },
    ctx,
  )) as unknown as JobRecord;
  if (job.state === "queued")
    await state.runner.remove?.(id, job.queueVersion).catch(() => undefined);
  return toReading(cancelled);
}

/** Move a job from one state to another, only if it is still in `from` for this run. */
async function transition(
  qb: Quickben,
  id: string,
  run: number,
  from: JobState,
  data: (current: JobRecord) => Record<string, unknown>,
): Promise<JobRecord | null> {
  return qb.transaction(async (tx) => {
    const current = (await tx.find(DOC_JOBS, { where: { id: { eq: id } }, limit: 1 }, SYSTEM))
      .docs[0] as unknown as JobRecord | undefined;
    if (current?.state !== from || current.queueVersion !== run) return null;
    return (await tx.update(DOC_JOBS, id, data(current), SYSTEM)) as unknown as JobRecord;
  });
}

async function resolveType(
  qb: Quickben,
  job: JobRecord,
  bytes: Uint8Array,
): Promise<DocumentType | undefined> {
  if (job.requestedType !== "auto") {
    return findPublished(qb, job.requestedType, job.typeVersion ?? undefined);
  }
  const text = job.mime === PDF ? await pdfPagesText(bytes, [1]).catch(() => null) : null;
  return classifyType(await newestPublished(qb), job.fileName ?? job.fileRef, text) ?? undefined;
}

async function read(
  qb: Quickben,
  state: DocReaderState,
  job: JobRecord,
): Promise<Record<string, unknown>> {
  const bytes = await state.files.read(job.fileRef);
  if (!bytes) return { state: "failed", error: "The file of this reading is gone" };
  const type = await resolveType(qb, job, bytes);
  if (!type) {
    return {
      state: "done",
      status: "NO_MATCH",
      error: "No published document type matches this document",
      attempts: [],
      result: { fields: {}, missing: [] },
    };
  }
  const tenant = tenantOf(job);
  const skip = await skipHook(qb, tenant, state.log);
  const result = await runPipeline({
    type,
    input: { bytes, mime: job.mime, pages: type.pages },
    params: job.params,
    tenant,
    jobId: job.id,
    extractors: state.extractors,
    ...(skip ? { skip } : {}),
  });
  // The read is paid for already; a lost usage row must not lose the result too.
  await recordUsage(
    qb,
    {
      tenant,
      actorUserId: job.actorUserId,
      job: job.id,
      typeKey: type.key,
      typeVersion: type.version,
    },
    result.attempts,
  ).catch((error: unknown) => {
    state.log("usage-failed", { jobId: job.id, error: String(error) });
  });
  return {
    state: "done",
    status: result.status,
    typeKey: type.key,
    typeVersion: type.version,
    attempts: result.attempts,
    result: { fields: result.fields, missing: result.missing },
    costUsd: attemptsCost(result.attempts),
    error: null,
  };
}

/**
 * Run one job. Runners call it; it never throws for a document it cannot read and ignores a
 * run that is not current (cancelled, retried or already taken).
 */
export async function processJob(qb: Quickben, jobId: string, run: number): Promise<void> {
  if (!Number.isSafeInteger(run) || run < 1) return;
  const state = getDocReader(qb);
  const started = Date.now();
  const job = await transition(qb, jobId, run, "queued", (current) => ({
    state: "running",
    runs: current.runs + 1,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  }));
  if (!job) return;

  let data: Record<string, unknown>;
  try {
    data = await read(qb, state, job);
  } catch (error) {
    state.log("reading-failed", { jobId, error: String(error) });
    data = {
      state: "failed",
      error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    };
  }
  const finished = await transition(qb, jobId, run, "running", () => ({
    ...data,
    durationMs: Date.now() - started,
    finishedAt: new Date().toISOString(),
  }));
  if (finished && state.onReadingDone) {
    try {
      await state.onReadingDone(toReading(finished), qb);
    } catch (error) {
      state.log("on-reading-done-failed", { jobId, error: String(error) });
    }
  }
}

/** Fail readings left `running` by a process that is gone. */
export async function failInterruptedJobs(qb: Quickben, staleMs = 30 * 60 * 1000): Promise<number> {
  const before = new Date(Date.now() - staleMs).toISOString();
  const stale = await qb.find(
    DOC_JOBS,
    { where: { state: { eq: "running" }, startedAt: { lt: before } }, limit: 100 },
    SYSTEM,
  );
  for (const job of stale.docs) {
    await qb.update(
      DOC_JOBS,
      job.id,
      { state: "failed", error: "interrupted by a restart", finishedAt: new Date().toISOString() },
      SYSTEM,
    );
  }
  return stale.docs.length;
}

/** Queue again the readings still `queued`, for runners whose queue lives in memory. */
export async function requeueJobs(qb: Quickben): Promise<number> {
  const state = getDocReader(qb);
  const queued = await qb.find(
    DOC_JOBS,
    { where: { state: { eq: "queued" } }, sort: "createdAt", limit: 100 },
    SYSTEM,
  );
  for (const job of queued.docs as unknown as JobRecord[]) {
    await state.runner.enqueue(job.id, job.queueVersion);
  }
  return queued.docs.length;
}
