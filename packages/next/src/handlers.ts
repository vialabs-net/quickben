import { getQuickben, ValidationError } from "@quickben/core";
import {
  assertSameOrigin,
  errorResponse,
  handleEndpointRequest,
  HttpError,
  json,
  normalizeBasePath,
  readBytes,
} from "@quickben/core/http";

import { fileResponse, readMultipart } from "./files";
import { getMeta } from "./meta";
import { parseFindParams, parseReadParams } from "./query-string";

import type { Quickben, QuickbenConfig, RequestContext } from "@quickben/core";
import type { CsrfOptions } from "@quickben/core/http";

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
  /** Largest JSON body of `POST` and `PATCH`, in bytes. Default `1_048_576` (1 MB). */
  maxBodyBytes?: number;
  /**
   * Largest `multipart/form-data` body of `POST` and `PATCH`, in bytes. Default `10_485_760`
   * (10 MB). Each file field also has its own `maxBytes`.
   */
  maxUploadBytes?: number;
  /**
   * Validate the output of custom endpoints. Default: only when `NODE_ENV` is not
   * `production`. An endpoint's own `validateOutput` wins.
   */
  validateOutput?: boolean;
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

/** {@link RouteHandlers} plus `PUT`, which only custom endpoints answer. */
export interface RouteHandlersWithPut extends RouteHandlers {
  PUT: RouteHandler;
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
  maxUploadBytes: number;
}

function trimSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end -= 1;
  return path.slice(0, end);
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
  if (segments.length === 3) return ["GET"];
  return [];
}

function withoutSystemFields(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => !systemFields.has(key)));
}

async function readBody(call: Call): Promise<Record<string, unknown>> {
  const { req, maxBodyBytes, maxUploadBytes } = call;
  const type = req.headers.get("content-type") ?? "";
  if (/^multipart\/form-data\b/i.test(type)) {
    return withoutSystemFields(await readMultipart(req, maxUploadBytes));
  }
  if (!/^application\/([\w.-]+\+)?json\b/i.test(type)) {
    throw new HttpError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Send a JSON body (application/json) or files (multipart/form-data)",
    );
  }
  const text = new TextDecoder().decode(await readBytes(req, maxBodyBytes));
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ValidationError([{ path: "", message: "Invalid JSON body" }]);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError([{ path: "", message: "Expected a JSON object" }]);
  }
  return withoutSystemFields(body as Record<string, unknown>);
}

async function handleFile({ qb, ctx, url, req, segments }: Call): Promise<Response> {
  const [slug, id, field] = segments as [string, string, string];
  for (const key of url.searchParams.keys()) {
    if (key !== "download") {
      throw new ValidationError([{ path: key, message: `Unknown parameter "${key}"` }]);
    }
  }
  const stored = await qb.readFile(slug, id, field, ctx);
  return fileResponse(stored, {
    download: url.searchParams.has("download"),
    ifNoneMatch: req.headers.get("if-none-match"),
  });
}

async function handleGet(call: Call): Promise<Response> {
  const { qb, ctx, url, segments, maxLimit } = call;
  if (segments.length === 3) return handleFile(call);
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

async function handlePost(call: Call): Promise<Response> {
  const [slug] = call.segments as [string];
  return json(await call.qb.create(slug, await readBody(call), call.ctx), 201);
}

async function handlePatch(call: Call): Promise<Response> {
  const [slug, id] = call.segments as [string, string];
  return json(await call.qb.update(slug, id, await readBody(call), call.ctx));
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
 * | `GET /:collection/:id/:field` | `qb.readFile` (streams the file)  | 200     |
 *
 * Custom endpoints (`defineConfig({ endpoints })`) are served first, with
 * `handleEndpointRequest`. Export `PUT` too when an endpoint uses it.
 *
 * `POST` and `PATCH` take JSON, or `multipart/form-data` with a `_payload` JSON part and one
 * file part per file field. The user comes from `config.auth.getUser(req)` on every request.
 * JSON bodies larger than `maxBodyBytes` (default 1 MB) and multipart bodies larger than
 * `maxUploadBytes` (default 10 MB) get `413 PAYLOAD_TOO_LARGE`. Errors are JSON:
 * `{ error: { code, message, details } }` with the status of the error.
 */
export function createRouteHandlers(
  config: QuickbenConfig,
  options: RouteHandlerOptions = {},
): RouteHandlersWithPut {
  const basePath = normalizeBasePath(options.basePath ?? "/api");
  const maxLimit = options.maxLimit ?? 100;
  const maxBodyBytes = options.maxBodyBytes ?? 1_048_576;
  const maxUploadBytes = options.maxUploadBytes ?? 10_485_760;
  const csrf = options.csrf ?? {};

  const endpointOptions = {
    basePath,
    csrf,
    maxBodyBytes,
    validateOutput: options.validateOutput,
  };

  const handler =
    (method: Method | "PUT"): RouteHandler =>
    async (req) => {
      const custom = await handleEndpointRequest(config, req, endpointOptions);
      if (custom) return custom;
      try {
        const url = new URL(req.url);
        const segments = segmentsOf(url, basePath);
        const allowed = allowedMethods(segments);
        if (allowed.length === 0) throw notFound();
        if (method === "PUT" || !allowed.includes(method)) {
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
          maxUploadBytes,
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
    PUT: handler("PUT"),
  };
}
