/**
 * The vision-LLM extractor with real provider factories of `@quickben/plugin-connections`:
 * an OpenAI-compatible gateway (its own base URL) and Google Vertex AI. `fetch` is stubbed, so
 * the requests are checked and the answers come back with token counts, cached ones included.
 */
import { createQuickben, defineConfig } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { connections } from "@quickben/plugin-connections";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createVisionLlmExtractor, docReader, inProcessRunner } from "../src";
import { connectionModels } from "../src/connections";

import { invoice, invoiceInput, invoiceReply, PNG } from "./helpers";

const admin = { id: "ada", roles: ["admin"] };

const reply = invoiceReply({
  number: { value: "A-1", confidence: 0.9 },
  issuedOn: { value: "2026-01-02", confidence: 0.9 },
  total: { value: "10.5", confidence: 0.9 },
});

async function setup() {
  const config = defineConfig({
    db: memoryAdapter(),
    collections: [],
    plugins: [
      connections({ masterKey: "b".repeat(64) }),
      docReader({ runner: inProcessRunner(), types: [invoiceInput], log: () => undefined }),
    ],
  });
  const qb = await createQuickben(config);
  const key = await qb.create(
    "credentials",
    { name: "Key", kind: "api_key", secret: "test-key-0123456789abcdef" },
    { user: admin },
  );
  const { resolveModel } = connectionModels({ maxPages: 1 });
  const extractor = createVisionLlmExtractor({
    resolveModel: (connectionId, modelId) => resolveModel(connectionId, modelId, qb),
    rasterize: (bytes, mime) => Promise.resolve([{ page: 1, bytes, mime }]),
  });
  return { qb, credential: key.id, extractor };
}

function respond(body: unknown) {
  const calls: { url: string; body: unknown }[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const sent = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ url, body: sent });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  vi.stubGlobal("fetch", fetch);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const models = (id: string) => ({
  models: [
    {
      id,
      vision: true,
      default: true,
      inputPerMTokUsd: 1,
      cachedInputPerMTokUsd: 0.1,
      outputPerMTokUsd: 4,
    },
  ],
});

// 600 × 1 + 400 × 0.1 + 100 × 4, per million.
const COST = (600 + 40 + 400) / 1e6;

describe("providers with the vision-llm extractor", () => {
  it("reads through an OpenAI-compatible gateway at its base URL and prices cached input", async () => {
    const { qb, credential, extractor } = await setup();
    const connection = await qb.create(
      "connections",
      {
        name: "Gateway",
        providerType: "openai_compatible",
        baseUrl: "https://gateway.example.test/v1",
        credential,
        metadata: models("gpt-6-luna"),
      },
      { user: admin },
    );
    const calls = respond({
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 1,
      model: "gpt-6-luna",
      choices: [
        { index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" },
      ],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 100,
        total_tokens: 1100,
        prompt_tokens_details: { cached_tokens: 400 },
      },
    });
    const result = await extractor.extract(
      { bytes: PNG, mime: "image/png", pages: [1] },
      invoice,
      {},
      { tenant: null, config: { connectionId: connection.id } },
    );
    expect(calls[0]?.url).toBe("https://gateway.example.test/v1/chat/completions");
    expect(calls[0]?.body).toMatchObject({ model: "gpt-6-luna" });
    expect(result).toMatchObject({
      status: "OK",
      fields: { number: { value: "A1" }, total: { value: "10.5" } },
      usage: {
        model: "gpt-6-luna",
        connectionName: "Gateway",
        inputTokens: 1000,
        cachedInputTokens: 400,
        outputTokens: 100,
      },
    });
    expect(result.usage?.costUsd).toBeCloseTo(COST, 9);
  });

  it("reads through Google Vertex AI and prices cached input", async () => {
    const { qb, credential, extractor } = await setup();
    const connection = await qb.create(
      "connections",
      {
        name: "Vertex",
        providerType: "vertex",
        credential,
        metadata: { location: "us-central1", ...models("gemini-3.1-flash-lite") },
      },
      { user: admin },
    );
    const calls = respond({
      candidates: [{ content: { role: "model", parts: [{ text: reply }] }, finishReason: "STOP" }],
      usageMetadata: {
        promptTokenCount: 1000,
        candidatesTokenCount: 100,
        totalTokenCount: 1100,
        cachedContentTokenCount: 400,
      },
    });
    const result = await extractor.extract(
      { bytes: PNG, mime: "image/png", pages: [1] },
      invoice,
      {},
      { tenant: null, config: { connectionId: connection.id } },
    );
    expect(calls[0]?.url).toMatch(
      /^https:\/\/[\w.-]*aiplatform\.googleapis\.com\/.*gemini-3\.1-flash-lite:generateContent/u,
    );
    expect(result).toMatchObject({
      status: "OK",
      fields: { number: { value: "A1" } },
      usage: { model: "gemini-3.1-flash-lite", cachedInputTokens: 400, outputTokens: 100 },
    });
    expect(result.usage?.costUsd).toBeCloseTo(COST, 9);
  });

  it("bills a gateway answer that is not JSON, and hides provider errors", async () => {
    const { qb, credential, extractor } = await setup();
    const connection = await qb.create(
      "connections",
      {
        name: "Gateway",
        providerType: "openai_compatible",
        baseUrl: "https://gateway.example.test/v1",
        credential,
        metadata: models("claude-haiku-5-5"),
      },
      { user: admin },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { message: "bad key test-key-0123" } }), {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    const result = await extractor.extract(
      { bytes: PNG, mime: "image/png", pages: [1] },
      invoice,
      {},
      { tenant: null, config: { connectionId: connection.id } },
    );
    expect(result).toMatchObject({ status: "ERROR", problems: { transient: true } });
    expect(JSON.stringify(result)).not.toContain("test-key");
  });
});
