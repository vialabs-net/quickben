import { ForbiddenError, UnauthorizedError } from "@quickben/core";
import { errorResponse, HttpError, json, normalizeBasePath } from "@quickben/core/http";

import { generateOpenApi } from "./generate";

import type { OpenApiDocument, OpenApiOptions } from "./types";
import type { QuickbenConfig, QuickbenUser } from "@quickben/core";

/** Arguments of the access rule of the served document. */
export interface OpenApiAccessArgs {
  user: QuickbenUser | null;
  req: Request;
}

/** Options of {@link createOpenApiHandler}. */
export interface OpenApiServeOptions extends OpenApiOptions {
  /** Serve `GET <basePath>/openapi.json`. Default `false`. */
  serve?: boolean;
  /**
   * Who may read the document: `true`, `false`, or a function. Default: authenticated users
   * only, like custom endpoints. Pass `true` for a public API.
   */
  access?: boolean | ((args: OpenApiAccessArgs) => boolean | Promise<boolean>);
}

/** A handler that answers `GET <basePath>/openapi.json`, or resolves `null` for other paths. */
export type OpenApiHandler = (req: Request) => Promise<Response | null>;

async function allowed(
  options: OpenApiServeOptions,
  user: QuickbenUser | null,
  req: Request,
): Promise<boolean> {
  const rule = options.access;
  if (typeof rule === "function") return rule({ user, req });
  return rule ?? user !== null;
}

/**
 * Serve the OpenAPI document of a config at `GET <basePath>/openapi.json`. Off unless
 * `serve: true`. The document is built once, on the first request. `@quickben/next` calls it
 * from `createRouteHandlers(config, { openapi: { serve: true } })`.
 */
export function createOpenApiHandler(
  config: QuickbenConfig,
  options: OpenApiServeOptions = {},
): OpenApiHandler {
  const basePath = normalizeBasePath(options.basePath ?? "/api");
  const path = `${basePath}/openapi.json`;
  let doc: OpenApiDocument | undefined;
  return async (req) => {
    if (options.serve !== true) return null;
    const url = new URL(req.url);
    if (url.pathname !== path) return null;
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        throw new HttpError(405, "METHOD_NOT_ALLOWED", `${req.method} is not allowed here`, {
          allow: "GET",
        });
      }
      const user = config.auth ? await config.auth.getUser(req) : null;
      if (!(await allowed(options, user, req))) {
        const message = "Not allowed to read the API document";
        throw user ? new ForbiddenError(message) : new UnauthorizedError(message);
      }
      doc ??= generateOpenApi(config, { ...options, basePath });
      const response = json(doc);
      return req.method === "HEAD" ? new Response(null, response) : response;
    } catch (error) {
      const response = errorResponse(error);
      return req.method === "HEAD" ? new Response(null, response) : response;
    }
  };
}
