import { ConfigError } from "./errors";

import type { QuickbenUser } from "./auth";
import type { Quickben, Registry, RequestContext } from "./types";
import type { z } from "zod";

type MaybePromise<T> = T | Promise<T>;

/** HTTP methods an endpoint can answer. */
export type EndpointMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Zod schemas of the request parts. Parts without a schema are not validated. */
export interface EndpointInputSchemas {
  /** Path parameters (`:id`). Values arrive as strings: use `z.coerce` for numbers. */
  params?: z.ZodType;
  /** Query string. Repeated keys arrive as string arrays, others as strings. */
  query?: z.ZodType;
  /** JSON body. Without it the body is not read (use `req` for other content). */
  body?: z.ZodType;
}

/** Output schema: one for every status, or one per status (`{ 200: …, 404: … }`). */
export type EndpointOutput = z.ZodType | Readonly<Record<number, z.ZodType>>;

/** A reply with a status and headers. Return it from a handler instead of a plain value. */
export interface EndpointReply<TStatus extends number = number, TBody = unknown> {
  status: TStatus;
  body: TBody;
  headers?: Readonly<Record<string, string>>;
}

/**
 * Build a reply with a literal status, so per-status output schemas can check it:
 * `return reply(404, { missing: id })`. A plain `{ status: 404, body }` in an async handler
 * widens `status` to `number`; write `status: 404 as const` there.
 */
export function reply<const TStatus extends number, TBody>(
  status: TStatus,
  body: TBody,
  headers?: Readonly<Record<string, string>>,
): EndpointReply<TStatus, TBody> {
  return headers ? { status, body, headers } : { status, body };
}

/** Names of the `:param` segments of a path: `"/a/:id/b/:x"` → `"id" | "x"`. */
export type PathParams<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | PathParams<`/${Rest}`>
  : P extends `${string}:${infer Name}`
    ? Name
    : never;

type SchemaOutput<S> = S extends z.ZodType ? z.output<S> : never;

/** Validated input of a handler, inferred from the schemas and the path. */
export interface EndpointInputOf<P extends string, I extends EndpointInputSchemas> {
  params: I extends { params: infer S } ? SchemaOutput<S> : Record<PathParams<P>, string>;
  query: I extends { query: infer S } ? SchemaOutput<S> : Record<string, string | string[]>;
  body: I extends { body: infer S } ? SchemaOutput<S> : undefined;
}

/**
 * What a handler may return for an output schema: the schema's output type. Output schemas
 * check the result and never change it, so transforms and defaults do not apply. A `Response`
 * is always allowed.
 */
export type EndpointResultOf<O> = O extends z.ZodType
  ? SchemaOutput<O> | EndpointReply<number, SchemaOutput<O>>
  : O extends Readonly<Record<number, z.ZodType>>
    ? | { [K in keyof O & number]: EndpointReply<K, SchemaOutput<O[K]>> }[keyof O & number]
      | (200 extends keyof O ? SchemaOutput<O[200]> : never)
    : unknown;

/** Arguments of an endpoint handler. */
export interface EndpointHandlerArgs<
  P extends string = string,
  I extends EndpointInputSchemas = EndpointInputSchemas,
  R extends Registry = Registry,
> {
  input: EndpointInputOf<P, I>;
  /** Local API. Bound to the transaction with `transactional: true`. */
  qb: Quickben<R>;
  /** Request context for local API calls: `{ user, req }`. Access applies. */
  ctx: RequestContext;
  user: QuickbenUser | null;
  req: Request;
}

/** Arguments of an endpoint access rule. Input is not validated yet. */
export interface EndpointAccessArgs {
  user: QuickbenUser | null;
  req: Request;
  ctx: RequestContext;
  qb: Quickben;
  endpoint: AnyEndpoint;
}

/** Access rule: `true`, `false`, or a function. Without one, authenticated users only. */
export type EndpointAccess = boolean | ((args: EndpointAccessArgs) => MaybePromise<boolean>);

type EndpointHandler<P extends string, I extends EndpointInputSchemas, O, R extends Registry> = {
  bivarianceHack(args: EndpointHandlerArgs<P, I, R>): MaybePromise<EndpointResultOf<O> | Response>;
}["bivarianceHack"];

/** Input of {@link defineEndpoint}. */
export interface EndpointDefinition<
  P extends string,
  I extends EndpointInputSchemas,
  O extends EndpointOutput | undefined,
  R extends Registry = Registry,
> {
  method: EndpointMethod;
  /** Path relative to the API base path (and the version prefix): `/purchases/:id/start`. */
  path: P;
  /**
   * Version: `1` mounts the endpoint under `/v1`. Unversioned endpoints are not a stable
   * contract: do not give them to external clients.
   */
  version?: number;
  summary?: string;
  description?: string;
  tags?: readonly string[];
  /** Sets the `Deprecation` header: `true`, or the date it was deprecated. */
  deprecated?: boolean | Date | string;
  /** Sets the `Sunset` header: the date the endpoint goes away. */
  sunset?: Date | string;
  input?: I;
  /** Output schema. Without it the result is not typed or validated. */
  output?: O;
  /** Default: authenticated users only. */
  access?: EndpointAccess;
  /** Run the handler in `qb.transaction`. A thrown error rolls back. Default `false`. */
  transactional?: boolean;
  /** Validate the output in production too. Default: only when `NODE_ENV` is not `production`. */
  validateOutput?: boolean;
  /** Largest JSON body in bytes. Default: the option of the request handler (1 MB). */
  maxBodyBytes?: number;
  handler: EndpointHandler<P, I, O, R>;
}

/** A defined endpoint. Register it with `defineConfig({ endpoints })`. */
export interface Endpoint<
  P extends string = string,
  I extends EndpointInputSchemas = EndpointInputSchemas,
  O extends EndpointOutput | undefined = EndpointOutput | undefined,
> extends Omit<EndpointDefinition<P, I, O>, "handler" | "version"> {
  readonly version: number | undefined;
  /** Mounted path: `/v1/purchases/:id/start`. */
  readonly fullPath: string;
  /** Segments of `fullPath`. */
  readonly segments: readonly string[];
  readonly handler: EndpointHandler<string, EndpointInputSchemas, unknown, Registry>;
  /** Type-level only. */
  readonly "~types"?: { path: P; input: I; output: O };
}

/** Any endpoint, whatever its types. */
export type AnyEndpoint = Endpoint;

const methods: ReadonlySet<string> = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const staticSegment = /^[\w.~-]+$/;
const paramSegment = /^:[A-Za-z_]\w*$/;

function invalid(endpoint: { method: string; path: string }, message: string): ConfigError {
  return new ConfigError(`Endpoint ${endpoint.method} ${endpoint.path}: ${message}`);
}

function assertDate(endpoint: { method: string; path: string }, name: string, value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw invalid(endpoint, `${name} is not a valid date`);
}

function pathSegments(endpoint: { method: string; path: string }): string[] {
  const { path } = endpoint;
  if (!path.startsWith("/") || path === "/" || path.endsWith("/")) {
    throw invalid(endpoint, 'path must start with "/", have a segment and no trailing "/"');
  }
  const segments = path.slice(1).split("/");
  const names = new Set<string>();
  for (const segment of segments) {
    if (segment.startsWith(":")) {
      if (!paramSegment.test(segment)) throw invalid(endpoint, `invalid parameter "${segment}"`);
      if (names.has(segment)) throw invalid(endpoint, `parameter "${segment}" is repeated`);
      names.add(segment);
    } else if (!staticSegment.test(segment)) {
      throw invalid(endpoint, `invalid segment "${segment}"`);
    }
  }
  return segments;
}

/**
 * Check an endpoint definition and resolve its mounted path. `defineEndpoint` and
 * `defineConfig` call it; plugins that build endpoint objects by hand get the same checks.
 */
export function sanitizeEndpoint(
  definition: EndpointDefinition<string, EndpointInputSchemas, EndpointOutput | undefined>,
): AnyEndpoint {
  if (!methods.has(definition.method)) {
    throw invalid(definition, `unknown method "${definition.method}"`);
  }
  const segments = pathSegments(definition);
  const { version } = definition;
  if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
    throw invalid(definition, "version must be a positive integer");
  }
  if (definition.method === "GET" && definition.input?.body !== undefined) {
    throw invalid(definition, "GET endpoints have no body");
  }
  if (typeof definition.deprecated === "string" || definition.deprecated instanceof Date) {
    assertDate(definition, "deprecated", definition.deprecated);
  }
  if (definition.sunset !== undefined) assertDate(definition, "sunset", definition.sunset);
  const { maxBodyBytes } = definition;
  if (maxBodyBytes !== undefined && (!Number.isInteger(maxBodyBytes) || maxBodyBytes <= 0)) {
    throw invalid(definition, "maxBodyBytes must be a positive integer");
  }
  const mounted = version === undefined ? segments : [`v${String(version)}`, ...segments];
  return {
    ...definition,
    version,
    fullPath: `/${mounted.join("/")}`,
    segments: mounted,
    handler: definition.handler,
  };
}

/**
 * Define a custom HTTP endpoint. Input and output types are inferred from the Zod schemas:
 *
 * ```ts
 * export const startPurchase = defineEndpoint({
 *   method: "POST",
 *   path: "/purchases/:id/start",
 *   version: 1,
 *   input: { body: z.object({ amount: z.number().positive() }) },
 *   output: z.object({ id: z.string(), status: z.literal("started") }),
 *   transactional: true,
 *   handler: async ({ input, qb, ctx }) => { … },
 * });
 * ```
 */
export function defineEndpoint<
  const P extends string,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- no input schemas
  const I extends EndpointInputSchemas = {},
  const O extends EndpointOutput | undefined = undefined,
>(definition: EndpointDefinition<P, I, O>): Endpoint<P, I, O> {
  return sanitizeEndpoint(definition) as Endpoint<P, I, O>;
}

/**
 * `defineEndpoint` with `qb` typed by a registry, for endpoints that live outside the config
 * file: `const endpoint = endpointFactory<ConfigRegistry<typeof posts, never>>()`.
 */
export function endpointFactory<R extends Registry>(): <
  const P extends string,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- no input schemas
  const I extends EndpointInputSchemas = {},
  const O extends EndpointOutput | undefined = undefined,
>(
  definition: EndpointDefinition<P, I, O, R>,
) => Endpoint<P, I, O> {
  return (definition) => sanitizeEndpoint(definition as never) as never;
}

/** Key of an endpoint for uniqueness: method and mounted path with parameter names removed. */
function routeKey(endpoint: AnyEndpoint): string {
  const shape = endpoint.segments.map((segment) => (segment.startsWith(":") ? ":" : segment));
  return `${endpoint.method} /${shape.join("/")}`;
}

/**
 * Check the endpoints of a config: unique method + path + version, and no path that the
 * CRUD routes own (`_meta`, `_*`, collection slugs, or a version prefix used as a slug).
 */
export function assertEndpoints(
  endpoints: readonly AnyEndpoint[],
  slugs: ReadonlySet<string>,
): AnyEndpoint[] {
  const keys = new Set<string>();
  return endpoints.map((input) => {
    const endpoint = sanitizeEndpoint(input);
    const first = endpoint.segments[0] ?? "";
    if (first.startsWith("_") || first.startsWith(":") || /^v\d+$/.test(first)) {
      if (endpoint.version === undefined) {
        throw invalid(endpoint, `the first segment "${first}" is reserved`);
      }
    }
    if (slugs.has(first)) {
      throw invalid(endpoint, `"/${first}" is the path of a collection`);
    }
    const key = routeKey(endpoint);
    if (keys.has(key)) throw invalid(endpoint, `another endpoint has the same route (${key})`);
    keys.add(key);
    return endpoint;
  });
}
