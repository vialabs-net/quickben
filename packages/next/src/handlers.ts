import { getQuickben, ValidationError } from "@quickben/core";

import { assertSameOrigin } from "./csrf";
import { errorResponse, HttpError, json } from "./errors";
import { getMeta } from "./meta";
import { parseFindParams, parseReadParams } from "./query-string";

import type { CsrfOptions } from "./csrf";
import type { Quickben, QuickbenConfig, RequestContext } from "@quickben/core";

/** Options of {@link createRouteHandlers}. */
export interface RouteHandlerOptions {
  /** URL path of the catch-all route. Default `/api` (for `app/api/[...quickben]/route.ts`). */
  basePath?: string;
  /** Largest `limit` of `GET /:collection`. Default `100`. */
  maxLimit?: number;
  /**
   * Same-origin check on `POST`, `PATCH` and `DELETE`. On by default; pass `false` to turn it
   * off (only for token auth that never uses cookies).
   */
  csrf?: CsrfOptions | false;
  /** Largest request body of `POST` and `PATCH`, in bytes. Default `1_048_576` (1 MB). */
  maxBodyBytes?: number;
}

/** A Next.js route handler. */
export type RouteHandler = (req: Request) => Promise<Response>;

/** The handlers to export from `app/api/[...quickben]/route.ts`. */
export interface RouteHandlers {
  GET: RouteHandler;
  POST: RouteHandler;
  PATCH: RouteHandler;
  DELETE: RouteHandler;
}

type Method = keyof RouteHandlers;

/** Fields the server sets. They are removed from request bodies. */
const systemFields: ReadonlySet<string> = new Set(["id", "createdAt", "updatedAt"]);

interface Call {
  qb: Quickben;
  ctx: RequestContext;
  url: URL;
  req: Request;
  segments: string[];
  maxLimit: number;
  maxBodyBytes: number;
}

function trimSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end -= 1;
  return path.slice(0, end);
}

function normalizeBasePath(basePath: string): string {
  const trimmed = trimSlashes(basePath);
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function notFound(): HttpError {
  return new HttpError(404, "NOT_FOUND", "No such route");
}

function segmentsOf(url: URL, basePath: string): string[] {
  const path = trimSlashes(url.pathname);
  if (path !== basePath && !path.startsWith(`${basePath}/`)) throw notFound();
  try {
    return path
      .slice(basePath.length)
      .split("/")
      .filter((part) => part !== "")
      .map(decodeURIComponent);
  } catch {
    throw notFound();
  }
}

/** Methods each route shape accepts, for `405` responses. */
function allowedMethods(segments: readonly string[]): Method[] {
  if (segments.length === 1 && segments[0] === "_meta") return ["GET"];
  if (segments.length === 1) return ["GET", "POST"];
  if (segments.length === 2) return ["GET", "PATCH", "DELETE"];
  return [];
}

function tooLarge(maxBodyBytes: number): HttpError {
  return new HttpError(
    413,
    "PAYLOAD_TOO_LARGE",
    `The request body is larger than ${String(maxBodyBytes)} bytes`,
  );
}

/** Read the body as text, stopping as soon as it passes `maxBodyBytes`. */
async function readText(req: Request, maxBodyBytes: number): Promise<string> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBodyBytes) throw tooLarge(maxBodyBytes);
  if (!req.body) return "";
  const reader = (req.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBodyBytes) {
      await reader.cancel();
      throw tooLarge(maxBodyBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readBody(req: Request, maxBodyBytes: number): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (!/^application\/([\w.-]+\+)?json\b/i.test(type)) {
    throw new HttpError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Send a JSON body with Content-Type: application/json",
    );
  }
  const text = await readText(req, maxBodyBytes);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ValidationError([{ path: "", message: "Invalid JSON body" }]);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError([{ path: "", message: "Expected a JSON object" }]);
  }
  return Object.fromEntries(Object.entries(body).filter(([key]) => !systemFields.has(key)));
}

async function handleGet({ qb, ctx, url, segments, maxLimit }: Call): Promise<Response> {
  const [slug, id] = segments as [string, string | undefined];
  if (id === undefined && slug === "_meta") {
    return json(await getMeta(qb, ctx));
  }
  if (id === undefined) {
    const query = parseFindParams(url.searchParams, { maxLimit });
    return json(await qb.find(slug, query as never, ctx));
  }
  const options = parseReadParams(url.searchParams);
  return json(await qb.findById(slug, id, options as never, ctx));
}

async function handlePost({ qb, ctx, req, segments, maxBodyBytes }: Call): Promise<Response> {
  const [slug] = segments as [string];
  return json(await qb.create(slug, await readBody(req, maxBodyBytes), ctx), 201);
}

async function handlePatch({ qb, ctx, req, segments, maxBodyBytes }: Call): Promise<Response> {
  const [slug, id] = segments as [string, string];
  return json(await qb.update(slug, id, await readBody(req, maxBodyBytes), ctx));
}

async function handleDelete({ qb, ctx, segments }: Call): Promise<Response> {
  const [slug, id] = segments as [string, string];
  return json(await qb.delete(slug, id, ctx));
}

const dispatch: Record<Method, (call: Call) => Promise<Response>> = {
  GET: handleGet,
  POST: handlePost,
  PATCH: handlePatch,
  DELETE: handleDelete,
};

/**
 * Create the REST handlers for `app/api/[...quickben]/route.ts`:
 *
 * ```ts
 * import config from "@/quickben.config";
 * export const { GET, POST, PATCH, DELETE } = createRouteHandlers(config);
 * ```
 *
 * | Route                        | Local API call                     | Success |
 * | ---------------------------- | ---------------------------------- | ------- |
 * | `GET /_meta`                 | collections and modules (readable) | 200     |
 * | `GET /:collection`           | `qb.find`                          | 200     |
 * | `GET /:collection/:id`       | `qb.findById`                      | 200     |
 * | `POST /:collection`          | `qb.create`                        | 201     |
 * | `PATCH /:collection/:id`     | `qb.update`                        | 200     |
 * | `DELETE /:collection/:id`    | `qb.delete`                        | 200     |
 *
 * The user comes from `config.auth.getUser(req)` on every request. Bodies larger than
 * `maxBodyBytes` (default 1 MB) get `413 PAYLOAD_TOO_LARGE`. Errors are JSON:
 * `{ error: { code, message, details } }` with the status of the error.
 */
export function createRouteHandlers(
  config: QuickbenConfig,
  options: RouteHandlerOptions = {},
): RouteHandlers {
  const basePath = normalizeBasePath(options.basePath ?? "/api");
  const maxLimit = options.maxLimit ?? 100;
  const maxBodyBytes = options.maxBodyBytes ?? 1_048_576;
  const csrf = options.csrf ?? {};

  const handler =
    (method: Method): RouteHandler =>
    async (req) => {
      try {
        const url = new URL(req.url);
        const segments = segmentsOf(url, basePath);
        const allowed = allowedMethods(segments);
        if (allowed.length === 0) throw notFound();
        if (!allowed.includes(method)) {
          throw new HttpError(405, "METHOD_NOT_ALLOWED", `${method} is not allowed here`, {
            allow: allowed.join(", "),
          });
        }
        if (method !== "GET" && csrf !== false) assertSameOrigin(req, csrf);
        const qb = await getQuickben(config);
        const user = config.auth ? await config.auth.getUser(req) : null;
        return await dispatch[method]({
          qb,
          ctx: { user, req },
          url,
          req,
          segments,
          maxLimit,
          maxBodyBytes,
        });
      } catch (error) {
        return errorResponse(error);
      }
    };

  return {
    GET: handler("GET"),
    POST: handler("POST"),
    PATCH: handler("PATCH"),
    DELETE: handler("DELETE"),
  };
}
