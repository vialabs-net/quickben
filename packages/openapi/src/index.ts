/**
 * `@quickben/openapi`: OpenAPI 3.1 documents for Quickben configs, a handler that serves them
 * and a diff that classifies changes as breaking or not. The `quickben-openapi` CLI wraps
 * `generateOpenApi` and `diffOpenApi`. Nothing here imports Node.js modules.
 */
export { diffOpenApi, formatDiff } from "./diff";
export { generateOpenApi, stringifyOpenApi } from "./generate";
export { createOpenApiHandler } from "./serve";

export type { DiffOptions, OpenApiChange, OpenApiChangeKind, OpenApiDiff } from "./diff";
export type { OpenApiAccessArgs, OpenApiHandler, OpenApiServeOptions } from "./serve";
export type {
  JsonSchema,
  OpenApiDocument,
  OpenApiInclude,
  OpenApiInfo,
  OpenApiMediaType,
  OpenApiMethod,
  OpenApiOperation,
  OpenApiOptions,
  OpenApiParameter,
  OpenApiPathItem,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiSecurityScheme,
  OpenApiServer,
  SecurityRequirement,
} from "./types";
