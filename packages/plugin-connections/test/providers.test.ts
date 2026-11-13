import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  anthropic,
  builtinProviders,
  CREDENTIAL_KINDS,
  defineProvider,
  gemini,
  http,
  openaiCompatible,
  pickModel,
  providersByCategory,
  vertex,
  vertexRoot,
} from "../src";
import { resolveOptions } from "../src/options";
import { parseServiceAccount, serviceAccountAssertion } from "../src/providers/google-auth";
import { joinUrl, statusError } from "../src/providers/shared";

import { API_KEY, fakeFetch, json, serviceAccount } from "./setup";

import type { AnyProvider, ResolvedSecret, TestContext } from "../src";

const apiKey: ResolvedSecret = { id: "c1", kind: "api_key", secret: API_KEY };

function ctx(provider: AnyProvider, overrides: Partial<TestContext> = {}): TestContext<never> {
  return {
    baseUrl: null,
    metadata: provider.fields.parse({}),
    credential: apiKey,
    model: undefined,
    fetch: fakeFetch(),
    signal: new AbortController().signal,
    ...overrides,
  } as TestContext<never>;
}

describe("defineProvider", () => {
  it("fills defaults", () => {
    const p = defineProvider({ type: "acme", label: "Acme", category: "Other", capabilities: [] });
    expect(p.credential).toEqual({ required: true, kinds: ["api_key"] });
    expect(p.baseUrl).toEqual({ required: false });
    expect(p.description).toBe("");
    expect(p.fields.parse({})).toEqual({});
  });

  it("checks the type and the credential kinds", () => {
    expect(() =>
      defineProvider({ type: "Bad Type", label: "x", category: "x", capabilities: [] }),
    ).toThrow(/Invalid provider type/);
    expect(() =>
      defineProvider({
        type: "x",
        label: "x",
        category: "x",
        capabilities: [],
        credential: { kinds: [] },
      }),
    ).toThrow(/at least one credential kind/);
  });

  it("groups by category in first-seen order", () => {
    expect(
      providersByCategory(builtinProviders).map((g) => [g.category, g.providers.length]),
    ).toEqual([
      ["AI models", 4],
      ["Other", 1],
    ]);
  });

  it("lists three credential kinds", () => {
    expect(CREDENTIAL_KINDS.map((k) => k.kind)).toEqual([
      "api_key",
      "service_account_json",
      "basic",
    ]);
  });
});

describe("registry options", () => {
  it("registers built-ins, a subset, none, and replaces by type", () => {
    expect([...resolveOptions({}).providers.keys()]).toEqual([
      "anthropic",
      "openai_compatible",
      "google",
      "vertex",
      "http",
    ]);
    expect([...resolveOptions({ builtins: ["vertex"] }).providers.keys()]).toEqual(["vertex"]);
    expect(resolveOptions({ builtins: false }).providers.size).toBe(0);
    expect(() => resolveOptions({ builtins: ["nope"] })).toThrow(/unknown built-in/);
    const custom = defineProvider({ type: "http", label: "Mine", category: "X", capabilities: [] });
    expect(resolveOptions({ providers: [custom] }).providers.get("http")?.label).toBe("Mine");
  });

  it("validates keys and the timeout", () => {
    expect(resolveOptions({ masterKey: "  " }).keys).toEqual([]);
    expect(() => resolveOptions({ previousMasterKeys: ["a".repeat(64)] })).toThrow(
      /needs a masterKey/,
    );
    expect(() => resolveOptions({ masterKey: "bad" })).toThrow(/32 bytes/);
    expect(() => resolveOptions({ testTimeoutMs: 0 })).toThrow(/positive integer/);
  });

  it("defaults access to admin (manage) and admin or staff (read)", () => {
    const options = resolveOptions({});
    expect(options.canManage({ id: "a", roles: ["admin"] })).toBe(true);
    expect(options.canManage({ id: "s", roles: ["staff"] })).toBe(false);
    expect(options.canRead({ id: "s", roles: ["staff"] })).toBe(true);
    expect(options.canRead({ id: "m" })).toBe(false);
  });
});

describe("llm metadata", () => {
  it("fills model defaults and refuses duplicates and two defaults", () => {
    const parsed = anthropic.fields.parse({ models: [{ id: "m1" }] });
    expect(parsed.models[0]).toMatchObject({
      id: "m1",
      vision: false,
      default: false,
      inputPerMTokUsd: 0,
    });
    expect(anthropic.fields.safeParse({ models: [{ id: "m" }, { id: "m" }] }).success).toBe(false);
    expect(
      anthropic.fields.safeParse({
        models: [
          { id: "a", default: true },
          { id: "b", default: true },
        ],
      }).success,
    ).toBe(false);
  });

  it("picks the requested, the default or the first model", () => {
    const metadata = { models: [{ id: "a" }, { id: "b", default: true }] };
    expect(pickModel(metadata)?.id).toBe("b");
    expect(pickModel(metadata, "a")?.id).toBe("a");
    expect(pickModel(metadata, "z")).toBeUndefined();
    expect(pickModel({ models: [{ id: "a" }] })?.id).toBe("a");
    expect(pickModel(null)).toBeUndefined();
    expect(pickModel({ models: "bad" })).toBeUndefined();
  });
});

describe("helpers", () => {
  it("joins URLs and words statuses in our own text", () => {
    expect(joinUrl(" https://x/v1// ", "/models")).toBe("https://x/v1/models");
    expect(statusError("X", 401)).toMatch(/rejected/);
    expect(statusError("X", 403)).toMatch(/permission/);
    expect(statusError("X", 404)).toMatch(/404/);
    expect(statusError("X", 429)).toMatch(/rate/);
    expect(statusError("X", 500)).toBe("X answered HTTP 500.");
  });
});

describe("anthropic test", () => {
  it("lists models when none is configured", async () => {
    const fetch = fakeFetch({
      "GET https://api.anthropic.com/v1/models": () => json({ data: [] }),
    });
    await expect(anthropic.test!(ctx(anthropic, { fetch }))).resolves.toEqual({ ok: true });
    expect(fetch.calls[0]?.headers["x-api-key"]).toBe(API_KEY);
    expect(fetch.calls[0]?.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("sends a 1-token message to the default model, on a custom base URL", async () => {
    const fetch = fakeFetch({ "POST https://proxy.test/v1/messages": () => json({}, 401) });
    const result = await anthropic.test!(
      ctx(anthropic, {
        fetch,
        baseUrl: "https://proxy.test/v1/",
        metadata: anthropic.fields.parse({ models: [{ id: "claude-haiku-4-5", default: true }] }),
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: "Anthropic rejected the credential (HTTP 401).",
      model: "claude-haiku-4-5",
    });
    expect(JSON.parse(fetch.calls[0]!.body!)).toMatchObject({
      model: "claude-haiku-4-5",
      max_tokens: 1,
    });
  });

  it("needs a credential", async () => {
    await expect(anthropic.test!(ctx(anthropic, { credential: null }))).resolves.toMatchObject({
      ok: false,
      error: "Anthropic needs a credential.",
    });
  });
});

describe("openai-compatible test", () => {
  it("lists models without a key, chats with a model and a key", async () => {
    const fetch = fakeFetch({
      "GET http://localhost:11434/v1/models": () => json({ data: [] }),
      "POST https://openrouter.ai/api/v1/chat/completions": () => json({ choices: [] }),
    });
    await expect(
      openaiCompatible.test!(
        ctx(openaiCompatible, { fetch, credential: null, baseUrl: "http://localhost:11434/v1" }),
      ),
    ).resolves.toEqual({ ok: true });
    expect(fetch.calls[0]?.headers.authorization).toBeUndefined();
    await expect(
      openaiCompatible.test!(
        ctx(openaiCompatible, { fetch, baseUrl: "https://openrouter.ai/api/v1", model: "x/y" }),
      ),
    ).resolves.toEqual({ ok: true, model: "x/y" });
    expect(fetch.calls[1]?.headers.authorization).toBe(`Bearer ${API_KEY}`);
  });

  it("uses the OpenAI URL by default", async () => {
    const fetch = fakeFetch();
    await openaiCompatible.test!(ctx(openaiCompatible, { fetch }));
    expect(fetch.calls[0]?.url).toBe("https://api.openai.com/v1/models");
  });
});

describe("gemini test", () => {
  it("sends the key in a header, never in the URL", async () => {
    const fetch = fakeFetch({
      "GET https://generativelanguage.googleapis.com/v1beta/models": () => json({}),
      "POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:countTokens":
        () => json({ totalTokens: 1 }),
    });
    await expect(gemini.test!(ctx(gemini, { fetch }))).resolves.toEqual({ ok: true });
    await expect(gemini.test!(ctx(gemini, { fetch, model: "gemini-2.5-flash" }))).resolves.toEqual({
      ok: true,
      model: "gemini-2.5-flash",
    });
    for (const call of fetch.calls) {
      expect(call.url).not.toContain(API_KEY);
      expect(call.headers["x-goog-api-key"]).toBe(API_KEY);
    }
    await expect(gemini.test!(ctx(gemini, { credential: null }))).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe("vertex", () => {
  it("refuses to run without a credential: no ambient server credentials", async () => {
    expect(vertex.credential.required).toBe(true);
    await expect(vertex.test!(ctx(vertex, { credential: null }))).resolves.toEqual({
      ok: false,
      error: "Vertex AI needs a credential.",
    });
  });

  it("uses express mode with an API key", async () => {
    const fetch = fakeFetch({
      "POST https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:countTokens":
        () => json({}),
    });
    await expect(vertex.test!(ctx(vertex, { fetch }))).resolves.toEqual({
      ok: true,
      model: "gemini-2.5-flash",
    });
    expect(fetch.calls[0]?.headers["x-goog-api-key"]).toBe(API_KEY);
  });

  it("signs a JWT, trades it for a token, then counts tokens in the project", async () => {
    const key = serviceAccount("proj-1");
    const fetch = fakeFetch({
      "POST https://oauth2.googleapis.com/token": () => json({ access_token: "ya29.token" }),
      "POST https://europe-west1-aiplatform.googleapis.com/v1/projects/proj-1/locations/europe-west1/":
        () => json({}),
    });
    const result = await vertex.test!(
      ctx(vertex, {
        fetch,
        credential: { id: "c", kind: "service_account_json", secret: key },
        metadata: vertex.fields.parse({ location: "europe-west1" }),
      }),
    );
    expect(result).toEqual({ ok: true, model: "gemini-2.5-flash" });
    const assertion = new URLSearchParams(fetch.calls[0]!.body).get("assertion")!;
    const [header, claims] = assertion
      .split(".")
      .slice(0, 2)
      .map(
        (part) => JSON.parse(Buffer.from(part, "base64url").toString()) as Record<string, unknown>,
      );
    expect(header).toMatchObject({ alg: "RS256", kid: "0123456789abcdef0123" });
    expect(claims).toMatchObject({
      iss: "robot@demo-project.iam.gserviceaccount.com",
      aud: "https://oauth2.googleapis.com/token",
    });
    expect(fetch.calls[1]?.headers.authorization).toBe("Bearer ya29.token");
  });

  it("reports a refused key, a missing project and a bad key", async () => {
    const refused = fakeFetch({ "POST https://oauth2.googleapis.com/token": () => json({}, 400) });
    const account = { id: "c", kind: "service_account_json" as const, secret: serviceAccount() };
    await expect(
      vertex.test!(ctx(vertex, { fetch: refused, credential: account })),
    ).resolves.toEqual({
      ok: false,
      error: "Google refused the service account (HTTP 400).",
    });
    const noToken = fakeFetch({ "POST https://oauth2.googleapis.com/token": () => json({}) });
    await expect(
      vertex.test!(ctx(vertex, { fetch: noToken, credential: account })),
    ).resolves.toMatchObject({
      error: "Google refused the service account (HTTP 502).",
    });
    const noProject = JSON.stringify({ ...JSON.parse(account.secret), project_id: undefined });
    await expect(
      vertex.test!(ctx(vertex, { credential: { ...account, secret: noProject } })),
    ).resolves.toEqual({ ok: false, error: "Set the project of the connection." });
    await expect(
      vertex.test!(ctx(vertex, { credential: { ...account, secret: "{}" } })),
    ).resolves.toEqual({ ok: false, error: "The credential is not a service account key." });
    const failing = fakeFetch({
      "POST https://oauth2.googleapis.com/token": () => json({ access_token: "t" }),
      "POST https://us-central1-aiplatform.googleapis.com/": () => json({}, 403),
    });
    await expect(
      vertex.test!(ctx(vertex, { fetch: failing, credential: account })),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/HTTP 403/) as unknown,
    });
  });

  it("builds regional and global roots, validates metadata", () => {
    expect(vertexRoot("global")).toBe("https://aiplatform.googleapis.com/v1");
    expect(vertexRoot("us-east1")).toBe("https://us-east1-aiplatform.googleapis.com/v1");
    expect(vertex.fields.parse({ project: "" })).toMatchObject({ location: "us-central1" });
    expect(vertex.fields.safeParse({ location: "../evil" }).success).toBe(false);
  });

  it("parses service accounts and signs assertions", () => {
    const key = serviceAccount();
    const account = parseServiceAccount(key)!;
    expect(account.client_email).toMatch(/@/);
    expect(parseServiceAccount("not json")).toBeUndefined();
    expect(parseServiceAccount(JSON.stringify({ type: "user" }))).toBeUndefined();
    const withoutKid = { ...account, private_key_id: undefined };
    const [header] = serviceAccountAssertion(withoutKid, 0).split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
  });
});

describe("http test", () => {
  it("GETs the test path with the key in the configured header", async () => {
    const fetch = fakeFetch({ "GET https://api.example.com/health": () => json({ ok: true }) });
    const metadata = http.fields.parse({
      healthPath: "/health",
      authHeader: "X-Api-Key",
      authScheme: "",
    });
    await expect(
      http.test!(ctx(http, { fetch, baseUrl: "https://api.example.com", metadata })),
    ).resolves.toEqual({
      ok: true,
    });
    expect(fetch.calls[0]?.headers["x-api-key"]).toBe(API_KEY);
  });

  it("uses Bearer by default, Basic for basic credentials, the base URL itself for /", async () => {
    const fetch = fakeFetch({ "GET https://api.example.com": () => json({}, 401) });
    await expect(
      http.test!(ctx(http, { fetch, baseUrl: "https://api.example.com/" })),
    ).resolves.toEqual({
      ok: false,
      error: "The API rejected the credential (HTTP 401).",
    });
    expect(fetch.calls[0]?.url).toBe("https://api.example.com");
    expect(fetch.calls[0]?.headers.authorization).toBe(`Bearer ${API_KEY}`);
    await http.test!(
      ctx(http, {
        fetch,
        baseUrl: "https://api.example.com",
        credential: { id: "b", kind: "basic", secret: "user:pass" },
      }),
    );
    expect(fetch.calls[1]?.headers.authorization).toBe(
      `Basic ${Buffer.from("user:pass").toString("base64")}`,
    );
    await http.test!(ctx(http, { fetch, baseUrl: "https://api.example.com", credential: null }));
    expect(fetch.calls[2]?.headers.authorization).toBeUndefined();
  });

  it("needs a base URL and validates its metadata", async () => {
    await expect(http.test!(ctx(http))).resolves.toEqual({
      ok: false,
      error: "Set the base URL of the connection.",
    });
    expect(http.fields.safeParse({ healthPath: "health" }).success).toBe(false);
    expect(http.fields.safeParse({ authHeader: "Bad Header" }).success).toBe(false);
    expect(z.object({}).parse({})).toEqual({});
  });
});
