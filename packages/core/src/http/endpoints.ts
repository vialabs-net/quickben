import { ForbiddenError, UnauthorizedError, ValidationError } from "../errors";
import { getQuickben } from "../local-api";

import { readBytes } from "./body";
import { assertSameOrigin } from "./csrf";
import { errorResponse, HttpError, json } from "./errors";

import type { AnyEndpoint, EndpointReply } from "../endpoints";
import type { ValidationIssue } from "../errors";
import type { Quickben, QuickbenConfig, RequestContext } from "../types";
import type { CsrfOptions } from "./csrf";
import type { z } from "zod";

/** Options of {@link handleEndpointRequest}. */
export interface EndpointRequestOptions {
  /** URL path the API is mounted at. Default `/api`. */
  basePath?: string;
  /**
   * Same-origin check on unsafe methods of cookie-authenticated requests. Requests with an
   * `Authorization: Bearer` header skip it. Pass `false` to turn it off.
   */
  csrf?: CsrfOptions | false;
  /** Largest JSON body in bytes. Default `1_048_576` (1 MB). An endpoint's own limit wins. */
  maxBodyBytes?: number;
  /** Validate outputs. Default: only when `NODE_ENV` is not `production`. */
  validateOutput?: boolean;
}

interface Match {
  endpoint: AnyEndpoint;
  params: Record<string, string>;
}

const jsonType = /^application\/([\w.-]+\+)?json\b/i;

function trimSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end -= 1;
  return path.slice(0, end);
}

/** `/api/` → `/api`, `api` → `/api`. */
export function normalizeBasePath(basePath: string): string {
  const trimmed = trimSlashes(basePath);
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Path segments below `basePath`, decoded. `null` outside it or when undecodable. */
function requestSegments(url: URL, basePath: string): string[] | null {
  const path = trimSlashes(url.pathname);
  if (path !== basePath && !path.startsWith(`${basePath}/`)) return null;
  try {
    return path
      .slice(basePath.length)
      .split("/")
      .filter((part) => part !== "")
      .map(decodeURIComponent);
  } catch {
    return null;
  }
}

function matchPath(endpoint: AnyEndpoint, segments: readonly string[]): Match | null {
  if (endpoint.segments.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (const [index, pattern] of endpoint.segments.entries()) {
    const value = segments[index] ?? "";
    if (pattern.startsWith(":")) params[pattern.slice(1)] = value;
    else if (pattern !== value) return null;
  }
  return { endpoint, params };
}

/** Static segments win over parameters, from left to right. */
function moreSpecific(a: AnyEndpoint, b: AnyEndpoint): number {
  for (const [index, segment] of a.segments.entries()) {
    const aParam = segment.startsWith(":");
    const bParam = b.segments[index]?.startsWith(":") ?? false;
    if (aParam !== bParam) return aParam ? 1 : -1;
  }
  return 0;
}

function findMatches(endpoints: readonly AnyEndpoint[], segments: readonly string[]): Match[] {
  return endpoints
    .map((endpoint) => matchPath(endpoint, segments))
    .filter((match): match is Match => match !== null)
    .sort((a, b) => moreSpecific(a.endpoint, b.endpoint));
}

function isBearer(req: Request): boolean {
  return /^bearer\s+\S/i.test(req.headers.get("authorization") ?? "");
}

function issuesOf(part: string, error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: [part, ...issue.path.map(String)].join("."),
    message: issue.message,
  }));
}

function queryObject(url: URL): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    query[key] = values.length === 1 ? (values[0] ?? "") : values;
  }
  return query;
}

async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const bytes = await readBytes(req, maxBytes);
  if (bytes.byteLength === 0) return undefined;
  const type = req.headers.get("content-type") ?? "";
  if (!jsonType.test(type)) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Send a JSON body (application/json)");
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ValidationError([{ path: "body", message: "Invalid JSON body" }]);
  }
}

interface Parsed {
  params: unknown;
  query: unknown;
  body: unknown;
}

async function parseInput(
  { endpoint, params }: Match,
  req: Request,
  url: URL,
  maxBodyBytes: number,
): Promise<Parsed> {
  const schemas = endpoint.input ?? {};
  const raw: Parsed = {
    params,
    query: queryObject(url),
    body: schemas.body ? await readJson(req, endpoint.maxBodyBytes ?? maxBodyBytes) : undefined,
  };
  const issues: ValidationIssue[] = [];
  const parsed: Parsed = { ...raw };
  for (const part of ["params", "query", "body"] as const) {
    const schema = schemas[part];
    if (!schema) continue;
    const result = await schema.safeParseAsync(raw[part]);
    if (result.success) parsed[part] = result.data;
    else issues.push(...issuesOf(part, result.error));
  }
  if (issues.length > 0) throw new ValidationError(issues);
  return parsed;
}

async function checkEndpointAccess(
  endpoint: AnyEndpoint,
  qb: Quickben,
  ctx: RequestContext & { req: Request },
): Promise<void> {
  const rule = endpoint.access;
  const allowed =
    typeof rule === "function"
      ? await rule({ user: ctx.user, req: ctx.req, ctx, qb, endpoint })
      : (rule ?? ctx.user !== null);
  if (allowed) return;
  const message = `Not allowed to call ${endpoint.method} ${endpoint.fullPath}`;
  throw ctx.user ? new ForbiddenError(message) : new UnauthorizedError(message);
}

function isReply(value: unknown): value is EndpointReply {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return (
    typeof (value as { status?: unknown }).status === "number" &&
    keys.includes("body") &&
    keys.every((key) => key === "status" || key === "body" || key === "headers")
  );
}

function outputSchema(endpoint: AnyEndpoint, status: number): z.ZodType | undefined {
  const { output } = endpoint;
  if (output === undefined) return undefined;
  if ("_zod" in output) return output;
  const schema = (output as Readonly<Record<number, z.ZodType>>)[status];
  if (!schema) {
    throw new OutputError(endpoint, status, [
      { path: "", message: `No output schema for status ${String(status)}` },
    ]);
  }
  return schema;
}

/** The handler returned a result that does not match the output schema. */
class OutputError extends Error {
  constructor(
    readonly endpoint: AnyEndpoint,
    readonly status: number,
    readonly issues: readonly ValidationIssue[],
  ) {
    super(
      `[quickben] Endpoint ${endpoint.method} ${endpoint.fullPath} returned status ${String(status)} with output that does not match its schema`,
    );
    this.name = "OutputError";
  }
}

async function validateBody(endpoint: AnyEndpoint, status: number, body: unknown) {
  const schema = outputSchema(endpoint, status);
  if (!schema) return body;
  const result = await schema.safeParseAsync(body);
  if (!result.success) {
    throw new OutputError(
      endpoint,
      status,
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

function shouldValidateOutput(endpoint: AnyEndpoint, option: boolean | undefined): boolean {
  if (endpoint.validateOutput !== undefined) return endpoint.validateOutput;
  if (option !== undefined) return option;
  const env = typeof process === "undefined" ? undefined : process.env.NODE_ENV;
  return env !== "production";
}

async function toResponse(
  endpoint: AnyEndpoint,
  result: unknown,
  validate: boolean,
): Promise<Response> {
  if (result instanceof Response) return result;
  const reply = isReply(result)
    ? result
    : { status: result === undefined ? 204 : 200, body: result, headers: {} };
  const body = validate ? await validateBody(endpoint, reply.status, reply.body) : reply.body;
  if (reply.status === 204 || reply.status === 304 || body === undefined) {
    return new Response(null, {
      status: reply.status,
      headers: { "cache-control": "private, no-store", ...reply.headers },
    });
  }
  return json(body, reply.status, { ...reply.headers });
}

function httpDate(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toUTCString();
}

/** `Deprecation` (RFC 9745) and `Sunset` (RFC 8594) headers of an endpoint. */
function lifecycleHeaders(endpoint: AnyEndpoint): Record<string, string> {
  const headers: Record<string, string> = {};
  const { deprecated, sunset } = endpoint;
  if (deprecated === true) headers.deprecation = "true";
  else if (deprecated instanceof Date || typeof deprecated === "string") {
    const date = deprecated instanceof Date ? deprecated : new Date(deprecated);
    headers.deprecation = `@${String(Math.floor(date.getTime() / 1000))}`;
  }
  if (sunset !== undefined) headers.sunset = httpDate(sunset);
  return headers;
}

function withHeaders(response: Response, headers: Record<string, string>): Response {
  const entries = Object.entries(headers);
  if (entries.length === 0) return response;
  try {
    for (const [name, value] of entries) response.headers.set(name, value);
    return response;
  } catch {
    // Immutable headers (e.g. a `fetch` response): copy the response.
    const copy = new Response(response.body, response);
    for (const [name, value] of entries) copy.headers.set(name, value);
    return copy;
  }
}

function failure(error: unknown): Response {
  if (error instanceof OutputError) {
    console.error(error.message, error.issues);
    return json(
      { error: { code: "INTERNAL", message: "Internal server error", details: null } },
      500,
    );
  }
  return errorResponse(error);
}

async function run(
  config: QuickbenConfig,
  match: Match,
  req: Request,
  url: URL,
  options: EndpointRequestOptions,
): Promise<Response> {
  const { endpoint } = match;
  const csrf = options.csrf ?? {};
  if (endpoint.method !== "GET" && csrf !== false && !isBearer(req)) assertSameOrigin(req, csrf);
  const qb = await getQuickben(config);
  const user = config.auth ? await config.auth.getUser(req) : null;
  const ctx = { user, req };
  await checkEndpointAccess(endpoint, qb, ctx);
  const input = await parseInput(match, req, url, options.maxBodyBytes ?? 1_048_576);
  const call = (api: Quickben) =>
    Promise.resolve(endpoint.handler({ input: input as never, qb: api, ctx, user, req }));
  const result = endpoint.transactional === true ? await qb.transaction(call) : await call(qb);
  return toResponse(endpoint, result, shouldValidateOutput(endpoint, options.validateOutput));
}

/**
 * Serve the custom endpoints of a config (`defineConfig({ endpoints })`) from any server that
 * speaks the Fetch API. Resolves `null` when no endpoint path matches, so the caller can try
 * other routes. A path that matches with another method gets `405`.
 *
 * ```ts
 * const response = await handleEndpointRequest(config, request, { basePath: "/api" });
 * if (response) return response;
 * ```
 *
 * Errors use the route handler shape: `{ error: { code, message, details } }`.
 */
export async function handleEndpointRequest(
  config: QuickbenConfig,
  request: Request,
  options: EndpointRequestOptions = {},
): Promise<Response | null> {
  const endpoints = config.endpoints ?? [];
  if (endpoints.length === 0) return null;
  const url = new URL(request.url);
  const segments = requestSegments(url, normalizeBasePath(options.basePath ?? "/api"));
  if (segments === null) return null;
  const matches = findMatches(endpoints, segments);
  if (matches.length === 0) return null;
  const method = request.method.toUpperCase();
  const match = matches.find((candidate) => candidate.endpoint.method === method);
  if (!match) {
    const allow = [...new Set(matches.map((candidate) => candidate.endpoint.method))];
    return errorResponse(
      new HttpError(405, "METHOD_NOT_ALLOWED", `${method} is not allowed here`, {
        allow: allow.join(", "),
      }),
    );
  }
  const headers = lifecycleHeaders(match.endpoint);
  try {
    return withHeaders(await run(config, match, request, url, options), headers);
  } catch (error) {
    return withHeaders(failure(error), headers);
  }
}
