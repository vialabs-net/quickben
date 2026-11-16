import { addErrors } from "./errors";
import { isObject } from "./schemas";

import type { ErrorStatus } from "./errors";
import type { SchemaRegistry } from "./schemas";
import type {
  JsonSchema,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiResponse,
  SecurityRequirement,
} from "./types";
import type { AnyEndpoint } from "@quickben/core";
import type { z } from "zod";

/** Shared state of one generation. */
export interface Context {
  registry: SchemaRegistry;
  usedErrors: Set<ErrorStatus>;
  /** Security of every operation, for operations that make it optional. */
  security: readonly SecurityRequirement[] | undefined;
}

/** `/v1/posts/:id` → `/v1/posts/{id}`. */
export function openApiPath(segments: readonly string[]): string {
  const parts = segments.map((segment) =>
    segment.startsWith(":") ? "{" + segment.slice(1) + "}" : segment,
  );
  return "/" + parts.join("/");
}

function pascal(word: string): string {
  return word
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part !== "")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/** `POST /v1/posts/:id/publish` → `postV1PostsByIdPublish`. */
function defaultOperationId(endpoint: AnyEndpoint): string {
  const words = endpoint.segments.map((segment) =>
    segment.startsWith(":") ? `By${pascal(segment.slice(1))}` : pascal(segment),
  );
  return `${endpoint.method.toLowerCase()}${words.join("")}`;
}

interface ObjectParts {
  properties: Record<string, JsonSchema>;
  required: readonly string[];
}

/**
 * Properties and required names of an object schema, following `$ref`s. For a union of
 * objects: every property, required when every branch requires it.
 */
function objectParts(registry: SchemaRegistry, schema: JsonSchema): ObjectParts {
  const resolved = registry.resolve(schema);
  const list = resolved.anyOf ?? resolved.oneOf;
  if (Array.isArray(list)) {
    const parts = list.filter(isObject).map((branch) => objectParts(registry, branch));
    const properties: Record<string, JsonSchema> = {};
    for (const part of parts) Object.assign(properties, part.properties);
    const required = Object.keys(properties).filter((name) =>
      parts.every((part) => part.required.includes(name)),
    );
    return { properties, required };
  }
  const properties = isObject(resolved.properties)
    ? (resolved.properties as Record<string, JsonSchema>)
    : {};
  const required = Array.isArray(resolved.required) ? (resolved.required as string[]) : [];
  return { properties, required };
}

function withDescription(parameter: OpenApiParameter, schema: JsonSchema): OpenApiParameter {
  return typeof schema.description === "string"
    ? { ...parameter, description: schema.description }
    : parameter;
}

function parameters(endpoint: AnyEndpoint, registry: SchemaRegistry): OpenApiParameter[] {
  const input = endpoint.input ?? {};
  const pathParts = input.params
    ? objectParts(registry, registry.fromZod(input.params, "input"))
    : { properties: {}, required: [] };
  const list: OpenApiParameter[] = endpoint.segments
    .filter((segment) => segment.startsWith(":"))
    .map((segment) => {
      const name = segment.slice(1);
      const schema = pathParts.properties[name] ?? { type: "string" };
      return withDescription({ name, in: "path", required: true, schema }, schema);
    });
  if (input.query) {
    const query = objectParts(registry, registry.fromZod(input.query, "input"));
    for (const [name, schema] of Object.entries(query.properties)) {
      list.push(
        withDescription(
          { name, in: "query", required: query.required.includes(name), schema },
          schema,
        ),
      );
    }
  }
  return list;
}

/** A body schema that accepts `undefined` (optional or with a default) is not required. */
function bodyRequired(schema: z.ZodType): boolean {
  return schema._zod.optin === undefined;
}

function successDescription(status: string): string {
  if (status === "201") return "Created.";
  if (status === "204") return "No content.";
  return status.startsWith("2") ? "Success." : `Status ${status}.`;
}

function responses(
  endpoint: AnyEndpoint,
  registry: SchemaRegistry,
): Record<string, OpenApiResponse> {
  const { output } = endpoint;
  const byStatus: Record<string, OpenApiResponse> = {};
  if (output === undefined) {
    byStatus["200"] = { description: "Success." };
  } else if ("_zod" in output) {
    byStatus["200"] = {
      description: "Success.",
      content: { "application/json": { schema: registry.fromZod(output, "output") } },
    };
  } else {
    for (const [status, schema] of Object.entries(output as Record<string, z.ZodType>)) {
      byStatus[status] = {
        description: successDescription(status),
        content: { "application/json": { schema: registry.fromZod(schema, "output") } },
      };
    }
  }
  return byStatus;
}

function lifecycle(endpoint: AnyEndpoint): Partial<OpenApiOperation> {
  const extra: Partial<OpenApiOperation> = {};
  const { deprecated, sunset } = endpoint;
  if (deprecated !== undefined && deprecated !== false) extra.deprecated = true;
  if (deprecated instanceof Date || typeof deprecated === "string") {
    extra["x-deprecated-at"] = new Date(deprecated).toISOString();
  }
  if (sunset !== undefined) extra["x-sunset"] = new Date(sunset).toISOString();
  return extra;
}

/** The OpenAPI operation of a custom endpoint. */
export function endpointOperation(endpoint: AnyEndpoint, context: Context): OpenApiOperation {
  const { registry } = context;
  const input = endpoint.input ?? {};
  const operation: OpenApiOperation = {
    operationId: endpoint.operationId ?? defaultOperationId(endpoint),
    responses: responses(endpoint, registry),
  };
  if (endpoint.summary !== undefined) operation.summary = endpoint.summary;
  if (endpoint.description !== undefined) operation.description = endpoint.description;
  if (endpoint.tags && endpoint.tags.length > 0) operation.tags = [...endpoint.tags];
  const list = parameters(endpoint, registry);
  if (list.length > 0) operation.parameters = list;
  if (input.body) {
    operation.requestBody = {
      required: bodyRequired(input.body),
      content: { "application/json": { schema: registry.fromZod(input.body, "input") } },
    };
  }
  if (endpoint.version !== undefined) operation["x-quickben-version"] = endpoint.version;
  Object.assign(operation, lifecycle(endpoint));
  const errors: ErrorStatus[] = [];
  if (input.params ?? input.query ?? input.body) errors.push(400);
  if (endpoint.access === true) {
    // Anyone may call it: credentials are optional.
    if (context.security) operation.security = [{}, ...context.security];
  } else {
    errors.push(401, 403);
  }
  if (input.body) errors.push(413, 415);
  errors.push(500);
  addErrors(operation.responses, errors, context.usedErrors);
  return operation;
}
