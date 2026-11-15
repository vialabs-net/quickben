/**
 * Google Cloud Storage for Quickben file fields, with the official `@google-cloud/storage` SDK.
 */
import { Readable } from "node:stream";

import { assertStorageKey } from "@quickben/core";

import type { Bucket, File, Storage } from "@google-cloud/storage";
import type { StorageAdapter, StorageObjectInfo } from "@quickben/core";

/** Options of {@link gcsStorage}. */
export interface GcsStorageOptions {
  /** The bucket: a name, or a `Bucket` from your own `Storage` client. */
  bucket: string | Bucket;
  /**
   * Client used when `bucket` is a name. Default: `new Storage()` from `@google-cloud/storage`,
   * with Application Default Credentials.
   */
  storage?: Storage;
  /** Folder for every key, such as `uploads/`. Default: none. */
  prefix?: string;
}

/** A key prefix: empty, or a valid key followed by `/`. */
export function normalizePrefix(prefix: string | undefined): string {
  if (!prefix) return "";
  const trimmed = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  return `${assertStorageKey(trimmed)}/`;
}

function isNotFound(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 404;
}

async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/**
 * Store files in a Google Cloud Storage bucket. `@google-cloud/storage` is an optional peer
 * dependency: install it, or pass your own `Bucket`. Signed URLs are V4 read URLs.
 */
export function gcsStorage(options: GcsStorageOptions): StorageAdapter {
  const prefix = normalizePrefix(options.prefix);
  let bucket: Promise<Bucket> | undefined;
  const getBucket = () => {
    if (typeof options.bucket !== "string") return Promise.resolve(options.bucket);
    const name = options.bucket;
    bucket ??= (async () => {
      const client = options.storage ?? new (await import("@google-cloud/storage")).Storage();
      return client.bucket(name);
    })();
    return bucket;
  };
  const fileOf = async (key: string): Promise<File> =>
    (await getBucket()).file(prefix + assertStorageKey(key));
  const info = async (key: string): Promise<StorageObjectInfo | null> => {
    const file = await fileOf(key);
    const result = await orNull(file.getMetadata());
    if (!result) return null;
    const [metadata] = result;
    return { key, size: Number(metadata.size ?? 0), contentType: metadata.contentType ?? null };
  };
  return {
    name: "gcs",
    async put(key, bytes, putOptions = {}) {
      const file = await fileOf(key);
      await file.save(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
        resumable: false,
        ...(putOptions.contentType ? { contentType: putOptions.contentType } : {}),
      });
    },
    async get(key) {
      const head = await info(key);
      if (!head) return null;
      const file = await fileOf(key);
      const body = Readable.toWeb(file.createReadStream()) as unknown as ReadableStream<Uint8Array>;
      return { ...head, body };
    },
    async getBytes(key) {
      const file = await fileOf(key);
      const result = await orNull(file.download());
      return result ? new Uint8Array(result[0]) : null;
    },
    head: info,
    async delete(key) {
      const file = await fileOf(key);
      await file.delete({ ignoreNotFound: true });
    },
    async signedUrl(key, urlOptions = {}) {
      const file = await fileOf(key);
      const [url] = await file.getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + (urlOptions.expiresIn ?? 300) * 1000,
        ...(urlOptions.downloadName
          ? {
              responseDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(urlOptions.downloadName)}`,
            }
          : {}),
      });
      return url;
    },
  };
}
