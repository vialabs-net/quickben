// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TemplateWorkspace } from "../src/admin/workspace";
import { resolveKind } from "../src/kinds";

import { invoice } from "./fixtures";

import type { TemplateContent, VersionSummary } from "../src";
import type { WorkspaceActions, WorkspaceProps } from "../src/admin/workspace";

const kind = resolveKind(invoice);
const content = invoice.baseTemplate as TemplateContent;

function actions(overrides: Partial<WorkspaceActions> = {}): WorkspaceActions {
  return {
    save: vi.fn(() => Promise.resolve({ ok: true as const, value: { number: 3, issues: [] } })),
    publish: vi.fn(() => Promise.resolve({ ok: true as const, value: { number: 4 } })),
    discard: vi.fn(() => Promise.resolve({ ok: true as const, value: { content } })),
    archive: vi.fn(() => Promise.resolve({ ok: true as const, value: null })),
    restore: vi.fn(() => Promise.resolve({ ok: true as const, value: { content } })),
    preview: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: { html: "<p>preview</p>", issues: [{ path: [1, 1], message: "Bad variable" }] },
      }),
    ),
    pdf: vi.fn(() =>
      Promise.resolve({ ok: true as const, value: { base64: "JVBERg==", fileName: "x.pdf" } }),
    ),
    ...overrides,
  };
}

const version = (number: number, status: VersionSummary["status"]): VersionSummary => ({
  id: `v${String(number)}`,
  number,
  status,
  contentHash: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  createdBy: null,
  updatedBy: null,
  publishedAt: status === "draft" ? null : "2026-11-02T00:00:00.000Z",
  publishedBy: null,
  archivedAt: null,
  restoredFrom: number === 3 ? 1 : null,
});

function renderWorkspace(props: Partial<WorkspaceProps> = {}) {
  const all: WorkspaceProps = {
    kind: "invoice",
    label: "Invoice",
    back: "/admin/templates",
    catalog: [...kind.catalog],
    initialContent: content,
    draft: { number: 3 },
    published: { number: 2 },
    versions: [version(3, "draft"), version(2, "published"), version(1, "archived")],
    canEdit: true,
    hasPdf: true,
    actions: actions(),
    ...props,
  };
  render(<TemplateWorkspace {...all} />);
  return all;
}

async function ready() {
  await screen.findByRole("textbox", { name: "Template text" }, { timeout: 5000 });
  await waitFor(() => {
    expect(screen.getByTitle("Document preview")).toBeTruthy();
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TemplateWorkspace", () => {
  it("loads the editor, previews and lists problems", async () => {
    const props = renderWorkspace();
    await ready();
    expect(props.actions.preview).toHaveBeenCalled();
    expect(screen.getByTitle("Document preview").getAttribute("srcdoc")).toBe("<p>preview</p>");
    const problems = screen.getByRole("region", { name: "Problems" });
    expect(problems.textContent).toContain("1 problem blocks publishing");
    fireEvent.click(within(problems).getByRole("button", { name: "Bad variable" }));
    expect(screen.getByRole("region", { name: "History" }).textContent).toContain(
      "restored from v1",
    );
  });

  it("inserts variables and blocks and marks unsaved changes", async () => {
    const props = renderWorkspace();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Insert Customer name" }));
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Insert Lines" }));
    for (const block of [
      "Checkbox option",
      "Inline checkbox",
      "Conditional block",
      "Repeated list",
      "Page break",
      "Signature",
      "Page footer",
      "Page footer",
      "Table",
    ]) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${block}`) }));
    }
    expect(screen.getByRole("button", { name: "Add row" })).toBeTruthy();
    for (const tool of [
      "Add row",
      "Add column",
      "Header row",
      "Merge or split",
      "Delete row",
      "Delete column",
      "Delete table",
    ]) {
      const button = screen.queryByRole("button", { name: tool });
      if (button) fireEvent.click(button);
    }
    fireEvent.change(screen.getByRole("searchbox", { name: "Search variables" }), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No variables match.")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search variables" }), {
      target: { value: "total" },
    });
    expect(screen.getByRole("button", { name: "Insert Total" })).toBeTruthy();
    await waitFor(() => {
      expect(vi.mocked(props.actions.preview).mock.calls.length).toBeGreaterThan(1);
    });
  });

  it("formats text with the toolbar", async () => {
    renderWorkspace();
    await ready();
    const toolbar = screen.getByRole("toolbar", { name: "Formatting" });
    for (const name of [
      "Bold",
      "Italic",
      "Underline",
      "Align left",
      "Align center",
      "Align right",
      "Align justify",
      "Bulleted list",
      "Numbered list",
      "Quote",
      "Horizontal rule",
      "Undo",
      "Redo",
    ]) {
      const button = within(toolbar).getByRole("button", { name });
      fireEvent.mouseDown(button);
      fireEvent.click(button);
    }
    const style = within(toolbar).getByRole("combobox", { name: "Text style" });
    for (const value of ["h2", "note", "p", "h1"]) fireEvent.change(style, { target: { value } });
  });

  it("edits node attributes in their views", async () => {
    renderWorkspace();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /^Conditional block/ }));
    fireEvent.click(screen.getByRole("button", { name: "Insert Lines" }));
    fireEvent.click(screen.getByRole("button", { name: /^Repeated list/ }));
    const conditions = await screen.findAllByPlaceholderText("order.paid and total > 100");
    fireEvent.change(conditions[0]!, { target: { value: "invoice.paid" } });
    fireEvent.change((await screen.findAllByRole("combobox", { name: "Display" }))[0]!, {
      target: { value: "bullets" },
    });
    fireEvent.change(screen.getAllByRole("combobox", { name: "When empty" })[0]!, {
      target: { value: "hide" },
    });
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Column Item" })[0]!);
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Column Item" })[0]!);
    fireEvent.change(screen.getAllByRole("combobox", { name: "List" })[0]!, {
      target: { value: "invoice.lines" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Signature/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Signature caption" }), {
      target: { value: "Client" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Inline checkbox/ }));
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Checkbox without a condition" }))[0]!,
    );
    expect(screen.getAllByText(/Invoice number/).length).toBeGreaterThan(0);
  });

  it("saves, publishes, discards, archives, restores and downloads", async () => {
    const createObjectURL = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const props = renderWorkspace();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText("Draft v3 saved");
    fireEvent.keyDown(globalThis.window, { key: "s", ctrlKey: true });
    await waitFor(() => {
      expect(props.actions.save).toHaveBeenCalledTimes(2);
    });

    const confirmWith = async (open: string, action: string, done: string) => {
      fireEvent.click(screen.getByRole("button", { name: open }));
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: action }),
      );
      await screen.findByText(done);
    };
    await confirmWith("Publish", "Publish", "Version 4 published");
    await confirmWith("Discard draft", "Discard draft", "Draft discarded");
    await confirmWith("Archive", "Archive", "Published version archived");
    await confirmWith("Restore v1", "Restore", "Version 1 is the draft now");
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalled();
    });
  });

  it("shows refused actions and preview errors", async () => {
    const props = renderWorkspace({
      actions: actions({
        publish: vi.fn(() =>
          Promise.resolve({
            ok: false as const,
            message: "Not published",
            issues: [{ path: [0], message: "Fix me" }],
          }),
        ),
        preview: vi.fn(() =>
          Promise.resolve({ ok: false as const, message: "Preview failed", issues: [] }),
        ),
      }),
    });
    await screen.findByText("Preview failed", undefined, { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Publish" }),
    );
    await screen.findByText("Not published");
    expect(screen.getByRole("button", { name: "Fix me" })).toBeTruthy();
    expect(props.actions.publish).toHaveBeenCalled();
  });

  it("is read-only without the manage rule", async () => {
    renderWorkspace({ canEdit: false, draft: null, published: null, hasPdf: false, versions: [] });
    await screen.findByRole("textbox", { name: "Template text" }, { timeout: 5000 });
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.getByText("Not published")).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(globalThis.window, { key: "s", metaKey: true });
      await Promise.resolve();
    });
  });
});
