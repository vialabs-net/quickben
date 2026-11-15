import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configFromModule, importModule } from "../src/load";
import { runCli } from "../src/run";

import { fixtureConfig } from "./fixture";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "qb-openapi-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function cli(modules: Record<string, Record<string, unknown>> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    cwd: dir,
    stdout: (text: string) => out.push(text),
    stderr: (text: string) => err.push(text),
    importModule: (file: string) => {
      const found = modules[file];
      return found ? Promise.resolve(found) : Promise.reject(new Error(`Cannot find ${file}`));
    },
  };
  return {
    run: (...argv: string[]) => runCli(argv, io),
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

describe("quickben-openapi generate", () => {
  const module = () => ({ default: fixtureConfig(), openapi: { info: { version: "9.9.9" } } });

  it("prints the document", async () => {
    const io = cli({ [join(dir, "app.ts")]: module() });
    expect(
      await io.run(
        "generate",
        "--config",
        "app.ts",
        "--title",
        "T",
        "--server",
        "https://a.test/api",
        "--server",
        "/api",
      ),
    ).toBe(0);
    const doc = JSON.parse(io.out()) as { info: object; servers: unknown };
    expect(doc.info).toEqual({ title: "T", version: "9.9.9" });
    expect(doc.servers).toEqual([{ url: "https://a.test/api" }, { url: "/api" }]);
  });

  it("writes and checks a file", async () => {
    const modules = { [join(dir, "app.ts")]: module() };
    const write = cli(modules);
    expect(
      await write.run(
        "generate",
        "--config",
        "app.ts",
        "--out",
        "spec.json",
        "--api-version",
        "2",
        "--base-path",
        "/x",
      ),
    ).toBe(0);
    expect(write.out()).toBe("Wrote spec.json.\n");
    const text = await readFile(join(dir, "spec.json"), "utf8");
    expect(JSON.parse(text)).toMatchObject({ info: { version: "2" }, servers: [{ url: "/x" }] });

    const fresh = cli(modules);
    expect(
      await fresh.run(
        "generate",
        "--config",
        "app.ts",
        "--out",
        "spec.json",
        "--check",
        "--api-version",
        "2",
        "--base-path",
        "/x",
      ),
    ).toBe(0);
    expect(fresh.out()).toBe("spec.json is up to date.\n");

    const stale = cli(modules);
    expect(await stale.run("generate", "--config", "app.ts", "--out", "spec.json", "--check")).toBe(
      1,
    );
    expect(stale.err()).toContain("spec.json is stale");

    const missing = cli(modules);
    expect(
      await missing.run("generate", "--config", "app.ts", "--out", "none.json", "--check"),
    ).toBe(1);
  });

  it("reports usage errors", async () => {
    const io = cli();
    expect(await io.run("generate")).toBe(2);
    expect(io.err()).toContain("generate needs --config <file>");
    expect(io.err()).toContain("Usage:");
    const check = cli();
    expect(await check.run("generate", "--config", "a.ts", "--check")).toBe(2);
    expect(check.err()).toContain("--check needs --out");
    const unknown = cli();
    expect(await unknown.run("publish")).toBe(2);
    expect(unknown.err()).toContain('Unknown command "publish"');
    const flag = cli();
    expect(await flag.run("generate", "--nope")).toBe(2);
  });

  it("fails on a module without a config", async () => {
    const io = cli({ [join(dir, "empty.ts")]: { default: { nothing: true } } });
    expect(await io.run("generate", "--config", "empty.ts")).toBe(2);
    expect(io.err()).toContain("empty.ts has no Quickben config");
    const gone = cli();
    expect(await gone.run("generate", "--config", "gone.ts")).toBe(2);
    expect(gone.err()).toContain("Cannot find");
  });

  it("prints help", async () => {
    const io = cli();
    expect(await io.run("--help")).toBe(0);
    expect(io.out()).toContain("quickben-openapi diff");
    expect(await cli().run()).toBe(2);
  });
});

describe("quickben-openapi diff", () => {
  const spec = (paths: object) =>
    JSON.stringify({ openapi: "3.1.0", info: { title: "t", version: "1" }, paths });
  const op = { responses: { "200": { description: "ok" } } };

  beforeAll(async () => {
    await writeFile(join(dir, "base.json"), spec({ "/a": { get: op }, "/b": { get: op } }));
    await writeFile(join(dir, "head.json"), spec({ "/a": { get: op }, "/c": { get: op } }));
    await writeFile(join(dir, "same.json"), spec({ "/a": { get: op }, "/b": { get: op } }));
    await writeFile(join(dir, "bad.json"), "{");
  });

  it("exits 1 on breaking changes", async () => {
    const io = cli();
    expect(await io.run("diff", "base.json", "head.json")).toBe(1);
    expect(io.out()).toBe(
      "Breaking changes (1):\n  GET /b: the path was removed\n\nNon-breaking changes (1):\n  GET /c: the operation was added\n",
    );
  });

  it("exits 0 without breaking changes and prints JSON", async () => {
    const io = cli();
    expect(await io.run("diff", "base.json", "same.json", "--json")).toBe(0);
    expect(JSON.parse(io.out())).toEqual({ breaking: 0, allowed: 0, nonBreaking: 0, changes: [] });
  });

  it("reports bad input", async () => {
    const io = cli();
    expect(await io.run("diff", "base.json")).toBe(2);
    expect(io.err()).toContain("diff needs <base.json> <head.json>");
    const outside = cli();
    expect(await outside.run("diff", "../base.json", "head.json")).toBe(2);
    expect(outside.err()).toContain("../base.json is outside the working directory");
    const bad = cli();
    expect(await bad.run("diff", "base.json", "bad.json")).toBe(2);
    expect(bad.err()).toContain("bad.json is not valid JSON");
  });
});

describe("loading configs", () => {
  it("imports TypeScript configs with tsx when it is installed", async () => {
    const file = join(import.meta.dirname, "fixtures/config.ts");
    const loaded = configFromModule(await importModule(file), "config.ts");
    expect(loaded.options).toEqual({ info: { title: "Notes", version: "1.0.0" } });
    expect(loaded.config.collections.map((c) => c.slug)).toEqual(["notes"]);
  });

  it("imports JavaScript modules and finds a config export", async () => {
    const file = join(dir, "plain.mjs");
    await writeFile(file, "export const config = { collections: [], admin: {} };\n");
    const loaded = configFromModule(await importModule(file), "plain.mjs");
    expect(loaded.config.collections).toEqual([]);
    expect(loaded.options).toEqual({});
  });

  it("uses Node's type stripping without tsx", async () => {
    const file = join(dir, "stripped.ts");
    await writeFile(
      file,
      "const config: { collections: never[]; admin: object } = { collections: [], admin: {} };\nexport default config;\n",
    );
    const loaded = configFromModule(await importModule(file), "stripped.ts");
    expect(loaded.config.collections).toEqual([]);
  });

  it("unwraps a CommonJS default", () => {
    const config = { collections: [], admin: {} };
    expect(configFromModule({ default: { default: config } }, "x").config).toBe(config);
  });
});
