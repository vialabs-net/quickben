import { defineConfig, defineEndpoint } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { diffOpenApi, formatDiff, generateOpenApi } from "../src";

import type { JsonSchema, OpenApiDocument, OpenApiOperation, OpenApiPathItem } from "../src";

function doc(
  paths: Record<string, OpenApiPathItem>,
  schemas: Record<string, JsonSchema> = {},
): OpenApiDocument {
  return { openapi: "3.1.0", info: { title: "t", version: "1" }, paths, components: { schemas } };
}

function json(schema: JsonSchema) {
  return { "application/json": { schema } };
}

function op(extra: Partial<OpenApiOperation> = {}): OpenApiOperation {
  return {
    responses: { "200": { description: "ok", content: json({ type: "object" }) } },
    ...extra,
  };
}

/** `[kind, breaking, allowed]` of each change. */
function kinds(base: OpenApiDocument, head: OpenApiDocument) {
  return diffOpenApi(base, head, { now: new Date("2026-06-01T00:00:00Z") }).changes.map((c) =>
    c.allowed ? [c.kind, c.breaking, c.allowed] : [c.kind, c.breaking],
  );
}

function withResponse(schema: JsonSchema, status = "200"): OpenApiDocument {
  return doc({
    "/x": { get: { responses: { [status]: { description: "ok", content: json(schema) } } } },
  });
}

function withBody(schema: JsonSchema, required = true): OpenApiDocument {
  return doc({ "/x": { post: op({ requestBody: { required, content: json(schema) } }) } });
}

const object = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: "object",
  properties,
  required,
});

describe("diffOpenApi", () => {
  it("detects new required fields in generated referenced intersections", () => {
    const shared = z.object({ name: z.string() }).meta({ id: "IntersectionBody" });
    const document = (required: boolean) =>
      generateOpenApi(
        defineConfig({
          db: memoryAdapter(),
          collections: [],
          endpoints: [
            defineEndpoint({
              method: "POST",
              path: "/x",
              input: {
                body: z.intersection(
                  shared,
                  z.object({ extra: required ? z.string() : z.string().optional() }),
                ),
              },
              handler: () => ({ ok: true }),
            }),
          ],
        }),
      );
    expect(diffOpenApi(document(false), document(true)).breaking).toBeGreaterThan(0);
    expect(diffOpenApi(document(true), document(false)).breaking).toBe(0);
  });

  it("resolves nullable enum references in requests and responses", () => {
    const schema = { anyOf: [{ $ref: "#/components/schemas/State" }, { type: "null" }] };
    const withEnum = (response: boolean, values: string[]) => {
      const document = response ? withResponse(schema) : withBody(schema);
      document.components = { schemas: { State: { type: "string", enum: values } } };
      return document;
    };
    expect(diffOpenApi(withEnum(true, ["a"]), withEnum(true, ["a", "b"])).breaking).toBeGreaterThan(
      0,
    );
    expect(
      diffOpenApi(withEnum(false, ["a", "b"]), withEnum(false, ["a"])).breaking,
    ).toBeGreaterThan(0);
  });

  it("compares effective inclusive and exclusive numeric bounds", () => {
    for (const [exclusive, inclusive] of [
      ["exclusiveMinimum", "minimum"],
      ["exclusiveMaximum", "maximum"],
    ] as const) {
      const strict = { type: "number", [exclusive]: 0 };
      const loose = { type: "number", [inclusive]: 0 };
      expect(diffOpenApi(withBody(strict), withBody(loose)).breaking).toBe(0);
      expect(diffOpenApi(withBody(loose), withBody(strict)).breaking).toBeGreaterThan(0);
      expect(diffOpenApi(withResponse(strict), withResponse(loose)).breaking).toBeGreaterThan(0);
      expect(diffOpenApi(withResponse(loose), withResponse(strict)).breaking).toBe(0);
    }
  });

  it("finds no changes in the same document", () => {
    const base = doc({ "/x": { get: op() } });
    const result = diffOpenApi(base, structuredClone(base));
    expect(result).toEqual({ breaking: 0, allowed: 0, nonBreaking: 0, changes: [] });
    expect(formatDiff(result)).toBe("No changes.\n");
  });

  it("rejects documents that are not OpenAPI", () => {
    expect(() => diffOpenApi({}, doc({}))).toThrow("The base document is not an OpenAPI document");
    expect(() => diffOpenApi(doc({}), { openapi: "3.1.0" })).toThrow("The head document");
  });

  describe("paths and operations", () => {
    it("classifies removed paths and operations as breaking", () => {
      const base = doc({ "/a": { get: op(), post: op() }, "/b": { get: op() } });
      const head = doc({ "/a": { get: op() } });
      expect(kinds(base, head)).toEqual([
        ["removed-operation", true],
        ["removed-path", true],
      ]);
    });

    it("classifies added operations as non-breaking", () => {
      expect(kinds(doc({}), doc({ "/a": { get: op() } }))).toEqual([["added-operation", false]]);
    });

    it("ignores path parameter names", () => {
      const base = doc({
        "/a/{id}": {
          get: op({
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          }),
        },
      });
      const head = doc({
        "/a/{postId}": {
          get: op({
            parameters: [
              { name: "postId", in: "path", required: true, schema: { type: "string" } },
            ],
          }),
        },
      });
      expect(kinds(base, head)).toEqual([]);
    });

    it("checks path parameter types", () => {
      const path = (type: string) =>
        doc({
          "/a/{id}": {
            get: op({ parameters: [{ name: "id", in: "path", required: true, schema: { type } }] }),
          },
        });
      expect(kinds(path("string"), path("integer"))).toEqual([["retyped", true]]);
      expect(kinds(path("integer"), path("number"))).toEqual([]);
    });

    it("allows breaking changes in a new version", () => {
      const v1 = op({
        "x-quickben-version": 1,
        responses: {
          "200": { description: "ok", content: json(object({ a: { type: "string" } }, ["a"])) },
        },
      });
      const v2 = op({
        "x-quickben-version": 2,
        responses: {
          "200": { description: "ok", content: json(object({ b: { type: "string" } }, ["b"])) },
        },
      });
      const base = doc({ "/v1/items": { get: v1 } });
      const head = doc({ "/v1/items": { get: v1 }, "/v2/items": { get: v2 } });
      const result = diffOpenApi(base, head);
      expect(result.breaking).toBe(0);
      expect(result.allowed).toBe(1);
      expect(kinds(base, head)).toEqual([
        ["added-version", false],
        ["removed-field", true, "version"],
        ["added-field", false],
      ]);
      expect(formatDiff(result)).toMatchInlineSnapshot(`
        "Allowed breaking changes (1):
          GET /v2/items: response 200 field "a" was removed [allowed: version]

        Non-breaking changes (2):
          GET /v2/items: new version 2 of /v1/items
          GET /v2/items: response 200 field "b" was added
        "
      `);
    });

    it("treats a removed version as breaking", () => {
      const base = doc({ "/v1/items": { get: op() }, "/items": { post: op() } });
      const head = doc({ "/v2/items": { get: op() }, "/v1/items": { post: op() } });
      const result = diffOpenApi(base, head);
      expect(result.changes.map((c) => [c.kind, c.path, c.message])).toEqual([
        ["removed-version", "/v1/items", "this version was removed (version 2 remains)"],
        ["removed-version", "/items", "this version was removed (version 1 remains)"],
        ["added-version", "/v2/items", "new version 2 of /v1/items"],
        ["added-version", "/v1/items", "new version 1 of /items"],
      ]);
      expect(result.breaking).toBe(2);
    });

    it("reads the version from the path when the extension is missing", () => {
      const base = doc({ "/v1/items": { get: op() } });
      const head = doc({ "/items": { get: op() } });
      expect(diffOpenApi(base, head).changes[0]?.message).toBe(
        "this version was removed (no version remains)",
      );
    });

    it("allows removing a deprecated operation after its sunset", () => {
      const old = op({ deprecated: true, "x-sunset": "2026-01-01T00:00:00.000Z" });
      const later = op({ deprecated: true, "x-sunset": "2027-01-01T00:00:00.000Z" });
      expect(kinds(doc({ "/a": { get: old } }), doc({}))).toEqual([
        ["removed-operation", true, "sunset"],
      ]);
      expect(kinds(doc({ "/a": { get: later } }), doc({}))).toEqual([["removed-path", true]]);
      expect(kinds(doc({ "/a": { get: op({ "x-sunset": "2020-01-01" }) } }), doc({}))).toEqual([
        ["removed-path", true],
      ]);
    });

    it("reports new deprecations", () => {
      const base = doc({ "/a": { get: op() } });
      const head = doc({ "/a": { get: op({ deprecated: true }) } });
      expect(kinds(base, head)).toEqual([["deprecated", false]]);
    });
  });

  describe("parameters", () => {
    const query = (parameters: OpenApiOperation["parameters"]) =>
      doc({ "/a": { get: op({ parameters }) } });

    it("classifies new, removed and required parameters", () => {
      const base = query([
        { name: "a", in: "query", schema: { type: "string" } },
        { name: "gone", in: "query", schema: { type: "string" } },
      ]);
      const head = query([
        { name: "a", in: "query", required: true, schema: { type: "string" } },
        { name: "b", in: "query", required: true, schema: { type: "string" } },
        { name: "c", in: "header", schema: { type: "string" } },
      ]);
      expect(kinds(base, head)).toEqual([
        ["parameter-required", true],
        ["added-required-parameter", true],
        ["added-parameter", false],
        ["removed-parameter", false],
      ]);
    });

    it("compares parameter schemas, also in content", () => {
      const base = query([
        { name: "n", in: "query", schema: { type: "integer" } },
        { name: "w", in: "query", content: json({ type: "object" }) },
      ]);
      const head = query([
        { name: "n", in: "query", schema: { type: "string", enum: ["a"] } },
        { name: "w", in: "query", content: json({ type: "string" }) },
      ]);
      expect(kinds(base, head)).toEqual([
        ["retyped", true],
        ["retyped", true],
      ]);
    });

    it("resolves parameter references", () => {
      const base: OpenApiDocument = {
        ...query([{ $ref: "#/components/parameters/P" } as never]),
        components: {
          parameters: { P: { name: "p", in: "query", schema: { type: "string" } } },
        } as never,
      };
      const head = query([{ name: "p", in: "query", required: true, schema: { type: "string" } }]);
      expect(kinds(base, head)).toEqual([["parameter-required", true]]);
    });
  });

  describe("request bodies", () => {
    it("classifies required, removed and changed bodies", () => {
      const none = doc({ "/x": { post: op() } });
      expect(kinds(none, withBody({ type: "object" }))).toEqual([["added-required-body", true]]);
      expect(kinds(none, withBody({ type: "object" }, false))).toEqual([]);
      expect(kinds(withBody({ type: "object" }, false), withBody({ type: "object" }))).toEqual([
        ["added-required-body", true],
      ]);
      expect(kinds(withBody({ type: "object" }), none)).toEqual([["removed-body", false]]);
    });

    it("treats a removed media type as breaking", () => {
      const head = doc({ "/x": { post: op({ requestBody: { content: { "text/plain": {} } } }) } });
      expect(kinds(withBody({ type: "object" }, false), head)).toEqual([
        ["removed-media-type", true],
      ]);
    });

    it("classifies request fields", () => {
      const base = object(
        {
          keep: { type: "string" },
          opt: { type: "string" },
          drop: { type: "string" },
          n: { type: "number" },
        },
        ["keep"],
      );
      const head = object(
        {
          keep: { type: "string" },
          opt: { type: "string" },
          added: { type: "string" },
          req: { type: "string" },
          n: { type: "integer" },
        },
        ["keep", "opt", "req"],
      );
      expect(kinds(withBody(base), withBody(head))).toEqual([
        ["field-required", true],
        ["removed-field", false],
        ["retyped", true],
        ["added-field", false],
        ["added-required-field", true],
      ]);
    });

    it("treats a removed field of a closed object as breaking", () => {
      const base = object({ a: { type: "string" } });
      const head = { ...object({}), additionalProperties: false };
      expect(kinds(withBody(base), withBody(head))).toEqual([
        ["removed-field", true],
        ["narrowed-constraint", true],
      ]);
    });

    it("classifies request enums", () => {
      const e = (...values: string[]) => object({ s: { type: "string", enum: values } });
      expect(kinds(withBody(e("a", "b")), withBody(e("a")))).toEqual([["narrowed-enum", true]]);
      expect(kinds(withBody(e("a")), withBody(e("a", "b")))).toEqual([["widened-enum", false]]);
      expect(kinds(withBody(object({ s: { type: "string" } })), withBody(e("a")))).toEqual([
        ["narrowed-enum", true],
      ]);
      expect(kinds(withBody(e("a")), withBody(object({ s: { type: "string" } })))).toEqual([]);
    });

    it("treats a type that is no longer any as narrowed", () => {
      expect(
        kinds(withBody(object({ v: {} })), withBody(object({ v: { type: "string" } }))),
      ).toEqual([["retyped", true]]);
      expect(
        kinds(withBody(object({ v: { type: "string" } })), withBody(object({ v: {} }))),
      ).toEqual([]);
    });
  });

  describe("responses", () => {
    it("classifies status codes", () => {
      const base = doc({
        "/x": { get: { responses: { "200": { description: "ok" }, "404": { description: "x" } } } },
      });
      const head = doc({
        "/x": {
          get: {
            responses: {
              "200": { description: "ok" },
              "202": { description: "x" },
              "409": { description: "x" },
            },
          },
        },
      });
      expect(kinds(base, head)).toEqual([
        ["added-status", true],
        ["removed-status", true],
        ["added-status", false],
      ]);
    });

    it("classifies response fields", () => {
      const base = object({ a: { type: "string" }, b: { type: "string" }, c: { type: "string" } }, [
        "a",
        "b",
      ]);
      const head = object(
        { a: { type: ["string", "null"] }, b: { type: "string" }, d: { type: "string" } },
        ["a"],
      );
      expect(kinds(withResponse(base), withResponse(head))).toEqual([
        ["retyped", true],
        ["field-optional", true],
        ["removed-field", true],
        ["added-field", false],
      ]);
    });

    it("classifies response enums", () => {
      const e = (schema: JsonSchema) => withResponse(object({ s: schema }));
      expect(kinds(e({ enum: ["a"] }), e({ enum: ["a", "b"] }))).toEqual([["widened-enum", true]]);
      expect(kinds(e({ enum: ["a", "b"] }), e({ enum: ["a"] }))).toEqual([
        ["narrowed-enum", false],
      ]);
      expect(kinds(e({ const: "a" }), e({ type: "string" }))).toEqual([["widened-enum", true]]);
      expect(
        kinds(
          e({ anyOf: [{ const: "a" }, { type: "null" }] }),
          e({ anyOf: [{ enum: ["a", "b"] }, { type: "null" }] }),
        ),
      ).toEqual([["widened-enum", true]]);
      expect(
        kinds(e({ anyOf: [{ const: "a" }, { type: "string" }] }), e({ type: "string" })),
      ).toEqual([]);
    });

    it("treats a response that becomes any as retyped", () => {
      expect(
        kinds(withResponse(object({ v: { type: "string" } })), withResponse(object({ v: {} }))),
      ).toEqual([["retyped", true]]);
    });

    it("compares array items and nullable objects", () => {
      const base = {
        type: "array",
        items: { anyOf: [object({ a: { type: "string" } }, ["a"]), { type: "null" }] },
      };
      const head = { type: "array", items: { anyOf: [object({}), { type: "null" }] } };
      const result = diffOpenApi(withResponse(base), withResponse(head));
      expect(result.changes.map((c) => c.message)).toEqual([
        'response 200 field "[].a" was removed',
      ]);
    });

    it("follows references and stops on recursive schemas", () => {
      const node = (extra: Record<string, JsonSchema>) =>
        object({
          children: { type: "array", items: { $ref: "#/components/schemas/Node" } },
          ...extra,
        });
      const base = doc(
        { "/x": { get: { responses: { "200": { $ref: "#/components/responses/R" } } } } },
        { Node: node({ name: { type: "string" } }) },
      );
      base.components = {
        ...base.components,
        responses: {
          R: { description: "r", content: json({ $ref: "#/components/schemas/Node" }) },
        },
      };
      const head = structuredClone(base);
      const schemas = head.components?.schemas;
      if (schemas) schemas.Node = node({});
      const messages = diffOpenApi(base, head).changes.map((c) => c.message);
      // The recursion into `children[]` stops at the schema already being compared.
      expect(messages).toEqual(['response 200 field "name" was removed']);
    });

    it("leaves unresolvable references alone", () => {
      const broken = withResponse({ $ref: "#/components/schemas/Missing" });
      const external = withResponse({ $ref: "https://x.test/schema.json" });
      expect(kinds(broken, structuredClone(broken))).toEqual([]);
      expect(kinds(external, broken)).toEqual([]);
    });
  });

  describe("security", () => {
    const secured = (
      security: OpenApiOperation["security"],
      schemes: Record<string, unknown> = { session: { type: "apiKey", in: "cookie", name: "sid" } },
    ): OpenApiDocument => ({
      ...doc({ "/x": { get: op(security ? { security } : {}) } }),
      components: { securitySchemes: schemes as never },
      security: [{ session: [] }],
    });

    it("treats credentials that become required as breaking", () => {
      expect(kinds(secured([{}, { session: [] }]), secured(undefined))).toEqual([
        ["security-required", true],
      ]);
      expect(kinds(doc({ "/x": { get: op() } }), secured(undefined))).toEqual([
        ["security-required", true],
      ]);
      expect(kinds(secured(undefined), secured([{}, { session: [] }]))).toEqual([]);
    });

    it("detects newly required OAuth scopes but allows scope relaxation", () => {
      const schemes = {
        session: {
          type: "oauth2",
          flows: {
            clientCredentials: {
              tokenUrl: "https://auth.test/token",
              scopes: { read: "Read", write: "Write" },
            },
          },
        },
      };
      const before = secured([{ session: ["read"] }], schemes);
      const after = secured([{ session: ["read", "write"] }], schemes);
      expect(diffOpenApi(before, after).breaking).toBe(1);
      expect(diffOpenApi(after, before).breaking).toBe(0);
      expect(
        diffOpenApi(
          before,
          secured([{ session: ["read", "write"] }, { session: ["read"] }], schemes),
        ).breaking,
      ).toBe(0);
    });

    it("allows relaxing an AND of credentials", () => {
      const both = secured([{ session: [], bearer: [] }]);
      const one = secured([{ session: [] }]);
      expect(diffOpenApi(both, one).breaking).toBe(0);
      expect(diffOpenApi(one, both).breaking).toBe(1);
    });

    it("ignores documentation and key order of security schemes", () => {
      const base = secured(undefined, {
        session: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Old" },
      });
      const head = secured(undefined, {
        session: { description: "New", scheme: "bearer", type: "http" },
      });
      expect(diffOpenApi(base, head).changes).toEqual([]);
    });

    it("treats removed or changed schemes as breaking", () => {
      const both = secured([{ session: [] }, { bearer: [] }]);
      expect(kinds(both, secured([{ session: [] }]))).toEqual([["removed-security", true]]);
      const renamed = secured(undefined, { session: { type: "apiKey", in: "cookie", name: "x" } });
      expect(diffOpenApi(secured(undefined), renamed).changes.map((c) => c.message)).toEqual([
        'security scheme "session" changed',
      ]);
      expect(kinds(secured(undefined), secured(undefined))).toEqual([]);
    });
  });

  describe("constraints", () => {
    it("treats narrower request bounds as breaking", () => {
      const limit = (schema: JsonSchema) =>
        doc({ "/a": { get: op({ parameters: [{ name: "limit", in: "query", schema }] }) } });
      expect(
        kinds(limit({ type: "integer", maximum: 100 }), limit({ type: "integer", maximum: 25 })),
      ).toEqual([["narrowed-constraint", true]]);
      expect(kinds(limit({ type: "integer", maximum: 25 }), limit({ type: "integer" }))).toEqual([
        ["widened-constraint", false],
      ]);
      expect(kinds(limit({ type: "integer" }), limit({ type: "integer", minimum: 1 }))).toEqual([
        ["narrowed-constraint", true],
      ]);
      const text = (maxLength: number) => withBody(object({ s: { type: "string", maxLength } }));
      expect(diffOpenApi(text(100), text(10)).changes.map((c) => c.message)).toEqual([
        'request field "s" maxLength changed from 100 to 10',
      ]);
    });

    it("compares object closure and typed additional properties", () => {
      const open = { type: "object", properties: { a: { type: "string" } } };
      const closed = { ...open, additionalProperties: false };
      expect(diffOpenApi(withBody(open), withBody(closed)).breaking).toBe(1);
      expect(diffOpenApi(withBody(closed), withBody(open)).breaking).toBe(0);
      expect(diffOpenApi(withResponse(closed), withResponse(open)).breaking).toBe(1);
      const typed = { ...open, additionalProperties: { type: "string" } };
      expect(diffOpenApi(withBody(open), withBody(typed)).breaking).toBe(1);
      expect(diffOpenApi(withResponse(typed), withResponse(open)).breaking).toBe(1);
    });

    it("compares tuple elements in both directions", () => {
      const tuple = (type: string) => ({
        type: "array",
        prefixItems: [{ type }],
        minItems: 1,
        maxItems: 1,
      });
      expect(diffOpenApi(withBody(tuple("string")), withBody(tuple("number"))).breaking).toBe(1);
      expect(
        diffOpenApi(withResponse(tuple("string")), withResponse(tuple("number"))).breaking,
      ).toBe(1);
    });

    it("compares multipleOf by inclusion in each direction", () => {
      const n = (multipleOf?: number): JsonSchema => ({
        type: "number",
        ...(multipleOf === undefined ? {} : { multipleOf }),
      });
      expect(diffOpenApi(withBody(n(2)), withBody(n(3))).breaking).toBe(1);
      expect(diffOpenApi(withBody(n(2)), withBody(n(4))).breaking).toBe(1);
      expect(diffOpenApi(withBody(n(4)), withBody(n(2))).breaking).toBe(0);
      expect(diffOpenApi(withResponse(n(4)), withResponse(n(2))).breaking).toBe(1);
      expect(diffOpenApi(withResponse(n(2)), withResponse(n(4))).breaking).toBe(0);
      expect(diffOpenApi(withBody(n()), withBody(n(2))).breaking).toBe(1);
      expect(diffOpenApi(withResponse(n(2)), withResponse(n())).breaking).toBe(1);
      expect(diffOpenApi(withBody(n(0.3)), withBody(n(0.1))).breaking).toBe(0);
    });

    it("treats wider response bounds and changed patterns as breaking", () => {
      const count = (schema: JsonSchema) => withResponse(object({ n: schema }));
      expect(
        kinds(count({ type: "integer", maximum: 5 }), count({ type: "integer", maximum: 9 })),
      ).toEqual([["widened-constraint", true]]);
      expect(
        kinds(count({ type: "integer", minimum: 0 }), count({ type: "integer", minimum: 1 })),
      ).toEqual([["narrowed-constraint", false]]);
      const code = (pattern?: string) =>
        withBody(object({ c: pattern ? { type: "string", pattern } : { type: "string" } }));
      expect(kinds(code("^a"), code("^b"))).toEqual([["narrowed-constraint", true]]);
      expect(kinds(code(), code("^b"))).toEqual([["narrowed-constraint", true]]);
      expect(kinds(code("^a"), code())).toEqual([["widened-constraint", false]]);
    });
  });

  describe("unions and maps", () => {
    it("compares union branches one by one", () => {
      const union = (type: string) =>
        withResponse({
          anyOf: [object({ kind: { const: "a" }, n: { type } }), object({ kind: { const: "b" } })],
        });
      expect(diffOpenApi(union("string"), union("number")).changes.map((c) => c.message)).toEqual([
        'response 200 field "<1>.n" changed type from string to number',
      ]);
    });

    it("checks removed request variants, added response variants and reordered unions", () => {
      const a = object({ kind: { const: "a" }, name: { type: "string" } }, ["kind", "name"]);
      const b = object({ kind: { const: "b" } }, ["kind"]);
      const c = object({ kind: { const: "c" } }, ["kind"]);
      const union = (...anyOf: JsonSchema[]): JsonSchema => ({ anyOf });
      expect(diffOpenApi(withBody(union(a, b)), withBody(a)).breaking).toBeGreaterThan(0);
      expect(diffOpenApi(withResponse(a), withResponse(union(a, b))).breaking).toBeGreaterThan(0);
      expect(diffOpenApi(withBody(union(a, b)), withBody(union(b, a))).breaking).toBe(0);
      expect(diffOpenApi(withResponse(union(a, b)), withResponse(union(b, a))).breaking).toBe(0);
      expect(diffOpenApi(withBody(a), withBody(union(a, b))).breaking).toBe(0);
      expect(diffOpenApi(withResponse(union(a, b)), withResponse(a)).breaking).toBe(0);
      const withoutName = object({ kind: { const: "a" } }, ["kind"]);
      expect(
        diffOpenApi(withResponse(union(a, b, c)), withResponse(union(withoutName, b))).breaking,
      ).toBeGreaterThan(0);
    });

    it("compares the values of maps", () => {
      const map = (type: string) =>
        withResponse({ type: "object", additionalProperties: { type } });
      expect(diffOpenApi(map("string"), map("number")).changes.map((c) => c.message)).toEqual([
        'response 200 field "*" changed type from string to number',
      ]);
    });
  });

  it("formats every group", () => {
    const base = doc({
      "/a": { get: op() },
      "/b": { get: op({ deprecated: true, "x-sunset": "2020-01-01" }) },
    });
    const head = doc({ "/a": { get: op({ deprecated: true }) } });
    expect(formatDiff(diffOpenApi(base, head))).toMatchInlineSnapshot(`
      "Allowed breaking changes (1):
        GET /b: the operation was removed after its sunset date [allowed: sunset]

      Non-breaking changes (1):
        GET /a: the operation is now deprecated
      "
    `);
    const removed = formatDiff(diffOpenApi(base, doc({})));
    expect(removed).toContain("Breaking changes (1):\n  GET /a: the path was removed");
  });
});
