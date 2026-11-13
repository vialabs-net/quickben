import { createQuickben, defineConfig } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ConnectionError,
  connectionState,
  defineProvider,
  findConnectionsByCapability,
  getConnection,
  getConnectionsOptions,
  listProviders,
  redactKeys,
  REDACTED,
  resolveCredential,
  rotateMasterKey,
  sealedKeyId,
  parseMasterKey,
  testConnection,
  testCredential,
} from "../src";

import {
  admin,
  API_KEY,
  as,
  fakeFetch,
  json,
  KEY_A,
  KEY_B,
  member,
  setup,
  staff,
  system,
} from "./setup";

import type { ConnectionsOptions } from "../src";

/** An identity provider that echoes its own key, like some real APIs do. */
const echo = defineProvider({
  type: "echo",
  label: "Echo",
  category: "Identity",
  capabilities: ["identity_verification"],
  baseUrl: { required: true, default: "https://echo.test" },
  fields: z.object({ level: z.coerce.number().int().min(0).max(3).default(1) }),
  test: async ({ baseUrl, credential, metadata, fetch, signal }) => {
    const response = await fetch(`${baseUrl ?? ""}/whoami?level=${String(metadata.level)}`, {
      headers: { "x-api-key": credential?.secret ?? "" },
      signal,
    });
    return {
      ok: response.ok,
      detail: await response.json(),
      error: response.ok ? undefined : `Echo said ${credential?.secret ?? ""}`,
    };
  },
  redactResponse: (body) => redactKeys(body, ["organization_api_key"]),
});

async function world(options: ConnectionsOptions = {}) {
  const fetch = fakeFetch({
    "GET https://echo.test/whoami": () =>
      json({ organization_api_key: API_KEY, note: `key ${API_KEY}`, org: "acme" }),
    "GET https://broken.test/whoami": () => json({ message: `bad key ${API_KEY}` }, 401),
    "GET https://api.anthropic.com/v1/models": () => json({ data: [] }),
  });
  const { qb } = await setup({ providers: [echo], fetch, ...options });
  const key = await qb.create("credentials", { name: "Key", secret: API_KEY }, as(admin));
  const claude = await qb.create(
    "connections",
    { name: "Claude", providerType: "anthropic", credential: key.id },
    as(admin),
  );
  const identity = await qb.create(
    "connections",
    { name: "Echo", providerType: "echo", credential: key.id, metadata: { level: "2" } },
    as(admin),
  );
  return { qb, fetch, key, claude, identity };
}

describe("getConnection / resolveCredential", () => {
  it("returns the provider, parsed metadata and the decrypted secret", async () => {
    const { qb, identity, key } = await world();
    const resolved = await getConnection(qb, identity.id);
    expect(resolved.provider.type).toBe("echo");
    expect(resolved.baseUrl).toBe("https://echo.test");
    expect(resolved.metadata).toEqual({ level: 2 });
    expect(resolved.credential).toEqual({ id: key.id, kind: "api_key", secret: API_KEY });
    await expect(resolveCredential(qb, key.id, as(staff))).resolves.toMatchObject({
      secret: API_KEY,
    });
  });

  it("applies access with a user context", async () => {
    const { qb, identity } = await world();
    await expect(getConnection(qb, identity.id, as(member))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuses disabled connections unless asked", async () => {
    const { qb, identity } = await world();
    await qb.update("connections", identity.id, { enabled: false }, as(admin));
    await expect(getConnection(qb, identity.id)).rejects.toMatchObject({ reason: "disabled" });
    await expect(
      getConnection(qb, identity.id, system, { allowDisabled: true }),
    ).resolves.toBeDefined();
  });

  it("reports missing secrets, credentials, providers and keys", async () => {
    const { qb, key, claude } = await world();
    await qb.update("credentials", key.id, { secret: null }, as(admin));
    await expect(resolveCredential(qb, key.id)).rejects.toMatchObject({ reason: "no-secret" });
    await qb.db.update({ collection: "connections", id: claude.id, data: { credential: null } });
    await expect(getConnection(qb, claude.id)).rejects.toMatchObject({ reason: "no-credential" });
    await qb.db.update({
      collection: "connections",
      id: claude.id,
      data: { providerType: "gone" },
    });
    await expect(getConnection(qb, claude.id)).rejects.toMatchObject({
      reason: "unknown-provider",
    });
  });

  it("refuses a credential of a kind the provider does not take", async () => {
    const { qb, key, claude } = await world();
    await qb.db.update({ collection: "credentials", id: key.id, data: { kind: "basic" } });
    await expect(getConnection(qb, claude.id)).rejects.toMatchObject({ reason: "wrong-kind" });
  });

  it("falls back to schema defaults for stored metadata that no longer parses", async () => {
    const { qb, identity } = await world();
    await qb.db.update({
      collection: "connections",
      id: identity.id,
      data: { metadata: { level: 9 } },
    });
    expect((await getConnection(qb, identity.id)).metadata).toEqual({ level: 1 });
  });

  it("needs the master key to read secrets", async () => {
    const { qb, key } = await world();
    getConnectionsOptions(qb);
    const other = defineConfig({
      db: qb.db,
      collections: [],
      plugins: [(await import("../src")).connections({ providers: [echo] })],
    });
    const bare = await createQuickben(other);
    await expect(resolveCredential(bare, key.id)).rejects.toThrow(/masterKey/);
  });

  it("throws when the plugin is not installed", async () => {
    const qb = await createQuickben(defineConfig({ db: memoryAdapter(), collections: [] }));
    expect(() => listProviders(qb)).toThrow(/not installed/);
  });
});

describe("findConnectionsByCapability", () => {
  it("lists enabled connections whose provider has the capability", async () => {
    const { qb, claude, identity } = await world();
    expect((await findConnectionsByCapability(qb, "vision")).map((c) => c.id)).toEqual([claude.id]);
    expect(
      (await findConnectionsByCapability(qb, "identity_verification")).map((c) => c.id),
    ).toEqual([identity.id]);
    await qb.update("connections", claude.id, { enabled: false }, as(admin));
    expect(await findConnectionsByCapability(qb, "llm")).toEqual([]);
    expect(
      await findConnectionsByCapability(qb, "llm", as(staff), { includeDisabled: true }),
    ).toHaveLength(1);
    expect(await findConnectionsByCapability(qb, "teleport")).toEqual([]);
  });

  it("pages through many connections", async () => {
    const { qb, key } = await world();
    for (let i = 0; i < 501; i += 1) {
      await qb.db.create({
        collection: "connections",
        data: {
          id: `bulk-${String(i).padStart(3, "0")}`,
          name: `Bulk ${String(i).padStart(3, "0")}`,
          providerType: "anthropic",
          credential: key.id,
          metadata: {},
          enabled: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      });
    }
    expect(await findConnectionsByCapability(qb, "llm")).toHaveLength(502);
  });
});

describe("testConnection", () => {
  it("runs the provider test, records lastTest and strips echoed secrets", async () => {
    const { qb, identity, fetch } = await world();
    const outcome = await testConnection(qb, identity.id, as(admin));
    expect(outcome).toMatchObject({
      ok: true,
      providerType: "echo",
      detail: { note: `key ${REDACTED}`, org: "acme" },
    });
    expect(JSON.stringify(outcome)).not.toContain(API_KEY);
    expect(fetch.calls[0]?.url).toBe("https://echo.test/whoami?level=2");
    const stored = await qb.findById("connections", identity.id, {}, as(staff));
    expect(stored.lastTest).toMatchObject({ ok: true, error: null, providerType: "echo" });
    expect(connectionState(stored.lastTest)).toBe("active");
    expect(connectionState(null)).toBe("untested");
    expect(connectionState({ ok: false })).toBe("failed");
  });

  it("redacts the secret from errors too", async () => {
    const { qb, identity } = await world();
    await qb.update("connections", identity.id, { baseUrl: "https://broken.test" }, as(admin));
    const outcome = await testConnection(qb, identity.id, as(admin));
    expect(outcome).toMatchObject({ ok: false, error: `Echo said ${REDACTED}` });
    expect(JSON.stringify(outcome)).not.toContain(API_KEY);
    const stored = await qb.findById("connections", identity.id, {}, as(admin));
    expect(JSON.stringify(stored)).not.toContain(API_KEY);
  });

  it("turns exceptions and timeouts into a fixed message", async () => {
    const hang = defineProvider({
      type: "hang",
      label: "Hang",
      category: "Other",
      capabilities: [],
      credential: { required: false, kinds: ["api_key"] },
      test: ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => {
            reject(new Error(`timeout ${API_KEY}`));
          });
        }),
    });
    const { qb } = await setup({ providers: [hang], testTimeoutMs: 10 });
    const connection = await qb.create(
      "connections",
      { name: "h", providerType: "hang" },
      as(admin),
    );
    await expect(testConnection(qb, connection.id, as(admin))).resolves.toMatchObject({
      ok: false,
      error: "Hang did not answer, or the request failed.",
    });
  });

  it("needs the manage permission and a test", async () => {
    const { qb, identity } = await world();
    await expect(testConnection(qb, identity.id, as(staff))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(testConnection(qb, identity.id, as(null))).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const silent = defineProvider({
      type: "silent",
      label: "Silent",
      category: "Other",
      capabilities: [],
      credential: { required: false, kinds: ["api_key"] },
    });
    const other = await setup({ providers: [silent] });
    const connection = await other.qb.create(
      "connections",
      { name: "s", providerType: "silent" },
      as(admin),
    );
    await expect(testConnection(other.qb, connection.id)).rejects.toMatchObject({
      reason: "not-testable",
    });
  });
});

describe("testCredential", () => {
  it("uses the provider and settings of its first connection", async () => {
    const { qb, key, fetch } = await world();
    const outcome = await testCredential(qb, key.id, as(admin));
    expect(outcome).toMatchObject({ ok: true, providerType: "anthropic" });
    expect(fetch.calls[0]?.url).toBe("https://api.anthropic.com/v1/models?limit=1");
    const stored = await qb.findById("credentials", key.id, {}, as(admin));
    expect(stored.lastTest).toMatchObject({ ok: true, providerType: "anthropic" });
  });

  it("takes a provider and URL for an unused credential, refuses without one", async () => {
    const { qb, fetch } = await world();
    const spare = await qb.create(
      "credentials",
      { name: "Spare", secret: "sk-spare-key-1234" },
      as(admin),
    );
    await expect(testCredential(qb, spare.id, as(admin))).rejects.toMatchObject({
      reason: "pick-provider",
    });
    await expect(
      testCredential(qb, spare.id, as(admin), {
        providerType: "echo",
        baseUrl: "https://broken.test",
      }),
    ).resolves.toMatchObject({ ok: false, providerType: "echo" });
    expect(fetch.calls.at(-1)?.url).toBe("https://broken.test/whoami?level=1");
    await expect(
      testCredential(qb, spare.id, as(admin), { providerType: "nope" }),
    ).rejects.toBeInstanceOf(ConnectionError);
    const basic = await qb.create(
      "credentials",
      { name: "B", kind: "basic", secret: "u:p" },
      as(admin),
    );
    await expect(
      testCredential(qb, basic.id, as(admin), { providerType: "anthropic" }),
    ).rejects.toMatchObject({
      reason: "wrong-kind",
    });
    await expect(
      testCredential(qb, spare.id, as(staff), { providerType: "echo" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("rotateMasterKey", () => {
  it("seals every secret again with the current key", async () => {
    const before = await setup({ masterKey: KEY_B });
    const credential = await before.qb.create(
      "credentials",
      { name: "k", secret: API_KEY },
      as(admin),
    );
    await before.qb
      .create("credentials", { name: "empty", secret: API_KEY }, as(admin))
      .then((c) => before.qb.update("credentials", c.id, { secret: null }, as(admin)));
    const config = defineConfig({
      db: before.qb.db,
      collections: [],
      plugins: [
        (await import("../src")).connections({ masterKey: KEY_A, previousMasterKeys: [KEY_B] }),
      ],
    });
    const after = await createQuickben(config);
    await expect(resolveCredential(after, credential.id)).resolves.toMatchObject({
      secret: API_KEY,
    });
    await expect(rotateMasterKey(after)).resolves.toEqual({ rotated: 1, current: 0 });
    await expect(rotateMasterKey(after)).resolves.toEqual({ rotated: 0, current: 1 });
    const row = await after.db.findOne({
      collection: "credentials",
      where: { field: "id", op: "eq", value: credential.id },
    });
    expect(sealedKeyId(row?.secret as string)).toBe(parseMasterKey(KEY_A).id);
    const noKey = await setup({ masterKey: undefined });
    await expect(rotateMasterKey(noKey.qb)).rejects.toThrow(/masterKey/);
  });
});
