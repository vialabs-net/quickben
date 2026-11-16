import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { diffOpenApi } from "../src";

import { validateOpenApi } from "./validate";

import type { OpenApiDocument } from "../src";

// The playground commits its document; CI regenerates it (`pnpm openapi:check`).
const file = join(import.meta.dirname, "../../../apps/playground/openapi.json");

describe("playground openapi.json", async () => {
  const doc = JSON.parse(await readFile(file, "utf8")) as OpenApiDocument;

  it("is a valid OpenAPI 3.1 document", async () => {
    const result = await validateOpenApi(doc);
    expect(result.errors).toBeUndefined();
    expect(result.valid).toBe(true);
  });

  it("documents the endpoints and the marked collections", () => {
    expect(Object.keys(doc.paths)).toEqual([
      "/authors",
      "/authors/{id}",
      "/authors/{id}/photo",
      "/posts",
      "/posts/{id}",
      "/tags",
      "/tags/{id}",
      "/v1/posts/published",
      "/v1/posts/{id}/publish",
    ]);
    expect(Object.keys(doc.components?.securitySchemes ?? {})).toEqual(["devUser", "role"]);
  });

  it("has no changes against itself", () => {
    expect(diffOpenApi(doc, structuredClone(doc)).changes).toEqual([]);
  });
});
