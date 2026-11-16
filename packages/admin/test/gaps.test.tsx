// @vitest-environment happy-dom
import { defineCollection, defineConfig, devAuth, fields as f, getQuickben } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { getAdminNav } from "../src";
import { DocumentForm } from "../src/client/document-form";
import { issuesToErrors } from "../src/forms";
import { englishI18n } from "../src/i18n/translator";
import { formScope } from "../src/ids";
import { createAdminContent } from "../src/page";
import { ListToolbar, RowsEditor, Table } from "../src/ui";
import { Dashboard } from "../src/views/dashboard";
import { FieldInput } from "../src/views/field-input";

import { editor, makeConfig } from "./fixtures";
import { actAs } from "./mocks";

import type { AdminServerFunction } from "../src";
import type { JsonRowColumn } from "@quickben/core";
import type { FieldMeta } from "@quickben/next";

afterEach(() => {
  cleanup();
});

const columns: JsonRowColumn[] = [
  { key: "id", label: "Id", description: "Model id", type: "text", required: true, maxLength: 20 },
  { key: "price", label: "Price", description: null, type: "number", required: false, min: 0 },
  {
    key: "pages",
    label: "Pages",
    description: null,
    type: "number",
    required: false,
    integer: true,
  },
  {
    key: "vision",
    label: "Vision",
    description: null,
    type: "boolean",
    required: false,
    default: false,
  },
  {
    key: "tier",
    label: "Tier",
    description: null,
    type: "select",
    required: false,
    options: ["fast", "smart"],
  },
];

function hiddenValue(container: HTMLElement): unknown {
  const input = container.querySelector<HTMLInputElement>('input[type="hidden"][name="models"]');
  return input?.value === "" ? "" : (JSON.parse(input?.value ?? "null") as unknown);
}

function renderRows(defaultValue: unknown, extra: Partial<Parameters<typeof RowsEditor>[0]> = {}) {
  return render(
    <>
      <p id="models-label">Models</p>
      <RowsEditor
        id="models"
        name="models"
        columns={columns}
        defaultValue={defaultValue}
        required={false}
        disabled={false}
        describedBy="models-hint"
        {...extra}
      />
    </>,
  );
}

describe("RowsEditor", () => {
  it("edits rows and submits them as JSON", async () => {
    const { container } = renderRows([
      { id: "a", price: 1, vision: true, tier: "fast", extra: "kept" },
      { id: "b" },
    ]);
    expect(screen.getByRole("group", { name: "Models" })).toBeTruthy();
    expect(hiddenValue(container)).toEqual([
      { id: "a", price: 1, vision: true, tier: "fast", extra: "kept" },
      { id: "b" },
    ]);
    fireEvent.change(screen.getByLabelText("Price, row 2"), { target: { value: "2.5" } });
    fireEvent.change(screen.getByLabelText("Pages, row 2"), { target: { value: "3" } });
    fireEvent.click(screen.getByLabelText("Vision, row 1"));
    fireEvent.change(screen.getByLabelText("Tier, row 2"), { target: { value: "smart" } });
    expect(hiddenValue(container)).toEqual([
      { id: "a", price: 1, vision: false, tier: "fast", extra: "kept" },
      { id: "b", price: 2.5, pages: 3, tier: "smart" },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Move row 2 up" }));
    expect((hiddenValue(container) as { id: string }[]).map((row) => row.id)).toEqual(["b", "a"]);
    await waitFor(() => {
      expect(document.activeElement?.id).toBe("models-down-0");
    });
    fireEvent.click(screen.getByRole("button", { name: "Move row 1 down" }));
    expect((hiddenValue(container) as { id: string }[]).map((row) => row.id)).toEqual(["a", "b"]);
    await waitFor(() => {
      expect(document.activeElement?.id).toBe("models-up-1");
    });
    expect(screen.getByRole("button", { name: "Move row 1 up" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Move row 2 down" })).toHaveProperty(
      "disabled",
      true,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    await waitFor(() => {
      expect(document.activeElement?.id).toBe("models.2.id");
    });
    expect((hiddenValue(container) as unknown[])[2]).toEqual({ id: "", vision: false });

    fireEvent.click(screen.getByRole("button", { name: "Remove row 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove row 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove row 1" }));
    expect(screen.getByText("No rows yet.")).toBeTruthy();
    expect(hiddenValue(container)).toEqual([]);
  });

  it("submits nothing for an empty list that was empty", () => {
    const { container } = renderRows(null);
    expect(hiddenValue(container)).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    fireEvent.change(screen.getByLabelText("Id, row 1"), { target: { value: "" } });
    expect(hiddenValue(container)).toEqual([{ id: "", vision: false }]);
  });

  it("switches to raw JSON and back", () => {
    const { container } = renderRows([{ id: "a" }]);
    fireEvent.click(screen.getByRole("button", { name: "Edit as JSON" }));
    const textarea = container.querySelector("textarea")!;
    expect(textarea.name).toBe("models");
    expect(JSON.parse(textarea.value)).toEqual([{ id: "a" }]);

    fireEvent.change(textarea, { target: { value: '{"not": "rows"}' } });
    fireEvent.click(screen.getByRole("button", { name: "Edit as JSON" }));
    expect(screen.getByText(/not a list of rows/)).toBeTruthy();

    fireEvent.change(container.querySelector("textarea")!, { target: { value: "{" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit as JSON" }));
    expect(container.querySelector("textarea")).toBeTruthy();

    fireEvent.change(container.querySelector("textarea")!, {
      target: { value: '[{"id": "z", "price": 3}]' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit as JSON" }));
    expect(hiddenValue(container)).toEqual([{ id: "z", price: 3 }]);

    fireEvent.click(screen.getByRole("button", { name: "Edit as JSON" }));
    fireEvent.change(container.querySelector("textarea")!, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Edit as JSON" }));
    expect(screen.getByText("No rows yet.")).toBeTruthy();
  });

  it("keeps stored values of cells that were not edited", () => {
    const { container } = renderRows([
      { id: "a", tier: null, price: null },
      { id: "b", vision: null },
    ]);
    expect(hiddenValue(container)).toEqual([
      { id: "a", tier: null, price: null },
      { id: "b", vision: null },
    ]);
    fireEvent.change(screen.getByLabelText("Price, row 1"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Price, row 1"), { target: { value: "" } });
    expect(hiddenValue(container)).toEqual([
      { id: "a", tier: null },
      { id: "b", vision: null },
    ]);
  });

  it("keeps an empty list as [] in the JSON editor", () => {
    const { container } = renderRows([]);
    expect(hiddenValue(container)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Edit as JSON" }));
    const textarea = container.querySelector("textarea")!;
    expect(textarea.value).toBe("[]");
    expect(textarea.getAttribute("aria-labelledby")).toBe("models-label");
  });

  it("asks for text only when the schema needs a minimum length", () => {
    renderRows([{ id: "a", note: "" }], {
      columns: [
        ...columns,
        { key: "note", label: "Note", description: null, type: "text", required: true },
        {
          key: "code",
          label: "Code",
          description: null,
          type: "text",
          required: true,
          minLength: 2,
        },
      ],
    });
    expect(screen.getByLabelText("Note, row 1")).toHaveProperty("required", false);
    expect(screen.getByLabelText("Code, row 1")).toHaveProperty("required", true);
  });

  it("opens values that are not rows as JSON", () => {
    const { container } = renderRows({ a: 1 });
    expect(JSON.parse(container.querySelector("textarea")!.value)).toEqual({ a: 1 });
  });

  it("shows cell errors until the rows change", () => {
    renderRows([{ id: "a" }, { id: "a" }], { errors: { "1.id": "Duplicate model a" } });
    const cell = screen.getByLabelText("Id, row 2");
    expect(cell.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Duplicate model a").id).toBe("models.1.id-error");
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    expect(screen.queryByText("Duplicate model a")).toBeNull();
  });

  it("is read-only when disabled", () => {
    renderRows([{ id: "a" }], { disabled: true });
    expect(screen.queryByRole("button", { name: "Add row" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove row 1" })).toBeNull();
    expect(screen.getByLabelText("Id, row 1")).toHaveProperty("disabled", true);
  });

  it("is used by FieldInput for json fields with rows, with errors from the form", async () => {
    const field: FieldMeta = {
      name: "models",
      type: "json",
      label: "Models",
      description: null,
      required: false,
      many: false,
      unique: false,
      admin: {},
      access: { create: true, update: true },
      rows: columns,
    };
    const fn = vi.fn<AdminServerFunction>(() =>
      Promise.resolve({
        status: "error" as const,
        message: "Check the highlighted fields.",
        fieldErrors: { "models.0.id": "Too long", models: "Too long" },
      }),
    );
    render(
      <DocumentForm serverFunction={fn} basePath="/admin" slug="llms" id={null} submitLabel="Save">
        <FieldInput
          field={field}
          value={[{ id: "a" }]}
          context={{
            components: {},
            relationOptions: {},
            labels: {},
            readOnly: false,
            serverFunction: fn,
            scope: formScope("llms", null),
            i18n: englishI18n,
          }}
        />
      </DocumentForm>,
    );
    expect(screen.getByRole("group", { name: "Models" })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const cell = await screen.findByLabelText("Id, row 1");
    await waitFor(() => {
      expect(cell.getAttribute("aria-invalid")).toBe("true");
    });
    expect(document.activeElement).toBe(cell);
    expect(screen.getAllByText("Too long")).toHaveLength(2);
  });
});

describe("issuesToErrors with nested fields", () => {
  it("keeps the full path of nested fields", () => {
    const issues = [
      { path: "models.0.id", message: "Required" },
      { path: "models", message: "Only one default" },
      { path: "tags.1", message: "Unknown" },
    ];
    expect(issuesToErrors(issues, ["models", "tags"], { nested: ["models"] }).fieldErrors).toEqual({
      "models.0.id": "Required",
      models: "Required",
      tags: "Unknown",
    });
    expect(issuesToErrors(issues, ["models", "tags"]).fieldErrors).toEqual({
      models: "Required",
      tags: "Unknown",
    });
  });
});

describe("ListToolbar", () => {
  it("renders search, filters, kept parameters and a clear link", () => {
    render(
      <ListToolbar
        action="/admin/connections"
        idPrefix="qb-connections"
        search={{ label: "Search name", value: "open" }}
        filters={[
          {
            name: "filter.enabled",
            label: "Enabled",
            value: "true",
            options: [
              { value: "true", label: "Yes" },
              { value: "false", label: "No" },
            ],
          },
        ]}
        hidden={{ sort: "name" }}
        clearHref="/admin/connections"
        i18n={englishI18n}
      />,
    );
    const form = screen.getByRole("search");
    expect(form.getAttribute("action")).toBe("/admin/connections");
    expect(within(form).getByLabelText("Search name")).toHaveProperty("value", "open");
    expect(within(form).getByLabelText("Enabled")).toHaveProperty("value", "true");
    expect(form.querySelector<HTMLInputElement>('input[name="sort"]')?.value).toBe("name");
    expect(within(form).getByRole("link", { name: "Clear" }).getAttribute("href")).toBe(
      "/admin/connections",
    );
  });

  it("renders nothing without search and filters, and no clear link when idle", () => {
    const { container } = render(<ListToolbar action="/x" idPrefix="x" i18n={englishI18n} />);
    expect(container.innerHTML).toBe("");
    render(
      <ListToolbar
        action="/x"
        idPrefix="x"
        search={{ label: "Search", value: "" }}
        clearHref="/x"
        i18n={englishI18n}
      />,
    );
    expect(screen.queryByRole("link", { name: "Clear" })).toBeNull();
  });
});

describe("Table", () => {
  it("scrolls inside its own container", () => {
    const { container } = render(
      <Table>
        <tbody>
          <tr>
            <td>Cell</td>
          </tr>
        </tbody>
      </Table>,
    );
    expect(container.firstElementChild?.className).toContain("qb-table-scroll");
  });
});

describe("dashboard messages", () => {
  it("tells apart nothing set up from no access", () => {
    const props = {
      title: "Admin",
      basePath: "/admin",
      groups: [],
      collections: new Map(),
      counts: {},
    };
    render(<Dashboard {...props} configured={false} i18n={englishI18n} />);
    expect(screen.getByText(/Nothing is set up yet/)).toBeTruthy();
    cleanup();
    render(<Dashboard {...props} i18n={englishI18n} />);
    expect(screen.getByText("There is nothing you can access yet.")).toBeTruthy();
  });

  it("says nothing is set up when the config has no visible collections", async () => {
    const empty = defineConfig({
      db: memoryAdapter(),
      collections: [
        defineCollection({ slug: "internal", fields: { a: f.text() }, admin: { hidden: true } }),
      ],
      auth: devAuth(),
    });
    actAs(editor);
    const Page = createAdminContent(empty, { basePath: "/x" });
    render(await Page({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/Nothing is set up yet/)).toBeTruthy();
  });
});

describe("page titles", () => {
  const config = makeConfig();

  function Reports() {
    return <p>Reports</p>;
  }

  const options = {
    basePath: "/app/data",
    pages: [{ path: "reports", label: "Reports", component: Reports }],
  };

  let postId = "";
  beforeAll(async () => {
    const qb = await getQuickben(config);
    const post = await qb.create(
      "posts",
      { title: "Hello title", status: "draft" },
      { user: null, overrideAccess: true },
    );
    postId = post.id;
  });

  it("hides page titles with pageTitle none", async () => {
    actAs(editor);
    const Embedded = createAdminContent(config, { ...options, chrome: "none", pageTitle: "none" });
    const view = render(
      await Embedded({
        params: Promise.resolve({ segments: ["posts"] }),
        searchParams: Promise.resolve({}),
      }),
    );
    const root = view.container.firstElementChild;
    expect(root?.getAttribute("data-qb-page-title")).toBe("none");
    expect(root?.querySelector("h1")?.className).toContain("qb-page-title");
    cleanup();
    const Full = createAdminContent(config, options);
    const full = render(
      await Full({ params: Promise.resolve({ segments: [] }), searchParams: Promise.resolve({}) }),
    );
    expect(full.container.firstElementChild?.hasAttribute("data-qb-page-title")).toBe(false);
  });

  it("gives the title and breadcrumb of the current page in the nav", async () => {
    actAs(editor);
    const page = async (pathname?: string) =>
      (await getAdminNav(config, options, pathname === undefined ? {} : { pathname })).page;
    expect(await page()).toBeUndefined();
    expect(await page("/app/data")).toEqual({ title: "Test admin", crumbs: [] });
    expect(await page("/app/data/posts")).toEqual({ title: "Posts", crumbs: [{ label: "Posts" }] });
    expect(await page("/app/data/posts/new")).toEqual({
      title: "New post",
      crumbs: [{ label: "Posts", href: "/app/data/posts" }, { label: "New" }],
    });
    expect(await page(`/app/data/posts/${postId}`)).toEqual({
      title: "Hello title",
      crumbs: [{ label: "Posts", href: "/app/data/posts" }, { label: "Hello title" }],
    });
    expect((await page("/app/data/posts/missing"))?.title).toBe("Edit");
    expect(await page("/app/data/reports/2026")).toEqual({
      title: "Reports",
      crumbs: [{ label: "Reports" }],
    });
    expect(await page("/app/data/secrets")).toBeNull();
    expect(await page("/app/data/nope/a/b")).toBeNull();
    expect(await page("/elsewhere")).toBeNull();
  });
});

describe("row columns schema", () => {
  it("are described in the field meta", async () => {
    const config = defineConfig({
      db: memoryAdapter(),
      collections: [
        defineCollection({
          slug: "llms",
          fields: { models: f.json({ schema: z.array(z.object({ id: z.string() })) }) },
          access: { read: () => true },
        }),
      ],
    });
    const Page = createAdminContent(config);
    actAs(null);
    render(
      await Page({
        params: Promise.resolve({ segments: ["llms", "new"] }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.getByRole("group", { name: "Models" })).toBeTruthy();
  });
});
