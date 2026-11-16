import {
  defineCollection,
  defineConfig,
  defineEndpoint,
  fields,
  getQuickben,
  reply,
} from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { generateOpenApi, stringifyOpenApi } from "../src";

import { auth, createTag, fixtureConfig, listTags, ping, posts, tagById } from "./fixture";
import { validateOpenApi } from "./validate";

import type { OpenApiDocument, OpenApiOperation } from "../src";
import type { AnyEndpoint } from "@quickben/core";

function config(endpoints: readonly AnyEndpoint[], extra: { auth?: typeof auth } = {}) {
  return defineConfig({ db: memoryAdapter(), collections: [], endpoints, ...extra });
}

function operation(
  doc: OpenApiDocument,
  path: string,
  method: "get" | "post" | "put" | "patch" | "delete",
) {
  const found = doc.paths[path]?.[method];
  if (!found) throw new Error(`no ${method} ${path}`);
  return found;
}

describe("generateOpenApi", () => {
  it("keeps intersected query properties, required names and shared constraints", () => {
    const shared = z.object({ q: z.string().min(1) }).meta({ id: "QueryIntersection" });
    const endpoint = defineEndpoint({
      method: "GET",
      path: "/search",
      input: {
        query: z.intersection(shared, z.object({ q: z.string().max(5), page: z.string() })),
      },
      handler: () => ({ ok: true }),
    });
    const op = operation(generateOpenApi(config([endpoint])), "/search", "get");
    expect(op.parameters?.map((p) => [p.name, p.required])).toEqual([
      ["q", true],
      ["page", true],
    ]);
    expect(op.parameters?.[0]?.schema).toEqual({
      allOf: [
        { type: "string", minLength: 1 },
        { type: "string", maxLength: 5 },
      ],
    });
  });

  it("documents optional union and unknown bodies and bodyless statuses", () => {
    for (const body of [z.union([z.object({ name: z.string() }), z.undefined()]), z.unknown()]) {
      const endpoint = defineEndpoint({
        method: "POST",
        path: "/optional",
        access: true,
        input: { body },
        output: { 204: z.undefined(), 304: z.undefined() },
        handler: () => reply(204, undefined),
      });
      const cfg = config([endpoint]);
      const op = operation(generateOpenApi(cfg), "/optional", "post");
      expect(op.requestBody?.required).toBe(false);
      expect(op.responses["204"]?.content).toBeUndefined();
      expect(op.responses["304"]?.content).toBeUndefined();
    }
  });

  it("documents unique, nonempty required multiple fields like core", async () => {
    const collection = defineCollection({
      slug: "choices",
      api: { openapi: true },
      fields: {
        labels: fields.select({ options: ["a", "b"], many: true, required: true }),
      },
    });
    const cfg = defineConfig({ db: memoryAdapter(), collections: [collection] });
    const schemas = generateOpenApi(cfg).components?.schemas;
    const props = schemas?.ChoiceCreateInput?.properties as Record<string, unknown>;
    expect(props.labels).toMatchObject({ uniqueItems: true, minItems: 1 });
    const qb = await getQuickben(cfg);
    for (const labels of [[], ["a", "a"]]) {
      await expect(
        qb.create("choices", { labels } as never, { user: { id: "u" } }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    }
  });

  it("does not execute asynchronous input validators during generation", () => {
    for (const body of [
      z.preprocess(async (value) => {
        await Promise.resolve();
        return value;
      }, z.string()),
      z.unknown().refine(async () => {
        await Promise.resolve();
        return true;
      }),
    ]) {
      const endpoint = defineEndpoint({
        method: "POST",
        path: "/async",
        input: { body },
        handler: () => ({ ok: true }),
      });
      expect(() => generateOpenApi(config([endpoint]))).not.toThrow();
    }
  });

  it("allows null for optional literal JSON fields", async () => {
    const item = defineCollection({
      slug: "items",
      api: { openapi: true },
      fields: { state: fields.json({ schema: z.literal("ok") }) },
    });
    const cfg = defineConfig({ db: memoryAdapter(), collections: [item] });
    const schemas = generateOpenApi(cfg).components?.schemas;
    for (const name of ["Item", "ItemCreateInput", "ItemUpdateInput"]) {
      const properties = schemas?.[name]?.properties as Record<string, unknown>;
      expect(properties.state).toMatchObject({ anyOf: [{ const: "ok" }, { type: "null" }] });
    }
    const qb = await getQuickben(cfg);
    expect((await qb.create("items", { state: null }, { user: { id: "u" } })).state).toBeNull();
  });

  it("builds a valid OpenAPI 3.1 document", async () => {
    const doc = generateOpenApi(fixtureConfig());
    expect(doc.openapi).toBe("3.1.0");
    const result = await validateOpenApi(doc);
    expect(result.errors).toBeUndefined();
    expect(result.valid).toBe(true);
  });

  it("matches the snapshot", async () => {
    const text = stringifyOpenApi(generateOpenApi(fixtureConfig()));
    await expect(text).toMatchFileSnapshot("__snapshots__/fixture.openapi.json");
  });

  it("the validator rejects broken documents", async () => {
    const result = await validateOpenApi({ openapi: "3.1.0", info: { title: "x" }, paths: {} });
    expect(result.valid).toBe(false);
  });

  it("is deterministic whatever the order of endpoints", () => {
    const a = stringifyOpenApi(generateOpenApi(config([listTags, createTag, tagById, ping])));
    const b = stringifyOpenApi(generateOpenApi(config([ping, tagById, createTag, listTags])));
    expect(a).toBe(b);
    expect(Object.keys(JSON.parse(a) as object)).toEqual([
      "openapi",
      "info",
      "servers",
      "tags",
      "paths",
      "components",
    ]);
  });

  it("uses info, servers and basePath", () => {
    const doc = generateOpenApi(fixtureConfig(), {
      info: { version: "2.0.0", description: "Shop" },
      basePath: "/rest",
    });
    expect(doc.info).toEqual({ title: "Fixture", version: "2.0.0", description: "Shop" });
    expect(doc.servers).toEqual([{ url: "/rest" }]);
    const custom = generateOpenApi(fixtureConfig(), { servers: [{ url: "https://x.test/api" }] });
    expect(custom.servers).toEqual([{ url: "https://x.test/api" }]);
    expect(generateOpenApi(config([])).info.title).toBe("Quickben");
  });

  describe("security", () => {
    it("comes from the auth adapter", () => {
      const doc = generateOpenApi(fixtureConfig());
      expect(doc.components?.securitySchemes).toEqual(auth.securitySchemes);
      expect(doc.security).toEqual([{ bearer: [] }, { session: [] }]);
      // `access: true` makes credentials optional.
      expect(operation(doc, "/v1/tags", "get").security).toEqual([
        {},
        { bearer: [] },
        { session: [] },
      ]);
      expect(operation(doc, "/v1/tags", "post").security).toBeUndefined();
    });

    it("can be overridden", () => {
      const doc = generateOpenApi(fixtureConfig(), {
        securitySchemes: { key: { type: "apiKey", in: "header", name: "x-key" } },
        security: [{ key: [] }],
      });
      expect(Object.keys(doc.components?.securitySchemes ?? {})).toEqual(["key"]);
      expect(doc.security).toEqual([{ key: [] }]);
    });

    it("is absent without schemes", () => {
      const doc = generateOpenApi(config([listTags]));
      expect(doc.security).toBeUndefined();
      expect(doc.components?.securitySchemes).toBeUndefined();
      expect(operation(doc, "/v1/tags", "get").security).toBeUndefined();
    });
  });

  describe("include", () => {
    it("documents marked collections by default", () => {
      const paths = Object.keys(generateOpenApi(fixtureConfig()).paths);
      expect(paths).toContain("/posts");
      expect(paths).toContain("/authors/{id}/photo");
      expect(paths).not.toContain("/users");
    });

    it("takes a list of slugs, or false", () => {
      const listed = generateOpenApi(fixtureConfig(), {
        include: { collections: ["users"], endpoints: false },
      });
      expect(Object.keys(listed.paths)).toEqual(["/users", "/users/{id}"]);
      const none = generateOpenApi(fixtureConfig(), { include: { collections: false } });
      expect(Object.keys(none.paths).some((path) => path.startsWith("/posts"))).toBe(false);
    });

    it("filters endpoints", () => {
      const doc = generateOpenApi(fixtureConfig(), {
        include: { collections: false, endpoints: (endpoint) => endpoint.version === 1 },
      });
      expect(Object.keys(doc.paths)).toEqual(["/v1/tags"]);
    });

    it("throws on an unknown slug", () => {
      expect(() =>
        generateOpenApi(fixtureConfig(), { include: { collections: ["nope"] } }),
      ).toThrow('unknown collection "nope"');
    });
  });

  describe("endpoints", () => {
    const doc = generateOpenApi(fixtureConfig());

    it("documents query parameters from the schema", () => {
      const op = operation(doc, "/v1/tags", "get");
      expect(op.operationId).toBe("getV1Tags");
      expect(op.parameters?.map((p) => [p.name, p.in, p.required])).toEqual([
        ["limit", "query", false],
        ["q", "query", false],
        ["kind", "query", false],
      ]);
      expect(op.parameters?.[0]?.description).toBe("Largest number of tags.");
      expect(op.summary).toBe("List tags");
      expect(op.description).toBe("Every tag.");
      expect(op.tags).toEqual(["tags"]);
      expect(op["x-quickben-version"]).toBe(1);
    });

    it("documents path parameters, optional bodies and deprecation", () => {
      const op = operation(doc, "/tags/{id}", "put");
      expect(op.parameters?.[0]).toMatchObject({ name: "id", in: "path", required: true });
      expect(op.parameters?.[0]?.schema).toMatchObject({ type: "string", format: "uuid" });
      expect(op.requestBody?.required).toBe(false);
      expect(op.deprecated).toBe(true);
      expect(op["x-deprecated-at"]).toBeUndefined();
      const untyped = operation(doc, "/ping/{token}", "delete");
      expect(untyped.parameters?.[0]?.schema).toEqual({ type: "string" });
      expect(untyped.responses["200"]).toEqual({ description: "Success." });
    });

    it("shares named schemas and splits input from output", () => {
      const op = operation(doc, "/v1/tags", "post");
      expect(op.operationId).toBe("createTag");
      expect(op.requestBody?.content["application/json"]?.schema).toEqual({
        $ref: "#/components/schemas/TagInput",
      });
      expect(op.responses["201"]?.content?.["application/json"]?.schema).toEqual({
        $ref: "#/components/schemas/Tag",
      });
      const schemas = doc.components?.schemas ?? {};
      expect(schemas.Tag?.required).toEqual(["name", "color"]);
      expect(schemas.TagInput?.required).toEqual(["name"]);
      expect(op["x-deprecated-at"]).toBe("2026-01-01T00:00:00.000Z");
      expect(op["x-sunset"]).toBe("2027-01-01T00:00:00.000Z");
    });

    it("adds the standard error responses", () => {
      const op = operation(doc, "/v1/tags", "post");
      expect(Object.keys(op.responses)).toEqual([
        "201",
        "400",
        "401",
        "403",
        "409",
        "413",
        "415",
        "500",
      ]);
      expect(op.responses["400"]).toEqual({ $ref: "#/components/responses/ValidationError" });
      // A declared status wins over the shared one.
      expect(op.responses["409"]?.description).toBe("Status 409.");
      expect(doc.components?.responses?.ValidationError?.content).toEqual({
        "application/json": { schema: { $ref: "#/components/schemas/Error" } },
      });
    });

    it("keeps the same id for an output-only schema", () => {
      const Item = z.object({ id: z.string() }).meta({ id: "Item" });
      const doc2 = generateOpenApi(
        config([
          defineEndpoint({
            method: "POST",
            path: "/items",
            input: { body: Item },
            output: { 200: Item, 204: z.undefined() },
            handler: () => ({ id: "1" }),
          }),
        ]),
      );
      const op = operation(doc2, "/items", "post");
      expect(op.requestBody?.content["application/json"]?.schema).toEqual({
        $ref: "#/components/schemas/Item",
      });
      expect(op.responses["204"]?.description).toBe("No content.");
    });

    it("throws on two schemas with one id", () => {
      const a = z.object({ a: z.string() }).meta({ id: "Dup" });
      const b = z.object({ b: z.string() }).meta({ id: "Dup" });
      const endpoint = (path: string, schema: z.ZodType) =>
        defineEndpoint({ method: "GET", path, output: schema, handler: () => ({}) });
      expect(() => generateOpenApi(config([endpoint("/a", a), endpoint("/b", b)]))).toThrow(
        'component name "Dup"',
      );
    });

    it("turns recursive schemas into components", () => {
      interface Node {
        children: Node[];
      }
      const node: z.ZodType<Node> = z.object({ children: z.array(z.lazy(() => node)) });
      const doc2 = generateOpenApi(
        config([
          defineEndpoint({
            method: "GET",
            path: "/tree",
            output: node,
            handler: () => ({ children: [] }),
          }),
        ]),
      );
      const schema = operation(doc2, "/tree", "get").responses["200"]?.content?.["application/json"]
        ?.schema;
      expect(String(schema?.$ref)).toMatch(/^#\/components\/schemas\/Schema[0-9a-f]{8}$/);
    });

    it("merges paths that differ only in parameter names", async () => {
      const read = defineEndpoint({ method: "GET", path: "/items/:id", handler: () => 1 });
      const write = defineEndpoint({
        method: "POST",
        path: "/items/:itemId",
        input: { params: z.object({ itemId: z.string().min(3) }) },
        handler: () => 1,
      });
      const merged = generateOpenApi(config([read, write]));
      expect(Object.keys(merged.paths)).toEqual(["/items/{id}"]);
      expect(operation(merged, "/items/{id}", "post").parameters?.[0]).toMatchObject({
        name: "id",
        in: "path",
        schema: { type: "string", minLength: 3 },
      });
      expect((await validateOpenApi(merged)).valid).toBe(true);
    });

    it("documents the parameters of a union query schema", () => {
      const search = defineEndpoint({
        method: "GET",
        path: "/search",
        input: {
          query: z.union([
            z.object({ q: z.string(), page: z.coerce.number().optional() }),
            z.object({ q: z.string(), tag: z.string() }),
          ]),
        },
        handler: () => 1,
      });
      const op = operation(generateOpenApi(config([search])), "/search", "get");
      expect(op.parameters?.map((p) => [p.name, p.required])).toEqual([
        ["q", true],
        ["page", false],
        ["tag", false],
      ]);
    });

    it("preserves all literal alternatives of a union query parameter", () => {
      const search = defineEndpoint({
        method: "GET",
        path: "/union-query",
        input: {
          query: z.union([z.object({ kind: z.literal("a") }), z.object({ kind: z.literal("b") })]),
        },
        handler: () => 1,
      });
      const parameter = operation(generateOpenApi(config([search])), "/union-query", "get")
        .parameters?.[0];
      expect(parameter).toMatchObject({
        name: "kind",
        required: true,
        schema: {
          anyOf: [
            { type: "string", const: "a" },
            { type: "string", const: "b" },
          ],
        },
      });
    });

    it("throws on duplicate operation ids", () => {
      const a = defineEndpoint({
        method: "GET",
        path: "/a",
        operationId: "same",
        handler: () => 1,
      });
      const b = defineEndpoint({
        method: "GET",
        path: "/b",
        operationId: "same",
        handler: () => 1,
      });
      expect(() => generateOpenApi(config([a, b]))).toThrow('share operationId "same"');
    });

    it("throws when a collection route and an endpoint collide", () => {
      const items = defineCollection({ slug: "items", fields: { name: fields.text() } });
      const conflicting = {
        ...listTags,
        fullPath: "/items",
        segments: ["items"],
        operationId: "x",
      };
      const cfg = defineConfig({ db: memoryAdapter(), collections: [items] });
      expect(() =>
        generateOpenApi(
          { ...cfg, endpoints: [conflicting] },
          { include: { collections: ["items"] } },
        ),
      ).toThrow("two operations for GET /items");
    });
  });

  describe("collections", () => {
    const doc = generateOpenApi(fixtureConfig());
    const schemas = doc.components?.schemas ?? {};

    it("maps field types to JSON Schema", () => {
      const props = schemas.Post?.properties as Record<string, Record<string, unknown>>;
      expect(props.id).toEqual({ type: "string" });
      expect(props.title).toEqual({
        type: "string",
        title: "Title",
        description: "Shown in lists.",
      });
      expect(props.status).toMatchObject({ type: "string", enum: ["draft", "published"] });
      expect(props.views).toMatchObject({ type: ["integer", "null"], minimum: 0 });
      expect(props.rating).toMatchObject({ type: ["number", "null"], minimum: 0, maximum: 5 });
      expect(props.featured).toMatchObject({ type: ["boolean", "null"] });
      expect(props.publishedOn).toMatchObject({ format: "date" });
      expect(props.publishedAt).toMatchObject({ format: "date-time" });
      expect(props.author?.anyOf).toEqual([
        {
          anyOf: [{ type: "string" }, { $ref: "#/components/schemas/Author" }],
          description: "Id of a authors document, or the document with `depth` above 0.",
          title: "Author",
        },
        { type: "null" },
      ]);
      // `users` is not documented: the populated document is any object.
      expect(JSON.stringify(props.reviewer)).toContain('{"type":"object"}');
      expect(props.tags).toMatchObject({ type: "array" });
      expect(props.labels).toMatchObject({ type: "array", items: { enum: ["a", "b"] } });
      expect(JSON.stringify(props.meta)).toContain('"seo"');
      expect(JSON.stringify(props.extra)).toContain("Any JSON value.");
      expect(props.body).toMatchObject({ minLength: 1 });
      expect(schemas.Post?.description).toBe("Articles.");
    });

    it("allows projected documents and fields removed by read rules", async () => {
      expect(schemas.Author?.required).toEqual(["id"]);
      const qb = await getQuickben(fixtureConfig());
      const ctx = { user: { id: "editor" } };
      const created = await qb.create("authors", { name: "Ada" }, ctx);
      const selected = await qb.findById("authors", created.id, { select: ["name"] }, ctx);
      expect(Object.keys(selected)).toEqual(expect.arrayContaining(["id", "name"]));
      expect(Object.keys(selected)).toHaveLength(2);
      for (const key of schemas.Author?.required as string[])
        expect(Object.hasOwn(selected, key)).toBe(true);
      const props = schemas.Author?.properties as Record<string, Record<string, unknown>>;
      expect(props.email).toMatchObject({ type: ["string", "null"], format: "email" });
      expect(props.site).toMatchObject({ format: "uri" });
      expect(props.photo).toEqual({
        anyOf: [{ $ref: "#/components/schemas/FileRef", title: "Photo" }, { type: "null" }],
      });
    });

    it("makes create and update inputs", () => {
      expect(schemas.PostCreateInput?.required).toEqual(["title"]);
      expect(schemas.PostUpdateInput?.required).toBeUndefined();
      const input = schemas.PostCreateInput?.properties as Record<string, Record<string, unknown>>;
      expect(input.author).toMatchObject({ type: ["string", "null"] });
    });

    it("closes write inputs like the core validator", async () => {
      expect(schemas.AuthorCreateInput?.additionalProperties).toBe(false);
      expect(schemas.AuthorUpdateInput?.additionalProperties).toBe(false);
      const qb = await getQuickben(fixtureConfig());
      await expect(
        qb.create("authors", { name: "Ada", unknown: true } as never, { user: { id: "u" } }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    });

    it("documents the list query parameters", () => {
      const op = operation(doc, "/posts", "get");
      expect(op.operationId).toBe("listPosts");
      expect(op.parameters?.map((p) => p.name)).toEqual([
        "where",
        "sort",
        "limit",
        "page",
        "cursor",
        "select",
        "depth",
      ]);
      expect(op.parameters?.[0]?.content?.["application/json"]?.schema).toEqual({
        $ref: "#/components/schemas/PostWhere",
      });
      expect(op.parameters?.[2]?.schema).toEqual({ type: "integer", minimum: 1, maximum: 100 });
      const limited = generateOpenApi(fixtureConfig(), { maxLimit: 20 });
      expect(operation(limited, "/posts", "get").parameters?.[2]?.schema?.maximum).toBe(20);
    });

    it("lets optional select fields be null", () => {
      const props = schemas.Post?.properties as Record<string, Record<string, unknown>>;
      expect(props.priority).toMatchObject({
        type: ["string", "null"],
        enum: ["low", "high", null],
      });
    });

    it("documents filter operands without write rules", () => {
      const where = schemas.PostWhere?.properties as Record<
        string,
        { properties?: Record<string, unknown> }
      >;
      expect(where.views?.properties?.gt).toEqual({ type: "number" });
      expect(where.title?.properties?.eq).toEqual({ type: "string" });
      expect(where.status?.properties?.in).toEqual({
        type: "array",
        items: { type: "string", enum: ["draft", "published"] },
      });
    });

    it("documents where operators per field type", () => {
      const where = schemas.PostWhere?.properties as Record<string, { properties?: object }>;
      expect(Object.keys(where.title?.properties ?? {})).toContain("startsWith");
      expect(Object.keys(where.views?.properties ?? {})).toContain("gte");
      expect(Object.keys(where.views?.properties ?? {})).not.toContain("contains");
      expect(Object.keys(where.tags?.properties ?? {})).toEqual([
        "contains",
        "in",
        "notIn",
        "exists",
      ]);
      expect(Object.keys(where.meta?.properties ?? {})).toEqual(["exists"]);
      expect(Object.keys(where.status?.properties ?? {})).toEqual([
        "eq",
        "ne",
        "in",
        "notIn",
        "exists",
      ]);
      expect(Object.keys(where.createdAt?.properties ?? {})).toContain("lt");
      expect(where.and).toEqual({
        type: "array",
        items: { $ref: "#/components/schemas/PostWhere" },
      });
    });

    it("documents writes, unique conflicts and multipart uploads", () => {
      const create = operation(doc, "/authors", "post");
      expect(Object.keys(create.responses)).toContain("409");
      expect(Object.keys(create.requestBody?.content ?? {})).toEqual([
        "application/json",
        "multipart/form-data",
      ]);
      const update: OpenApiOperation = operation(doc, "/posts/{id}", "patch");
      expect(Object.keys(update.responses)).not.toContain("409");
      expect(Object.keys(update.requestBody?.content ?? {})).toEqual(["application/json"]);
      expect(operation(doc, "/posts/{id}", "delete").operationId).toBe("deletePost");
      const file = operation(doc, "/authors/{id}/photo", "get");
      expect(file.operationId).toBe("getAuthorPhoto");
      expect(Object.keys(file.responses["200"]?.content ?? {})).toEqual(["image/png"]);
    });

    it("names collections whose slug is not plural", () => {
      const news = defineCollection({ slug: "news-feed", fields: { title: fields.text() } });
      const status = defineCollection({
        slug: "status_history",
        fields: { file: fields.file({ maxBytes: 10 }) },
      });
      const classes = defineCollection({ slug: "classes", fields: { name: fields.text() } });
      const stories = defineCollection({ slug: "stories", fields: { name: fields.text() } });
      const cfg = defineConfig({
        db: memoryAdapter(),
        collections: [news, status, classes, stories],
      });
      const names = Object.keys(
        generateOpenApi(cfg, {
          include: { collections: ["news-feed", "status_history", "classes", "stories"] },
        }).components?.schemas ?? {},
      );
      expect(names).toContain("NewsFeedItem");
      expect(names).toContain("StatusHistoryItem");
      // Same rule as collection labels: "classes" → "Classe".
      expect(names).toContain("Classe");
      expect(names).toContain("Story");
      const paths = generateOpenApi(cfg, { include: { collections: ["status_history"] } }).paths;
      const file = paths["/status_history/{id}/file"]?.get;
      expect(Object.keys(file?.responses["200"]?.content ?? {})).toEqual([
        "application/octet-stream",
      ]);
    });

    it("tags operations with the collection slug", () => {
      expect(doc.tags).toEqual([
        { name: "authors", description: "Authors" },
        { name: "posts", description: "Articles." },
        { name: "tags" },
      ]);
    });

    it("uses the posts collection fixture", () => {
      expect(posts.api).toEqual({ openapi: true });
    });
  });
});
