import { describe, expect, it, vi } from "vitest";

import { createOpenApiHandler } from "../src";

import { fixtureConfig } from "./fixture";

import type { AuthAdapter } from "@quickben/core";

const signedIn: AuthAdapter = { getUser: () => Promise.resolve({ id: "u1" }) };
const anonymous: AuthAdapter = { getUser: () => Promise.resolve(null) };

function get(path: string, method = "GET") {
  return new Request(`http://localhost${path}`, { method });
}

describe("createOpenApiHandler", () => {
  it("is off by default", async () => {
    const handler = createOpenApiHandler(fixtureConfig({ auth: signedIn }));
    expect(await handler(get("/api/openapi.json"))).toBeNull();
  });

  it("serves the document to signed-in users", async () => {
    const handler = createOpenApiHandler(fixtureConfig({ auth: signedIn }), {
      serve: true,
      basePath: "/rest/",
      info: { version: "3.0.0" },
    });
    expect(await handler(get("/rest/other"))).toBeNull();
    const response = await handler(get("/rest/openapi.json"));
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    const doc = (await response?.json()) as { info: { version: string }; servers: unknown };
    expect(doc.info.version).toBe("3.0.0");
    expect(doc.servers).toEqual([{ url: "/rest" }]);
    const head = await handler(get("/rest/openapi.json", "HEAD"));
    expect(head?.status).toBe(200);
    expect(await head?.text()).toBe("");
  });

  it("refuses anonymous users and rules that say no", async () => {
    const closed = createOpenApiHandler(fixtureConfig({ auth: anonymous }), { serve: true });
    const response = await closed(get("/api/openapi.json"));
    expect(response?.status).toBe(401);
    const head = await closed(get("/api/openapi.json", "HEAD"));
    expect(head?.status).toBe(401);
    expect(head?.body).toBeNull();
    expect(await response?.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    const rule = vi.fn(() => false);
    const denied = createOpenApiHandler(fixtureConfig({ auth: signedIn }), {
      serve: true,
      access: rule,
    });
    expect((await denied(get("/api/openapi.json")))?.status).toBe(403);
    expect(rule).toHaveBeenCalledWith(expect.objectContaining({ user: { id: "u1" } }));
  });

  it("can be public", async () => {
    const open = createOpenApiHandler(fixtureConfig({ auth: anonymous }), {
      serve: true,
      access: true,
    });
    expect((await open(get("/api/openapi.json")))?.status).toBe(200);
    const cfg = { ...fixtureConfig(), auth: undefined };
    const noAuth = createOpenApiHandler(cfg, { serve: true, access: () => true });
    expect((await noAuth(get("/api/openapi.json")))?.status).toBe(200);
  });

  it("answers other methods with 405", async () => {
    const handler = createOpenApiHandler(fixtureConfig({ auth: signedIn }), { serve: true });
    const response = await handler(get("/api/openapi.json", "POST"));
    expect(response?.status).toBe(405);
    expect(response?.headers.get("allow")).toBe("GET");
  });
});
