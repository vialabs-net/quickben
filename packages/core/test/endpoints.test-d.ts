import { describe, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { defineConfig, defineEndpoint, endpointFactory, reply } from "../src";

import { posts, tags, users } from "./fixtures";
import { testAdapter } from "./helpers";

import type {
  ConfigRegistry,
  EndpointInputOf,
  EndpointReply,
  EndpointResultOf,
  InferDoc,
  PathParams,
  Quickben,
  QuickbenUser,
} from "../src";

describe("endpoint types", () => {
  it("reads parameter names from the path", () => {
    expectTypeOf<PathParams<"/a/:id/b/:key">>().toEqualTypeOf<"id" | "key">();
    expectTypeOf<PathParams<"/a/b">>().toEqualTypeOf<never>();
    expectTypeOf<EndpointInputOf<"/a/:id", object>>().toEqualTypeOf<{
      params: { id: string };
      query: Record<string, string | string[]>;
      body: undefined;
    }>();
  });

  it("infers input from the schemas", () => {
    defineEndpoint({
      method: "POST",
      path: "/orders/:id/start",
      version: 1,
      input: {
        params: z.object({ id: z.uuid() }),
        query: z.object({ dry: z.coerce.boolean().optional() }),
        body: z.object({ amount: z.number(), note: z.string().default("") }),
      },
      output: z.object({ ok: z.boolean() }),
      handler: ({ input, qb, user, req, ctx }) => {
        expectTypeOf(input.params).toEqualTypeOf<{ id: string }>();
        expectTypeOf(input.query).toEqualTypeOf<{ dry?: boolean }>();
        expectTypeOf(input.body).toEqualTypeOf<{ amount: number; note: string }>();
        expectTypeOf(qb).toEqualTypeOf<Quickben>();
        expectTypeOf(user).toEqualTypeOf<QuickbenUser | null>();
        expectTypeOf(req).toEqualTypeOf<Request>();
        expectTypeOf(ctx.user).toEqualTypeOf<QuickbenUser | null>();
        return { ok: true };
      },
    });
  });

  it("types params from the path without a schema", () => {
    defineEndpoint({
      method: "GET",
      path: "/a/:x/:y",
      handler: ({ input }) => {
        expectTypeOf(input.params).toEqualTypeOf<{ x: string; y: string }>();
        expectTypeOf(input.body).toEqualTypeOf<undefined>();
        return null;
      },
    });
  });

  it("checks the result against the output schema", () => {
    const output = z.object({ ok: z.boolean() });
    expectTypeOf<EndpointResultOf<typeof output>>().toEqualTypeOf<
      | { ok: boolean }
      | { status: number; body: { ok: boolean }; headers?: Readonly<Record<string, string>> }
    >();
    defineEndpoint({
      method: "GET",
      path: "/x",
      output,
      // @ts-expect-error -- `ok` must be a boolean
      handler: () => ({ ok: "yes" }),
    });
    defineEndpoint({
      method: "GET",
      path: "/x",
      output,
      handler: () => new Response("raw"),
    });
  });

  it("checks replies per status", () => {
    const output = { 201: z.object({ id: z.string() }), 404: z.object({ missing: z.string() }) };
    type Result = EndpointResultOf<typeof output>;
    expectTypeOf<{ status: 201; body: { id: string } }>().toExtend<Result>();
    expectTypeOf<{ status: 404; body: { missing: string } }>().toExtend<Result>();
    expectTypeOf<{ status: 404; body: { id: string } }>().not.toExtend<Result>();
    expectTypeOf<{ id: string }>().not.toExtend<Result>();
    expectTypeOf<{ id: string }>().toExtend<
      EndpointResultOf<{ 200: z.ZodObject<{ id: z.ZodString }> }>
    >();
    defineEndpoint({
      method: "POST",
      path: "/x",
      output,
      handler: () => ({ status: 201 as const, body: { id: "1" } }),
    });
    defineEndpoint({
      method: "POST",
      path: "/x",
      output,
      handler: async () =>
        (await Promise.resolve(true)) ? reply(201, { id: "1" }) : reply(404, { missing: "1" }),
    });
    expectTypeOf(reply(404, { a: 1 })).toEqualTypeOf<EndpointReply<404, { a: number }>>();
  });

  it("allows any result without an output schema", () => {
    expectTypeOf<EndpointResultOf<undefined>>().toEqualTypeOf<unknown>();
  });

  it("types qb with endpointFactory and registers endpoints in the config", () => {
    type R = ConfigRegistry<typeof users | typeof tags | typeof posts, never>;
    const endpoint = endpointFactory<R>();
    const list = endpoint({
      method: "GET",
      path: "/posts-summary",
      access: true,
      handler: async ({ qb, ctx }) => {
        const found = await qb.find("posts", { select: ["title"] }, ctx);
        expectTypeOf(found.docs[0]?.title).toEqualTypeOf<string | undefined>();
        // @ts-expect-error -- unknown collection
        await qb.find("nope", {}, ctx);
        return found.docs.length;
      },
    });
    const config = defineConfig({
      db: testAdapter(),
      collections: [users, tags, posts],
      endpoints: [list],
    });
    expectTypeOf<InferDoc<typeof posts>["title"]>().toEqualTypeOf<string>();
    expectTypeOf(config.endpoints).toExtend<readonly unknown[] | undefined>();
  });
});
