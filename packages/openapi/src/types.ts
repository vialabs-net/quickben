import type { AnyEndpoint, AuthSecurityScheme } from "@quickben/core";

/** A JSON Schema (draft 2020-12), the schema dialect of OpenAPI 3.1. */
export type JsonSchema = Record<string, unknown>;

/** `info` of an OpenAPI document. */
export interface OpenApiInfo {
  title: string;
  version: string;
  summary?: string;
  description?: string;
  termsOfService?: string;
  contact?: { name?: string; url?: string; email?: string };
  license?: { name: string; identifier?: string; url?: string };
}

/** A server of an OpenAPI document. */
export interface OpenApiServer {
  url: string;
  description?: string;
}

/** A security scheme: the ones auth adapters describe, or any other OpenAPI scheme. */
export type OpenApiSecurityScheme =
  AuthSecurityScheme | { type: "oauth2" | "openIdConnect" | "mutualTLS"; [key: string]: unknown };

/** Scheme names and scopes. `{}` makes credentials optional. */
export type SecurityRequirement = Record<string, string[]>;

/** A media type of a request or response body. */
export interface OpenApiMediaType {
  schema?: JsonSchema;
  encoding?: Record<string, { contentType?: string }>;
}

/** A path, query, header or cookie parameter. */
export interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  deprecated?: boolean;
  style?: string;
  explode?: boolean;
  schema?: JsonSchema;
  content?: Record<string, OpenApiMediaType>;
}

/** A request body. */
export interface OpenApiRequestBody {
  description?: string;
  required?: boolean;
  content: Record<string, OpenApiMediaType>;
}

/** A response, or a `$ref` to one in `components/responses`. */
export interface OpenApiResponse {
  $ref?: string;
  description?: string;
  headers?: Record<string, { description?: string; schema: JsonSchema }>;
  content?: Record<string, OpenApiMediaType>;
}

/** An operation (one method of a path). */
export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: Record<string, OpenApiResponse>;
  deprecated?: boolean;
  security?: SecurityRequirement[];
  /** Endpoint version (`version: 1` mounts it under `/v1`). */
  "x-quickben-version"?: number;
  /** Date the endpoint was deprecated, when given as a date. */
  "x-deprecated-at"?: string;
  /** Date the endpoint goes away (`Sunset` header). */
  "x-sunset"?: string;
}

/** Lowercase HTTP methods of a path item. */
export type OpenApiMethod = "get" | "put" | "post" | "delete" | "patch" | "head" | "options";

/** The operations of one path. */
export type OpenApiPathItem = Partial<Record<OpenApiMethod, OpenApiOperation>>;

/** An OpenAPI 3.1 document. */
export interface OpenApiDocument {
  openapi: string;
  info: OpenApiInfo;
  jsonSchemaDialect?: string;
  servers?: OpenApiServer[];
  tags?: { name: string; description?: string }[];
  paths: Record<string, OpenApiPathItem>;
  components?: {
    schemas?: Record<string, JsonSchema>;
    responses?: Record<string, OpenApiResponse>;
    securitySchemes?: Record<string, OpenApiSecurityScheme>;
  };
  security?: SecurityRequirement[];
}

/** What {@link generateOpenApi} documents. */
export interface OpenApiInclude {
  /** Custom endpoints: `true` (default), `false`, or a filter. */
  endpoints?: boolean | ((endpoint: AnyEndpoint) => boolean);
  /**
   * CRUD routes of collections. Default: the collections with `api: { openapi: true }`.
   * A list of slugs documents exactly those; `false` documents none.
   */
  collections?: false | readonly string[];
}

/** Options of {@link generateOpenApi}. */
export interface OpenApiOptions {
  /** Default: `{ title: <admin title>, version: "0.0.0" }`. Missing keys use the defaults. */
  info?: Partial<OpenApiInfo>;
  /** Default: one server at `basePath`. */
  servers?: readonly OpenApiServer[];
  /** URL path the API is mounted at, for the default server. Default `/api`. */
  basePath?: string;
  include?: OpenApiInclude;
  /** Security schemes. Default: the ones the auth adapter describes. */
  securitySchemes?: Readonly<Record<string, OpenApiSecurityScheme>>;
  /** Security of every operation. Default: any one of the schemes. */
  security?: readonly SecurityRequirement[];
  /** Largest `limit` of collection lists, as in the route handler. Default `100`. */
  maxLimit?: number;
}
