import { describe, expect, it } from "vitest";

import { callCost, languageModelFactories, resolveLanguageModel } from "../src/ai";

import { admin, API_KEY, as, serviceAccount, setup } from "./setup";

async function world() {
  const { qb } = await setup();
  const key = await qb.create("credentials", { name: "Key", secret: API_KEY }, as(admin));
  const sa = await qb.create(
    "credentials",
    { name: "SA", kind: "service_account_json", secret: serviceAccount("p1") },
    as(admin),
  );
  const connection = (data: Record<string, unknown>) =>
    qb.create("connections", { name: "c", credential: key.id, ...data } as never, as(admin));
  return { qb, key, sa, connection };
}

describe("resolveLanguageModel", () => {
  it("builds a model for every built-in LLM provider", async () => {
    const { qb, sa, connection } = await world();
    const models = { models: [{ id: "m-1", default: true, vision: true }] };
    for (const providerType of ["anthropic", "openai_compatible", "google", "vertex"]) {
      const c = await connection({ providerType, metadata: models });
      const resolved = await resolveLanguageModel(qb, c.id);
      expect(resolved.model).toMatchObject({ id: "m-1", vision: true });
      expect(resolved.languageModel).toMatchObject({ modelId: "m-1" });
    }
    const viaAccount = await connection({
      providerType: "vertex",
      credential: sa.id,
      metadata: models,
    });
    const resolved = await resolveLanguageModel(qb, viaAccount.id);
    expect(resolved.languageModel).toMatchObject({ modelId: "m-1" });
    expect(JSON.stringify(resolved.connection)).not.toContain("PRIVATE KEY");
  });

  it("picks a named model and refuses unknown or missing ones", async () => {
    const { qb, connection } = await world();
    const c = await connection({
      providerType: "anthropic",
      metadata: { models: [{ id: "a" }, { id: "b" }] },
    });
    expect((await resolveLanguageModel(qb, c.id, { model: "b" })).model.id).toBe("b");
    await expect(resolveLanguageModel(qb, c.id, { model: "z" })).rejects.toMatchObject({
      reason: "no-model",
    });
    const empty = await connection({ providerType: "anthropic" });
    await expect(resolveLanguageModel(qb, empty.id)).rejects.toThrow(/has no models/);
  });

  it("refuses connections that are not LLMs, and accepts custom factories", async () => {
    const { qb, connection } = await world();
    const c = await qb.create(
      "connections",
      { name: "h", providerType: "http", baseUrl: "https://api.test" },
      as(admin),
    );
    await expect(resolveLanguageModel(qb, c.id)).rejects.toMatchObject({ reason: "not-llm" });
    const custom = await connection({
      providerType: "anthropic",
      metadata: { models: [{ id: "m" }] },
    });
    const fake = { modelId: "fake" } as never;
    const resolved = await resolveLanguageModel(qb, custom.id, {
      factories: { anthropic: () => fake },
    });
    expect(resolved.languageModel).toBe(fake);
  });

  it("never builds Vertex without a credential, and checks the key format", () => {
    const base = {
      connection: {} as never,
      provider: {} as never,
      baseUrl: null,
      metadata: {},
    };
    expect(() => languageModelFactories.vertex!({ ...base, credential: null }, "m")).toThrow(
      /needs a credential/,
    );
    expect(() =>
      languageModelFactories.vertex!(
        { ...base, credential: { id: "x", kind: "service_account_json", secret: "{}" } },
        "m",
      ),
    ).toThrow(/not a service account/);
  });
});

describe("callCost", () => {
  it("prices a call per million tokens", () => {
    expect(callCost({ inputPerMTokUsd: 3, outputPerMTokUsd: 15 }, 1000, 500)).toBeCloseTo(
      0.0105,
      6,
    );
  });
});
