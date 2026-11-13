import {
  ConfigError,
  createQuickben,
  defineConfig,
  ForbiddenError,
  getQuickben,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { describe, expect, it, vi } from "vitest";

import {
  cancelReading,
  DOC_JOBS,
  DOC_USAGE,
  docReader,
  getDocReader,
  getReading,
  listReadings,
  processJob,
  readDocument,
  readingFile,
  retryReading,
} from "../src";
import { failInterruptedJobs, requeueJobs, sniffMime } from "../src/readings";

import {
  alice,
  as,
  bob,
  INVOICE_TEXT,
  invoiceInput,
  invoiceReply,
  makePdf,
  PNG,
  setup,
  staff,
  system,
} from "./helpers";

import type { JobRunner } from "../src";

const pdfFile = async (text = INVOICE_TEXT, name = "invoice-1043.pdf") =>
  new File([await makePdf([text])], name, { type: "application/pdf" });

describe("readDocument", () => {
  it("reads a PDF with its text layer, free, and waits for the result", async () => {
    const { qb, mock } = await setup();
    const reading = await readDocument(
      qb,
      { type: "invoice", file: await pdfFile(), wait: 5000 },
      as(alice),
    );
    expect(reading).toMatchObject({
      state: "done",
      status: "OK",
      type: { key: "invoice", version: 1 },
      fields: {
        number: { value: "A1043" },
        issuedOn: { value: "2026-03-05" },
        total: { value: "1234.5" },
      },
      missing: [],
      costUsd: 0,
      runs: 1,
      fileName: "invoice-1043.pdf",
      mime: "application/pdf",
      actor: { userId: "alice", email: "alice@example.com" },
    });
    expect(reading.attempts.map((a) => a.extractor)).toEqual(["text-layer"]);
    expect(mock.calls).toHaveLength(0);
  });

  it("falls back to the vision model for a scan and records the usage", async () => {
    const { qb, runner, mock } = await setup({
      answer: invoiceReply({
        number: {
          value: "A-1043",
          confidence: 0.95,
          page: 1,
          evidence: "INVOICE",
          box: "10,10,200,40",
        },
        issuedOn: { value: "2026-03-05", confidence: 0.9 },
      }),
    });
    const queued = await readDocument(
      qb,
      { type: "invoice", file: { bytes: PNG, name: "scan.png" }, tenant: "acme" },
      as(alice),
    );
    expect(queued.state).toBe("queued");
    await runner.idle();
    const reading = await getReading(qb, queued.id, as(alice));
    expect(reading).toMatchObject({
      state: "done",
      status: "OK",
      costUsd: 0.0105,
      tenant: "acme",
      mime: "image/png",
    });
    expect(reading.attempts.map((a) => [a.extractor, a.status])).toEqual([
      ["text-layer", "NO_TEXT"],
      ["vision-llm", "OK"],
    ]);
    expect(mock.calls).toHaveLength(1);
    const usage = await qb.find(DOC_USAGE, {}, system);
    expect(usage.docs).toMatchObject([
      {
        tenant: "acme",
        job: reading.id,
        typeKey: "invoice",
        typeVersion: 1,
        model: "vision-test",
        costUsd: 0.0105,
        connectionName: "Test connection",
      },
    ]);
  });

  it("classifies with type auto and reports a document nothing matches", async () => {
    const { qb } = await setup();
    const auto = await readDocument(
      qb,
      { type: "auto", file: await pdfFile(), wait: true },
      as(alice),
    );
    expect(auto).toMatchObject({ requestedType: "auto", type: { key: "invoice" }, status: "OK" });
    const none = await readDocument(
      qb,
      {
        type: "auto",
        file: { bytes: await makePdf(["A plain letter. ".repeat(10)]), name: "letter.pdf" },
        wait: 5000,
      },
      as(alice),
    );
    expect(none).toMatchObject({
      state: "done",
      status: "NO_MATCH",
      type: null,
    });
    expect(none.error).toContain("No published");
  });

  it("validates the type, the parameters and the file", async () => {
    const { qb } = await setup({ maxFileBytes: 2000 });
    const file = { bytes: PNG };
    await expect(readDocument(qb, { type: "nope", file }, as(alice))).rejects.toThrow(
      ValidationError,
    );
    await expect(
      readDocument(qb, { type: "invoice", version: 9, file }, as(alice)),
    ).rejects.toThrow(/invoice@9/u);
    await expect(readDocument(qb, { type: "Bad Key", file }, as(alice))).rejects.toThrow(
      ValidationError,
    );
    await expect(
      readDocument(qb, { type: "invoice", file, params: { a: 3 } as never }, as(alice)),
    ).rejects.toThrow(ValidationError);
    await expect(
      readDocument(qb, { type: "invoice", file: { bytes: new Uint8Array() } }, as(alice)),
    ).rejects.toThrow(/empty/u);
    await expect(
      readDocument(
        qb,
        { type: "invoice", file: { bytes: new Uint8Array(3000).fill(1) } },
        as(alice),
      ),
    ).rejects.toThrow(/larger than/u);
    await expect(
      readDocument(
        qb,
        { type: "invoice", file: new Blob(["hello world"], { type: "application/pdf" }) },
        as(alice),
      ),
    ).rejects.toThrow(/PDF, JPEG, PNG or WebP/u);
    await expect(readDocument(qb, { type: "invoice", file }, as(null))).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("marks a reading failed when the queue is down", async () => {
    const runner: JobRunner = {
      name: "broken",
      inProcess: false,
      start: () => undefined,
      enqueue: () => Promise.reject(new Error("redis down")),
      background: () => undefined,
    };
    const { qb } = await setup({ runner });
    await expect(
      readDocument(qb, { type: "invoice", file: { bytes: PNG } }, as(alice)),
    ).rejects.toThrow("redis down");
    const jobs = await qb.find(DOC_JOBS, {}, system);
    expect(jobs.docs[0]).toMatchObject({ state: "failed", error: "queue unavailable" });
  });
});

describe("access and listing", () => {
  it("shows users their own readings and staff all of them", async () => {
    const { qb } = await setup();
    const mine = await readDocument(
      qb,
      { type: "invoice", file: await pdfFile(), wait: 5000 },
      as(alice),
    );
    await readDocument(
      qb,
      { type: "invoice", file: { bytes: PNG, name: "b.png" }, wait: 5000 },
      as(bob),
    );
    await expect(getReading(qb, mine.id, as(bob))).rejects.toThrow(NotFoundError);
    expect((await listReadings(qb, {}, as(alice))).readings.map((r) => r.id)).toEqual([mine.id]);
    const all = await listReadings(qb, {}, as(staff));
    expect(all.totalDocs).toBe(2);
    expect((await listReadings(qb, { actor: "BOB" }, as(staff))).readings).toHaveLength(1);
    expect((await listReadings(qb, { state: "done", type: "invoice" }, as(staff))).totalDocs).toBe(
      2,
    );
    expect((await listReadings(qb, { tenant: "nobody" }, as(staff))).totalDocs).toBe(0);
    expect(
      (await listReadings(qb, { from: "2000-01-01", to: "2000-01-02" }, as(staff))).totalDocs,
    ).toBe(0);
    const file = await readingFile(qb, mine.id, as(alice));
    expect(file).toMatchObject({ mime: "application/pdf", fileName: "invoice-1043.pdf" });
    expect(sniffMime(file.bytes)).toBe("application/pdf");
  });

  it("lets staff retry and cancel, and ignores stale runs", async () => {
    const { qb, runner } = await setup();
    const reading = await readDocument(
      qb,
      { type: "invoice", file: await pdfFile(), wait: 5000 },
      as(alice),
    );
    await expect(retryReading(qb, reading.id, as(alice))).rejects.toThrow(ForbiddenError);
    await expect(cancelReading(qb, reading.id, as(staff))).rejects.toThrow(/is done/u);
    const retried = await retryReading(qb, reading.id, as(staff));
    expect(retried.state).toBe("queued");
    await runner.idle();
    const done = await getReading(qb, reading.id, as(staff));
    expect(done).toMatchObject({ state: "done", runs: 2 });
    // A stale message for the first run does nothing.
    await processJob(qb, reading.id, 1);
    await processJob(qb, reading.id, 0);
    expect((await getReading(qb, reading.id, as(staff))).runs).toBe(2);
    await expect(retryReading(qb, "missing", as(staff))).rejects.toThrow(NotFoundError);
  });

  it("cancels a queued reading before it runs", async () => {
    const remove = vi.fn(() => Promise.reject(new Error("gone")));
    const runner: JobRunner = {
      name: "manual",
      inProcess: false,
      start: () => undefined,
      enqueue: () => Promise.resolve(),
      remove,
      background: () => undefined,
    };
    const { qb } = await setup({ runner });
    const reading = await readDocument(qb, { type: "invoice", file: await pdfFile() }, as(alice));
    const cancelled = await cancelReading(qb, reading.id, as(staff));
    expect(cancelled.state).toBe("cancelled");
    expect(remove).toHaveBeenCalledWith(reading.id, 1);
    await processJob(qb, reading.id, 1);
    expect((await getReading(qb, reading.id, as(staff))).state).toBe("cancelled");
    // `wait` returns as soon as the reading ends.
    expect((await getReading(qb, reading.id, as(staff), { wait: 10_000 })).state).toBe("cancelled");
  });

  it("fails a reading whose file is gone and reports a failure that throws", async () => {
    const log = vi.fn();
    const onReadingDone = vi.fn(() => {
      throw new Error("hook failed");
    });
    const { qb, files, runner } = await setup({ log, onReadingDone });
    const reading = await readDocument(qb, { type: "invoice", file: await pdfFile() }, as(alice));
    files.files.clear();
    await runner.idle();
    expect(await getReading(qb, reading.id, as(alice))).toMatchObject({
      state: "failed",
      error: "The file of this reading is gone",
    });
    await expect(readingFile(qb, reading.id, as(alice))).rejects.toThrow(NotFoundError);
    expect(onReadingDone).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("on-reading-done-failed", expect.anything());

    const broken = await setup({
      log,
      extractors: [
        { key: "text-layer", paid: false, extract: () => Promise.resolve(null as never) },
      ],
    });
    const failed = await readDocument(
      broken.qb,
      { type: "invoice", file: await pdfFile(), wait: 5000 },
      as(alice),
    );
    expect(failed.state).toBe("failed");
    expect(log).toHaveBeenCalledWith("reading-failed", expect.anything());
  });
});

describe("plugin lifecycle", () => {
  it("queues again what was queued and fails what was left running", async () => {
    const made = await setup({
      runner: {
        name: "x",
        inProcess: false,
        start: () => undefined,
        enqueue: () => Promise.resolve(),
        background: () => undefined,
      },
    });
    const queued = await readDocument(
      made.qb,
      { type: "invoice", file: await pdfFile() },
      as(alice),
    );
    const stuck = await readDocument(
      made.qb,
      { type: "invoice", file: await pdfFile() },
      as(alice),
    );
    await made.qb.update(
      DOC_JOBS,
      stuck.id,
      { state: "running", startedAt: "2000-01-01T00:00:00.000Z" },
      system,
    );
    expect(await failInterruptedJobs(made.qb)).toBe(1);
    const enqueue = vi.spyOn(getDocReader(made.qb).runner, "enqueue");
    expect(await requeueJobs(made.qb)).toBe(1);
    expect(enqueue).toHaveBeenCalledWith(queued.id, 1);
  });

  it("rejects bad type lists and works without the plugin state", async () => {
    expect(() => docReader({ types: [{ ...invoiceInput, key: "Bad" }] })).toThrow(ConfigError);
    expect(() => docReader({ types: [invoiceInput, invoiceInput] })).toThrow(/listed twice/u);
    const qb = await createQuickben(defineConfig({ db: memoryAdapter(), collections: [] }));
    expect(() => getDocReader(qb)).toThrow(ConfigError);
    const config = defineConfig({ db: memoryAdapter(), collections: [], plugins: [docReader()] });
    const plain = await getQuickben(config);
    expect(getDocReader(plain).runner.name).toBe("in-process");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    getDocReader(plain).log("test", { a: 1 });
    expect(warn).toHaveBeenCalledWith("[doc-reader] test", { a: 1 });
    warn.mockRestore();
  });
});
