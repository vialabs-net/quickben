/** Multipart uploads and file downloads of the route handlers. */
import { ValidationError } from "@quickben/core";

import { HttpError } from "./errors";

import type { StoredFile } from "@quickben/core";

/** Types a browser may show inline. Everything else is sent as an attachment. */
const inlineTypes: ReadonlySet<string> = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "text/plain",
]);

/** Name of the multipart part with the JSON fields. */
export const PAYLOAD_PART = "_payload";

function tooLarge(maxBytes: number): HttpError {
  return new HttpError(
    413,
    "PAYLOAD_TOO_LARGE",
    `The request body is larger than ${String(maxBytes)} bytes`,
  );
}

/** Read the body as bytes, stopping as soon as it passes `maxBytes`. */
export async function readBytes(req: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(maxBytes);
  if (!req.body) return new Uint8Array();
  const reader = (req.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooLarge(maxBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function invalid(path: string, message: string): ValidationError {
  return new ValidationError([{ path, message }]);
}

function parsePayload(value: ReturnType<FormData["get"]>): Record<string, unknown> {
  if (value === null) return {};
  if (typeof value !== "string") throw invalid(PAYLOAD_PART, "Expected JSON text");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw invalid(PAYLOAD_PART, "Invalid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw invalid(PAYLOAD_PART, "Expected a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Read a `multipart/form-data` body: the `_payload` part is a JSON object with the other
 * fields, and every other part is a file named after its field. At most `maxBytes`.
 */
export async function readMultipart(
  req: Request,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const bytes = await readBytes(req, maxBytes);
  let form: FormData;
  try {
    const body = new Response(bytes, {
      headers: { "content-type": req.headers.get("content-type") ?? "" },
    });
    // The body is already limited to `maxBytes`, so the platform parser is enough.
    // eslint-disable-next-line @typescript-eslint/no-deprecated, sonarjs/deprecation -- see above
    form = await body.formData();
  } catch {
    throw invalid("", "Invalid multipart body");
  }
  const data = parsePayload(form.get(PAYLOAD_PART));
  for (const [name, value] of form.entries()) {
    if (name === PAYLOAD_PART) continue;
    if (typeof value === "string") throw invalid(name, `Send "${name}" inside ${PAYLOAD_PART}`);
    if (form.getAll(name).length > 1) throw invalid(name, "Send one file per field");
    data[name] = value;
  }
  return data;
}

/** `Content-Disposition` with an ASCII fallback name and the UTF-8 name (RFC 6266). */
export function contentDisposition(type: "inline" | "attachment", name: string): string {
  const ascii = Array.from(name, (char) =>
    char >= " " && char <= "~" && char !== '"' && char !== "\\" ? char : "_",
  ).join("");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * A response that streams a stored file. Images, PDFs and plain text are `inline` unless
 * `download` is set. Other types are always attachments. The body is never sniffed by the
 * browser, and non-PDF files are sandboxed.
 */
export function fileResponse(
  stored: StoredFile,
  options: { download?: boolean; ifNoneMatch?: string | null } = {},
): Response {
  const { file } = stored;
  const etag = `"${file.sha256}"`;
  const headers: Record<string, string> = {
    "cache-control": "private, no-cache",
    etag,
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin",
  };
  if (options.ifNoneMatch === etag) {
    void stored.body.cancel();
    return new Response(null, { status: 304, headers });
  }
  const inline = !options.download && inlineTypes.has(file.mime);
  headers["content-type"] = file.mime === "text/plain" ? "text/plain; charset=utf-8" : file.mime;
  headers["content-length"] = String(stored.size);
  headers["content-disposition"] = contentDisposition(inline ? "inline" : "attachment", file.name);
  // The browser PDF viewer does not run in a sandbox.
  headers["content-security-policy"] =
    file.mime === "application/pdf"
      ? "default-src 'none'; object-src 'self'"
      : "default-src 'none'; sandbox";
  return new Response(stored.body, { status: 200, headers });
}
