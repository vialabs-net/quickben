import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stampManifest, stampTemplates, workspaceVersions } from "../src/stamp";

import { packageDir, sourceTemplates, tempDir } from "./helpers";

const versions = { "@quickben/core": "1.2.3" };

describe("stampManifest", () => {
  it("replaces workspace ranges in every dependency map", () => {
    expect(
      stampManifest(
        {
          name: "app",
          dependencies: { "@quickben/core": "workspace:^", next: "16.4.6" },
          devDependencies: { "@quickben/core": "workspace:*" },
          peerDependencies: { "@quickben/core": "workspace:~" },
        },
        versions,
      ),
    ).toEqual({
      name: "app",
      dependencies: { "@quickben/core": "^1.2.3", next: "16.4.6" },
      devDependencies: { "@quickben/core": "1.2.3" },
      peerDependencies: { "@quickben/core": "~1.2.3" },
    });
  });

  it("keeps explicit workspace ranges and non-string values", () => {
    expect(
      stampManifest({ dependencies: { "@quickben/core": "workspace:^1.0.0", odd: 1 } }, versions),
    ).toEqual({ dependencies: { "@quickben/core": "^1.0.0", odd: 1 } });
  });

  it("throws for unknown workspace packages", () => {
    expect(() =>
      stampManifest({ dependencies: { "@quickben/nope": "workspace:^" } }, versions),
    ).toThrow("No workspace package named @quickben/nope");
  });
});

describe("workspaceVersions", () => {
  it("reads the versions of the sibling packages", async () => {
    const found = await workspaceVersions(join(packageDir, ".."));
    expect(Object.keys(found)).toEqual(
      expect.arrayContaining([
        "@quickben/core",
        "@quickben/next",
        "@quickben/admin",
        "@quickben/db-drizzle",
        "@quickben/db-memory",
        "create-quickben",
      ]),
    );
    expect(found["@quickben/core"]).toMatch(/^\d+\.\d+\.\d+/);
  });

  describe("with odd entries", () => {
    let dir: string;
    let cleanup: () => Promise<void>;
    beforeEach(async () => ({ dir, cleanup } = await tempDir()));
    afterEach(() => cleanup());

    it("skips files, directories without a manifest and manifests without a version", async () => {
      await writeFile(join(dir, "README.md"), "");
      await mkdir(join(dir, "empty"));
      await mkdir(join(dir, "private"));
      await writeFile(join(dir, "private/package.json"), JSON.stringify({ name: "x" }));
      await mkdir(join(dir, "ok"));
      await writeFile(
        join(dir, "ok/package.json"),
        JSON.stringify({ name: "ok", version: "2.0.0" }),
      );
      expect(await workspaceVersions(dir)).toEqual({ ok: "2.0.0" });
    });
  });
});

describe("stampTemplates", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  beforeEach(async () => ({ dir, cleanup } = await tempDir()));
  afterEach(() => cleanup());

  it("copies the templates and stamps every package.json", async () => {
    const out = join(dir, "templates");
    const stamped = await stampTemplates(sourceTemplates, out, {
      "@quickben/core": "0.1.0",
      "@quickben/next": "0.1.0",
      "@quickben/admin": "0.1.0",
      "@quickben/db-drizzle": "0.2.0",
      "@quickben/db-memory": "0.1.0",
    });
    expect(stamped.length).toBeGreaterThanOrEqual(5);
    const all = await Promise.all(stamped.map((file) => readFile(file, "utf8")));
    for (const content of all) expect(content).not.toContain("workspace:");
    const pglite = JSON.parse(await readFile(join(out, "db/pglite/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pglite.dependencies["@quickben/db-drizzle"]).toBe("^0.2.0");
    // Other files are copied as they are.
    expect(await readFile(join(out, "base/lib/auth.ts"), "utf8")).toBe(
      await readFile(join(sourceTemplates, "base/lib/auth.ts"), "utf8"),
    );
  });
});
