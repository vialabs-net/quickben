/**
 * Files in a local directory. For development, tests, one server or a shared volume.
 */
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Readable } from "node:stream";

import { assertStorageKey, fileExtensions } from "@quickben/core";

import type { StorageAdapter, StorageObjectInfo } from "@quickben/core";

/** Options of {@link localFileStorage}. */
export interface LocalFileStorageOptions {
  /** Directory of the files. Created on the first write. Relative paths resolve from the working directory. */
  root: string;
}

const typesByExtension: ReadonlyMap<string, string> = new Map(
  Object.entries(fileExtensions).map(([type, extension]) => [extension, type]),
);

/** The type of a key from its extension, as core names stored files. */
function typeOf(key: string): string | null {
  const dot = key.lastIndexOf(".");
  return dot === -1 ? null : (typesByExtension.get(key.slice(dot).toLowerCase()) ?? null);
}

function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Store files under `root`. Keys are checked with `assertStorageKey` and must resolve inside
 * `root`. Writes go to a temporary file first, then are renamed, so readers never see half a
 * file. The content type of `head` and `get` comes from the key's extension.
 */
export function localFileStorage(options: LocalFileStorageOptions): StorageAdapter {
  const root = resolve(options.root);
  const pathOf = (key: string) => {
    const path = resolve(root, assertStorageKey(key));
    if (!path.startsWith(root + sep)) throw new TypeError(`Key "${key}" is outside the root`);
    return path;
  };
  const info = async (key: string): Promise<StorageObjectInfo | null> => {
    try {
      const stats = await stat(pathOf(key));
      return stats.isFile() ? { key, size: stats.size, contentType: typeOf(key) } : null;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  };
  return {
    name: "local",
    async put(key, bytes) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${globalThis.crypto.randomUUID()}.tmp`;
      try {
        await writeFile(temporary, bytes);
        await rename(temporary, path);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    },
    async get(key) {
      const head = await info(key);
      if (!head) return null;
      const stream = Readable.toWeb(createReadStream(pathOf(key)));
      return { ...head, body: stream as unknown as ReadableStream<Uint8Array> };
    },
    async getBytes(key) {
      try {
        return new Uint8Array(await readFile(pathOf(key)));
      } catch (error) {
        if (isMissing(error) || (error as { code?: unknown }).code === "EISDIR") return null;
        throw error;
      }
    },
    head: info,
    async delete(key) {
      await rm(pathOf(key), { force: true });
    },
  };
}
