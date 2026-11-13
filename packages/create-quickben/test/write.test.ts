import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertEmptyTarget, TargetNotEmptyError, writeFiles } from "../src/write";

import { tempDir } from "./helpers";

let dir: string;
let cleanup: () => Promise<void>;
beforeEach(async () => ({ dir, cleanup } = await tempDir()));
afterEach(() => cleanup());

describe("assertEmptyTarget", () => {
  it("accepts a missing directory and one with harmless entries", async () => {
    await expect(assertEmptyTarget(join(dir, "new"))).resolves.toBeUndefined();
    await mkdir(join(dir, ".git"));
    await writeFile(join(dir, ".DS_Store"), "");
    await expect(assertEmptyTarget(dir)).resolves.toBeUndefined();
  });

  it("rejects a directory with files", async () => {
    for (const name of ["a", "b", "c", "d", "e", "f", "g"]) await writeFile(join(dir, name), "");
    await expect(assertEmptyTarget(dir)).rejects.toThrow(
      new TargetNotEmptyError(
        `${dir} is not empty (a, b, c, d, e and 2 more). Pick a new or empty directory.`,
      ),
    );
  });

  it("lists every conflict when there are few", async () => {
    await writeFile(join(dir, "package.json"), "{}");
    await expect(assertEmptyTarget(dir)).rejects.toThrow(`${dir} is not empty (package.json).`);
  });

  it("rejects a file", async () => {
    const file = join(dir, "file");
    await writeFile(file, "");
    await expect(assertEmptyTarget(file)).rejects.toThrow(`${file} is a file.`);
  });

  it("passes other errors on", async () => {
    const file = join(dir, "file");
    await writeFile(file, "");
    await expect(assertEmptyTarget(join(file, "child"))).rejects.toMatchObject({ code: "ENOTDIR" });
  });
});

describe("writeFiles", () => {
  it("writes nested files", async () => {
    await writeFiles(
      join(dir, "app"),
      new Map([
        ["package.json", "{}"],
        ["app/api/[...quickben]/route.ts", "export {};"],
      ]),
    );
    expect(await readFile(join(dir, "app/package.json"), "utf8")).toBe("{}");
    expect(await readFile(join(dir, "app/app/api/[...quickben]/route.ts"), "utf8")).toBe(
      "export {};",
    );
  });
});
