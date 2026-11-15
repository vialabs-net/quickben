/**
 * Amazon S3 and S3-compatible stores (R2, MinIO) for Quickben file fields, with the official
 * AWS SDK v3.
 */
import { assertStorageKey } from "@quickben/core";

import type * as S3Sdk from "@aws-sdk/client-s3";
import type { S3Client, S3ClientConfig } from "@aws-sdk/client-s3";
import type { StorageAdapter, StorageObjectInfo } from "@quickben/core";

/** Options of {@link s3Storage}. */
export interface S3StorageOptions {
  /** Bucket name. */
  bucket: string;
  /** Your own client. Default: `new S3Client(clientConfig)`. */
  client?: S3Client;
  /** Config of the default client: region, endpoint, credentials. */
  clientConfig?: S3ClientConfig;
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
  const failure = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } } | null;
  return (
    failure?.name === "NoSuchKey" ||
    failure?.name === "NotFound" ||
    failure?.$metadata?.httpStatusCode === 404
  );
}

async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

type Sdk = typeof S3Sdk;

/**
 * Store files in an S3 bucket. `@aws-sdk/client-s3` is an optional peer dependency;
 * `@aws-sdk/s3-request-presigner` is needed for `signedUrl` only.
 */
export function s3Storage(options: S3StorageOptions): StorageAdapter {
  const prefix = normalizePrefix(options.prefix);
  const Bucket = options.bucket;
  let loaded: Promise<{ sdk: Sdk; client: S3Client }> | undefined;
  const load = () => {
    loaded ??= (async () => {
      const sdk = await import("@aws-sdk/client-s3");
      return { sdk, client: options.client ?? new sdk.S3Client(options.clientConfig ?? {}) };
    })();
    return loaded;
  };
  const keyOf = (key: string) => prefix + assertStorageKey(key);
  const info = async (key: string): Promise<StorageObjectInfo | null> => {
    const Key = keyOf(key);
    const { sdk, client } = await load();
    const head = await orNull(client.send(new sdk.HeadObjectCommand({ Bucket, Key })));
    if (!head) return null;
    return { key, size: head.ContentLength ?? 0, contentType: head.ContentType ?? null };
  };
  const getObject = async (key: string) => {
    const Key = keyOf(key);
    const { sdk, client } = await load();
    const object = await orNull(client.send(new sdk.GetObjectCommand({ Bucket, Key })));
    return object?.Body ? object : null;
  };
  return {
    name: "s3",
    async put(key, bytes, putOptions = {}) {
      const Key = keyOf(key);
      const { sdk, client } = await load();
      await client.send(
        new sdk.PutObjectCommand({
          Bucket,
          Key,
          Body: bytes,
          ContentLength: bytes.byteLength,
          ...(putOptions.contentType ? { ContentType: putOptions.contentType } : {}),
        }),
      );
    },
    async get(key) {
      const object = await getObject(key);
      if (!object?.Body) return null;
      return {
        key,
        size: object.ContentLength ?? 0,
        contentType: object.ContentType ?? null,
        body: object.Body.transformToWebStream() as ReadableStream<Uint8Array>,
      };
    },
    async getBytes(key) {
      const object = await getObject(key);
      return object?.Body ? new Uint8Array(await object.Body.transformToByteArray()) : null;
    },
    head: info,
    async delete(key) {
      const Key = keyOf(key);
      const { sdk, client } = await load();
      await client.send(new sdk.DeleteObjectCommand({ Bucket, Key }));
    },
    async signedUrl(key, urlOptions = {}) {
      const Key = keyOf(key);
      const { sdk, client } = await load();
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      const command = new sdk.GetObjectCommand({
        Bucket,
        Key,
        ...(urlOptions.downloadName
          ? {
              ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(urlOptions.downloadName)}`,
            }
          : {}),
      });
      return getSignedUrl(client, command, { expiresIn: urlOptions.expiresIn ?? 300 });
    },
  };
}
