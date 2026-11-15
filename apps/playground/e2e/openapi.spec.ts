import { expect, test } from "@playwright/test";

// GET /api/openapi.json, served by createRouteHandlers(config, { openapi: { serve: true } }).
test.skip(
  process.env.QUICKBEN_TENANCY === "1" || process.env.QUICKBEN_AUTH === "better-auth",
  "single-tenant playground with the demo auth only",
);

test("serves the OpenAPI document to signed-in users", async ({ request }) => {
  const response = await request.get("/api/openapi.json", {
    headers: { "x-quickben-user": JSON.stringify({ id: "viewer", roles: ["viewer"] }) },
  });
  expect(response.status()).toBe(200);
  const doc = (await response.json()) as { openapi: string; paths: Record<string, unknown> };
  expect(doc.openapi).toBe("3.1.0");
  expect(Object.keys(doc.paths)).toContain("/v1/posts/{id}/publish");
  expect(Object.keys(doc.paths)).toContain("/posts");

  const anonymous = await request.get("/api/openapi.json", {
    headers: { cookie: "qb-playground-role=anonymous" },
  });
  expect(anonymous.status()).toBe(401);
});
