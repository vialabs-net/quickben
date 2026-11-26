import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ALL_SCOPES,
  bearerToken,
  createApiKey,
  hasScopes,
  missingScopes,
  parseApiKey,
  verifyApiKeySecret,
} from "../src";

describe("createApiKey", () => {
  it("builds the token from prefix, keyId and secret", () => {
    const key = createApiKey({ prefix: "ida_sk" });
    expect(key.keyId).toMatch(/^[0-9a-z]{12}$/);
    expect(key.secret).toMatch(/^[0-9A-Za-z]{32,}$/);
    expect(key.token).toBe(`ida_sk_${key.keyId}_${key.secret}`);
    expect(key.secretHash).toBe(createHash("sha256").update(key.secret).digest("hex"));
    expect(key.hint).toBe(key.secret.slice(-4));
  });

  it("returns a different key each call", () => {
    const keys = Array.from({ length: 50 }, () => createApiKey({ prefix: "qb" }));
    expect(new Set(keys.map((k) => k.keyId)).size).toBe(50);
    expect(new Set(keys.map((k) => k.secret)).size).toBe(50);
  });

  it("rejects a bad prefix", () => {
    for (const prefix of ["", "a_b_c", "_a", "a_", "a-b", "a b"]) {
      expect(() => createApiKey({ prefix })).toThrow(TypeError);
    }
  });
});

describe("parseApiKey", () => {
  it("round-trips a created key", () => {
    const key = createApiKey({ prefix: "ida_sk" });
    expect(parseApiKey(key.token, { prefix: "ida_sk" })).toEqual({
      keyId: key.keyId,
      secret: key.secret,
    });
  });

  it("works with a prefix without an underscore", () => {
    const key = createApiKey({ prefix: "qb" });
    expect(parseApiKey(key.token, { prefix: "qb" })?.keyId).toBe(key.keyId);
  });

  it("rejects the wrong prefix", () => {
    const key = createApiKey({ prefix: "ida_sk" });
    expect(parseApiKey(key.token, { prefix: "ida_pk" })).toBeNull();
    expect(parseApiKey(key.token, { prefix: "ida" })).toBeNull();
    expect(parseApiKey(key.token, { prefix: "sk" })).toBeNull();
  });

  it("rejects malformed tokens", () => {
    const { keyId, secret } = createApiKey({ prefix: "qb" });
    const bad = [
      "",
      "qb",
      "qb_",
      `qb_${keyId}`,
      `qb_${keyId}_`,
      `qb_${keyId}${secret}`,
      `qb_${keyId.toUpperCase()}_${secret}`,
      `qb_${keyId.slice(1)}_${secret}`,
      `qb_${keyId}x_${secret}`,
      `qb_${keyId}_${secret.slice(0, 31)}`,
      `qb_${keyId}_${secret}!`,
      `qb_${keyId}_${secret}_extra`,
      `qb_${keyId}_${"a".repeat(129)}`,
      ` qb_${keyId}_${secret}`,
    ];
    for (const token of bad) expect(parseApiKey(token, { prefix: "qb" }), token).toBeNull();
  });
});

describe("verifyApiKeySecret", () => {
  it("accepts the right secret and rejects others", () => {
    const key = createApiKey({ prefix: "qb" });
    expect(verifyApiKeySecret(key.secret, key.secretHash)).toBe(true);
    expect(verifyApiKeySecret(key.secret, key.secretHash.toUpperCase())).toBe(true);
    expect(verifyApiKeySecret(`${key.secret}x`, key.secretHash)).toBe(false);
    expect(verifyApiKeySecret(key.secret, "not-a-hash")).toBe(false);
    expect(verifyApiKeySecret(key.secret, "")).toBe(false);
  });
});

describe("bearerToken", () => {
  it("reads a Bearer header", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer  abc ")).toBe("abc");
  });

  it("falls back to the API key header", () => {
    expect(bearerToken(undefined, "abc")).toBe("abc");
    expect(bearerToken("Basic xyz", " abc ")).toBe("abc");
    expect(bearerToken("Bearer abc", "other")).toBe("abc");
  });

  it("returns null without a token", () => {
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken("Bearer ")).toBeNull();
    expect(bearerToken("Bearer a b")).toBeNull();
    expect(bearerToken("Basic xyz")).toBeNull();
    expect(bearerToken(undefined, "  ")).toBeNull();
  });
});

describe("scopes", () => {
  it("matches scopes exactly", () => {
    expect(hasScopes(["a:read", "b:write"], ["a:read"])).toBe(true);
    expect(hasScopes(["a:read"], ["a:read", "b:write"])).toBe(false);
    expect(hasScopes(["a:*"], ["a:read"])).toBe(false);
    expect(hasScopes([], [])).toBe(true);
  });

  it("lets * grant everything", () => {
    expect(hasScopes([ALL_SCOPES], ["a:read", "b:write"])).toBe(true);
    expect(missingScopes(["*"], ["a"])).toEqual([]);
  });

  it("lists missing scopes once", () => {
    expect(missingScopes(["a"], ["a", "b", "c", "b"])).toEqual(["b", "c"]);
  });
});
