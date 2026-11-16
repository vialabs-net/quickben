import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "tsdown";
import { afterAll, describe, expect, it } from "vitest";

// Inside the package, so bare imports resolve from its node_modules.
const outDir = join(import.meta.dirname, "../node_modules/.cache/plain-node");

afterAll(async () => {
  await rm(outDir, { recursive: true, force: true });
});

describe("built package", () => {
  it("loads in plain Node ESM, without a bundler", async () => {
    await build({
      config: false,
      cwd: join(import.meta.dirname, ".."),
      entry: ["src/index.ts"],
      outDir,
      format: "esm",
      platform: "neutral",
      dts: false,
      logLevel: "silent",
    });
    const url = pathToFileURL(join(outDir, "index.js")).href;
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const m = await import(${JSON.stringify(url)}); console.log(typeof m.getRequestContext);`,
      ],
      { encoding: "utf8" },
    );
    expect(output.trim()).toBe("function");
  }, 60_000);
});
