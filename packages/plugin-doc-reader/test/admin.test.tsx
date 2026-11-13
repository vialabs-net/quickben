// @vitest-environment happy-dom
import { getQuickben } from "@quickben/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DOC_USAGE, readDocument } from "../src";
import { docReaderAdmin } from "../src/admin";
import {
  addSamplesAction,
  cancelReadingAction,
  createDraftAction,
  createTypeAction,
  deleteDraftAction,
  publishAction,
  removeBudgetAction,
  removeSampleAction,
  retryReadingAction,
  saveDraftAction,
  setBudgetAction,
  setCapAction,
  startTestAction,
  tryReadingAction,
  updateSampleAction,
} from "../src/admin/actions";

import {
  alice,
  INVOICE_TEXT,
  invoiceReply,
  makeConfig,
  makePdf,
  PNG,
  staff,
  system,
} from "./helpers";
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
        evidence: "INVOICE NO. A-1043",
        box: "100,100,400,150",
      },
    }),
    listModels: () =>
      Promise.resolve([
        {
          connectionId: "conn-1",
          connectionName: "Main",
          models: [{ id: "vision-test", label: "Vision" }, { id: "small" }],
        },
      ]),
  });
  extension = docReaderAdmin(made.config, { basePath: "/admin/" });
});

afterEach(() => {
  cleanup();
  actAs(null);
});

async function renderPage(
  path: string,
  segments: string[] = [],
  searchParams: PageProps["searchParams"] = {},
) {
  const page = extension.pages?.find((p) => p.path === path);
  if (!page) throw new Error(`no page ${path}`);
  const Page = page.component as unknown as (props: PageProps) => Promise<ReactElement>;
  return render(await Page({ user: null, basePath: "/admin", segments, searchParams }));
}

function form(entries: Record<string, string | string[] | File>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (value instanceof File) data.append(key, value);
    else for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

async function run(
  action: (key: string, data: FormData) => Promise<void>,
  data: FormData,
): Promise<string | undefined> {
  await expect(action("/admin", data)).rejects.toThrow(/NEXT_REDIRECT/u);
  return navigation.redirects.at(-1);
}

/** The form data a browser would send for the form that contains `element`. */
function formOf(element: HTMLElement): FormData {
  const owner = element.closest("form");
  if (!owner) throw new Error("not in a form");
  return new FormData(owner);
}

describe("docReaderAdmin", () => {
  it("adds three pages in a Documents group", () => {
    expect(extension.pages?.map((p) => [p.path, p.label, p.group])).toEqual([
      ["document-types", "Document types", "Documents"],
      ["document-queue", "Readings", "Documents"],
      ["document-usage", "Usage", "Documents"],
    ]);
    expect(docReaderAdmin(made.config, { group: "Docs" }).pages?.[0]?.group).toBe("Docs");
  });

  it("keeps the staff pages for staff", async () => {
    actAs(alice);
    await renderPage("document-types");
    expect(screen.getByText("Only platform staff can manage document types.")).toBeTruthy();
    cleanup();
    await renderPage("document-usage");
    expect(screen.getByText("Only platform staff can see document reading usage.")).toBeTruthy();
    cleanup();
    actAs(null);
    await renderPage("document-queue");
    expect(screen.getByText("Sign in to see document readings.")).toBeTruthy();
  });
});

describe("document types and the studio", () => {
  it("lists types and creates one", async () => {
    actAs(staff);
    await getQuickben(made.config);
    await renderPage("document-types", [], { toast: "type-created" });
    expect(screen.getByRole("heading", { level: 1, name: "Document types" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Invoice" }).getAttribute("href")).toBe(
      "/admin/document-types/invoice",
    );
    expect(screen.getByRole("status").textContent).toContain("Document type created");

    expect(await run(createTypeAction, form({ key: "receipt", label: "Receipt" }))).toBe(
      "/admin/document-types/receipt?toast=type-created",
    );
    expect(await run(createTypeAction, form({ key: "receipt", label: "Again" }))).toBe(
      "/admin/document-types?error=type-exists",
    );
    expect(await run(createTypeAction, form({ key: "Bad", label: "Bad" }))).toBe(
      "/admin/document-types?error=invalid&issue=key",
    );
  });

  it("edits a draft from its form, tests it on samples and publishes it", async () => {
    actAs(staff);
    const qb = await getQuickben(made.config);
    await run(createTypeAction, form({ key: "receipt", label: "Receipt" }));

    await renderPage("document-types", ["receipt"]);
    expect(screen.getByRole("heading", { level: 1, name: "Receipt" })).toBeTruthy();
    const label = screen.getByLabelText<HTMLInputElement>("Name", { selector: "#qb-dr-label" });
    label.value = "Store receipt";
    const total = screen
      .getAllByLabelText<HTMLInputElement>("Key")
      .find((input) => input.name === "fields.1.key");
    if (!total) throw new Error("no new field row");
    total.value = "total";
    const totalLabel = document.querySelector<HTMLInputElement>('[name="fields.1.label"]');
    if (totalLabel) totalLabel.value = "Total";
    const type = document.querySelector<HTMLSelectElement>('[name="fields.1.type"]');
    if (type) type.value = "number";
    const firstStep = document.querySelector<HTMLSelectElement>('[name="steps.0.extractor"]');
    if (firstStep) firstStep.value = "text-layer";
    const data = formOf(label);
    expect(await run(saveDraftAction, data)).toBe(
      "/admin/document-types/receipt?v=1&toast=draft-saved",
    );
    cleanup();

    // Text-layer steps get template and reader pickers once saved.
    await renderPage("document-types", ["receipt"], { v: "1" });
    expect(
      screen.getByLabelText<HTMLInputElement>("Name", { selector: "#qb-dr-label" }).value,
    ).toBe("Store receipt");
    const template = document.querySelector<HTMLSelectElement>('[name="steps.0.template"]');
    expect(
      template &&
        within(template)
          .getAllByRole("option")
          .map((o) => o.textContent),
    ).toEqual(["—", "invoice"]);
    if (template) template.value = "invoice";
    const config = document.querySelector<HTMLTextAreaElement>('[name="steps.0.config"]');
    if (config) config.value = "not json";
    expect(await run(saveDraftAction, formOf(template as HTMLElement))).toBe(
      "/admin/document-types/receipt?v=1&error=invalid&issue=steps.0.config",
    );
    if (config) config.value = "";
    const number = document.querySelector<HTMLInputElement>('[name="fields.0.key"]');
    expect(await run(saveDraftAction, formOf(number as HTMLElement))).toBe(
      "/admin/document-types/receipt?v=1&toast=draft-saved",
    );
    cleanup();

    // Bench: upload, expected values, test, publish.
    const pdf = new File([await makePdf([INVOICE_TEXT])], "r1.pdf", { type: "application/pdf" });
    expect(await run(addSamplesAction, form({ typeKey: "receipt", version: "1" }))).toBe(
      "/admin/document-types/receipt?v=1&tab=bench&error=no-file",
    );
    expect(
      await run(addSamplesAction, form({ typeKey: "receipt", version: "1", files: pdf })),
    ).toBe("/admin/document-types/receipt?v=1&tab=bench&toast=samples-added");
    await renderPage("document-types", ["receipt"], { v: "1", tab: "bench" });
    const sampleLink = screen.getByRole("link", { name: "r1.pdf" });
    const sampleId =
      new URL(sampleLink.getAttribute("href") ?? "", "https://x").searchParams.get("sample") ?? "";
    expect(screen.getByRole("button", { name: "Publish v1" }).hasAttribute("disabled")).toBe(true);
    cleanup();

    await renderPage("document-types", ["receipt"], { v: "1", tab: "bench", sample: sampleId });
    const expected = screen.getByLabelText<HTMLInputElement>("Number *");
    expected.value = "A-1043";
    expect(await run(updateSampleAction, formOf(expected))).toBe(
      "/admin/document-types/receipt?v=1&tab=bench&toast=sample-saved",
    );
    cleanup();

    const started = await run(
      startTestAction,
      form({ typeKey: "receipt", version: "1", mode: "version" }),
    );
    expect(started).toMatch(
      /^\/admin\/document-types\/receipt\?v=1&tab=bench&run=.+&toast=test-started$/u,
    );
    await made.runner.idle();
    await renderPage("document-types", ["receipt"], { v: "1", tab: "bench" });
    const results = screen.getByRole("table", { name: "Results of This version" });
    expect(within(results).getByText("A-1043")).toBeTruthy();
    expect(within(results).getByText("match")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish v1" }).hasAttribute("disabled")).toBe(false);
    cleanup();

    expect(await run(publishAction, form({ typeKey: "receipt", version: "1" }))).toBe(
      "/admin/document-types/receipt?v=1&tab=bench&toast=published",
    );
    expect(await run(publishAction, form({ typeKey: "receipt", version: "1" }))).toBe(
      "/admin/document-types/receipt?v=1&tab=bench&error=published",
    );
    expect(await run(createDraftAction, form({ typeKey: "receipt", from: "1" }))).toBe(
      "/admin/document-types/receipt?v=2&toast=draft-created",
    );
    expect(await run(createDraftAction, form({ typeKey: "receipt" }))).toBe(
      "/admin/document-types/receipt?error=draft-exists",
    );
    await renderPage("document-types", ["receipt"], { v: "1" });
    expect(
      screen.getByText("Published versions cannot change. Create a draft to edit this type."),
    ).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Versions" }).textContent).toContain(
      "v2 · draft",
    );
    cleanup();
    expect(await run(deleteDraftAction, form({ typeKey: "receipt", version: "2" }))).toBe(
      "/admin/document-types/receipt?toast=draft-deleted",
    );
    expect(
      await run(removeSampleAction, form({ typeKey: "receipt", version: "1", sampleId })),
    ).toBe("/admin/document-types/receipt?v=1&tab=bench&toast=sample-removed");
    expect(await qb.count("doc-samples", {}, system)).toBe(0);
  });

  it("compares two models side by side", async () => {
    actAs(staff);
    await getQuickben(made.config);
    await run(
      addSamplesAction,
      form({ typeKey: "invoice", version: "1", files: new File([PNG], "scan.png") }),
    );
    expect(
      await run(
        startTestAction,
        form({ typeKey: "invoice", version: "1", mode: "compare", "a.choice": "conn-1" }),
      ),
    ).toBe("/admin/document-types/invoice?v=1&tab=bench&error=invalid&issue=variants");
    await run(
      startTestAction,
      form({
        typeKey: "invoice",
        version: "1",
        mode: "compare",
        "a.choice": "conn-1|vision-test",
        "b.choice": "conn-1|small",
      }),
    );
    await made.runner.idle();
    await renderPage("document-types", ["invoice"], { tab: "bench" });
    expect(screen.getByRole("table", { name: "Results of Main · vision-test" })).toBeTruthy();
    expect(screen.getByRole("table", { name: "Results of Main · small" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Model A" })).toBeTruthy();
    cleanup();
    await renderPage("document-types", ["invoice"]);
    expect(document.querySelector<HTMLSelectElement>('[name="steps.1.connectionId"]')?.value).toBe(
      "conn-1",
    );
    cleanup();
    await renderPage("document-types", ["missing"]);
    expect(screen.getByRole("heading", { level: 1, name: "Document type not found" })).toBeTruthy();
  });
});

describe("usage", () => {
  it("shows spend and edits budgets and the platform cap", async () => {
    actAs(staff);
    const qb = await getQuickben(made.config);
    await qb.create(
      DOC_USAGE,
      {
        tenant: "acme",
        typeKey: "invoice",
        extractor: "vision-llm",
        connectionId: "conn-1",
        connectionName: "Main",
        model: "vision-test",
        inputTokens: 1000,
        outputTokens: 100,
        pages: 2,
        costUsd: 4,
      },
      system,
    );
    expect(
      await run(setBudgetAction, form({ tenant: "acme", monthlyUsd: "5", month: "2026-11" })),
    ).toBe("/admin/document-usage?month=2026-11&toast=budget-saved");
    expect(await run(setBudgetAction, form({ tenant: "acme", monthlyUsd: "-1" }))).toBe(
      "/admin/document-usage?error=invalid&issue=monthlyUsd",
    );
    expect(await run(setCapAction, form({ monthlyUsd: "100" }))).toBe(
      "/admin/document-usage?toast=cap-saved",
    );
    await renderPage("document-usage", [], { month: "bad" });
    expect(screen.getByText("US$4.00", { selector: "p" })).toBeTruthy();
    expect(
      screen.getByRole("meter", { name: "Budget used by acme" }).getAttribute("aria-valuenow"),
    ).toBe("80");
    expect(
      screen.getByRole("meter", { name: "Platform cap used" }).getAttribute("aria-valuenow"),
    ).toBe("4");
    expect(screen.getByText("vision-test")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Spend by month" }).children).toHaveLength(6);
    cleanup();
    expect(await run(removeBudgetAction, form({ tenant: "acme" }))).toBe(
      "/admin/document-usage?toast=budget-removed",
    );
    expect(await run(setCapAction, form({ monthlyUsd: "" }))).toBe(
      "/admin/document-usage?toast=cap-saved",
    );
    actAs(alice);
    expect(await run(setCapAction, form({ monthlyUsd: "1" }))).toBe(
      "/admin/document-usage?error=forbidden",
    );
  });
});

describe("readings", () => {
  it("lists readings with filters, shows one, retries and cancels", async () => {
    actAs(staff);
    const qb = await getQuickben(made.config);
    const scan = await readDocument(
      qb,
      { type: "invoice", file: new File([PNG], "scan.png"), wait: 5000 },
      { user: alice },
    );
    const pdf = await readDocument(
      qb,
      { type: "invoice", file: new File([await makePdf([INVOICE_TEXT])], "inv.pdf") },
      { user: staff },
    );
    await made.runner.idle();

    await renderPage("document-queue", [], { state: "done", page: "1", to: "2999-01-01" });
    expect(screen.getByRole("link", { name: "scan.png" }).getAttribute("href")).toBe(
      `/admin/document-queue/${scan.id}`,
    );
    expect(screen.getByRole("link", { name: "inv.pdf" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Read" })).toBeTruthy();
    cleanup();
    await renderPage("document-queue", [], { actor: "alice", state: "nope", from: "x" });
    expect(screen.queryByRole("link", { name: "inv.pdf" })).toBeNull();
    cleanup();

    await renderPage("document-queue", [scan.id]);
    expect(screen.getByRole("heading", { level: 1, name: "scan.png" })).toBeTruthy();
    expect(screen.getByText("A1043")).toBeTruthy();
    expect(screen.getByText("vision-llm")).toBeTruthy();
    expect(screen.getByRole("img", { name: "scan.png" })).toBeTruthy();
    cleanup();
    await renderPage("document-queue", [pdf.id]);
    expect(screen.getByTitle("inv.pdf")).toBeTruthy();
    cleanup();
    await renderPage("document-queue", ["missing"]);
    expect(screen.getByRole("heading", { level: 1, name: "Reading not found" })).toBeTruthy();
    cleanup();

    const refused = await run(cancelReadingAction, form({ id: scan.id }));
    expect(refused).toBe(`/admin/document-queue/${scan.id}?error=invalid&issue=state`);
    expect(await run(retryReadingAction, form({ id: scan.id }))).toBe(
      `/admin/document-queue/${scan.id}?toast=reading-retried`,
    );
    expect(await run(cancelReadingAction, form({ id: scan.id }))).toBe(
      `/admin/document-queue/${scan.id}?toast=reading-cancelled`,
    );
    await made.runner.idle();

    // Users see their own readings, without staff columns or actions.
    actAs(alice);
    await renderPage("document-queue");
    expect(screen.getByText("Your readings, newest first.")).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Tenant" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Read" })).toBeNull();
  });

  it("reads a document from the queue page", async () => {
    actAs(staff);
    await getQuickben(made.config);
    expect(await run(tryReadingAction, form({ type: "invoice" }))).toBe(
      "/admin/document-queue?error=no-file",
    );
    expect(
      await run(tryReadingAction, form({ type: "nope", file: new File([PNG], "a.png") })),
    ).toBe("/admin/document-queue?error=invalid");
    const target = await run(
      tryReadingAction,
      form({ type: "auto", file: new File([await makePdf([INVOICE_TEXT])], "invoice.pdf") }),
    );
    expect(target).toMatch(/^\/admin\/document-queue\/[\w-]+$/u);
  });
});
