import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@libsql/client";
import { defineCollection, defineConfig, fields as f } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  generateSql,
  prismaModelName,
  prismaSource,
  schemaSource,
  sqlSource,
  sqlStatements,
} from "../src";

import { drizzleAdapter } from "./drizzle";
import { fullSchema } from "./fixtures/schema";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "quickben-sql-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("sqlSource", () => {
  it.each([
    ["postgres", undefined],
    ["postgres", "quickben"],
    ["sqlite", undefined],
  ] as const)("writes the DDL for %s (schema %s)", (dialect, schema) => {
    expect(sqlSource(fullSchema, dialect, schema)).toMatchSnapshot();
  });

  it("ignores the schema on SQLite", () => {
    expect(sqlStatements(fullSchema, "sqlite", "quickben")).toEqual(
      sqlStatements(fullSchema, "sqlite"),
    );
  });

  it("creates tables that pass verify (pglite, in a schema)", async () => {
    const client = await PGlite.create();
    await client.exec(sqlSource(fullSchema, "pglite", "quickben"));
    const db = drizzleAdapter({
      dialect: "pglite",
      client,
      push: false,
      schema: "quickben",
      verify: true,
    });
    await db.init(fullSchema);
    expect(await db.checkSchema()).toEqual({ issues: [], statements: [] });
    await client.close();
  });

  it("creates tables that pass verify (sqlite)", async () => {
    const client = createClient({ url: ":memory:" });
    await client.executeMultiple(sqlSource(fullSchema, "sqlite"));
    const db = drizzleAdapter({ dialect: "sqlite", client, push: false, verify: true });
    await db.init(fullSchema);
    expect((await db.checkSchema()).issues).toEqual([]);
    client.close();
  });
});

describe("prismaSource", () => {
  it.each([
    ["postgres", undefined],
    ["postgres", "quickben"],
    ["sqlite", undefined],
  ] as const)("writes Prisma models for %s (schema %s)", (dialect, schema) => {
    expect(prismaSource(fullSchema, dialect, schema)).toMatchSnapshot();
  });

  it("names models and fields Prisma accepts", () => {
    expect(["blog-posts", "a_b", "2fa"].map(prismaModelName)).toEqual([
      "BlogPosts",
      "AB",
      "Model2fa",
    ]);
    const source = prismaSource(
      {
        collections: [
          {
            slug: "x",
            fields: [
              {
                name: "_raw",
                type: "text",
                many: false,
                required: false,
                unique: true,
                index: false,
              },
              { name: "n", type: "text", many: false, required: false, unique: false, index: true },
            ],
          },
        ],
      },
      "postgres",
    );
    expect(source).toMatch(
      /^ {2}f_raw +String\? +@map\("_raw"\) @unique\(map: "x__raw_unique"\)$/m,
    );
    expect(source).toContain('@@index([n], map: "x_n_idx")');
  });

  // Runs when the `prisma` CLI is installed (a dev dependency of this package).
  const prisma = join(import.meta.dirname, "../node_modules/.bin/prisma");
  describe.runIf(existsSync(prisma))("prisma validate", () => {
    const run = promisify(execFile);
    it.each([
      ["postgresql", "postgres", "quickben"],
      ["postgresql", "postgres", undefined],
      ["sqlite", "sqlite", undefined],
    ] as const)("accepts the %s models (schema %s)", async (provider, dialect, schema) => {
      const file = join(dir, `${dialect}-${schema ?? "default"}.prisma`);
      const datasource = [
        "datasource db {",
        `  provider = "${provider}"`,
        ...(schema ? [`  schemas  = ["${schema}"]`] : []),
        "}",
        "",
      ];
      await writeFile(file, [...datasource, prismaSource(fullSchema, dialect, schema)].join("\n"));
      const { stdout } = await run(prisma, ["validate", "--schema", file], {
        env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "1", CHECKPOINT_DISABLE: "1" },
      });
      expect(stdout).toContain("is valid");
    });
  });
});

describe("generateSql", () => {
  const notes = defineCollection({ slug: "notes", fields: { text: f.text({ required: true }) } });

  it("takes the dialect and schema from the config's adapter", async () => {
    const config = defineConfig({
      db: drizzleAdapter({ dialect: "pglite", schema: "app" }),
      collections: [notes],
    });
    const source = await generateSql(config);
    expect(source).toContain('create table "app"."notes" (');
    expect(await generateSql(config, { schema: "other" })).toContain('"other"."notes"');
    expect(await generateSql(config, { format: "prisma" })).toContain('@@schema("app")');
    expect(schemaSource(fullSchema, "postgres", "public")).not.toContain("pgSchema");
  });

  it("writes the file and needs a dialect without drizzleAdapter", async () => {
    const config = defineConfig({ db: memoryAdapter(), collections: [notes] });
    await expect(generateSql(config)).rejects.toThrow("pass `dialect`");
    const out = join(dir, "nested/notes.sql");
    const source = await generateSql(config, { dialect: "sqlite", out });
    expect(await readFile(out, "utf8")).toBe(source);
  });
});
