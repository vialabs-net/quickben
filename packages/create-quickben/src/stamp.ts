import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Manifest = Record<string, unknown>;

const dependencyKeys = ["dependencies", "devDependencies", "peerDependencies"] as const;

/** Name to version of every package in a directory of packages (e.g. `packages/`). */
export async function workspaceVersions(packagesDir: string): Promise<Record<string, string>> {
  const versions: Record<string, string> = {};
  for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let manifest: Manifest;
    try {
      manifest = JSON.parse(
        await readFile(join(packagesDir, entry.name, "package.json"), "utf8"),
      ) as Manifest;
    } catch {
      continue;
    }
    if (typeof manifest.name === "string" && typeof manifest.version === "string") {
      versions[manifest.name] = manifest.version;
    }
  }
  return versions;
}

/**
 * Replace `workspace:` versions with the package's version: `workspace:^` becomes `^1.2.3`,
 * `workspace:~` becomes `~1.2.3` and `workspace:*` becomes `1.2.3`. Throws for packages that are
 * not in `versions`.
 */
export function stampManifest(
  manifest: Manifest,
  versions: Readonly<Record<string, string>>,
): Manifest {
  const result: Manifest = { ...manifest };
  for (const key of dependencyKeys) {
    const deps = result[key];
    if (typeof deps !== "object" || deps === null) continue;
    const stamped: Record<string, unknown> = {};
    for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
      stamped[name] = typeof spec === "string" ? stampSpec(name, spec, versions) : spec;
    }
    result[key] = stamped;
  }
  return result;
}

function stampSpec(name: string, spec: string, versions: Readonly<Record<string, string>>): string {
  if (!spec.startsWith("workspace:")) return spec;
  const version = Object.hasOwn(versions, name) ? versions[name] : undefined;
  if (version === undefined) throw new Error(`No workspace package named ${name}`);
  const range = spec.slice("workspace:".length);
  if (range === "^" || range === "~") return `${range}${version}`;
  if (range === "*") return version;
  return range;
}

async function findManifests(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name === "package.json")
    .map((entry) => join(entry.parentPath, entry.name));
}

/**
 * Copy the templates to `outDir` and stamp every `package.json` in the copy, so a published
 * CLI installs the `@quickben/*` versions it was released with. Returns the stamped files.
 */
export async function stampTemplates(
  templatesDir: string,
  outDir: string,
  versions: Readonly<Record<string, string>>,
): Promise<string[]> {
  await cp(templatesDir, outDir, { recursive: true });
  const manifests = await findManifests(outDir);
  for (const file of manifests) {
    const manifest = JSON.parse(await readFile(file, "utf8")) as Manifest;
    await writeFile(file, `${JSON.stringify(stampManifest(manifest, versions), null, 2)}\n`);
  }
  return manifests.sort((a, b) => a.localeCompare(b, "en"));
}
