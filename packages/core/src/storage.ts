/**
 * File storage contract. Core stores files through a {@link StorageAdapter}; adapters for a
 * local directory, Google Cloud Storage and S3 live in their own packages.
 */
import { ValidationError } from "./errors";

/** What `head` returns: an object without its bytes. */
export interface StorageObjectInfo {
  key: string;
  /** Size in bytes. */
  size: number;
  /** The content type given to `put`, or `null` when the store has none. */
  contentType: string | null;
}

/** What `get` returns: the object and a stream of its bytes. */
export interface StorageObject extends StorageObjectInfo {
  body: ReadableStream<Uint8Array>;
}

/** Options of {@link StorageAdapter.put}. */
export interface StoragePutOptions {
  contentType?: string;
}

/** Options of {@link StorageAdapter.signedUrl}. */
export interface SignedUrlOptions {
  /** Seconds the URL stays valid. Default `300`. */
  expiresIn?: number;
  /** Ask the store to send `Content-Disposition: attachment` with this file name. */
  downloadName?: string;
}

/**
 * Where files are kept. Keys are relative paths such as `brands/logo/0199….png`: no leading
 * `/`, no `\`, no `.` or `..` segments. Adapters check keys with {@link assertStorageKey}.
 */
export interface StorageAdapter {
  /** Adapter name for messages, e.g. `local`. */
  readonly name: string;
  /** Write an object. Replaces an object with the same key. */
  put(key: string, bytes: Uint8Array, options?: StoragePutOptions): Promise<void>;
  /** The object with a stream of its bytes, or `null` when it does not exist. */
  get(key: string): Promise<StorageObject | null>;
  /** The object's bytes, or `null` when it does not exist. */
  getBytes(key: string): Promise<Uint8Array | null>;
  /** Size and type of an object, or `null` when it does not exist. */
  head(key: string): Promise<StorageObjectInfo | null>;
  /** Remove an object. A missing object is not an error. */
  delete(key: string): Promise<void>;
  /** A time-limited URL that reads the object directly from the store. Optional. */
  signedUrl?(key: string, options?: SignedUrlOptions): Promise<string>;
}

const MAX_KEY_LENGTH = 1024;
/** Whether `text` has a control character (NUL to unit separator, or DEL) not in `allowed`. */
function hasControl(text: string, allowed: readonly number[] = []): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if ((code < 0x20 || code === 0x7f) && !allowed.includes(code)) return true;
  }
  return false;
}

/**
 * Check a storage key and return it. Throws `ValidationError` for an empty key, a key longer
 * than 1024 characters, an absolute path (`/x`, `C:x`), `\`, control characters, and empty,
 * `.` or `..` segments.
 */
export function assertStorageKey(key: string): string {
  const reason = keyProblem(key);
  if (reason)
    throw new ValidationError([{ path: "key", message: `Invalid storage key: ${reason}` }]);
  return key;
}

function keyProblem(key: unknown): string | null {
  if (typeof key !== "string" || key === "") return "empty";
  if (key.length > MAX_KEY_LENGTH) return "too long";
  if (key.startsWith("/") || /^[A-Za-z]:/.test(key)) return "absolute path";
  if (key.includes("\\")) return "backslash";
  if (hasControl(key)) return "control character";
  for (const segment of key.split("/")) {
    if (segment === "" || segment === "." || segment === "..") return "empty, . or .. segment";
  }
  return null;
}

/** A stream of `bytes`. */
export function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** Read a whole stream into one array. */
export async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** In-memory storage with its objects exposed. */
export interface MemoryStorage extends StorageAdapter {
  /** Stored objects by key. */
  readonly objects: Map<string, { bytes: Uint8Array; contentType: string | null }>;
}

/** Run `fn` and return its result as a promise; a throw becomes a rejection. */
function later<T>(fn: () => T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/** Objects in memory. Lost on restart and not shared between processes: for tests and demos. */
export function memoryStorage(): MemoryStorage {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string | null }>();
  const find = (key: string) => objects.get(assertStorageKey(key));
  const info = (key: string) => {
    const object = find(key);
    return object ? { key, size: object.bytes.byteLength, contentType: object.contentType } : null;
  };
  return {
    name: "memory",
    objects,
    put: (key, bytes, options = {}) =>
      later(() => {
        objects.set(assertStorageKey(key), {
          bytes: new Uint8Array(bytes),
          contentType: options.contentType ?? null,
        });
      }),
    get: (key) =>
      later(() => {
        const head = info(key);
        const object = objects.get(key);
        return head && object
          ? { ...head, body: bytesToStream(new Uint8Array(object.bytes)) }
          : null;
      }),
    getBytes: (key) =>
      later(() => {
        const object = find(key);
        return object ? new Uint8Array(object.bytes) : null;
      }),
    head: (key) => later(() => info(key)),
    delete: (key) =>
      later(() => {
        objects.delete(assertStorageKey(key));
      }),
  };
}

/* File types by their first bytes */

const PDF = "application/pdf";

const startsWith = (bytes: Uint8Array, prefix: readonly number[], offset = 0) =>
  bytes.length >= offset + prefix.length && prefix.every((byte, i) => bytes[offset + i] === byte);

const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

const signatures: readonly { mime: string; bytes: readonly number[]; offset?: number }[] = [
  { mime: PDF, bytes: ascii("%PDF-") },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/gif", bytes: ascii("GIF8") },
  { mime: "font/woff2", bytes: ascii("wOF2") },
  { mime: "font/woff", bytes: ascii("wOFF") },
];

/**
 * The type of a file from its first bytes: PDF, PNG, JPEG, GIF, WebP, AVIF, woff and woff2.
 * `null` for anything else. The declared type is never trusted.
 */
export function sniffMime(bytes: Uint8Array): string | null {
  for (const signature of signatures) {
    if (startsWith(bytes, signature.bytes, signature.offset)) return signature.mime;
  }
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  if (startsWith(bytes, ascii("ftypavif"), 4) || startsWith(bytes, ascii("ftypavis"), 4)) {
    return "image/avif";
  }
  return null;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });
// Tab, line feed, form feed and carriage return.
const textControls = [0x09, 0x0a, 0x0c, 0x0d];

/**
 * The type of a stored file: {@link sniffMime}, else `text/plain` for UTF-8 text without
 * control characters, else `application/octet-stream`.
 */
export function detectMime(bytes: Uint8Array): string {
  const sniffed = sniffMime(bytes);
  if (sniffed) return sniffed;
  try {
    const text = utf8.decode(bytes);
    if (text !== "" && !hasControl(text, textControls)) return "text/plain";
  } catch {
    // Not UTF-8.
  }
  return "application/octet-stream";
}

/** Whether `mime` matches one of `accept`: exact types or `type/*`. */
export function mimeMatches(mime: string, accept: readonly string[]): boolean {
  return accept.some((pattern) =>
    pattern.endsWith("/*") ? mime.startsWith(pattern.slice(0, -1)) : pattern === mime,
  );
}

/** Hex SHA-256 of `bytes`. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** File extensions of stored keys, by type. */
export const fileExtensions: Readonly<Record<string, string>> = {
  [PDF]: ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "font/woff2": ".woff2",
  "font/woff": ".woff",
  "text/plain": ".txt",
};
