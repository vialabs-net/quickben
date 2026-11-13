import { ConfigError, ConflictError, ForbiddenError, ValidationError } from "@quickben/core";
import { collectionMeta, getMeta, getQuickben } from "@quickben/next";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { fieldErrorsState, toFormState } from "../src/action-errors";
import { assertPages, normalizeBasePath, resolveExtensions } from "../src/extensions";
import {
  editableFields,
  issuesToErrors,
  parseFormData,
  toDatetimeLocal,
  toJsonText,
} from "../src/form-data";
import {
  columnLabel,
  documentTitle,
  formatCell,
  formatDatetime,
  relationTitle,
} from "../src/format";
import { controlId, formScope } from "../src/ids";
import {
  columnsOf,
  filterFields,
  isSortable,
  listHref,
  listQuery,
  nextSort,
  parseListState,
  searchField,
} from "../src/list-query";
import { buildNav } from "../src/nav";
import { resolveRoute } from "../src/page";
import { getAdmin, registerAdmin } from "../src/registry";

import { admin, makeConfig } from "./fixtures";

import type { CollectionMeta, MetaResponse } from "@quickben/next";

let meta: MetaResponse;
let postsMeta: CollectionMeta;
let metas: Map<string, CollectionMeta>;

beforeAll(async () => {
  const qb = await getQuickben(makeConfig());
  meta = await getMeta(qb, { user: admin });
  postsMeta = meta.collections.find((c) => c.slug === "posts")!;
  metas = new Map(meta.collections.map((c) => [c.slug, c]));
});

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("parseFormData", () => {
  it("converts each field type", () => {
    const { data, errors } = parseFormData(
      postsMeta.fields,
      form([
        ["title", "Hello"],
        ["slug", ""],
        ["status", "published"],
        ["channels", "web"],
        ["channels", "email"],
        ["views", "12"],
        ["rating", "4.5"],
        ["featured", "on"],
        ["publishedOn", "2026-01-02"],
        ["publishedAt", "2026-01-02T10:30"],
        ["contact", "a@b.co"],
        ["website", ""],
        ["summary", "Text"],
        ["author", "a1"],
        ["tags", "t1"],
        ["tags", ""],
        ["meta", ' {"a": 1} '],
        ["color", "#fff"],
        ["internal", "ignored"],
        ["locked", "ignored"],
      ]),
    );
    expect(errors).toEqual({});
    expect(data).toEqual({
      title: "Hello",
      slug: null,
      status: "published",
      channels: ["web", "email"],
      views: 12,
      rating: 4.5,
      featured: true,
      publishedOn: "2026-01-02",
      publishedAt: "2026-01-02T10:30:00.000Z",
      contact: "a@b.co",
      website: null,
      summary: "Text",
      author: "a1",
      tags: ["t1"],
      meta: { a: 1 },
      color: "#fff",
    });
  });

  it("reports invalid and missing values per field", () => {
    const { errors, data } = parseFormData(
      postsMeta.fields,
      form([
        ["title", ""],
        ["views", "1.5"],
        ["rating", "abc"],
        ["publishedAt", "not a date"],
        ["meta", "{oops"],
        ["featured", "true"],
      ]),
    );
    expect(errors).toEqual({
      title: "Required",
      status: "Required",
      views: "Enter a whole number",
      rating: "Enter a number",
      publishedAt: "Enter a valid date and time",
      meta: "Enter valid JSON",
    });
    expect(data.featured).toBe(true);
    expect(data.channels).toEqual([]);
    expect(data.meta).toBeUndefined();
  });

  it("requires at least one value for required many fields", () => {
    const fields = [{ ...postsMeta.fields.find((f) => f.name === "channels")!, required: true }];
    expect(parseFormData(fields, form([])).errors).toEqual({ channels: "Choose at least one" });
  });

  it("keeps seconds of datetime inputs", () => {
    const { data } = parseFormData(
      postsMeta.fields,
      form([["publishedAt", "2026-01-02T10:30:15"]]),
    );
    expect(data.publishedAt).toBe("2026-01-02T10:30:15.000Z");
  });

  it("lists editable fields", () => {
    const names = editableFields(postsMeta.fields).map((f) => f.name);
    expect(names).not.toContain("internal");
    expect(names).not.toContain("locked");
  });
});

describe("form helpers", () => {
  it("map validation issues to fields", () => {
    expect(
      issuesToErrors(
        [
          { path: "tags.0", message: "Bad id" },
          { path: "tags.1", message: "Second" },
          { path: "", message: "Whole" },
          { path: "other", message: "Unknown" },
        ],
        ["tags"],
      ),
    ).toEqual({ fieldErrors: { tags: "Bad id" }, formError: "Whole" });
    expect(issuesToErrors([{ path: "x.y", message: "Bad" }], []).formError).toBe("x.y: Bad");
  });

  it("format stored values for inputs", () => {
    expect(toDatetimeLocal("2026-01-02T10:30:00.000Z")).toBe("2026-01-02T10:30");
    expect(toDatetimeLocal(null)).toBe("");
    expect(toJsonText({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(toJsonText(null)).toBe("");
  });

  it("turn errors into form states", () => {
    const names = ["title", "slug"];
    expect(
      toFormState(new ValidationError([{ path: "title", message: "Too long" }]), names),
    ).toEqual({
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: { title: "Too long" },
    });
    expect(toFormState(new ConflictError("Taken", "slug"), names).fieldErrors).toEqual({
      slug: "This value is already taken",
    });
    expect(toFormState(new ConflictError("Id taken", "id"), names)).toMatchObject({
      message: "Id taken",
      fieldErrors: {},
    });
    expect(toFormState(new ForbiddenError("No"), names).message).toBe("No");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(toFormState(new Error("boom"), names).message).toBe("Something went wrong. Try again.");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
    expect(fieldErrorsState({ a: "b" })).toMatchObject({
      status: "error",
      fieldErrors: { a: "b" },
    });
  });
});

describe("list state", () => {
  it("reads search, sort, filters and paging", () => {
    const state = parseListState(postsMeta, {
      q: "  hello ",
      sort: "-title",
      page: "3",
      limit: "50",
      "filter.status": "published",
      "filter.featured": "true",
      "filter.channels": "web",
      "filter.title": "ignored",
    });
    expect(state).toEqual({
      q: "hello",
      sort: "-title",
      page: 3,
      limit: 50,
      filters: { status: "published", featured: "true", channels: "web" },
    });
    expect(listQuery(postsMeta, state)).toEqual({
      where: {
        and: [
          { title: { contains: "hello" } },
          { status: { eq: "published" } },
          { channels: { contains: "web" } },
          { featured: { eq: true } },
        ],
      },
      sort: "-title",
      limit: 50,
      page: 3,
      depth: 1,
    });
  });

  it("falls back to defaults for invalid values", () => {
    const state = parseListState(postsMeta, {
      sort: ["-meta"],
      page: "0",
      limit: "7",
      "filter.status": "nope",
      "filter.featured": "maybe",
    });
    expect(state).toEqual({ q: "", sort: null, page: 1, limit: 20, filters: {} });
    expect(listQuery(postsMeta, state)).toEqual({ limit: 20, page: 1, depth: 1 });
    expect(parseListState(postsMeta, { sort: "createdAt", page: "x" })).toMatchObject({
      sort: "createdAt",
      page: 1,
    });
  });

  it("builds list URLs without defaults", () => {
    const state = parseListState(postsMeta, {});
    expect(listHref("/admin", "posts", state)).toBe("/admin/posts");
    expect(
      listHref("/admin", "posts", state, {
        q: "a b",
        filters: { status: "draft" },
        sort: "-title",
        limit: 50,
        page: 2,
      }),
    ).toBe("/admin/posts?q=a+b&filter.status=draft&sort=-title&limit=50&page=2");
    expect(nextSort(state, "title")).toBe("title");
    expect(nextSort({ ...state, sort: "title" }, "title")).toBe("-title");
  });

  it("chooses columns, filters and the search field", () => {
    expect(columnsOf(postsMeta)).toEqual(["title", "status", "author", "featured", "createdAt"]);
    const authorsMeta = metas.get("authors")!;
    expect(columnsOf(authorsMeta)).toEqual(["name", "active"]);
    expect(
      columnsOf({ ...postsMeta, admin: { ...postsMeta.admin, defaultColumns: null } }),
    ).toEqual(["title", "slug", "status", "channels"]);
    expect(
      columnsOf({
        ...postsMeta,
        admin: { ...postsMeta.admin, defaultColumns: ["internal", "id", "nope"] },
      }),
    ).toEqual(["id"]);
    expect(filterFields(postsMeta).map((f) => f.name)).toEqual(["status", "channels", "featured"]);
    expect(searchField(postsMeta)?.name).toBe("title");
    expect(searchField(metas.get("secrets")!)).toBeNull();
    expect(isSortable(postsMeta, "tags")).toBe(false);
    expect(isSortable(postsMeta, "updatedAt")).toBe(true);
    expect(isSortable(postsMeta, "nope")).toBe(false);
  });
});

describe("format", () => {
  const doc = {
    id: "p1",
    title: "Hello",
    status: "draft",
    channels: ["web", "email"],
    featured: false,
    views: 3,
    publishedAt: "2026-01-02T10:30:00.000Z",
    meta: { long: "x".repeat(100) },
    author: { id: "a1", name: "Ann" },
    tags: ["t1", { id: "t2", name: "Two" }],
    summary: "y".repeat(100),
    createdAt: "2026-01-01T00:00:00.000Z",
    slug: null,
  };

  it("formats cells per field type", () => {
    const cell = (column: string) => formatCell(postsMeta, column, doc, metas);
    expect(cell("title")).toEqual({ kind: "text", text: "Hello" });
    expect(cell("slug")).toEqual({ kind: "empty" });
    expect(cell("status")).toEqual({ kind: "badges", items: ["draft"] });
    expect(cell("channels")).toEqual({ kind: "badges", items: ["web", "email"] });
    expect(cell("featured")).toEqual({ kind: "boolean", value: false });
    expect(cell("views")).toEqual({ kind: "text", text: "3" });
    expect(cell("publishedAt")).toEqual({ kind: "text", text: "2026-01-02 10:30 UTC" });
    expect(cell("createdAt")).toEqual({ kind: "text", text: "2026-01-01 00:00 UTC" });
    expect(cell("id")).toEqual({ kind: "text", text: "p1", mono: true });
    expect(cell("author")).toEqual({ kind: "text", text: "Ann" });
    expect(cell("tags")).toEqual({ kind: "text", text: "t1, Two" });
    expect(cell("meta")).toMatchObject({ kind: "text", mono: true });
    expect((cell("meta") as { text: string }).text).toHaveLength(60);
    expect((cell("summary") as { text: string }).text.endsWith("…")).toBe(true);
    expect(formatCell(postsMeta, "unknown", { unknown: 5 }, metas)).toEqual({
      kind: "text",
      text: "5",
    });
  });

  it("formats labels and titles", () => {
    expect(columnLabel(postsMeta, "createdAt")).toBe("Created");
    expect(columnLabel(postsMeta, "publishedAt")).toBe("Published at");
    expect(columnLabel(postsMeta, "nope")).toBe("nope");
    expect(documentTitle(postsMeta, { id: "x", title: "" })).toBe("x");
    expect(documentTitle(postsMeta, { id: "x", title: 7 })).toBe("7");
    expect(documentTitle(undefined, { id: 5 })).toBe("");
    expect(relationTitle(42, undefined)).toBe("");
    expect(formatDatetime("garbage")).toBe("garbage");
  });
});

describe("navigation", () => {
  it("groups modules, other collections, pages and links", () => {
    const extensions = resolveExtensions({
      pages: [{ path: "reports", label: "Reports", component: () => null }],
      nav: [
        { label: "Docs", href: "https://example.com" },
        { label: "Local", href: "settings" },
        { label: "Tags again", collection: "tags", group: "Taxonomy" },
        { label: "Unknown", collection: "nope" },
      ],
    });
    expect(buildNav(meta, extensions, "/admin")).toEqual([
      {
        label: "Content",
        links: [
          { label: "Posts", href: "/admin/posts", key: "posts", external: false },
          { label: "Authors", href: "/admin/authors", key: "authors", external: false },
        ],
      },
      {
        label: "Vault",
        links: [
          { label: "Secrets", href: "/admin/secrets", key: "secrets", external: false },
          {
            label: "Help",
            href: "https://example.com/help",
            key: "https://example.com/help",
            external: true,
          },
        ],
      },
      {
        label: "Taxonomy",
        links: [{ label: "Tags", href: "/admin/tags", key: "tags", external: false }],
      },
      {
        label: "Collections",
        links: [{ label: "Notes", href: "/admin/notes", key: "notes", external: false }],
      },
      {
        label: "Pages",
        links: [{ label: "Reports", href: "/admin/reports", key: "reports", external: false }],
      },
      {
        label: "Links",
        links: [
          {
            label: "Docs",
            href: "https://example.com",
            key: "https://example.com",
            external: true,
          },
          { label: "Local", href: "/admin/settings", key: "settings", external: false },
        ],
      },
    ]);
  });

  it("leaves out collections the user cannot read", async () => {
    const qb = await getQuickben(makeConfig());
    const anonymous = await getMeta(qb, { user: null });
    const labels = buildNav(anonymous, resolveExtensions({}), "/admin").map((g) => g.label);
    expect(labels).toEqual(["Content", "Vault", "Taxonomy", "Collections"]);
  });
});

describe("extensions and registry", () => {
  it("merge extensions in order", () => {
    const first = () => null;
    const second = () => null;
    const resolved = resolveExtensions({
      extensions: [
        {
          components: { color: first },
          views: { posts: { list: first } },
          pages: [{ path: "a", label: "A", component: first }],
        },
      ],
      components: { color: second },
      views: { posts: { edit: second } },
      pages: [{ path: "a", label: "A2", component: second }],
    });
    expect(resolved.components.color).toBe(second);
    expect(resolved.views.posts).toEqual({ list: first, edit: second });
    expect(resolved.pages).toEqual([{ path: "a", label: "A2", component: second }]);
  });

  it("checks page paths", () => {
    const config = makeConfig();
    const page = (path: string) =>
      resolveExtensions({ pages: [{ path, label: path, component: () => null }] });
    expect(() => {
      assertPages(config, page("Bad Path"));
    }).toThrow(ConfigError);
    expect(() => {
      assertPages(config, page("posts"));
    }).toThrow("also a collection slug");
    expect(() => {
      assertPages(config, page("reports"));
    }).not.toThrow();
  });

  it("normalizes base paths", () => {
    expect(normalizeBasePath("admin/")).toBe("/admin");
    expect(normalizeBasePath("/cms/admin")).toBe("/cms/admin");
  });

  it("registers instances by base path", () => {
    const config = makeConfig();
    expect(registerAdmin({ config, basePath: "/registry-test" })).toBe("/registry-test");
    expect(getAdmin("/registry-test")?.config).toBe(config);
    expect(getAdmin("/missing")).toBeUndefined();
  });

  it("resolves routes", () => {
    const slugs = new Set(["posts"]);
    const page = { path: "reports", label: "Reports", component: () => null };
    expect(resolveRoute([], slugs, [page])).toEqual({ kind: "dashboard" });
    expect(resolveRoute(["posts"], slugs, [])).toEqual({ kind: "list", slug: "posts" });
    expect(resolveRoute(["posts", "new"], slugs, [])).toEqual({ kind: "create", slug: "posts" });
    expect(resolveRoute(["posts", "p1"], slugs, [])).toEqual({
      kind: "edit",
      slug: "posts",
      id: "p1",
    });
    expect(resolveRoute(["posts", "p1", "x"], slugs, [])).toEqual({ kind: "notFound" });
    expect(resolveRoute(["nope"], slugs, [])).toEqual({ kind: "notFound" });
    expect(resolveRoute(["reports", "2024"], slugs, [page])).toEqual({
      kind: "page",
      page,
      segments: ["2024"],
    });
  });

  it("describes collections for the admin", async () => {
    const qb = await getQuickben(makeConfig());
    expect(await collectionMeta(qb.collections.secrets, { user: null })).toBeNull();
  });
});

describe("formScope", () => {
  it("is unique per document and safe in a selector", () => {
    expect(formScope("posts", null)).toBe("posts-new");
    expect(formScope("posts", "a.b:c")).toBe("posts-a_b_c");
    expect(controlId(formScope("posts", "01"), "title")).toBe("qb-posts-01-title");
  });
});
