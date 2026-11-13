import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { main } from "../src/cli";

let dir: string;
const fixtures = join(import.meta.dirname, "fixtures");

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "quickben-cli-"));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

it("generates the schema from a TypeScript config", async () => {
  const out = join(dir, "schema.ts");
  expect(await main(["generate", "--out", out], fixtures)).toBe(0);
  const source = await readFile(out, "utf8");
  expect(source).toContain("export const notesTable = pg.pgTable(");
  expect(console.error).toHaveBeenLastCalledWith(`Wrote ${out} (1 tables)`);
});

it("takes the dialect from the command line", async () => {
  const out = join(dir, "sqlite.ts");
  const code = await main(
    [
      "generate",
      "--config",
      join(fixtures, "quickben.config.ts"),
      "--out",
      out,
      "--dialect",
      "sqlite",
    ],
    dir,
  );
  expect(code).toBe(0);
  expect(await readFile(out, "utf8")).toContain("sqlite.sqliteTable(");
});

it("prints help and rejects bad input", async () => {
  expect(await main(["--help"])).toBe(0);
  expect(await main([])).toBe(1);
  expect(await main(["generate", "--dialect", "mysql"])).toBe(1);
  expect(console.error).toHaveBeenLastCalledWith(
    'Unknown dialect "mysql". Use postgres, pglite or sqlite.',
  );
});
