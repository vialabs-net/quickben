/**
 * `@quickben/plugin-doc-reader/node`: read datasets from disk for `importSamples`.
 *
 * ```ts
 * await importSamples(qb, ctx, "receipt", loadManifest("data/manifest.jsonl"), { map });
 * ```
 */
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

import type { ImportItem } from "./import";
import type { SampleAttributes } from "./metrics";
import type { ExtractionParams } from "./definition";

/** Document files a folder import picks up. */
export const DOCUMENT_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".webp"] as const;

/** One line of a manifest (JSON Lines) or one entry of a JSON array. */
export interface ManifestEntry {
  /** Path of the document, relative to the manifest. */
  readonly file: string;
  /** Default: `file`. */
  readonly key?: string;
  readonly expected?: unknown;
  readonly group?: string | null;
  readonly attributes?: SampleAttributes;
  readonly params?: ExtractionParams;
  readonly note?: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Entries of a `.jsonl` (one JSON object per line) or `.json` (an array) manifest. */
export async function readManifest(path: string): Promise<ManifestEntry[]> {
  const text = await readFile(path, "utf8");
  const entries: unknown[] = path.endsWith(".json")
    ? (JSON.parse(text) as unknown[])
    : text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"))
        .map((line, index) => {
          try {
            return JSON.parse(line) as unknown;
          } catch {
            throw new Error(`${path}:${String(index + 1)}: not JSON`);
          }
        });
  if (!Array.isArray(entries)) throw new Error(`${path}: expected an array of entries`);
  return entries.map((entry, index) => {
    if (!isObject(entry) || typeof entry.file !== "string" || entry.file === "") {
      throw new Error(`${path}: entry ${String(index + 1)} has no "file"`);
    }
    return entry as unknown as ManifestEntry;
  });
}

/** A path inside `root`, or an error: a manifest cannot reach files outside its folder. */
function inside(root: string, path: string): string {
  const full = resolve(root, path);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error(`${path} is outside ${root}`);
  }
  return full;
}

/** Import items from a manifest. Files are read one at a time, as the import asks for them. */
export async function* loadManifest(path: string): AsyncGenerator<ImportItem> {
  const root = dirname(resolve(path));
  for (const entry of await readManifest(path)) {
    const full = inside(root, entry.file);
    yield {
      key: entry.key ?? entry.file.split(sep).join("/"),
      file: { bytes: new Uint8Array(await readFile(full)), name: basename(full) },
      ...(entry.expected === undefined ? {} : { expected: entry.expected }),
      ...(entry.group === undefined ? {} : { group: entry.group }),
      ...(entry.attributes ? { attributes: entry.attributes } : {}),
      ...(entry.params ? { params: entry.params } : {}),
      ...(entry.note ? { note: entry.note } : {}),
    };
  }
}

async function documentsIn(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await documentsIn(path)));
    else if ((DOCUMENT_EXTENSIONS as readonly string[]).includes(extname(entry.name).toLowerCase()))
      found.push(path);
  }
  return found.sort();
}

/**
 * Import items from a folder: every document file, with a JSON sidecar of the same name
 * (`a.pdf` → `a.json`). A sidecar with an `expected` object is read as
 * `{ expected, group, attributes, params, note }`; any other JSON is the expected values. The
 * key is the file's path relative to the folder.
 */
export async function* loadFolder(dir: string): AsyncGenerator<ImportItem> {
  const root = resolve(dir);
  for (const path of await documentsIn(root)) {
    const sidecar = path.slice(0, -extname(path).length) + ".json";
    let meta: unknown;
    try {
      meta = JSON.parse(await readFile(sidecar, "utf8")) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`${sidecar}: not JSON`, { cause: error });
      }
    }
    const wrapped = isObject(meta) && isObject(meta.expected);
    const info = wrapped ? (meta as Record<string, unknown>) : {};
    yield {
      key: relative(root, path).split(sep).join("/"),
      file: { bytes: new Uint8Array(await readFile(path)), name: basename(path) },
      ...(meta === undefined ? {} : { expected: wrapped ? info.expected : meta }),
      ...(typeof info.group === "string" ? { group: info.group } : {}),
      ...(isObject(info.attributes) ? { attributes: info.attributes as SampleAttributes } : {}),
      ...(isObject(info.params) ? { params: info.params as ExtractionParams } : {}),
      ...(typeof info.note === "string" ? { note: info.note } : {}),
    };
  }
}

export type { ExpectedMapper, ImportItem, ImportOptions, ImportReport } from "./import";
