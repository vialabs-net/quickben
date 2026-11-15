import { localize } from "@quickben/core";

import { collectionPaths } from "./collections";
import { endpointOperation, openApiPath } from "./endpoints";
import { addErrorSchema, errorComponents } from "./errors";
import { compareText, isObject, SchemaRegistry } from "./schemas";

import type { CollectionContext } from "./collections";
import type { ErrorStatus } from "./errors";
import type {
  OpenApiDocument,
  OpenApiMethod,
  OpenApiOperation,
  OpenApiOptions,
  OpenApiPathItem,
  OpenApiSecurityScheme,
  SecurityRequirement,
} from "./types";
import type { AnyEndpoint, QuickbenConfig, SanitizedCollection } from "@quickben/core";

const methodOrder: readonly OpenApiMethod[] = ["get", "put", "post", "patch", "delete"];

const topLevelOrder = [
  "openapi",
  "info",
  "jsonSchemaDialect",
  "servers",
  "security",
  "tags",
  "paths",
  "components",
];

/** Sort object keys, keeping the order of `properties` (declaration order) and of arrays. */
function canonical(value: unknown, keepOrder = false): unknown {
  if (Array.isArray(value)) return value.map((item) => canonical(item));
  if (!isObject(value)) return value;
  const keys = Object.keys(value);
  if (!keepOrder) keys.sort(compareText);
  return Object.fromEntries(keys.map((key) => [key, canonical(value[key], key === "properties")]));
}

/** Sort keys of the whole document, with the top-level keys in the usual order. */
export function canonicalDocument(doc: OpenApiDocument): OpenApiDocument {
  const sorted = canonical(doc) as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const key of topLevelOrder) if (key in sorted) ordered[key] = sorted[key];
  for (const key of Object.keys(sorted)) if (!(key in ordered)) ordered[key] = sorted[key];
  return ordered as unknown as OpenApiDocument;
}

function selectedCollections(
  config: QuickbenConfig,
  include: OpenApiOptions["include"],
): SanitizedCollection[] {
  const option = include?.collections;
  if (option === false) return [];
  if (option === undefined) return config.collections.filter((c) => c.api?.openapi === true);
  const bySlug = new Map(config.collections.map((collection) => [collection.slug, collection]));
  return option.map((slug) => {
    const collection = bySlug.get(slug);
    if (!collection) throw new Error(`[quickben] OpenAPI: unknown collection "${slug}"`);
    return collection;
  });
}

function selectedEndpoints(
  config: QuickbenConfig,
  include: OpenApiOptions["include"],
): AnyEndpoint[] {
  const option = include?.endpoints ?? true;
  const endpoints = config.endpoints ?? [];
  if (option === false) return [];
  return option === true ? [...endpoints] : endpoints.filter((endpoint) => option(endpoint));
}

function securityOf(config: QuickbenConfig, options: OpenApiOptions) {
  const schemes: Readonly<Record<string, OpenApiSecurityScheme>> =
    options.securitySchemes ?? config.auth?.securitySchemes ?? {};
  const names = Object.keys(schemes).sort(compareText);
  if (options.security) return { schemes, security: [...options.security] };
  const security: SecurityRequirement[] | undefined =
    names.length > 0 ? names.map((name) => ({ [name]: [] })) : undefined;
  return { schemes, security };
}

/** `/items/{id}` → `/items/{}`: paths that differ only in parameter names. */
function pathShape(path: string): string {
  return path.replaceAll(/\{[^{}/]*\}/g, "{}");
}

function parameterNames(path: string): string[] {
  return [...path.matchAll(/\{([^{}/]*)\}/g)].map((match) => match[1] ?? "");
}

/** Rename the path parameters of an operation to the names of an equivalent path. */
function renamePathParameters(
  operation: OpenApiOperation,
  from: string,
  to: string,
): OpenApiOperation {
  const names = new Map(
    parameterNames(from).map((name, index) => [name, parameterNames(to)[index] ?? name]),
  );
  if (!operation.parameters) return operation;
  return {
    ...operation,
    parameters: operation.parameters.map((parameter) =>
      parameter.in === "path"
        ? { ...parameter, name: names.get(parameter.name) ?? parameter.name }
        : parameter,
    ),
  };
}

function addOperation(
  paths: Record<string, OpenApiPathItem>,
  given: string,
  method: OpenApiMethod,
  input: OpenApiOperation,
): void {
  // OpenAPI forbids two paths that differ only in parameter names: use the first one.
  const path = Object.keys(paths).find((other) => pathShape(other) === pathShape(given)) ?? given;
  const operation = path === given ? input : renamePathParameters(input, given, path);
  const item = (paths[path] ??= {});
  if (item[method]) {
    throw new Error(`[quickben] OpenAPI: two operations for ${method.toUpperCase()} ${path}`);
  }
  item[method] = operation;
}

function assertOperationIds(paths: Record<string, OpenApiPathItem>): void {
  const seen = new Map<string, string>();
  for (const [path, item] of Object.entries(paths)) {
    for (const method of methodOrder) {
      const id = item[method]?.operationId;
      if (id === undefined) continue;
      const where = `${method.toUpperCase()} ${path}`;
      const other = seen.get(id);
      if (other !== undefined) {
        throw new Error(`[quickben] OpenAPI: ${other} and ${where} share operationId "${id}"`);
      }
      seen.set(id, where);
    }
  }
}

function documentTags(
  paths: Record<string, OpenApiPathItem>,
  collections: readonly SanitizedCollection[],
): { name: string; description?: string }[] {
  const names = new Set<string>();
  for (const item of Object.values(paths)) {
    for (const method of methodOrder) for (const tag of item[method]?.tags ?? []) names.add(tag);
  }
  const descriptions = new Map(
    collections.map((collection) => [
      collection.slug,
      localize(collection.admin.description ?? collection.labels.plural, "en"),
    ]),
  );
  return [...names].sort(compareText).map((name) => {
    const description = descriptions.get(name);
    return description ? { name, description } : { name };
  });
}

/**
 * Build an OpenAPI 3.1 document for a config: its custom endpoints and, opt-in, the CRUD
 * routes of collections marked `api: { openapi: true }`. The output is deterministic (sorted
 * keys), so it can be committed and compared.
 *
 * ```ts
 * const doc = generateOpenApi(config, { info: { title: "Shop API", version: "1.0.0" } });
 * ```
 */
export function generateOpenApi(
  config: QuickbenConfig,
  options: OpenApiOptions = {},
): OpenApiDocument {
  const registry = new SchemaRegistry();
  const usedErrors = new Set<ErrorStatus>();
  addErrorSchema(registry);
  const { schemes, security } = securityOf(config, options);
  const collections = selectedCollections(config, options.include);
  const context: CollectionContext = {
    registry,
    usedErrors,
    security,
    documented: new Set(collections.map((collection) => collection.slug)),
    maxLimit: options.maxLimit ?? 100,
  };
  const paths: Record<string, OpenApiPathItem> = {};
  for (const collection of collections) {
    for (const [path, item] of Object.entries(collectionPaths(collection, context))) {
      for (const method of methodOrder) {
        const operation = item[method];
        if (operation) addOperation(paths, path, method, operation);
      }
    }
  }
  for (const endpoint of selectedEndpoints(config, options.include)) {
    const method = endpoint.method.toLowerCase() as OpenApiMethod;
    addOperation(
      paths,
      openApiPath(endpoint.segments),
      method,
      endpointOperation(endpoint, context),
    );
  }
  assertOperationIds(paths);
  const doc: OpenApiDocument = {
    openapi: "3.1.0",
    info: {
      title: localize(config.admin.title, "en") || "Quickben",
      version: "0.0.0",
      ...options.info,
    },
    servers: options.servers ? [...options.servers] : [{ url: options.basePath ?? "/api" }],
    paths,
    components: {
      schemas: Object.fromEntries(registry.schemas),
      responses: errorComponents(usedErrors),
      ...(Object.keys(schemes).length > 0 ? { securitySchemes: { ...schemes } } : {}),
    },
  };
  const tags = documentTags(paths, collections);
  if (tags.length > 0) doc.tags = tags;
  if (security) doc.security = security;
  return canonicalDocument(doc);
}

/** The document as text: two-space JSON with a final newline, ready to commit. */
export function stringifyOpenApi(doc: OpenApiDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
