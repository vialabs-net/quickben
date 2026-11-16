import { describe, expectTypeOf, test } from "vitest";

import { defineCollection, fields as f } from "../src";

import type {
  DatabaseAdapter,
  InferDoc,
  JoinedTransaction,
  Quickben,
  RequestContext,
} from "../src";

export const tracked = defineCollection({
  slug: "tracked",
  fields: { title: f.text() },
  trackAuthor: true,
});
export const plain = defineCollection({ slug: "plain", fields: { title: f.text() } });
export const off = defineCollection({
  slug: "off",
  fields: { title: f.text() },
  trackAuthor: false,
});

describe("trackAuthor", () => {
  test("adds createdBy and updatedBy to the document type", () => {
    type Doc = InferDoc<typeof tracked>;
    expectTypeOf<Doc["createdBy"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Doc["updatedBy"]>().toEqualTypeOf<string | null>();
  });

  test("adds nothing without the option", () => {
    expectTypeOf<InferDoc<typeof plain>>().not.toHaveProperty("createdBy");
    expectTypeOf<InferDoc<typeof off>>().not.toHaveProperty("createdBy");
  });
});

describe("preserveTimestamps", () => {
  test("create and update accept timestamps", () => {
    type Qb = Quickben<{ plain: typeof plain }>;
    expectTypeOf<Parameters<Qb["create"]>[1]>().toExtend<{
      createdAt?: string | Date;
      updatedAt?: string | Date;
    }>();
    expectTypeOf<Parameters<Qb["update"]>[2]>().toExtend<{ updatedAt?: string | Date }>();
    expectTypeOf<{ preserveTimestamps: true; user: null }>().toExtend<RequestContext>();
  });
});

describe("withTransaction", () => {
  test("returns the local API of the registry and the settle calls", () => {
    type Qb = Quickben<{ tracked: typeof tracked }>;
    expectTypeOf<Qb["withTransaction"]>().parameters.toEqualTypeOf<[DatabaseAdapter]>();
    expectTypeOf<ReturnType<Qb["withTransaction"]>>().toEqualTypeOf<
      JoinedTransaction<{ tracked: typeof tracked }>
    >();
    expectTypeOf<JoinedTransaction["committed"]>().returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf<JoinedTransaction<{ tracked: typeof tracked }>["qb"]>().toEqualTypeOf<Qb>();
  });
});
