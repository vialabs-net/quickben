import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ConfigError,
  defineCollection,
  defineConfig,
  defineEndpoint,
  definePlugin,
  endpointFactory,
  fields as f,
} from "../src";

import { testAdapter } from "./helpers";

import type { EndpointDefinition, EndpointInputSchemas, EndpointOutput } from "../src";

type Definition = EndpointDefinition<string, EndpointInputSchemas, EndpointOutput | undefined>;

const ok = () => ({ ok: true });
const items = defineCollection({ slug: "items", fields: { name: f.text() } });

function endpoint(overrides: Partial<Definition> = {}) {
  return defineEndpoint({
    method: "GET",
    path: "/status",
    handler: ok,
    ...overrides,
  });
}

function config(endpoints: readonly ReturnType<typeof endpoint>[]) {
  return defineConfig({ db: testAdapter(), collections: [items], endpoints });
}

describe("defineEndpoint", () => {
  it("resolves the mounted path and segments", () => {
    const unversioned = endpoint({ path: "/orders/:id/start" });
    expect(unversioned.fullPath).toBe("/orders/:id/start");
    expect(unversioned.segments).toEqual(["orders", ":id", "start"]);
    const versioned = endpoint({ path: "/orders/:id", version: 2 });
    expect(versioned.fullPath).toBe("/v2/orders/:id");
    expect(versioned.version).toBe(2);
  });

  it.each([
    ["status", "must start"],
    ["/", "must start"],
    ["/a/", "must start"],
    ["/a//b", 'invalid segment ""'],
    ["/a b", "invalid segment"],
    ["/a/./b", "invalid segment"],
    ["/a/../b", "invalid segment"],
    ["/a/:1d", "invalid parameter"],
    ["/a/:id/b/:id", "is repeated"],
  ])("refuses the path %s", (path, message) => {
    expect(() => endpoint({ path })).toThrow(message);
  });

  it("refuses bad methods, versions, dates, limits and GET bodies", () => {
    expect(() => endpoint({ method: "HEAD" as never })).toThrow('unknown method "HEAD"');
    expect(() => endpoint({ version: 0 })).toThrow("positive integer");
    expect(() => endpoint({ version: 1.5 })).toThrow("positive integer");
    expect(() => endpoint({ deprecated: "soon" })).toThrow("deprecated is not a valid date");
    expect(() => endpoint({ sunset: "never" })).toThrow("sunset is not a valid date");
    expect(() => endpoint({ maxBodyBytes: 0 })).toThrow("maxBodyBytes");
    expect(() => endpoint({ input: { body: z.object({}) } })).toThrow("GET endpoints have no body");
    expect(() =>
      endpoint({ deprecated: new Date("2026-01-01"), sunset: new Date("2027-01-01") }),
    ).not.toThrow();
  });

  it("endpointFactory defines the same endpoint", () => {
    const define = endpointFactory();
    expect(define({ method: "POST", path: "/x", version: 1, handler: ok }).fullPath).toBe("/v1/x");
  });
});

describe("config endpoints", () => {
  it("keeps endpoints in order, plugin endpoints after the config ones", () => {
    const plugin = definePlugin({
      name: "extra",
      endpoints: [endpoint({ path: "/extra" })],
    });
    const result = defineConfig({
      db: testAdapter(),
      collections: [items],
      endpoints: [endpoint()],
      plugins: [plugin],
    });
    expect(result.endpoints?.map((e) => e.fullPath)).toEqual(["/status", "/extra"]);
    expect(defineConfig({ db: testAdapter(), collections: [] }).endpoints).toEqual([]);
  });

  it("allows the same path in several versions and methods", () => {
    const result = config([
      endpoint({ path: "/orders" }),
      endpoint({ path: "/orders", version: 1 }),
      endpoint({ path: "/orders", version: 2 }),
      endpoint({ path: "/orders", version: 2, method: "POST" }),
    ]);
    expect(result.endpoints).toHaveLength(4);
  });

  it("refuses duplicate routes, also with other parameter names", () => {
    expect(() => config([endpoint(), endpoint()])).toThrow("same route (GET /status)");
    expect(() =>
      config([endpoint({ path: "/o/:id", version: 1 }), endpoint({ path: "/o/:key", version: 1 })]),
    ).toThrow(ConfigError);
  });

  it("refuses reserved paths", () => {
    expect(() => config([endpoint({ path: "/_meta" })])).toThrow('"_meta" is reserved');
    expect(() => config([endpoint({ path: "/_x" })])).toThrow("reserved");
    expect(() => config([endpoint({ path: "/v1/x" })])).toThrow('"v1" is reserved');
    expect(() => config([endpoint({ path: "/:id" })])).toThrow("reserved");
    expect(() => config([endpoint({ path: "/items" })])).toThrow("path of a collection");
    expect(() => config([endpoint({ path: "/items/count" })])).toThrow("path of a collection");
    expect(() => config([endpoint({ path: "/:id", version: 1 })])).not.toThrow();
  });

  it("refuses a version prefix that is a collection slug", () => {
    const v1 = defineCollection({ slug: "v1", fields: { name: f.text() } });
    expect(() =>
      defineConfig({
        db: testAdapter(),
        collections: [v1],
        endpoints: [endpoint({ version: 1 })],
      }),
    ).toThrow("path of a collection");
  });

  it("checks endpoint objects that plugins build by hand", () => {
    const plugin = definePlugin({
      name: "raw",
      endpoints: [{ ...endpoint(), path: "bad" }],
    });
    expect(() => defineConfig({ db: testAdapter(), collections: [], plugins: [plugin] })).toThrow(
      "must start",
    );
  });
});
