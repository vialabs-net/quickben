import { beforeEach, describe, expect, it, vi } from "vitest";

import { createRouteHandlers, toSearchParams } from "../src";

import { admin, editor, makeConfig, request } from "./fixtures";

import type { ErrorBody, MetaResponse, RouteHandlers } from "../src";

let api: RouteHandlers;

beforeEach(() => {
  api = createRouteHandlers(makeConfig());
});

async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function createPost(data: Record<string, unknown>, user = editor) {
  const response = await api.POST(request("POST", "/api/posts", { user, body: data }));
  return body<{ id: string } & Record<string, unknown>>(response);
}

describe("POST /:collection", () => {
  it("creates a document and returns 201", async () => {
    const response = await api.POST(
      request("POST", "/api/posts", { user: editor, body: { title: "Hello" } }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const doc = await body(response);
    expect(doc).toMatchObject({ title: "Hello", status: "draft", createdBy: "system" });
  });

  it("strips id, createdAt and updatedAt from the body", async () => {
    const doc = await createPost({
      title: "Hello",
      id: "chosen",
      createdAt: "2000-01-01T00:00:00.000Z",
      updatedAt: "2000-01-01T00:00:00.000Z",
    });
    expect(doc.id).not.toBe("chosen");
    expect(doc.createdAt).not.toBe("2000-01-01T00:00:00.000Z");
  });

  it("returns validation issues as details", async () => {
    const response = await api.POST(
      request("POST", "/api/posts", { user: editor, body: { title: 5, views: -1 } }),
    );
    expect(response.status).toBe(400);
    const { error } = await body<ErrorBody>(response);
    expect(error.code).toBe("VALIDATION");
    expect(error.details?.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "title" })]),
    );
  });

  it("returns 409 with the field for unique conflicts", async () => {
    await createPost({ title: "A", slug: "a" });
    const response = await api.POST(
      request("POST", "/api/posts", { user: editor, body: { title: "B", slug: "a" } }),
    );
    expect(response.status).toBe(409);
    expect((await body<ErrorBody>(response)).error).toMatchObject({
      code: "CONFLICT",
      details: { field: "slug" },
    });
  });

  it("returns 401 without a user", async () => {
    const response = await api.POST(request("POST", "/api/posts", { body: { title: "A" } }));
    expect(response.status).toBe(401);
    expect((await body<ErrorBody>(response)).error.code).toBe("UNAUTHORIZED");
  });

  it("rejects bodies that are not JSON objects", async () => {
    const notJson = await api.POST(request("POST", "/api/posts", { user: editor, body: "{oops" }));
    expect(notJson.status).toBe(400);
    const array = await api.POST(request("POST", "/api/posts", { user: editor, body: [1] }));
    expect((await body<ErrorBody>(array)).error.details).toEqual({
      issues: [{ path: "", message: "Expected a JSON object" }],
    });
  });

  it("requires a JSON content type", async () => {
    const response = await api.POST(
      request("POST", "/api/posts", {
        user: editor,
        body: "title=A",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
    );
    expect(response.status).toBe(415);
    expect((await body<ErrorBody>(response)).error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("accepts JSON media type suffixes", async () => {
    const response = await api.POST(
      request("POST", "/api/posts", {
        user: editor,
        body: { title: "A" },
        headers: { "content-type": "application/merge-patch+json; charset=utf-8" },
      }),
    );
    expect(response.status).toBe(201);
  });
});

describe("GET /:collection", () => {
  beforeEach(async () => {
    await createPost({ title: "Draft", views: 1 });
    await createPost({ title: "Live", status: "published", views: 10 });
    await createPost({ title: "Also live", status: "published", views: 5 });
  });

  it("applies read access", async () => {
    const anonymous = await body<{ docs: { title: string }[] }>(
      await api.GET(request("GET", "/api/posts")),
    );
    expect(anonymous.docs.map((doc) => doc.title).sort((a, b) => a.localeCompare(b))).toEqual([
      "Also live",
      "Live",
    ]);
  });

  it("reads where, sort, limit, page and select from the query string", async () => {
    const params = toSearchParams({
      where: { views: { gte: 5 } },
      sort: ["-views"],
      limit: 1,
      page: 2,
      select: ["title"],
    });
    const result = await body(
      await api.GET(request("GET", `/api/posts?${params.toString()}`, { user: editor })),
    );
    expect(result).toMatchObject({
      docs: [{ title: "Also live" }],
      page: 2,
      totalDocs: 2,
      totalPages: 2,
      hasNextPage: false,
    });
    expect(Object.keys((result.docs as object[])[0]!)).toEqual(
      expect.arrayContaining(["id", "title"]),
    );
    expect(Object.keys((result.docs as object[])[0]!)).toHaveLength(2);
  });

  it("supports cursors and repeated sort keys", async () => {
    const first = await body<{ nextCursor: string; docs: { title: string }[] }>(
      await api.GET(request("GET", "/api/posts?sort=title&limit=2", { user: editor })),
    );
    expect(first.docs.map((doc) => doc.title)).toEqual(["Also live", "Draft"]);
    const next = await body<{ docs: { title: string }[]; page: null }>(
      await api.GET(
        request("GET", `/api/posts?sort=title&limit=2&cursor=${first.nextCursor}`, {
          user: editor,
        }),
      ),
    );
    expect(next.docs.map((doc) => doc.title)).toEqual(["Live"]);
    expect(next.page).toBeNull();
    const repeated = await body<{ docs: { title: string }[] }>(
      await api.GET(request("GET", "/api/posts?sort=-status&sort=title", { user: editor })),
    );
    expect(repeated.docs.map((doc) => doc.title)).toEqual(["Also live", "Live", "Draft"]);
  });

  it("populates relations with depth", async () => {
    const author = await body<{ id: string }>(
      await api.POST(request("POST", "/api/authors", { user: editor, body: { name: "Ann" } })),
    );
    await createPost({ title: "By Ann", author: author.id });
    const result = await body<{ docs: { author: { name: string } }[] }>(
      await api.GET(
        request(
          "GET",
          `/api/posts?depth=1&where=${encodeURIComponent('{"title":{"eq":"By Ann"}}')}`,
          { user: editor },
        ),
      ),
    );
    expect(result.docs[0]?.author.name).toBe("Ann");
  });

  it.each([
    ["where=nope", "where"],
    ["where=[1]", "where"],
    ["limit=abc", "limit"],
    ["limit=500", "limit"],
    ["limit=1&limit=2", "limit"],
    ["status=draft", "status"],
    ["sort=nope", "sort.0"],
    ["depth=9", "depth"],
  ])("rejects ?%s", async (query, path) => {
    const response = await api.GET(request("GET", `/api/posts?${query}`, { user: editor }));
    expect(response.status).toBe(400);
    const { error } = await body<ErrorBody>(response);
    expect(error.details?.issues).toEqual([expect.objectContaining({ path })]);
  });

  it("returns 404 for unknown collections", async () => {
    const response = await api.GET(request("GET", "/api/nope"));
    expect(response.status).toBe(404);
  });
});

describe("GET, PATCH and DELETE /:collection/:id", () => {
  it("reads, updates and deletes one document", async () => {
    const created = await createPost({ title: "One" });
    const path = `/api/posts/${created.id}`;

    const read = await api.GET(request("GET", `${path}?select=title`, { user: editor }));
    expect(await body(read)).toEqual({ id: created.id, title: "One" });

    const updated = await api.PATCH(
      request("PATCH", path, { user: editor, body: { title: "Two", id: "other" } }),
    );
    expect(updated.status).toBe(200);
    expect(await body(updated)).toMatchObject({ id: created.id, title: "Two" });

    const forbidden = await api.DELETE(request("DELETE", path, { user: editor }));
    expect(forbidden.status).toBe(403);

    const deleted = await api.DELETE(request("DELETE", path, { user: admin }));
    expect(await body(deleted)).toMatchObject({ id: created.id, title: "Two" });

    const gone = await api.GET(request("GET", path, { user: editor }));
    expect(gone.status).toBe(404);
  });

  it("hides documents filtered out by read access", async () => {
    const draft = await createPost({ title: "Hidden" });
    const response = await api.GET(request("GET", `/api/posts/${draft.id}`));
    expect(response.status).toBe(404);
  });

  it("rejects unknown read parameters", async () => {
    const draft = await createPost({ title: "Draft" });
    const response = await api.GET(
      request("GET", `/api/posts/${draft.id}?limit=1`, { user: editor }),
    );
    expect(response.status).toBe(400);
  });

  it("decodes ids in the path", async () => {
    const response = await api.GET(request("GET", "/api/posts/a%20b", { user: editor }));
    expect((await body<ErrorBody>(response)).error.message).toContain('"a b"');
  });
});

describe("GET /_meta", () => {
  it("describes only what the user can read", async () => {
    const meta = await body<MetaResponse>(
      await api.GET(request("GET", "/api/_meta", { user: editor })),
    );
    expect(meta.title).toBe("Test");
    expect(meta.user).toMatchObject({ id: "e1" });
    expect(meta.collections.map((c) => c.slug)).toEqual(["authors", "posts"]);
    const posts = meta.collections.find((c) => c.slug === "posts")!;
    expect(posts.access).toEqual({ create: true, update: true, delete: false });
    expect(posts.admin).toMatchObject({ useAsTitle: "title", group: "Content" });
    expect(posts.fields.find((field) => field.name === "status")).toMatchObject({
      type: "select",
      options: ["draft", "published"],
      default: "draft",
      required: true,
    });
    expect(posts.fields.find((field) => field.name === "createdBy")).not.toHaveProperty("default");
    expect(posts.fields.find((field) => field.name === "author")).toMatchObject({
      to: "authors",
    });
    expect(posts.fields.find((field) => field.name === "views")).toMatchObject({
      integer: true,
      min: 0,
    });
    expect(posts.fields.find((field) => field.name === "title")).toMatchObject({
      maxLength: 50,
    });
    expect(meta.modules).toEqual([
      {
        key: "content",
        label: "Content",
        collections: ["posts", "authors"],
        nav: [
          { label: "Posts", collection: "posts" },
          { label: "Docs", href: "https://example.com" },
        ],
      },
    ]);
  });

  it("includes admin-only collections for admins", async () => {
    const meta = await body<MetaResponse>(
      await api.GET(request("GET", "/api/_meta", { user: admin })),
    );
    expect(meta.collections.map((c) => c.slug)).toContain("secrets");
    expect(meta.modules.map((m) => m.key)).toEqual(["content", "vault"]);
  });

  it("only answers GET", async () => {
    const response = await api.POST(request("POST", "/api/_meta", { body: {} }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });
});

describe("routing", () => {
  it.each([
    ["GET", "/api"],
    ["GET", "/api/posts/1/extra"],
    ["GET", "/other/posts"],
    ["GET", "/api/%E0%A4%A"],
  ])("returns 404 for %s %s", async (method, path) => {
    const response = await api.GET(request(method, path));
    expect(response.status).toBe(404);
    expect((await body<ErrorBody>(response)).error.code).toBe("NOT_FOUND");
  });

  it("returns 405 with Allow for the wrong method", async () => {
    const response = await api.PATCH(request("PATCH", "/api/posts", { body: {} }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST");
  });

  it("supports a custom base path and trailing slashes", async () => {
    const custom = createRouteHandlers(makeConfig(), { basePath: "cms/v1/" });
    const response = await custom.GET(request("GET", "/cms/v1/posts/"));
    expect(response.status).toBe(200);
  });

  it("hides unexpected errors behind a generic 500", async () => {
    const config = makeConfig();
    const failing = createRouteHandlers({
      ...config,
      auth: { getUser: () => Promise.reject(new Error("secret detail")) },
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await failing.GET(request("GET", "/api/posts"));
    expect(response.status).toBe(500);
    expect(await body(response)).toEqual({
      error: { code: "INTERNAL", message: "Internal server error", details: null },
    });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("works without an auth adapter", async () => {
    const config = makeConfig();
    const anonymous = createRouteHandlers({ ...config, auth: undefined });
    const response = await anonymous.GET(request("GET", "/api/posts"));
    expect(response.status).toBe(200);
  });
});

describe("CSRF", () => {
  const post = (headers: Record<string, string>) =>
    api.POST(request("POST", "/api/posts", { user: editor, body: { title: "A" }, headers }));

  it("allows same-origin and header-less requests", async () => {
    expect((await post({ origin: "http://localhost:3000" })).status).toBe(201);
    expect((await post({})).status).toBe(201);
    expect((await post({ "sec-fetch-site": "same-origin" })).status).toBe(201);
  });

  it("allows the forwarded host", async () => {
    const response = await post({
      origin: "https://app.example.com",
      "x-forwarded-host": "app.example.com",
    });
    expect(response.status).toBe(201);
  });

  it("blocks other origins", async () => {
    const cases: Record<string, string>[] = [
      { origin: "https://evil.example" },
      { origin: "null" },
      { "sec-fetch-site": "cross-site" },
    ];
    for (const headers of cases) {
      const response = await post(headers);
      expect(response.status).toBe(403);
      expect((await body<ErrorBody>(response)).error.message).toBe("Cross-origin request blocked");
    }
  });

  it("allows trusted origins, or can be turned off", async () => {
    const trusted = createRouteHandlers(makeConfig(), {
      csrf: { trustedOrigins: ["https://admin.example"] },
    });
    const response = await trusted.POST(
      request("POST", "/api/posts", {
        user: editor,
        body: { title: "A" },
        headers: { origin: "https://admin.example" },
      }),
    );
    expect(response.status).toBe(201);
    const off = createRouteHandlers(makeConfig(), { csrf: false });
    const crossSite = await off.DELETE(
      request("DELETE", "/api/posts/x", {
        user: admin,
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(crossSite.status).toBe(404);
  });

  it("does not check GET requests", async () => {
    const response = await api.GET(
      request("GET", "/api/posts", { headers: { origin: "https://evil.example" } }),
    );
    expect(response.status).toBe(200);
  });
});
