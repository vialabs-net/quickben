import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { databases, examples } from "../src/options";
import {
  mergePackageJson,
  outputPath,
  renderString,
  renderTemplate,
  templateLayers,
  templateVariables,
} from "../src/template";

import { sourceTemplates, stampedTemplates, tempDir } from "./helpers";

import type { ProjectOptions } from "../src/options";

const base: ProjectOptions = {
  directory: "/work/my-app",
  name: "my-app",
  db: "pglite",
  pm: "pnpm",
  example: "blank",
  install: true,
  git: true,
};

describe("helpers", () => {
  it("lists the layers in order", () => {
    expect(templateLayers({ db: "sqlite", example: "blog" })).toEqual([
      "base",
      "db/sqlite",
      "example/blog",
    ]);
  });

  it("replaces known placeholders only", () => {
    expect(renderString("{{name}} {{ name }} {{other}} {{name}}", { name: "x" })).toBe(
      "x {{ name }} {{other}} x",
    );
  });

  it("turns a leading underscore into a dot", () => {
    expect(outputPath("_gitignore")).toBe(".gitignore");
    expect(outputPath("app/_env.example")).toBe("app/.env.example");
    expect(outputPath("app/api/[...quickben]/route.ts")).toBe("app/api/[...quickben]/route.ts");
  });

  it("deep-merges package.json and sorts dependencies", () => {
    expect(
      mergePackageJson(
        { name: "a", scripts: { dev: "next dev" }, dependencies: { next: "1", "@b/c": "1" } },
        { scripts: { seed: "x" }, dependencies: { drizzle: "2" }, keywords: ["a"] },
      ),
    ).toEqual({
      name: "a",
      scripts: { dev: "next dev", seed: "x" },
      dependencies: { "@b/c": "1", drizzle: "2", next: "1" },
      keywords: ["a"],
    });
  });

  it("fills variables from the options", () => {
    expect(templateVariables({ ...base, pm: "npm", db: "postgres" })).toMatchObject({
      name: "my-app",
      database: "Postgres",
      install: "npm install",
      run: "npm run",
    });
  });
});

describe("renderTemplate", () => {
  let templates: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const temp = await tempDir();
    cleanup = temp.cleanup;
    templates = await stampedTemplates(temp.dir);
  });
  afterAll(() => cleanup());

  it("renders the files of a pglite blank app", async () => {
    const files = await renderTemplate(templates, base);
    expect([...files.keys()]).toEqual([
      ".env.example",
      ".gitignore",
      "app/admin/[[...segments]]/page.tsx",
      "app/admin/layout.tsx",
      "app/api/[...quickben]/route.ts",
      "app/globals.css",
      "app/layout.tsx",
      "app/page.tsx",
      "lib/auth.ts",
      "lib/db.ts",
      "next.config.ts",
      "package.json",
      "quickben.config.ts",
      "README.md",
      "tsconfig.json",
    ]);
    const manifest = JSON.parse(files.get("package.json") ?? "") as {
      name: string;
      dependencies: Record<string, string>;
    };
    expect(manifest.name).toBe("my-app");
    expect(Object.keys(manifest.dependencies)).toEqual([
      "@electric-sql/pglite",
      "@quickben/admin",
      "@quickben/core",
      "@quickben/db-drizzle",
      "@quickben/next",
      "drizzle-orm",
      "next",
      "react",
      "react-dom",
    ]);
    expect(files.get("lib/db.ts")).toContain('dialect: "pglite"');
    expect(files.get("app/page.tsx")).toContain('const appName = "my-app";');
    expect(files.get("README.md")).toContain("pnpm install\npnpm dev");
    expect(files.get(".env.example")).toContain("QUICKBEN_DEV_USER=");
    expect(files.get(".env.example")).toContain("PGLITE_DATA_DIR=");
    expect(files.get("next.config.ts")).toContain("serverExternalPackages");
  });

  it.each(databases.flatMap((db) => examples.map((example) => [db, example] as const)))(
    "renders %s + %s without placeholders left",
    async (db, example) => {
      const files = await renderTemplate(templates, { ...base, db, example });
      for (const [path, content] of files) {
        expect(content, path).not.toMatch(/\{\{\w+\}\}/);
        expect(content, path).not.toContain("workspace:");
      }
      expect(files.has("lib/seed.ts")).toBe(example === "blog");
      const manifest = files.get("package.json") ?? "";
      expect(manifest.includes("@quickben/db-memory")).toBe(db === "memory");
      expect(manifest.includes("@quickben/db-drizzle")).toBe(db !== "memory");
      expect(manifest.includes('"pg"')).toBe(db === "postgres");
      expect(manifest.includes("@libsql/client")).toBe(db === "sqlite");
    },
  );

  it("refuses templates that were not stamped", async () => {
    await expect(renderTemplate(sourceTemplates, base)).rejects.toThrow(
      /has version "workspace:\^". Build create-quickben/,
    );
  });
});
