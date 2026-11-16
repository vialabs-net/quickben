import { HttpError } from "./errors";

function tooLarge(maxBytes: number): HttpError {
  return new HttpError(
    413,
    "PAYLOAD_TOO_LARGE",
    `The request body is larger than ${String(maxBytes)} bytes`,
  );
}

/** Read the body as bytes, stopping as soon as it passes `maxBytes` (`413 PAYLOAD_TOO_LARGE`). */
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
