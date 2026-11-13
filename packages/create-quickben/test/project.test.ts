import { describe, expect, it } from "vitest";

import { packageName, validateDirectory } from "../src/project";

describe("packageName", () => {
  it.each([
    ["my-app", "my-app"],
    ["./apps/My App", "my-app"],
    ["/work/Été 2026!", "t-2026"],
    ["_private", "private"],
    ["trailing--", "trailing"],
    ["v1.2_beta~x", "v1.2_beta~x"],
  ])("%s → %s", (directory, name) => {
    expect(packageName(directory)).toBe(name);
  });
});

describe("validateDirectory", () => {
  it("accepts names that give a package name", () => {
    expect(validateDirectory("my-app")).toBeUndefined();
  });

  it("rejects empty input and names without valid characters", () => {
    expect(validateDirectory("  ")).toBe("Enter a directory.");
    expect(validateDirectory("!!!")).toContain("does not give a valid package name");
    expect(validateDirectory("a".repeat(215))).toBe("The directory name is too long.");
  });
});
