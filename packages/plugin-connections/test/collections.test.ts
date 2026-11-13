import { createRouteHandlers } from "@quickben/next";
import { describe, expect, it } from "vitest";

import { decryptSecret, MasterKeyError, parseMasterKey } from "../src";

import { admin, API_KEY, as, member, serviceAccount, setup, staff, system } from "./setup";

function newCredential(
  qb: Awaited<ReturnType<typeof setup>>["qb"],
  data: Record<string, unknown> = {},
) {
  return qb.create("credentials", { name: "Main key", secret: API_KEY, ...data }, as(admin));
}

describe("credentials", () => {
  it("encrypts the secret and never returns it from the local API", async () => {
    const { qb } = await setup();
    const created = await newCredential(qb);
    expect(created).toMatchObject({
      name: "Main key",
      kind: "api_key",
      secret: null,
      last4: "cdef",
      hasSecret: true,
    });
    const read = await qb.findById("credentials", created.id, {}, as(staff));
    expect(read.secret).toBeNull();
    const listed = await qb.find("credentials", { select: ["secret", "name"] }, as(admin));
    expect(listed.docs[0]).toEqual({ id: created.id, secret: null, name: "Main key" });
    expect((await qb.findById("credentials", created.id, {}, system)).secret).toBeNull();
    // At rest: ciphertext only.
    const row = await qb.db.findOne({
      collection: "credentials",
      where: { field: "id", op: "eq", value: created.id },
    });
    expect(row?.secret).toMatch(/^v1:/);
    expect(JSON.stringify(row)).not.toContain(API_KEY);
    expect(decryptSecret(row?.secret as string, [parseMasterKey("a".repeat(64))])).toBe(API_KEY);
  });

  it("does not return secrets through relations, updates or deletes", async () => {
    const { qb } = await setup();
    const credential = await newCredential(qb);
    const connection = await qb.create(
      "connections",
      { name: "Claude", providerType: "anthropic", credential: credential.id },
      as(admin),
    );
    const populated = await qb.findById("connections", connection.id, { depth: 1 }, as(admin));
    expect(JSON.stringify(populated)).not.toMatch(/v1:|sk-test/);
    const updated = await qb.update("credentials", credential.id, { name: "Renamed" }, as(admin));
    expect(updated.secret).toBeNull();
    await qb.delete("connections", connection.id, as(admin));
    const deleted = await qb.delete("credentials", credential.id, as(admin));
    expect(deleted.secret).toBeNull();
  });

  it("never returns secrets through REST", async () => {
    const { config, qb } = await setup();
    const credential = await newCredential(qb);
    const api = createRouteHandlers(config);
    const user = { "x-quickben-user": JSON.stringify(admin) };
    const get = async (path: string) => {
      const response = await api.GET(new Request(`http://localhost/api${path}`, { headers: user }));
      return response.text();
    };
    for (const path of [
      "/credentials",
      `/credentials/${credential.id}`,
      `/credentials?select=secret`,
      `/credentials/${credential.id}?select=secret,last4`,
    ]) {
      const body = await get(path);
      expect(body).not.toContain(API_KEY);
      expect(body).not.toContain("v1:");
    }
    const patch = await api.PATCH(
      new Request(`http://localhost/api/credentials/${credential.id}`, {
        method: "PATCH",
        headers: { ...user, "content-type": "application/json" },
        body: JSON.stringify({ secret: "sk-new-secret-value-99" }),
      }),
    );
    const body = await patch.text();
    expect(patch.status).toBe(200);
    expect(body).not.toContain("sk-new-secret");
    expect(JSON.parse(body)).toMatchObject({ last4: "e-99" });
  });

  it("lets staff read but only admins write", async () => {
    const { qb } = await setup();
    await expect(newCredential(qb, {})).resolves.toBeDefined();
    await expect(
      qb.create("credentials", { name: "x", secret: API_KEY }, as(staff)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(qb.find("credentials", {}, as(member))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(qb.find("credentials", {}, as(null))).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect((await qb.find("credentials", {}, as(staff))).docs).toHaveLength(1);
  });

  it("requires a secret on create, keeps it when left out or empty, removes it with null", async () => {
    const { qb } = await setup();
    await expect(qb.create("credentials", { name: "x" }, as(admin))).rejects.toMatchObject({
      issues: [{ path: "secret", message: "Required" }],
    });
    await expect(
      qb.create("credentials", { name: "x", secret: "   " }, as(admin)),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const credential = await newCredential(qb);
    const kept = await qb.update(
      "credentials",
      credential.id,
      { name: "y", secret: "" },
      as(admin),
    );
    expect(kept).toMatchObject({ hasSecret: true, last4: "cdef" });
    const removed = await qb.update("credentials", credential.id, { secret: null }, as(admin));
    expect(removed).toMatchObject({ hasSecret: false, last4: null });
  });

  it("ignores last4, hasSecret and lastTest from callers", async () => {
    const { qb } = await setup();
    const credential = await qb.create(
      "credentials",
      {
        name: "x",
        secret: API_KEY,
        last4: "zzzz",
        hasSecret: false,
        lastTest: { at: "x", ok: true, error: null, latencyMs: 1, model: null, providerType: null },
      },
      as(admin),
    );
    expect(credential).toMatchObject({ last4: "cdef", hasSecret: true, lastTest: null });
  });

  it("validates secrets per kind and asks for a new one when the kind changes", async () => {
    const { qb } = await setup();
    await expect(
      qb.create(
        "credentials",
        { name: "sa", kind: "service_account_json", secret: "{}" },
        as(admin),
      ),
    ).rejects.toMatchObject({ issues: [{ path: "secret" }] });
    const sa = await qb.create(
      "credentials",
      { name: "sa", kind: "service_account_json", secret: serviceAccount() },
      as(admin),
    );
    expect(sa.last4).toBe("0123");
    await expect(
      qb.create("credentials", { name: "b", kind: "basic", secret: "nopassword" }, as(admin)),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const basic = await qb.create(
      "credentials",
      { name: "b", kind: "basic", secret: "user:long-password-1" },
      as(admin),
    );
    expect(basic.last4).toBe("rd-1");
    await expect(
      qb.create("credentials", { name: "k", secret: "has space" }, as(admin)),
    ).rejects.toMatchObject({ issues: [{ message: "An API key has no spaces." }] });
    await expect(
      qb.update("credentials", basic.id, { kind: "api_key" }, as(admin)),
    ).rejects.toMatchObject({
      issues: [{ path: "secret" }],
    });
    await expect(
      qb.update("credentials", basic.id, { kind: "api_key", secret: API_KEY }, as(admin)),
    ).resolves.toMatchObject({ kind: "api_key" });
  });

  it("refuses to store secrets without a master key", async () => {
    const { qb } = await setup({ masterKey: undefined });
    await expect(newCredential(qb)).rejects.toBeInstanceOf(MasterKeyError);
  });

  it("refuses to delete a credential in use (409)", async () => {
    const { qb } = await setup();
    const credential = await newCredential(qb);
    const connection = await qb.create(
      "connections",
      { name: "Claude", providerType: "anthropic", credential: credential.id },
      as(admin),
    );
    await expect(qb.delete("credentials", credential.id, as(admin))).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      field: "credential",
    });
    await qb.delete("connections", connection.id, as(admin));
    await expect(qb.delete("credentials", credential.id, as(admin))).resolves.toBeDefined();
  });
});

describe("connections", () => {
  it("validates the provider, base URL, credential and metadata", async () => {
    const { qb } = await setup();
    await expect(
      qb.create("connections", { name: "x", providerType: "nope" }, as(admin)),
    ).rejects.toMatchObject({ issues: [{ path: "providerType" }] });
    await expect(
      qb.create("connections", { name: "x", providerType: "anthropic" }, as(admin)),
    ).rejects.toMatchObject({
      issues: [{ path: "credential", message: "Anthropic needs a credential" }],
    });
    await expect(
      qb.create("connections", { name: "x", providerType: "http" }, as(admin)),
    ).rejects.toMatchObject({ issues: [{ path: "baseUrl" }] });
    await expect(
      qb.create(
        "connections",
        {
          name: "x",
          providerType: "http",
          baseUrl: "https://a.test",
          metadata: { healthPath: "x" },
        },
        as(admin),
      ),
    ).rejects.toMatchObject({ issues: [{ path: "metadata.healthPath" }] });
    const basic = await qb.create(
      "credentials",
      { name: "b", kind: "basic", secret: "u:p" },
      as(admin),
    );
    await expect(
      qb.create(
        "connections",
        { name: "x", providerType: "anthropic", credential: basic.id },
        as(admin),
      ),
    ).rejects.toMatchObject({
      issues: [{ message: "Anthropic does not take a credential of kind basic" }],
    });
  });

  it("refuses Vertex without an explicit credential", async () => {
    const { qb } = await setup();
    await expect(
      qb.create("connections", { name: "v", providerType: "vertex" }, as(admin)),
    ).rejects.toMatchObject({
      issues: [{ path: "credential", message: "Google Vertex AI needs a credential" }],
    });
  });

  it("fills metadata defaults, keeps the provider type and the test result", async () => {
    const { qb } = await setup();
    const connection = await qb.create(
      "connections",
      {
        name: "Local",
        providerType: "openai_compatible",
        baseUrl: "http://localhost:11434/v1",
        metadata: { models: [{ id: "llama" }] },
        lastTest: { at: "x", ok: true, error: null, latencyMs: 1, model: null, providerType: null },
      },
      as(admin),
    );
    expect(connection.metadata).toEqual({
      models: [
        {
          id: "llama",
          label: "",
          vision: false,
          structuredOutput: true,
          inputPerMTokUsd: 0,
          outputPerMTokUsd: 0,
          default: false,
        },
      ],
    });
    expect(connection.lastTest).toBeNull();
    expect(connection.enabled).toBe(true);
    await expect(
      qb.update("connections", connection.id, { providerType: "anthropic" }, as(admin)),
    ).rejects.toMatchObject({ issues: [{ path: "providerType" }] });
    await expect(
      qb.update(
        "connections",
        connection.id,
        { providerType: "openai_compatible", name: "L" },
        as(admin),
      ),
    ).resolves.toMatchObject({ name: "L" });
    await expect(
      qb.update("connections", connection.id, { baseUrl: "mailto:x@example.com" }, as(admin)),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("uses the provider default base URL", async () => {
    const { qb } = await setup({
      providers: [
        (await import("../src")).defineProvider({
          type: "acme",
          label: "Acme",
          category: "Identity",
          capabilities: ["identity_verification"],
          baseUrl: { required: true, default: "https://acme.test" },
          credential: { required: false, kinds: ["api_key"] },
        }),
      ],
    });
    const connection = await qb.create(
      "connections",
      { name: "a", providerType: "acme" },
      as(admin),
    );
    expect(connection.baseUrl).toBe("https://acme.test");
  });

  it("refuses updates when the provider is no longer registered", async () => {
    const first = await setup();
    await first.qb.db.create({
      collection: "connections",
      data: {
        id: "old",
        name: "Old",
        providerType: "removed",
        metadata: {},
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    await expect(
      first.qb.update("connections", "old", { name: "x" }, as(admin)),
    ).rejects.toMatchObject({
      issues: [{ path: "providerType" }],
    });
  });
});
