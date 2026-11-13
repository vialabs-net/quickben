import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { databaseChoices } from "./options";
import { installCommand, runPrefix } from "./pm";

import type { Database, ProjectOptions } from "./options";

/** Files of a rendered project: relative path (with `/`) to content. */
export type FileMap = Map<string, string>;

type Json = Record<string, unknown>;

/** Template layers, applied in order. Later layers replace files of earlier ones. */
export function templateLayers(options: Pick<ProjectOptions, "db" | "example">): string[] {
  return ["base", `db/${options.db}`, `example/${options.example}`];
}

const databaseNotes: Record<Database, string> = {
  pglite:
    "PGlite runs Postgres in process. Data lives in `./.pglite`; delete the directory to start over. Tables and columns are created on start (`push: true` in `lib/db.ts`).",
  postgres:
    "Set `DATABASE_URL` in `.env.local` to your Postgres server. Tables and columns are created on start (`push: true` in `lib/db.ts`). Use migrations once the database holds real data: see https://github.com/vialabs-net/quickben/tree/trunk/packages/db-drizzle#migrations.",
  sqlite:
    "SQLite through libSQL. `DATABASE_URL` in `.env.local` is a local file (default `file:./app.db`) or a libSQL server with `DATABASE_AUTH_TOKEN`. Tables and columns are created on start (`push: true` in `lib/db.ts`).",
  memory:
    "Data lives in memory and resets when the server restarts. Switch `lib/db.ts` to `@quickben/db-drizzle` to keep it.",
};

/** Values for `{{placeholders}}` in template files. */
export function templateVariables(options: ProjectOptions): Record<string, string> {
  const install = installCommand(options.pm);
  const label = databaseChoices.find((choice) => choice.value === options.db)?.label ?? options.db;
  return {
    name: options.name,
    database: label,
    databaseNotes: databaseNotes[options.db],
    install: [install.command, ...install.args].join(" "),
    run: runPrefix(options.pm),
  };
}

/** Replace `{{key}}` with known variables. Unknown keys stay as they are. */
export function renderString(text: string, variables: Readonly<Record<string, string>>): string {
  return text.replaceAll(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.hasOwn(variables, key) ? (variables[key] ?? match) : match,
  );
}

/** A file's path in the project: a leading `_` becomes `.` (npm drops some dotfiles). */
export function outputPath(templatePath: string): string {
  return templatePath
    .split("/")
    .map((part) => (part.startsWith("_") ? `.${part.slice(1)}` : part))
    .join("/");
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-merge two `package.json` objects. Dependency maps are sorted by name. */
export function mergePackageJson(target: Json, source: Json): Json {
  const result: Json = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const current = result[key];
    result[key] = isObject(current) && isObject(value) ? mergePackageJson(current, value) : value;
  }
  for (const key of ["dependencies", "devDependencies"]) {
    const deps = result[key];
    if (isObject(deps)) {
      result[key] = Object.fromEntries(
        Object.entries(deps).sort(([a], [b]) => a.localeCompare(b, "en")),
      );
    }
  }
  return result;
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort((a, b) => a.localeCompare(b, "en"));
}

/**
 * Render the project files from the template directory. `package.json` files of all layers are
 * merged and `.env.example` files are concatenated; other files of later layers replace earlier
 * ones.
 */
export async function renderTemplate(
  templateDir: string,
  options: ProjectOptions,
): Promise<FileMap> {
  const variables = templateVariables(options);
  const files: FileMap = new Map();
  let manifest: Json = {};
  for (const layer of templateLayers(options)) {
    const layerDir = join(templateDir, layer);
    for (const file of await listFiles(layerDir)) {
      const content = renderString(await readFile(join(layerDir, file), "utf8"), variables);
      const path = outputPath(file);
      if (path === "package.json") {
        manifest = mergePackageJson(manifest, JSON.parse(content) as Json);
      } else if (path === ".env.example") {
        files.set(path, (files.get(path) ?? "") + content);
      } else {
        files.set(path, content);
      }
    }
  }
  assertStamped(manifest);
  files.set("package.json", `${JSON.stringify(manifest, null, 2)}\n`);
  return new Map([...files].sort(([a], [b]) => a.localeCompare(b, "en")));
}

/** Fail on `workspace:` versions: templates must be stamped by the build first. */
function assertStamped(manifest: Json): void {
  for (const key of ["dependencies", "devDependencies"]) {
    const deps = manifest[key];
    if (!isObject(deps)) continue;
    for (const [name, version] of Object.entries(deps)) {
      if (typeof version === "string" && version.startsWith("workspace:")) {
        throw new Error(
          `Template dependency ${name} has version "${version}". Build create-quickben to stamp the templates.`,
        );
      }
    }
  }
}
