/** Uploads, references and cleanup of `file` fields. */
import { ConfigError, ValidationError } from "./errors";
import { uuidv7 } from "./id";
import { detectMime, fileExtensions, mimeMatches, sha256Hex } from "./storage";
import { fileRefSchema, isFileUpload } from "./validation";

import type { DocumentData } from "./adapter";
import type { OperationScope } from "./documents";
import type { ValidationIssue } from "./errors";
import type { FileField, FileRef, FileUpload, FieldValidator } from "./fields";
import type { StorageAdapter } from "./storage";
import type { SanitizedCollection, SanitizedField } from "./types";

type SanitizedFileField = Extract<SanitizedField, { type: "file" }>;

/** Whether `value` is a stored file reference. */
export function isFileRef(value: unknown): value is FileRef {
  return fileRefSchema.safeParse(value).success;
}

function fileFields(collection: SanitizedCollection): SanitizedFileField[] {
  return collection.fieldList.filter((field): field is SanitizedFileField => field.type === "file");
}

/** The storage of a file field: its own, else the config's. Throws `ConfigError` without one. */
export function storageOf(
  scope: Pick<OperationScope, "storage">,
  collection: SanitizedCollection,
  field: FileField,
  name: string,
): StorageAdapter {
  const storage = field.storage ?? scope.storage;
  if (!storage) {
    throw new ConfigError(
      `Field "${collection.slug}.${name}" needs a storage adapter: set storage in defineConfig or on the field`,
    );
  }
  return storage;
}

const MB = 1024 * 1024;

function sizeText(bytes: number): string {
  return bytes >= MB
    ? `${String(Math.floor(bytes / MB))} MB`
    : `${String(Math.ceil(bytes / 1024))} KB`;
}

/** Whether a code point is a lone UTF-16 surrogate. */
const isLoneSurrogate = (char: string) => char.length === 1 && /[\uD800-\uDFFF]/.test(char);

/**
 * A file name without folders, control characters and lone surrogates, at most 255 code
 * points, so it never splits a character.
 */
export function cleanFileName(name: string): string {
  const base = name.split(/[/\\]/).at(-1) ?? "";
  const chars = Array.from(base).filter(
    (char) => char >= " " && char !== "\u007f" && !isLoneSurrogate(char),
  );
  const clean = chars.join("").trim();
  const short = Array.from(clean).slice(0, 255).join("").trim();
  return short === "" ? "file" : short;
}

async function uploadBytes(upload: FileUpload): Promise<{ bytes: Uint8Array; name: string }> {
  if (upload instanceof Blob) {
    const name = "name" in upload && typeof upload.name === "string" ? upload.name : "";
    return { bytes: new Uint8Array(await upload.arrayBuffer()), name };
  }
  return { bytes: upload.bytes, name: upload.name };
}

function declaredSize(upload: FileUpload): number {
  return upload instanceof Blob ? upload.size : upload.bytes.byteLength;
}

interface PreparedUpload {
  field: SanitizedFileField;
  storage: StorageAdapter;
  bytes: Uint8Array;
  ref: FileRef;
}

async function checkUpload(
  scope: OperationScope,
  collection: SanitizedCollection,
  field: SanitizedFileField,
  upload: FileUpload,
  context: { operation: "create" | "update"; data: DocumentData; original: DocumentData | null },
): Promise<PreparedUpload | string> {
  if (declaredSize(upload) > field.maxBytes) {
    return `The file is larger than ${sizeText(field.maxBytes)}`;
  }
  const { bytes, name } = await uploadBytes(upload);
  if (bytes.byteLength === 0) return "The file is empty";
  if (bytes.byteLength > field.maxBytes)
    return `The file is larger than ${sizeText(field.maxBytes)}`;
  const mime = detectMime(bytes);
  if (field.accept && !mimeMatches(mime, field.accept)) {
    return `Files of type ${mime} are not accepted. Accepted: ${field.accept.join(", ")}`;
  }
  const storage = storageOf(scope, collection, field, field.name);
  const ref: FileRef = {
    key: `${collection.slug}/${field.name}/${uuidv7()}${fileExtensions[mime] ?? ""}`,
    name: cleanFileName(name),
    mime,
    size: bytes.byteLength,
    sha256: await sha256Hex(bytes),
  };
  if (field.validate) {
    const outcome = await (field.validate as FieldValidator<FileRef>)(ref, {
      ...context,
      user: scope.ctx.user,
    });
    if (outcome !== true) return outcome;
  }
  return { field, storage, bytes, ref };
}

const sameRef = (a: unknown, b: unknown) => isFileRef(a) && isFileRef(b) && a.key === b.key;

/**
 * Store the uploads in validated data and replace them with references. Every upload is
 * checked before any is stored. The stored reference sent back is left out of the write, so
 * it keeps its stored metadata and never overwrites a newer file. Any other reference needs
 * `overrideAccess`. Stored objects are removed when the outermost transaction rolls back.
 */
export async function storeUploads(
  scope: OperationScope,
  collection: SanitizedCollection,
  operation: "create" | "update",
  data: DocumentData,
  original: DocumentData | null,
): Promise<DocumentData> {
  const fields = fileFields(collection);
  if (fields.length === 0) return data;
  const issues: ValidationIssue[] = [];
  const prepared: PreparedUpload[] = [];
  const kept: string[] = [];
  for (const field of fields) {
    const value = data[field.name];
    if (value === undefined || value === null) continue;
    if (isFileUpload(value)) {
      const result = await checkUpload(scope, collection, field, value, {
        operation,
        data,
        original,
      });
      if (typeof result === "string") issues.push({ path: field.name, message: result });
      else prepared.push(result);
    } else if (sameRef(value, original?.[field.name])) {
      kept.push(field.name);
    } else if (scope.ctx.overrideAccess !== true) {
      issues.push({
        path: field.name,
        message: "Upload a file. Only the stored file can be kept.",
      });
    }
  }
  if (issues.length > 0) throw new ValidationError(issues);
  const result = Object.fromEntries(Object.entries(data).filter(([name]) => !kept.includes(name)));
  for (const upload of prepared) {
    await upload.storage.put(upload.ref.key, upload.bytes, { contentType: upload.ref.mime });
    scope.commit?.rollback.push(() => upload.storage.delete(upload.ref.key));
    result[upload.field.name] = upload.ref;
  }
  return result;
}

/**
 * After the commit, remove files that a write replaced or removed: on update the old file when
 * the reference changed, on delete every file of the document.
 */
export function queueFileCleanup(
  scope: OperationScope,
  collection: SanitizedCollection,
  doc: DocumentData | null,
  original: DocumentData,
): void {
  const queue = scope.commit;
  if (!queue) return;
  for (const field of fileFields(collection)) {
    const old = original[field.name];
    if (!isFileRef(old) || sameRef(old, doc?.[field.name])) continue;
    const storage = storageOf(scope, collection, field, field.name);
    queue.tasks.push(() => storage.delete(old.key));
  }
}
