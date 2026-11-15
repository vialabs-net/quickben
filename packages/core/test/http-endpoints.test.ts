import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  defineCollection,
  defineConfig,
  defineEndpoint,
  fields as f,
  getQuickben,
  NotFoundError,
  reply,
} from "../src";
import { handleEndpointRequest, HttpError, readBytes } from "../src/http";

import { system, testAdapter } from "./helpers";

import type { AnyEndpoint, AuthAdapter, Quickben } from "../src";
import type { EndpointRequestOptions } from "../src/http";

const BASE = "https://app.test/api";

/** `x-user: u1` or `Authorization: Bearer u1` sign in as `u1`. */
const auth: AuthAdapter = {
  getUser(req) {
    const bearer = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
    const id = bearer ?? req.headers.get("x-user");
    return Promise.resolve(id ? { id, roles: id === "admin" ? ["admin"] : [] } : null);
  },
};

const notes = defineCollection({
  slug: "notes",
  fields: { text: f.text({ required: true }) },
  access: { read: () => true, create: () => true },
  hooks: {
    afterCommit: [
      () => {
        events.push("commit");
      },
    ],
  },
});

const events: string[] = [];

const health = defineEndpoint({
  method: "GET",
  path: "/health",
  access: true,
  output: z.object({ ok: z.boolean() }),
  handler: () => ({ ok: true }),
});

const getNote = defineEndpoint({
  method: "GET",
  path: "/notes/:id",
  version: 1,
  access: true,
  input: { params: z.object({ id: z.string().min(2) }) },
  output: {
    200: z.object({ id: z.string(), text: z.string() }),
    404: z.object({ missing: z.string() }),
  },
  handler: async ({ input, qb, ctx }) => {
    try {
      const doc = await qb.findById("notes", input.params.id, {}, ctx);
      return reply(200, { id: doc.id, text: String(doc.text) });
    } catch (error) {
      if (error instanceof NotFoundError) return reply(404, { missing: input.params.id });
      throw error;
    }
  },
});

const latestNote = defineEndpoint({
  method: "GET",
  path: "/notes/latest",
  version: 1,
  access: true,
  handler: () => ({ latest: true }),
});

const createNotes = defineEndpoint({
  method: "POST",
  path: "/notes",
  version: 1,
  transactional: true,
  input: {
    body: z.object({ texts: z.array(z.string()).min(1), fail: z.boolean().optional() }),
    query: z.object({ dry: z.enum(["yes", "no"]).optional() }),
  },
  output: z.object({ ids: z.array(z.string()) }),
  handler: async ({ input, qb, ctx }) => {
    const ids: string[] = [];
    for (const text of input.body.texts) ids.push((await qb.create("notes", { text }, ctx)).id);
    if (input.body.fail) throw new HttpError(409, "CONFLICT", "Refused after writing");
    return { status: 201, body: { ids }, headers: { location: `/api/v1/notes/${ids[0] ?? ""}` } };
  },
});

const createNotesV2 = defineEndpoint({
  method: "POST",
  path: "/notes",
  version: 2,
  deprecated: true,
  sunset: "2027-01-01T00:00:00Z",
  access: ({ user }) => user?.roles?.includes("admin") ?? false,
  input: { body: z.object({ text: z.string() }) },
  handler: () => undefined,
});

const echo = defineEndpoint({
  method: "PUT",
  path: "/echo/:a/:b",
  deprecated: "2026-01-01T00:00:00Z",
  maxBodyBytes: 32,
  input: { body: z.unknown() },
  handler: ({ input, user }) => ({
    params: input.params,
    query: input.query,
    body: input.body,
    user: user?.id,
  }),
});

const broken = defineEndpoint({
  method: "GET",
  path: "/broken",
  access: true,
  output: z.object({ n: z.number() }),
  handler: () => ({ n: "one" }) as never,
});

const unlisted = defineEndpoint({
  method: "GET",
  path: "/unlisted",
  access: true,
  output: { 200: z.object({ n: z.number() }) },
  handler: () => ({ status: 202, body: { n: 1 } }) as never,
});

const file = defineEndpoint({
  method: "GET",
  path: "/file",
  access: true,
  handler: async () => {
    const upstream = await Promise.resolve(Response.redirect("https://app.test/elsewhere", 302));
    return upstream;
  },
});

const plain = defineEndpoint({
  method: "GET",
  path: "/plain",
  access: true,
  handler: () => new Response("hello", { headers: { "content-type": "text/plain" } }),
});

const crash = defineEndpoint({
  method: "DELETE",
  path: "/crash",
  handler: () => {
    throw new Error("boom");
  },
});

const endpoints: AnyEndpoint[] = [
  health,
  getNote,
  latestNote,
  createNotes,
  createNotesV2,
  echo,
  broken,
  unlisted,
  file,
  plain,
  crash,
];

function makeConfig() {
  return defineConfig({ db: testAdapter(), collections: [notes], auth, endpoints });
}

let config = makeConfig();

function call(
  method: string,
  path: string,
  init: { body?: unknown; headers?: Record<string, string>; raw?: string } = {},
  options?: EndpointRequestOptions,
) {
  const headers: Record<string, string> = { ...init.headers };
  let body: string | undefined = init.raw;
  if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers["content-type"] ??= "application/json";
  }
  return handleEndpointRequest(
    config,
    new Request(`${BASE}${path}`, { method, headers, body }),
    options,
  );
}

async function jsonOf(response: Response | null): Promise<unknown> {
  expect(response).not.toBeNull();
  return response!.json();
}

afterEach(() => {
  config = makeConfig();
  events.length = 0;
  vi.restoreAllMocks();
});

describe("matching", () => {
  it("returns null without endpoints, outside the base path or for unknown paths", async () => {
    const empty = defineConfig({ db: testAdapter(), collections: [] });
    expect(await handleEndpointRequest(empty, new Request(`${BASE}/health`))).toBeNull();
    expect(
      await handleEndpointRequest(config, new Request("https://app.test/other/health")),
    ).toBeNull();
    expect(await call("GET", "/notes")).toBeNull();
    expect(await call("GET", "/v3/notes")).toBeNull();
    expect(await call("GET", "/%E0%A4%A")).toBeNull();
  });

  it("serves under a custom base path", async () => {
    const response = await handleEndpointRequest(
      config,
      new Request("https://app.test/rest/health/"),
      {
        basePath: "rest/",
      },
    );
    expect(await jsonOf(response)).toEqual({ ok: true });
  });

  it("prefers static segments over parameters", async () => {
    expect(await jsonOf(await call("GET", "/v1/notes/latest"))).toEqual({ latest: true });
  });

  it("answers 405 with Allow for a known path and another method", async () => {
    const response = await call("PATCH", "/v1/notes");
    expect(response?.status).toBe(405);
    expect(response?.headers.get("allow")).toBe("POST");
    expect(await jsonOf(response)).toMatchObject({ error: { code: "METHOD_NOT_ALLOWED" } });
  });
});

describe("versioning and deprecation", () => {
  it("serves several versions of a path", async () => {
    const v1 = await call("POST", "/v1/notes", {
      body: { texts: ["a"] },
      headers: { "x-user": "u1" },
    });
    expect(v1?.status).toBe(201);
    const v2 = await call("POST", "/v2/notes", {
      body: { text: "a" },
      headers: { "x-user": "admin" },
    });
    expect(v2?.status).toBe(204);
    expect(v2?.headers.get("deprecation")).toBe("true");
    expect(v2?.headers.get("sunset")).toBe("Fri, 01 Jan 2027 00:00:00 GMT");
    expect(v1?.headers.get("deprecation")).toBeNull();
  });

  it("sets the deprecation date and keeps the headers on errors", async () => {
    const response = await call("PUT", "/echo/x/y", { body: 1 });
    expect(response?.status).toBe(401);
    expect(response?.headers.get("deprecation")).toBe("@1767225600");
  });
});

describe("input", () => {
  it("passes params, query and body", async () => {
    const response = await call("PUT", "/echo/a%20b/c?x=1&y=2&y=3", {
      body: { n: 1 },
      headers: { "x-user": "u1" },
    });
    expect(await jsonOf(response)).toEqual({
      params: { a: "a b", b: "c" },
      query: { x: "1", y: ["2", "3"] },
      body: { n: 1 },
      user: "u1",
    });
  });

  it("answers 400 VALIDATION with prefixed issues", async () => {
    const response = await call("POST", "/v1/notes?dry=maybe", {
      body: { texts: [] },
      headers: { "x-user": "u1" },
    });
    expect(response?.status).toBe(400);
    const body = (await jsonOf(response)) as {
      error: { code: string; details: { issues: { path: string }[] } };
    };
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.details.issues.map((issue) => issue.path)).toEqual([
      "query.dry",
      "body.texts",
    ]);
    const params = await call("GET", "/v1/notes/x");
    expect(await jsonOf(params)).toMatchObject({
      error: { details: { issues: [{ path: "params.id" }] } },
    });
  });

  it("refuses an empty, invalid, non-JSON or too large body", async () => {
    const user = { "x-user": "u1" };
    const empty = await call("POST", "/v1/notes", { headers: user });
    expect(await jsonOf(empty)).toMatchObject({
      error: { details: { issues: [{ path: "body" }] } },
    });
    const invalid = await call("POST", "/v1/notes", {
      raw: "{",
      headers: { ...user, "content-type": "application/json" },
    });
    expect(await jsonOf(invalid)).toMatchObject({
      error: { details: { issues: [{ path: "body", message: "Invalid JSON body" }] } },
    });
    const text = await call("POST", "/v1/notes", {
      raw: "a",
      headers: { ...user, "content-type": "text/plain" },
    });
    expect(text?.status).toBe(415);
    const large = await call("PUT", "/echo/a/b", { body: "x".repeat(40), headers: user });
    expect(large?.status).toBe(413);
    const fallback = await call(
      "POST",
      "/v1/notes",
      { body: { texts: ["a".repeat(20)] }, headers: user },
      { maxBodyBytes: 8 },
    );
    expect(fallback?.status).toBe(413);
  });
});

describe("access", () => {
  it("allows authenticated users by default", async () => {
    expect((await call("POST", "/v1/notes", { body: { texts: ["a"] } }))?.status).toBe(401);
    expect(
      (await call("POST", "/v1/notes", { body: { texts: ["a"] }, headers: { "x-user": "u1" } }))
        ?.status,
    ).toBe(201);
  });

  it("runs access rules before validation", async () => {
    const anonymous = await call("POST", "/v2/notes", { body: {} });
    expect(anonymous?.status).toBe(401);
    const user = await call("POST", "/v2/notes", { body: {}, headers: { "x-user": "u1" } });
    expect(await jsonOf(user)).toMatchObject({
      error: { code: "FORBIDDEN", message: "Not allowed to call POST /v2/notes" },
    });
  });

  it("refuses access: false and works without an auth adapter", async () => {
    const closed = defineEndpoint({
      method: "GET",
      path: "/closed",
      access: false,
      handler: () => 1,
    });
    const noAuth = defineConfig({
      db: testAdapter(),
      collections: [],
      endpoints: [closed, health],
    });
    const response = await handleEndpointRequest(noAuth, new Request(`${BASE}/closed`));
    expect(response?.status).toBe(401);
    expect((await handleEndpointRequest(noAuth, new Request(`${BASE}/health`)))?.status).toBe(200);
  });
});

describe("CSRF", () => {
  const body = { texts: ["a"] };

  it("blocks cross-site cookie requests on unsafe methods", async () => {
    const cross = await call("POST", "/v1/notes", {
      body,
      headers: { "x-user": "u1", cookie: "session=u1", origin: "https://evil.test" },
    });
    expect(cross?.status).toBe(403);
    const site = await call("POST", "/v1/notes", {
      body,
      headers: { "x-user": "u1", cookie: "session=u1", "sec-fetch-site": "cross-site" },
    });
    expect(site?.status).toBe(403);
    const same = await call("POST", "/v1/notes", {
      body,
      headers: { "x-user": "u1", cookie: "session=u1", origin: "https://app.test" },
    });
    expect(same?.status).toBe(201);
  });

  it("allows header authentication without cookies and rejects mixed cookie credentials", async () => {
    const header = await call("POST", "/v1/notes", {
      body,
      headers: { "x-user": "u1", origin: "https://mobile.test" },
    });
    expect(header?.status).toBe(201);
    const mixed = await call("POST", "/v1/notes", {
      body,
      headers: {
        "x-user": "u1",
        cookie: "session=u1",
        authorization: "Bearer ignored-by-cookie-adapter",
        origin: "https://evil.test",
      },
    });
    expect(mixed?.status).toBe(403);
  });

  it("allows anonymous unsafe endpoints without checking the origin", async () => {
    const publicWrite = defineEndpoint({
      method: "POST",
      path: "/public",
      access: true,
      handler: () => 1,
    });
    const publicConfig = defineConfig({
      db: testAdapter(),
      collections: [],
      endpoints: [publicWrite],
    });
    const response = await handleEndpointRequest(
      publicConfig,
      new Request(`${BASE}/public`, {
        method: "POST",
        headers: { origin: "https://other.test", cookie: "unrelated=1" },
      }),
    );
    expect(response?.status).toBe(200);
  });

  it("lets Bearer requests, trusted origins, GET and csrf: false through", async () => {
    const bearer = await call("POST", "/v1/notes", {
      body,
      headers: { authorization: "Bearer u1", origin: "https://mobile.test" },
    });
    expect(bearer?.status).toBe(201);
    const trusted = await call(
      "POST",
      "/v1/notes",
      { body, headers: { "x-user": "u1", cookie: "session=u1", origin: "https://admin.test" } },
      { csrf: { trustedOrigins: ["https://admin.test"] } },
    );
    expect(trusted?.status).toBe(201);
    const off = await call(
      "POST",
      "/v1/notes",
      { body, headers: { "x-user": "u1", cookie: "session=u1", origin: "https://evil.test" } },
      { csrf: false },
    );
    expect(off?.status).toBe(201);
    const get = await call("GET", "/health", { headers: { origin: "https://evil.test" } });
    expect(get?.status).toBe(200);
  });
});

describe("results and errors", () => {
  it("sends replies with status and headers, and no-store", async () => {
    const response = await call("POST", "/v1/notes", {
      body: { texts: ["a"] },
      headers: { "x-user": "u1" },
    });
    expect(response?.headers.get("location")).toMatch(/^\/api\/v1\/notes\/.+/);
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
  });

  it("validates per-status output", async () => {
    const qb: Quickben = await getQuickben(config);
    const doc = await qb.create("notes", { text: "hi" }, system);
    expect(await jsonOf(await call("GET", `/v1/notes/${doc.id}`))).toEqual({
      id: doc.id,
      text: "hi",
    });
    const missing = await call("GET", "/v1/notes/nope");
    expect(missing?.status).toBe(404);
    expect(await jsonOf(missing)).toEqual({ missing: "nope" });
  });

  it("answers 500 and logs when the output does not match", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await call("GET", "/broken");
    expect(response?.status).toBe(500);
    expect(await jsonOf(response)).toMatchObject({ error: { code: "INTERNAL" } });
    expect(log).toHaveBeenCalledWith(
      "[quickben] Endpoint GET /broken returned status 200 with output that does not match its schema",
      [{ path: "n", message: expect.any(String) as string }],
    );
    expect((await call("GET", "/unlisted"))?.status).toBe(500);
    expect(log).toHaveBeenLastCalledWith(expect.any(String), [
      { path: "", message: "No output schema for status 202" },
    ]);
  });

  it("skips output validation in production unless asked", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(await jsonOf(await call("GET", "/broken"))).toEqual({ n: "one" });
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      expect((await call("GET", "/broken", {}, { validateOutput: true }))?.status).toBe(500);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(await jsonOf(await call("GET", "/broken", {}, { validateOutput: false }))).toEqual({
      n: "one",
    });
  });

  it("passes Response results through and copies immutable ones", async () => {
    const response = await call("GET", "/plain");
    expect(await response?.text()).toBe("hello");
    const redirect = await call("GET", "/file");
    expect(redirect?.status).toBe(302);
    const deprecated = defineEndpoint({
      method: "GET",
      path: "/old-file",
      access: true,
      deprecated: true,
      handler: () => Response.redirect("https://app.test/x", 302),
    });
    const withOld = defineConfig({ db: testAdapter(), collections: [], endpoints: [deprecated] });
    const copied = await handleEndpointRequest(withOld, new Request(`${BASE}/old-file`));
    expect(copied?.status).toBe(302);
    expect(copied?.headers.get("deprecation")).toBe("true");
    expect(copied?.headers.get("location")).toBe("https://app.test/x");
  });

  it("hides unexpected errors as 500 INTERNAL", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await call("DELETE", "/crash", { headers: { "x-user": "u1" } });
    expect(response?.status).toBe(500);
    expect(await jsonOf(response)).toEqual({
      error: { code: "INTERNAL", message: "Internal server error", details: null },
    });
    expect(log).toHaveBeenCalled();
  });
});

describe("transactions", () => {
  it("commits and then runs afterCommit hooks", async () => {
    const response = await call("POST", "/v1/notes", {
      body: { texts: ["a", "b"] },
      headers: { "x-user": "u1" },
    });
    expect(response?.status).toBe(201);
    expect(events).toEqual(["commit", "commit"]);
    const qb = await getQuickben(config);
    expect((await qb.find("notes", {}, system)).docs).toHaveLength(2);
  });

  it("rolls back when the handler throws", async () => {
    const response = await call("POST", "/v1/notes", {
      body: { texts: ["a", "b"], fail: true },
      headers: { "x-user": "u1" },
    });
    expect(response?.status).toBe(409);
    expect(await jsonOf(response)).toMatchObject({
      error: { code: "CONFLICT", message: "Refused after writing" },
    });
    expect(events).toEqual([]);
    const qb = await getQuickben(config);
    expect((await qb.find("notes", {}, system)).docs).toHaveLength(0);
  });

  it("rolls back when the output does not match", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const badWrite = defineEndpoint({
      method: "POST",
      path: "/bad-write",
      access: true,
      transactional: true,
      output: z.object({ id: z.number() }),
      handler: async ({ qb }) => {
        const doc = await qb.create("notes", { text: "x" }, system);
        return { id: doc.id } as never;
      },
    });
    const withBad = defineConfig({
      db: testAdapter(),
      collections: [notes],
      endpoints: [badWrite],
    });
    const response = await handleEndpointRequest(
      withBad,
      new Request(`${BASE}/bad-write`, { method: "POST" }),
    );
    expect(response?.status).toBe(500);
    expect(events).toEqual([]);
    const qb = await getQuickben(withBad);
    expect((await qb.find("notes", {}, system)).docs).toHaveLength(0);
  });
});

describe("HEAD, root base path and transforms", () => {
  it("serves HEAD with the GET endpoint and no body", async () => {
    const response = await call("HEAD", "/health");
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("application/json");
    expect(await response?.text()).toBe("");
    expect((await call("HEAD", "/v1/notes"))?.status).toBe(405);
  });

  it("mounts at the root with basePath /", async () => {
    const response = await handleEndpointRequest(config, new Request("https://app.test/health"), {
      basePath: "/",
    });
    expect(await jsonOf(response)).toEqual({ ok: true });
  });

  it("sends the result unchanged: output schemas do not transform", async () => {
    const transformed = defineEndpoint({
      method: "GET",
      path: "/n",
      access: true,
      output: z.object({ n: z.string().transform(Number), extra: z.string().default("d") }),
      handler: () => ({ n: 42, extra: "e" }) as never,
    });
    const typed = defineEndpoint({
      method: "GET",
      path: "/m",
      access: true,
      output: z.object({ n: z.number(), extra: z.string() }),
      handler: () => ({ n: 42, extra: "e" }),
    });
    const both = defineConfig({
      db: testAdapter(),
      collections: [],
      endpoints: [transformed, typed],
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bad = await handleEndpointRequest(both, new Request(`${BASE}/n`));
    expect(bad?.status).toBe(500);
    const good = await handleEndpointRequest(both, new Request(`${BASE}/m`));
    expect(await jsonOf(good)).toEqual({ n: 42, extra: "e" });
  });
});

describe("readBytes", () => {
  it("reads empty bodies and refuses a declared size over the limit", async () => {
    expect(await readBytes(new Request(BASE), 10)).toEqual(new Uint8Array());
    const declared = new Request(BASE, {
      method: "POST",
      body: "abc",
      headers: { "content-length": "99" },
    });
    await expect(readBytes(declared, 10)).rejects.toMatchObject({ status: 413 });
  });
});
