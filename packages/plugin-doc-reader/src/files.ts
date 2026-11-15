/**
 * Where uploaded documents and samples are kept. The plugin uses a `StorageAdapter` from
 * `@quickben/core`: the config `storage` by default, or `docReader({ files })`.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

import { bytesToStream } from "@quickben/core";

import type { StorageAdapter } from "@quickben/core";

/**
 * The file store of earlier versions. Deprecated: pass a `StorageAdapter` from
 * `@quickben/core` instead, such as `localFileStorage` from `@quickben/storage-local`.
 * A `FileStore` still works until the next major version.
 */
export interface FileStore {
  /** The file's bytes, or `null` when it does not exist. */
  read(ref: string): Promise<Uint8Array | null>;
  write(ref: string, bytes: Uint8Array, mime: string): Promise<void>;
  /** Remove a file. Missing files are fine. */
  delete?(ref: string): Promise<void>;
}

/** Whether `files` is a core `StorageAdapter` rather than a {@link FileStore}. */
export function isStorageAdapter(files: StorageAdapter | FileStore): files is StorageAdapter {
  return "getBytes" in files && "put" in files;
}

/** A `StorageAdapter` over a {@link FileStore}. */
export function fromFileStore(store: FileStore): StorageAdapter {
  const head = async (key: string) => {
    const bytes = await store.read(key);
    return bytes ? { key, size: bytes.byteLength, contentType: null } : null;
  };
  return {
    name: "file-store",
    put: (key, bytes, options = {}) =>
      store.write(key, bytes, options.contentType ?? "application/octet-stream"),
    async get(key) {
      const bytes = await store.read(key);
      return bytes
        ? { key, size: bytes.byteLength, contentType: null, body: bytesToStream(bytes) }
        : null;
    },
    getBytes: (key) => store.read(key),
    head,
    delete: async (key) => {
      await store.delete?.(key);
    },
  };
}

/** Reject absolute paths and `..`, which would escape the store's root. */
export function assertSafeRef(ref: string): string {
  const clean = normalize(ref);
  if (
    !ref ||
    ref.startsWith("/") ||
    ref.includes("\\") ||
    clean.startsWith("..") ||
    clean.includes("/../")
  ) {
    throw new TypeError(`invalid file reference: ${ref}`);
  }
  return clean;
}

/**
 * Files in memory, as a {@link FileStore}. Deprecated: use `memoryStorage()` from
 * `@quickben/core`.
 */
export function memoryFileStore(): FileStore & { readonly files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    read: (ref) => Promise.resolve(files.get(assertSafeRef(ref)) ?? null),
    write: (ref, bytes) => {
      files.set(assertSafeRef(ref), new Uint8Array(bytes));
      return Promise.resolve();
    },
    delete: (ref) => {
      files.delete(assertSafeRef(ref));
      return Promise.resolve();
    },
  };
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT"
  );
}

/**
 * Files in a local directory, as a {@link FileStore}. Deprecated: use
 * `localFileStorage({ root })` from `@quickben/storage-local`.
 */
export function localFileStore(root: string): FileStore {
  return {
    async read(ref) {
      try {
        return new Uint8Array(await readFile(join(root, assertSafeRef(ref))));
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async write(ref, bytes) {
      const path = join(root, assertSafeRef(ref));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
    async delete(ref) {
      await rm(join(root, assertSafeRef(ref)), { force: true });
    },
  };
}

/** File types the reader accepts, with the extension used for stored files. */
export const ACCEPTED_MIMES: Readonly<Record<string, string>> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
