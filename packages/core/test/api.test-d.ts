import { describe, expectTypeOf, it } from "vitest";

import { defineCollection, defineEndpoint, devAuth, fields } from "../src";

import type { AuthAdapter, AuthSecurityScheme, CollectionApi } from "../src";

describe("API description types", () => {
  it("collections take api options", () => {
    const notes = defineCollection({
      slug: "notes",
      fields: { text: fields.text() },
      api: { openapi: true },
    });
    expectTypeOf(notes.api).toEqualTypeOf<CollectionApi | undefined>();
    // @ts-expect-error -- openapi is a boolean
    defineCollection({ slug: "x", fields: {}, api: { openapi: "yes" } });
  });

  it("endpoints take an operationId", () => {
    const endpoint = defineEndpoint({
      method: "GET",
      path: "/a",
      operationId: "getA",
      handler: () => 1,
    });
    expectTypeOf(endpoint.operationId).toEqualTypeOf<string | undefined>();
  });

  it("auth adapters may describe their security schemes", () => {
    expectTypeOf(devAuth().securitySchemes).toEqualTypeOf<
      Readonly<Record<string, AuthSecurityScheme>> | undefined
    >();
    const adapter: AuthAdapter = {
      getUser: () => Promise.resolve(null),
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
    };
    expectTypeOf(adapter).toExtend<AuthAdapter>();
    const old: AuthAdapter = { getUser: () => Promise.resolve(null) };
    expectTypeOf(old.securitySchemes).toBeNullable();
    // @ts-expect-error -- apiKey needs `in` and `name`
    const bad: AuthSecurityScheme = { type: "apiKey" };
    expectTypeOf(bad).toBeObject();
  });
});
