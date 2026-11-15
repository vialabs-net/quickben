import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { main } from "../src/cli";

import { drizzleAdapter } from "./drizzle";

let dir: string;
const fixtures = join(import.meta.dirname, "fixtures");

let stdout: string[] = [];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "quickben-cli-"));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
});

function output(): string {
  const text = stdout.join("");
  stdout = [];
  return text;
}

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
  expect(await main(["sql", "--format", "xml"])).toBe(1);
  expect(console.error).toHaveBeenLastCalledWith('Unknown format "xml". Use sql or prisma.');
  expect(await main(["sql", "--diff", "--format", "prisma"])).toBe(1);
  expect(await main(["sql", "--diff"], fixtures)).toBe(1);
  expect(console.error).toHaveBeenLastCalledWith("sql --diff needs --url.");
  expect(await main(["verify"], fixtures)).toBe(1);
  expect(console.error).toHaveBeenLastCalledWith("verify needs --url.");
});

it("writes a schema file in a Postgres schema", async () => {
  const out = join(dir, "in-schema.ts");
  expect(await main(["generate", "--out", out, "--schema", "app"], fixtures)).toBe(0);
  expect(await readFile(out, "utf8")).toContain('export const dbSchema = pg.pgSchema("app");');
  expect(console.error).toHaveBeenLastCalledWith(`Wrote ${out} (1 tables)`);
});

describe("sql", () => {
  it("prints the DDL and Prisma models", async () => {
    expect(await main(["sql", "--schema", "app"], fixtures)).toBe(0);
    expect(output()).toContain('create table "app"."notes" (');
    expect(await main(["sql", "--format", "prisma", "--dialect", "sqlite"], fixtures)).toBe(0);
    expect(output()).toContain("model Notes {");
    const out = join(dir, "out/notes.sql");
    expect(await main(["sql", "--out", out], fixtures)).toBe(0);
    expect(await readFile(out, "utf8")).toContain('create table "notes" (');
  });

  it("prints only what a database is missing, then verifies it", async () => {
    const file = join(dir, "app.db");
    const url = `file:${file}`;
    const client = createClient({ url });
    await client.execute(
      'create table "notes" ("id" text primary key, "createdAt" text not null, "updatedAt" text not null, "text" integer)',
    );
    const args = ["--dialect", "sqlite", "--url", url];

    expect(await main(["verify", ...args], fixtures)).toBe(1);
    expect(console.error).toHaveBeenCalledWith("- notes.text: type is INTEGER, expected text");

    expect(await main(["sql", "--diff", ...args], fixtures)).toBe(0);
    const diff = output();
    expect(diff).toContain('alter table "notes" add column "tags" text default \'[]\' not null;');
    expect(diff).toContain('create index "notes_createdAt_idx" on "notes" ("createdAt");');
    expect(console.error).toHaveBeenCalledWith(
      "Not fixed by this SQL: notes.text: type is INTEGER, expected text",
    );

    const out = join(dir, "diff.sql");
    expect(await main(["sql", "--diff", "--out", out, ...args], fixtures)).toBe(0);
    await client.executeMultiple(await readFile(out, "utf8"));
    await client.execute('alter table "notes" drop column "text"');
    await client.execute('alter table "notes" add column "text" text not null default \'\'');
    client.close();

    expect(await main(["verify", ...args], fixtures)).toBe(0);
    expect(console.error).toHaveBeenLastCalledWith(
      "The database matches the collections (1 tables).",
    );
    expect(await main(["sql", "--diff", ...args], fixtures)).toBe(0);
    expect(console.error).toHaveBeenLastCalledWith("Nothing is missing.");
  });

  it("opens PGlite data directories", async () => {
    const dataDir = join(dir, "pglite");
    const db = drizzleAdapter({ dialect: "pglite", dataDir, schema: "app", push: true });
    await db.init({
      collections: [
        {
          slug: "notes",
          fields: [
            {
              name: "text",
              type: "text",
              many: false,
              required: true,
              unique: false,
              index: false,
            },
            {
              name: "tags",
              type: "select",
              options: ["a", "b"],
              many: true,
              required: false,
              unique: false,
              index: false,
            },
          ],
        },
      ],
    });
    await db.close?.();
    expect(await main(["verify", "--schema", "app", "--url", dataDir], fixtures)).toBe(0);
    expect(await main(["verify", "--url", dataDir], fixtures)).toBe(1);
  });
});
