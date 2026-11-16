import { describe, expect, it } from "vitest";
import { z } from "zod";

import { getConnectionsOptions, http, llmModelSchema, pickModel } from "../src";
import { describeProvider } from "../src/admin/describe";
import { resolveLanguageModel } from "../src/ai";
import { withModelSchema } from "../src/providers/shared";

import { admin, API_KEY, as, setup } from "./setup";

import type { connections, ModelOf } from "../src";

const modelSchema = (base: typeof llmModelSchema) =>
  base.extend({ maxPages: z.number().int().min(1).default(4) });

type Model = ModelOf<ReturnType<typeof connections<ReturnType<typeof modelSchema>>>>;

async function world() {
  const { qb } = await setup({ modelSchema });
  const key = await qb.create("credentials", { name: "Key", secret: API_KEY }, as(admin));
  const connection = (metadata: unknown, providerType = "anthropic") =>
    qb.create(
      "connections",
      { name: "c", credential: key.id, providerType, metadata } as never,
      as(admin),
    );
  return { qb, connection };
}

describe("modelSchema", () => {
  it("keeps the extra keys on save and in resolveLanguageModel", async () => {
    const { qb, connection } = await world();
    const c = await connection({ models: [{ id: "m1", maxPages: 9 }, { id: "m2" }] });
    expect((c.metadata as { models: unknown[] }).models).toMatchObject([
      { id: "m1", maxPages: 9 },
      { id: "m2", maxPages: 4 },
    ]);
    const resolved = await resolveLanguageModel<Model>(qb, c.id);
    expect(resolved.model.maxPages).toBe(9);
  });

  it("validates the extra keys", async () => {
    const { connection } = await world();
    await expect(connection({ models: [{ id: "m1", maxPages: 0 }] })).rejects.toThrow();
  });

  it("applies to every built-in LLM provider, not to the others", async () => {
    const { qb } = await world();
    const { providers, modelSchema: schema } = getConnectionsOptions(qb);
    for (const type of ["anthropic", "openai_compatible", "google", "vertex"]) {
      const parsed = providers.get(type)?.fields.parse({ models: [{ id: "a" }] }) as {
        models: { maxPages: number }[];
      };
      expect(parsed.models[0]?.maxPages).toBe(4);
    }
    expect(providers.get("http")).toBe(http);
    expect(withModelSchema(http, schema ?? llmModelSchema)).toBe(http);
  });

  it("keeps the form description of the models field", async () => {
    const { qb } = await world();
    const anthropic = getConnectionsOptions(qb).providers.get("anthropic");
    const field = describeProvider(anthropic!).fields.find((f) => f.key === "models");
    expect(field).toMatchObject({ label: "Models", control: "json" });
  });

  it("defaults to the base schema", async () => {
    const { qb } = await setup();
    expect(getConnectionsOptions(qb).modelSchema).toBe(llmModelSchema);
  });

  it("pickModel parses with a given schema", () => {
    const metadata = { models: [{ id: "a", maxPages: 2 }] };
    expect(pickModel(metadata)).not.toHaveProperty("maxPages");
    expect(pickModel(metadata, "a", modelSchema(llmModelSchema))?.maxPages).toBe(2);
  });
});
