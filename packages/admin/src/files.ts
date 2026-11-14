import type { FieldMeta } from "@quickben/next";

/** A stored file reference as the admin reads it. */
export interface StoredFileValue {
  key: string;
  name: string;
  mime: string;
  size: number;
}

/** Whether a field value is a stored file reference. */
export function isStoredFile(value: unknown): value is StoredFileValue {
  const ref = value as Partial<StoredFileValue> | null;
  return (
    typeof ref === "object" &&
    ref !== null &&
    typeof ref.key === "string" &&
    typeof ref.name === "string" &&
    typeof ref.mime === "string" &&
    typeof ref.size === "number"
  );
}

/** Default URL path of the REST route handlers. */
export const DEFAULT_API_BASE_PATH = "/api";

/**
 * Download URLs of the stored files of a document, by field name, for the `@quickben/next`
 * route `GET <apiBasePath>/:collection/:id/:field`. Empty on create.
 */
export function fileUrls(
  apiBasePath: string,
  slug: string,
  doc: Record<string, unknown> | null,
  fields: readonly FieldMeta[],
): Record<string, string> {
  if (!doc) return {};
  let base = apiBasePath;
  while (base.endsWith("/")) base = base.slice(0, -1);
  const id = encodeURIComponent(String(doc.id));
  const urls: Record<string, string> = {};
  for (const field of fields) {
    if (field.type !== "file" || !isStoredFile(doc[field.name])) continue;
    urls[field.name] =
      `${base}/${encodeURIComponent(slug)}/${id}/${encodeURIComponent(field.name)}`;
  }
  return urls;
}
