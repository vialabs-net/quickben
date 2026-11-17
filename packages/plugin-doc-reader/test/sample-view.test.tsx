// @vitest-environment happy-dom
import { englishI18n } from "@quickben/admin/i18n";
import { getQuickben } from "@quickben/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDraft, deleteDraft, addSample, getSample, listSamples, startTestRun } from "../src";
import { docReaderAdmin } from "../src/admin";
import {
  annotateAction,
  correctExpectedAction,
  inspectSampleAction,
  inspectUploadAction,
} from "../src/admin/actions";
import { errorCount, inspectFields } from "../src/admin/sample-page";
import { locateEvidence } from "../src/extractors/text-layer";

import { INVOICE_TEXT, invoice, invoiceReply, makeConfig, makePdf, PNG, staff } from "./helpers";
import { actAs, navigation } from "./next-mocks";

import type { AdminExtension, PageProps } from "@quickben/admin";
import type { ReactElement } from "react";

let made: ReturnType<typeof makeConfig>;
let extension: AdminExtension;

beforeEach(() => {
  made = makeConfig({
    answer: invoiceReply({
      number: {
        value: "A-1043",
        confidence: 0.95,
        page: 1,
        evidence: "NO. A-1043",
        box: "100,100,400,150",
      },
      total: {
        value: "12",
        confidence: 0.4,
        page: 1,
        evidence: "TOTAL 12",
        box: "500,800,600,850",
      },
    }),
  });
  extension = docReaderAdmin(made.config);
});

afterEach(() => {
  cleanup();
  actAs(null);
});

async function renderPage(segments: string[], searchParams: PageProps["searchParams"] = {}) {
  const page = extension.pages?.find((p) => p.path === "document-types");
  const Page = page?.component as unknown as (props: PageProps) => Promise<ReactElement>;
  const serverFunction = () => Promise.resolve({ status: "options" as const, options: [] });
  return render(
    await Page({
      user: null,
      basePath: "/admin",
      segments,
      searchParams,
      i18n: englishI18n,
      serverFunction,
    }),
  );
}

async function run(
  action: (key: string, data: FormData) => Promise<void>,
  data: Record<string, string | File>,
): Promise<string> {
  const form = new FormData();
  for (const [key, value] of Object.entries(data)) form.append(key, value);
  await expect(action("/admin", form)).rejects.toThrow(/NEXT_REDIRECT/u);
  return navigation.redirects.at(-1) ?? "";
}

const query = (url: string) => new URL(url, "https://x").searchParams;

describe("sample view", () => {
  it("reads one sample with a chosen model and shows each field on the page", async () => {
    actAs(staff);
    const qb = await getQuickben(made.config);
    const admin = { user: staff };
    const sample = await addSample(qb, admin, "invoice", {
      file: { bytes: PNG, name: "scan.png" },
      expected: { number: "A-1043", issuedOn: "01/02/2026", total: "13" },
    });
    await addSample(qb, admin, "invoice", {
      file: { bytes: PNG, name: "other.png" },
      expected: { number: "A-1043" },
    });
    // A run of both samples: the list shows each one's errors.
    await startTestRun(qb, admin, "invoice", 1);
    await made.runner.idle();

    const to = await run(inspectSampleAction, {
      typeKey: "invoice",
      sampleId: sample.id,
      version: "1",
      "m.choice": "conn-1|vision-test",
    });
    expect(to).toMatch(new RegExp(`^/admin/document-types/invoice/samples/${sample.id}\\?`, "u"));
    const runId = query(to).get("run") ?? "";
    await renderPage(["invoice", "samples", sample.id], { v: "1", run: runId });
    expect(screen.getByRole("status")).toBeTruthy(); // still running: refreshes
    cleanup();
    await made.runner.idle();

    await renderPage(["invoice", "samples", sample.id], { v: "1", run: runId });
    expect(screen.getByRole("heading", { level: 1, name: "scan.png" })).toBeTruthy();
    expect(screen.getByText("Right (scored fields)")).toBeTruthy();
    // The list comes from the two-sample run, with error counts.
    const list = screen.getByRole("navigation", { name: "Samples" });
    expect(within(list).getAllByText(/^\d+ errors$/u)).toHaveLength(2);
    expect(within(list).getByRole("link", { name: "Only samples with errors" })).toBeTruthy();

    // A box and a row select each other; the detail shows where the value came from.
    const box = screen.getByRole("button", { name: "Invoice number: A1043" });
    expect(box.getAttribute("aria-pressed")).toBe("false");
    act(() => {
      fireEvent.click(box);
    });
    expect(box.getAttribute("aria-pressed")).toBe("true");
    const detail = screen.getByRole("region", { name: "Details of Invoice number" });
    expect(within(detail).getByText("step 1 (vision-llm)")).toBeTruthy();
    expect(within(detail).getByText("page 1, box from the model")).toBeTruthy();
    // Low confidence is drawn dashed.
    const total = screen.getByRole("button", { name: "Total: 12" });
    expect(total.dataset.confidence).toBe("low");
    expect(box.dataset.confidence).toBe("ok");

    const table = screen.getByRole("table", { name: "Fields" });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Errors (2)" }));
    });
    expect(within(table).queryByRole("button", { name: "Invoice number" })).toBeNull();
    act(() => {
      fireEvent.click(within(table).getByRole("button", { name: "Total" }));
    });
    const totalDetail = screen.getByRole("region", { name: "Details of Total" });
    expect(totalDetail.querySelector<HTMLInputElement>('input[name="value"]')!.value).toBe("12");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Low confidence (1)" }));
    });
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Right (1)" }));
    });
    expect(within(table).getByRole("button", { name: "Invoice number" })).toBeTruthy();

    // Correct an expected value and leave a note, from the detail.
    const here = `/admin/document-types/invoice/samples/${sample.id}?v=1&run=${runId}`;
    expect(
      await run(correctExpectedAction, {
        typeKey: "invoice",
        sampleId: sample.id,
        field: "total",
        value: "12",
        back: here,
      }),
    ).toBe(`${here}&toast=sample-saved`);
    await run(correctExpectedAction, {
      typeKey: "invoice",
      sampleId: sample.id,
      field: "issuedOn",
      value: "",
      back: "https://elsewhere.example/x",
    });
    expect(navigation.redirects.at(-1)).toBe("/admin/document-types?toast=sample-saved");
    expect((await getSample(qb, admin, sample.id)).expected).toEqual({
      number: "A-1043",
      total: "12",
    });
    expect(
      await run(annotateAction, {
        typeKey: "invoice",
        sampleId: sample.id,
        field: "total",
        note: "The total is the last amount, not the subtotal.",
        back: here,
      }),
    ).toBe(`${here}&toast=note-saved`);
    expect(
      await run(annotateAction, { typeKey: "invoice", sampleId: sample.id, note: " ", back: here }),
    ).toBe(`${here}&error=invalid&issue=text`);
    cleanup();
    await renderPage(["invoice", "samples", sample.id], { v: "1", errors: "1" });
    expect(screen.getByText("Notes for the prompt")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Show all samples" })).toBeTruthy();
    cleanup();
    await renderPage(["invoice"], { v: "1" });
    expect(screen.getByText(/not the subtotal/u)).toBeTruthy();
  });

  it("uploads a PDF to look at, with boxes from its text layer", async () => {
    actAs(staff);
    await getQuickben(made.config);
    const pdf = await makePdf([INVOICE_TEXT]);
    const to = await run(inspectUploadAction, {
      typeKey: "invoice",
      version: "1",
      file: new File([pdf], "upload.pdf", { type: "application/pdf" }),
    });
    expect(to).toMatch(/^\/admin\/document-types\/invoice\/samples\/[\w-]+\?v=1&run=/u);
    expect(await run(inspectUploadAction, { typeKey: "invoice", version: "1" })).toBe(
      "/admin/document-types/invoice?v=1&tab=bench&error=no-file",
    );
    await made.runner.idle();
    const [id] = new URL(to, "https://x").pathname.split("/").slice(-1);
    await renderPage(["invoice", "samples", id ?? ""], Object.fromEntries(query(to)));
    // The text layer read the number: its box comes from the PDF's own text.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Invoice number: A1043" }));
    });
    expect(screen.getByText("page 1, box from the PDF text")).toBeTruthy();
    expect(screen.getByText("step 1 (text-layer)")).toBeTruthy();
    cleanup();
    await renderPage(["invoice", "samples", "missing"]);
    expect(screen.getByRole("heading", { level: 1, name: "Sample not found" })).toBeTruthy();
    expect(
      await listSamples(await getQuickben(made.config), { user: staff }, "invoice"),
    ).toHaveLength(1);
  });
});

describe("evidence boxes", () => {
  it("finds values in the PDF text layer, else keeps the model's box", async () => {
    const pdf = await makePdf([INVOICE_TEXT]);
    const fields = {
      number: {
        value: "A1043",
        confidence: 0.9,
        evidence: { page: 1, text: "NO. A-1043", box: { x0: 0.5, y0: 0.5, x1: 0.6, y1: 0.6 } },
      },
      total: {
        value: "999",
        confidence: 0.9,
        evidence: { page: 1, text: "", box: { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 } },
      },
      issuedOn: { value: "2026-03-05", confidence: 0.9 },
    };
    const located = await locateEvidence(pdf, "application/pdf", [1], fields);
    expect(located.number?.evidence).toMatchObject({
      page: 1,
      source: "text-layer",
      text: "NO. A-1043",
    });
    expect(located.number?.evidence?.box?.x0).toBeLessThan(0.5);
    expect(located.total?.evidence).toMatchObject({ source: "model", box: { x0: 0.1 } });
    expect(located.issuedOn?.evidence).toBeUndefined();
    const image = await locateEvidence(PNG, "image/png", [1], fields);
    expect(image.number?.evidence?.source).toBe("model");
    const broken = await locateEvidence(new Uint8Array([1, 2]), "application/pdf", [1], fields);
    expect(broken.total?.evidence?.source).toBe("model");
  });

  it("finds the value after the label when they are separate text runs", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([600, 400]);
    page.drawText("Fuel type", { x: 20, y: 360, size: 8, font });
    page.drawText(":", { x: 120, y: 360, size: 8, font });
    page.drawText("Petrol", { x: 300, y: 360, size: 8, font });
    const pdf = new Uint8Array(await doc.save());
    const located = await locateEvidence(pdf, "application/pdf", [1], {
      fuel: {
        value: "PETROL (HYBRID)",
        confidence: 0.6,
        evidence: {
          page: 1,
          text: "Fuel type : Petrol",
          box: { x0: 0.4, y0: 0.9, x1: 0.5, y1: 0.95 },
        },
      },
    });
    expect(located.fuel?.evidence).toMatchObject({
      source: "text-layer",
      text: "Fuel type : Petrol",
    });
    expect(located.fuel?.evidence?.box?.x0).toBeGreaterThan(0.45);
    expect(located.fuel?.evidence?.box?.y0).toBeLessThan(0.2);
  });

  it("labels each field for the view", () => {
    const fields = inspectFields(invoice, {
      sampleId: "s",
      fileName: "s.pdf",
      status: "OK",
      durationMs: 1,
      costUsd: 0,
      fields: [
        {
          key: "number",
          label: "N",
          expected: "1",
          read: "1",
          confidence: 0.5,
          match: true,
          outcome: "correct",
        },
        { key: "total", label: "T", expected: "1", read: "2", confidence: 1, match: false },
        { key: "issuedOn", label: "D", expected: null, read: null, confidence: null, match: null },
        {
          key: "buyerTaxId",
          label: "B",
          expected: "-",
          read: "9",
          confidence: 1,
          match: false,
          outcome: "hallucinated",
          scored: false,
        },
      ],
    });
    expect(fields.map((f) => [f.status, f.low])).toEqual([
      ["correct", true],
      ["wrong", false],
      ["unchecked", false],
      ["hallucinated", false],
    ]);
    expect(
      errorCount({
        sampleId: "s",
        fileName: "s",
        status: "OK",
        durationMs: 0,
        costUsd: 0,
        fields: [
          {
            key: "a",
            label: "a",
            expected: "1",
            read: null,
            confidence: null,
            match: false,
            outcome: "missed",
          },
          {
            key: "b",
            label: "b",
            expected: "1",
            read: "2",
            confidence: 1,
            match: false,
            outcome: "wrong",
            scored: false,
          },
        ],
      }),
    ).toBe(1);
  });
});

it("opens a historical run after its draft is deleted", async () => {
  actAs(staff);
  const qb = await getQuickben(made.config);
  const ctx = { user: staff };
  const sample = await addSample(qb, ctx, "invoice", { file: { bytes: PNG } });
  await createDraft(qb, ctx, "invoice");
  const [run] = await startTestRun(qb, ctx, "invoice", 2);
  await made.runner.idle();
  await deleteDraft(qb, ctx, "invoice", 2);
  await renderPage(["invoice", "samples", sample.id], { v: "1", run: run!.id });
  expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
});
