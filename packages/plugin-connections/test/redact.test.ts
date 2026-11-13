import { describe, expect, it } from "vitest";

import { REDACTED, redactKeys, redactSecrets, secretVariants } from "../src";
import { kindLabel } from "../src/admin/describe";
import { normalizeBasePath } from "../src/admin/registry";

describe("redaction", () => {
  it("removes keys at any depth", () => {
    expect(
      redactKeys({ a: 1, organization_api_key: "k", list: [{ organization_api_key: "k", b: 2 }] }, [
        "organization_api_key",
      ]),
    ).toEqual({ a: 1, list: [{ b: 2 }] });
    expect(redactKeys("text", ["x"])).toBe("text");
  });

  it("replaces secrets in strings and keys, ignoring very short ones", () => {
    expect(redactSecrets({ "k-secret1": ["say secret1", 3, null] }, ["secret1", "ab"])).toEqual({
      [`k-${REDACTED}`]: [`say ${REDACTED}`, 3, null],
    });
    expect(redactSecrets("abc", ["ab"])).toBe("abc");
  });

  it("knows the parts of basic and service account secrets", () => {
    expect(secretVariants(" user:password1 ")).toEqual([
      " user:password1 ",
      "user:password1",
      "password1 ",
    ]);
    expect(
      secretVariants(
        JSON.stringify({ private_key: "PEM", private_key_id: "kid", client_email: "x" }),
      ),
    ).toEqual(expect.arrayContaining(["PEM", "kid"]));
    expect(secretVariants("123")).toEqual(["123"]);
  });
});

describe("admin helpers", () => {
  it("labels kinds and normalizes base paths", () => {
    expect(kindLabel("basic")).toBe("Username and password");
    expect(kindLabel("other")).toBe("other");
    expect(normalizeBasePath("admin//")).toBe("/admin");
    expect(normalizeBasePath("/x")).toBe("/x");
  });
});
