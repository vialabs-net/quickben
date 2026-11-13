import { describe, expect, it } from "vitest";

import {
  decryptSecret,
  encryptSecret,
  generateMasterKey,
  lastFour,
  MasterKeyError,
  parseMasterKey,
  sealedKeyId,
} from "../src";

import { KEY_A, KEY_B } from "./setup";

describe("master key", () => {
  it("parses hex, base64 and bytes to the same 32 bytes", () => {
    const hex = parseMasterKey(KEY_A);
    expect(hex.key).toHaveLength(32);
    expect(parseMasterKey(Buffer.from(KEY_A, "hex").toString("base64")).id).toBe(hex.id);
    expect(parseMasterKey(new Uint8Array(Buffer.from(KEY_A, "hex"))).id).toBe(hex.id);
    expect(hex.id).toMatch(/^[\da-f]{8}$/);
  });

  it("refuses keys that are not 32 bytes", () => {
    expect(() => parseMasterKey("short")).toThrow(MasterKeyError);
    expect(() => parseMasterKey(new Uint8Array(16))).toThrow(/32 bytes/);
  });

  it("generates random base64 keys", () => {
    const key = generateMasterKey();
    expect(parseMasterKey(key).key).toHaveLength(32);
    expect(generateMasterKey()).not.toBe(key);
  });
});

describe("encryptSecret / decryptSecret", () => {
  const a = parseMasterKey(KEY_A);
  const b = parseMasterKey(KEY_B);

  it("round-trips and never stores the clear text", () => {
    const sealed = encryptSecret("sk-secret-value", a);
    expect(sealed).toMatch(/^v1:[\da-f]{8}:/);
    expect(sealed).not.toContain("sk-secret-value");
    expect(sealedKeyId(sealed)).toBe(a.id);
    expect(decryptSecret(sealed, [a])).toBe("sk-secret-value");
    expect(encryptSecret("sk-secret-value", a)).not.toBe(sealed);
  });

  it("picks the key that sealed the value", () => {
    const sealed = encryptSecret("old", b);
    expect(decryptSecret(sealed, [a, b])).toBe("old");
    expect(() => decryptSecret(sealed, [a])).toThrow(/No master key with id/);
  });

  it("detects tampering and unknown formats", () => {
    const sealed = encryptSecret("value", a);
    const parts = sealed.split(":");
    parts[4] = Buffer.from("other").toString("base64");
    expect(() => decryptSecret(parts.join(":"), [a])).toThrow(/cannot be decrypted/);
    expect(() => decryptSecret("v0:x:y:z:w", [a])).toThrow(/Unknown secret format/);
    expect(() => decryptSecret(`${sealed}:extra`, [a])).toThrow(/Unknown secret format/);
    expect(sealedKeyId("plain")).toBeUndefined();
  });

  it("is a ConfigError (HTTP 500, message hidden by the REST layer)", () => {
    expect(new MasterKeyError("x").status).toBe(500);
  });
});

describe("lastFour", () => {
  it("shows the end of long secrets only", () => {
    expect(lastFour("  sk-0123456789  ")).toBe("6789");
    expect(lastFour("12345678")).toBe("");
  });
});
