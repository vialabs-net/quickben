import { describe, expectTypeOf, test } from "vitest";
import { z } from "zod";

import { connections } from "../src";

import type { LlmModel, ModelOf, ModelSchema } from "../src";
import type { ResolvedLanguageModel } from "../src/ai";

export const extended = connections({
  modelSchema: (base) => base.extend({ maxPages: z.number().int().default(4) }),
});
export const plain = connections();

describe("modelSchema", () => {
  test("ModelOf infers the extended model entry", () => {
    type Model = ModelOf<typeof extended>;
    expectTypeOf<Model["maxPages"]>().toEqualTypeOf<number>();
    expectTypeOf<Model>().toExtend<LlmModel>();
    expectTypeOf<ResolvedLanguageModel<Model>["model"]["maxPages"]>().toEqualTypeOf<number>();
  });

  test("defaults to LlmModel", () => {
    expectTypeOf<ModelOf<typeof plain>>().toEqualTypeOf<LlmModel>();
    expectTypeOf<ResolvedLanguageModel["model"]>().toEqualTypeOf<LlmModel>();
  });

  test("the extension must keep the base keys", () => {
    const narrow = z.object({ id: z.string() });
    expectTypeOf(narrow).not.toExtend<ModelSchema>();
  });
});
