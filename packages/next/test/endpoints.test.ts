import { defineConfig, defineEndpoint, devAuth } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createRouteHandlers } from "../src";

import { authors, editor, posts, request } from "./fixtures";

const count = defineEndpoint({
  method: "GET",
  path: "/posts-count",
  version: 1,
  access: true,
  output: z.object({ count: z.number() }),
  handler: async ({ qb, ctx }) => ({ count: await qb.count("posts", {}, ctx) }),
});

const rename = defineEndpoint({
  method: "PUT",
  path: "/authors/:id/name",
  version: 1,
  input: { body: z.object({ name: z.string().min(1) }) },
  output: z.object({ id: z.string(), name: z.string() }),
  handler: async ({ input, qb, ctx }) => {
    const doc = await qb.update(
      "authors",
      input.params.id,
      { name: input.body.name },
      {
        ...ctx,
        overrideAccess: true,
      },
    );
    return { id: doc.id, name: String(doc.name) };
  },
});

function handlers(options: Parameters<typeof createRouteHandlers>[1] = {}) {
  const config = defineConfig({
    db: memoryAdapter(),
    collections: [authors, posts],
    auth: devAuth(),
    endpoints: [count, rename],
  });
  return { api: createRouteHandlers(config, options), config };
}

describe("custom endpoints in createRouteHandlers", () => {
  it("serves endpoints before the CRUD routes", async () => {
    const { api } = handlers();
    const response = await api.GET(request("GET", "/api/v1/posts-count"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 0 });
    const crud = await api.GET(request("GET", "/api/posts"));
    expect(crud.status).toBe(200);
  });

  it("answers PUT for endpoints and 405 for CRUD paths", async () => {
    const { api } = handlers();
    const created = await api.POST(
      request("POST", "/api/authors", { user: editor, body: { name: "Ann" } }),
    );
    const { id } = (await created.json()) as { id: string };
    const renamed = await api.PUT(
      request("PUT", `/api/v1/authors/${id}/name`, { user: editor, body: { name: "Bo" } }),
    );
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toEqual({ id, name: "Bo" });
    const crud = await api.PUT(request("PUT", `/api/authors/${id}`, { user: editor, body: {} }));
    expect(crud.status).toBe(405);
  });

  it("applies the base path, CSRF and body limit options", async () => {
    const { api } = handlers({ basePath: "/rest", maxBodyBytes: 16 });
    const big = await api.PUT(
      request("PUT", "/rest/v1/authors/x/name", { user: editor, body: { name: "x".repeat(40) } }),
    );
    expect(big.status).toBe(413);
    const cross = await api.PUT(
      request("PUT", "/rest/v1/authors/x/name", {
        user: editor,
        body: { name: "x" },
        headers: { origin: "https://evil.test" },
      }),
    );
    expect(cross.status).toBe(403);
  });
});
