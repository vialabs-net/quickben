import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getQuickben } from "@quickben/core";
import { afterAll, describe, expect, it } from "vitest";

import { inProcessRunner, listSamples } from "../src";
import { runCli, usage } from "../src/cli-run";
import { loadFolder, loadManifest, readManifest } from "../src/node";

import { dataset, fakeModels, fileOf, mapReceipt, rawExpected, receiptInput } from "./dataset";
import { makeConfig, system } from "./helpers";

import type { ImportItem } from "../src";

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "qb-doc-reader-"));
  dirs.push(dir);
  return dir;
}

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function collect(items: AsyncIterable<ImportItem>): Promise<ImportItem[]> {
  const out: ImportItem[] = [];
  for await (const item of items) out.push(item);
  return out;
}

/** A folder: 30 receipts with sidecars, in two subfolders, and a manifest of 10 more. */
async function writeDataset(root: string) {
  for (const item of dataset.slice(0, 30)) {
    const name = item.key.replace("docs/", `docs/${item.group}/`);
    await mkdir(join(root, name, ".."), { recursive: true });
    await writeFile(join(root, name), fileOf(item.key));
    const sidecar =
      item.index % 2 === 0
        ? {
            expected: rawExpected(item),
            group: item.group,
            attributes: { hasTextLayer: item.hasTextLayer },
          }
        : rawExpected(item);
    await writeFile(join(root, name.replace(/\.png$/u, ".json")), JSON.stringify(sidecar));
  }
  await mkdir(join(root, "more"), { recursive: true });
  const lines = ["# manifest"];
  for (const item of dataset.slice(30, 40)) {
    await writeFile(join(root, "more", `${String(item.index)}.png`), fileOf(item.key));
    lines.push(
      JSON.stringify({
        key: item.key,
        file: `more/${String(item.index)}.png`,
        expected: rawExpected(item),
        group: item.group,
        attributes: { hasTextLayer: item.hasTextLayer },
        note: "from the manifest",
      }),
    );
  }
  await writeFile(join(root, "manifest.jsonl"), lines.join("\n"));
}

describe("disk loaders", () => {
  it("reads folders with sidecars and manifests, and refuses paths outside", async () => {
    const root = await tempDir();
    await writeDataset(root);
    const folder = await collect(loadFolder(join(root, "docs")));
    expect(folder).toHaveLength(30);
    expect(folder[0]).toMatchObject({
      key: "g0/receipt-000.png",
      group: "g0",
      attributes: { hasTextLayer: true },
      expected: { header: { code: "C-1000" } },
    });
    // A plain sidecar is the expected values.
    expect(folder.find((item) => item.key === "g1/receipt-001.png")).toMatchObject({
      expected: { header: { code: "C-1001" } },
    });
    expect(folder.find((item) => item.key === "g1/receipt-001.png")?.group).toBeUndefined();

    const manifest = await collect(loadManifest(join(root, "manifest.jsonl")));
    expect(manifest).toHaveLength(10);
    expect(manifest[0]).toMatchObject({ key: dataset[30]?.key, note: "from the manifest" });

    await writeFile(join(root, "list.json"), JSON.stringify([{ file: "more/30.png" }]));
    expect(await readManifest(join(root, "list.json"))).toEqual([{ file: "more/30.png" }]);
    await writeFile(join(root, "escape.jsonl"), JSON.stringify({ file: "../etc/passwd" }));
    await expect(collect(loadManifest(join(root, "escape.jsonl")))).rejects.toThrow(/outside/u);
    await writeFile(join(root, "bad.jsonl"), "{not json");
    await expect(readManifest(join(root, "bad.jsonl"))).rejects.toThrow(/not JSON/u);
    await writeFile(join(root, "nofile.jsonl"), JSON.stringify({ key: "x" }));
    await expect(readManifest(join(root, "nofile.jsonl"))).rejects.toThrow(/no "file"/u);
    await writeFile(join(root, "docs", "g0", "receipt-000.json"), "{oops");
    await expect(collect(loadFolder(join(root, "docs")))).rejects.toThrow(/not JSON/u);
  });
});

describe("quickben-doc-reader", () => {
  it("imports, splits, runs and exports from a terminal", async () => {
    const root = await tempDir();
    await writeDataset(root);
    const models = fakeModels();
    const { config } = makeConfig({
      types: [receiptInput],
      resolveModel: models.resolveModel,
      runner: inProcessRunner({ concurrency: 4 }),
      testRetryDelayMs: 0,
    });
    let stdout = "";
    let stderr = "";
    const io = {
      cwd: root,
      stdout: (text: string) => {
        stdout += text;
      },
      stderr: (text: string) => {
        stderr += text;
      },
      pollMs: 5,
      importModule: (file: string) =>
        Promise.resolve(file.endsWith("map.ts") ? { default: mapReceipt } : { default: config }),
    };
    const cli = async (...args: string[]) => {
      stdout = "";
      stderr = "";
      return runCli(args, io);
    };
    const base = ["--config", "quickben.config.ts", "--type", "receipt"];

    expect(await cli("import", ...base, "--dir", "docs", "--map", "map.ts")).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ created: 30, failed: [] });
    expect(
      await cli("import", ...base, "--manifest", "manifest.jsonl", "--map", "map.ts", "--dry-run"),
    ).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ created: 10 });
    expect(await cli("import", ...base, "--manifest", "manifest.jsonl", "--map", "map.ts")).toBe(0);
    expect(await cli("import", ...base, "--manifest", "manifest.jsonl", "--map", "map.ts")).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ unchanged: 10 });

    expect(
      await cli(
        "split",
        ...base,
        "--seed",
        "cli",
        "--ratios",
        "60/20/20",
        "--unseen",
        "g9",
        "--stratify",
        "group",
        "--note",
        "cli",
      ),
    ).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ version: 1, seed: "cli", unseenGroups: ["g9"] });
    expect(await cli("split", ...base)).toBe(1);
    expect(stderr).toMatch(/resplit/u);

    expect(await cli("run", ...base, "--version", "1", "--split", "test")).toBe(1);
    expect(stderr).toMatch(/publishing/u);
    expect(
      await cli(
        "run",
        ...base,
        "--version",
        "1",
        "--split",
        "dev,validation",
        "--concurrency",
        "3",
        "--retries",
        "1",
        "--max-cost",
        "5",
        "--wait",
      ),
    ).toBe(0);
    const run = JSON.parse(stdout) as { id: string; state: string; metrics: { samples: number } };
    expect(run.state).toBe("done");
    const samples = await listSamples(await getQuickben(config), system, "receipt");
    expect(samples).toHaveLength(40);
    expect(run.metrics.samples).toBe(
      samples.filter((s) => s.split === "dev" || s.split === "validation").length,
    );

    expect(await cli("run", ...base, "--version", "1", "--split", "validation", "--held-out")).toBe(
      0,
    );
    expect(stdout.trim()).toMatch(/^[\w-]+$/u);

    expect(
      await cli("export", "--config", "quickben.config.ts", "--run", run.id, "--out", "out.csv"),
    ).toBe(0);
    const csv = await readFile(join(root, "out.csv"), "utf8");
    expect(csv.split("\n")[0]).toContain("sampleId");
    expect(
      await cli("export", "--config", "quickben.config.ts", "--run", run.id, "--format", "json"),
    ).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ id: run.id });

    // Usage errors.
    expect(await cli()).toBe(1);
    expect(stdout).toContain(usage.split("\n")[0]);
    expect(await cli("--help")).toBe(0);
    expect(await cli("nope", ...base)).toBe(2);
    expect(await cli("import", "--type", "receipt", "--dir", "docs")).toBe(2);
    expect(await cli("import", "--config", "quickben.config.ts", "--dir", "docs")).toBe(2);
    expect(await cli("import", ...base)).toBe(2);
    expect(await cli("split", ...base, "--ratios", "1/2")).toBe(2);
    expect(await cli("split", ...base, "--ratios", "0/0/0")).toBe(2);
    expect(await cli("run", ...base)).toBe(2);
    expect(await cli("run", ...base, "--version", "x")).toBe(2);
    expect(await cli("run", ...base, "--version", "1", "--split", "train")).toBe(2);
    expect(await cli("export", "--config", "quickben.config.ts")).toBe(2);
    expect(
      await cli("export", "--config", "quickben.config.ts", "--run", run.id, "--format", "xml"),
    ).toBe(2);
    expect(await cli("import", ...base, "--dir", "docs", "--map", "map.ts", "--bogus")).toBe(2);
  });
});
