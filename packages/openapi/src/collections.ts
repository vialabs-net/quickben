import { localize } from "@quickben/core";

import { addErrors } from "./errors";
import { ref } from "./schemas";

import type { Context } from "./endpoints";
import type { ErrorStatus } from "./errors";
import type { SchemaRegistry } from "./schemas";
import type {
  JsonSchema,
  OpenApiMediaType,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiPathItem,
} from "./types";
import type { AnyField, SanitizedCollection, SanitizedField } from "@quickben/core";

/** Largest `depth` the local API accepts. */
const MAX_DEPTH = 3;

const systemNames = ["id", "createdAt", "updatedAt"] as const;

const textOperators = [
  "eq",
  "ne",
  "in",
  "notIn",
  "lt",
  "lte",
  "gt",
  "gte",
  "contains",
  "startsWith",
  "exists",
] as const;
const rangeOperators = ["eq", "ne", "in", "notIn", "lt", "lte", "gt", "gte", "exists"] as const;
const equalityOperators = ["eq", "ne", "in", "notIn", "exists"] as const;
const arrayOperators = ["contains", "in", "notIn", "exists"] as const;

function pascal(slug: string): string {
  return slug
    .split(/[-_]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function singular(name: string): string {
  if (name.endsWith("ies")) return `${name.slice(0, -3)}y`;
  if (name.endsWith("ss")) return name;
  if (name.endsWith("s")) return name.slice(0, -1);
  return name;
}

/** Component and operation names of a collection: `posts` → `Post` and `Posts`. */
export function collectionNames(slug: string): { one: string; many: string } {
  const many = pascal(slug);
  const one = singular(many);
  return { one: one === many ? `${many}Item` : one, many };
}

function nullable(schema: JsonSchema): JsonSchema {
  if (typeof schema.type === "string") return { ...schema, type: [schema.type, "null"] };
  return { anyOf: [schema, { type: "null" }] };
}

function textSchema(field: Extract<AnyField, { minLength: unknown }>): JsonSchema {
  const schema: JsonSchema = { type: "string" };
  if (field.type === "email") schema.format = "email";
  if (field.type === "url") schema.format = "uri";
  if (field.minLength !== undefined) schema.minLength = field.minLength;
  if (field.maxLength !== undefined) schema.maxLength = field.maxLength;
  return schema;
}

type Mode = "doc" | "input";

/** JSON Schema of a field with a plain value. `undefined` for relation, json and file fields. */
function plainSchema(field: AnyField): JsonSchema | undefined {
  switch (field.type) {
    case "text":
    case "textarea":
    case "email":
    case "url":
      return textSchema(field);
    case "number": {
      const schema: JsonSchema = { type: field.integer ? "integer" : "number" };
      if (field.min !== undefined) schema.minimum = field.min;
      if (field.max !== undefined) schema.maximum = field.max;
      return schema;
    }
    case "boolean":
      return { type: "boolean" };
    case "date":
      return { type: "string", format: "date" };
    case "datetime":
      return { type: "string", format: "date-time" };
    case "select":
      return { type: "string", enum: [...field.options] };
    default:
      return undefined;
  }
}

/** JSON Schema of one value of a field (one item for `many` fields). */
function valueSchema(field: AnyField, mode: Mode, context: CollectionContext): JsonSchema {
  const plain = plainSchema(field);
  if (plain) return plain;
  if (field.type === "relation") {
    if (mode === "input") return { type: "string", description: `Id of a ${field.to} document.` };
    const target = context.documented.has(field.to)
      ? ref(collectionNames(field.to).one)
      : { type: "object" };
    return {
      description: `Id of a ${field.to} document, or the document with \`depth\` above 0.`,
      anyOf: [{ type: "string" }, target],
    };
  }
  if (field.type === "json") {
    if (!field.schema) return { description: "Any JSON value." };
    return context.registry.fromZod(field.schema, mode === "doc" ? "output" : "input");
  }
  return ref("FileRef");
}

function fieldSchema(field: SanitizedField, mode: Mode, context: CollectionContext): JsonSchema {
  const value = valueSchema(field, mode, context);
  const schema = field.many ? { type: "array", items: value } : value;
  const described: JsonSchema = { ...schema, title: localize(field.label, "en") };
  const description = localize(field.description, "en");
  if (description !== "" && described.description === undefined) {
    described.description = description;
  }
  // Missing values are `null` in documents; in input, `null` clears a field.
  return field.required || field.many ? described : nullable(described);
}

interface CollectionContext extends Context {
  /** Slugs of the documented collections. */
  documented: ReadonlySet<string>;
  maxLimit: number;
}

function docSchema(collection: SanitizedCollection, context: CollectionContext): JsonSchema {
  const properties: Record<string, JsonSchema> = {
    id: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  };
  const required: string[] = [...systemNames];
  for (const field of collection.fieldList) {
    properties[field.name] = fieldSchema(field, "doc", context);
    // Field read rules may remove the field.
    if (field.access.read === undefined) required.push(field.name);
  }
  const schema: JsonSchema = { type: "object", properties, required };
  const description = localize(collection.admin.description, "en");
  return description === "" ? schema : { description, ...schema };
}

function inputSchema(
  collection: SanitizedCollection,
  context: CollectionContext,
  operation: "create" | "update",
): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const field of collection.fieldList) {
    properties[field.name] = fieldSchema(field, "input", context);
    if (operation === "create" && field.required && field.default === undefined) {
      required.push(field.name);
    }
  }
  return required.length > 0
    ? { type: "object", properties, required }
    : { type: "object", properties };
}

function scalarSchema(field: AnyField | undefined): JsonSchema {
  return (field && plainSchema(field)) ?? { type: "string" };
}

function operatorsOf(field: AnyField | undefined): readonly string[] {
  if (!field) return equalityOperators;
  if (field.many) return arrayOperators;
  switch (field.type) {
    case "number":
    case "date":
    case "datetime":
      return rangeOperators;
    case "boolean":
    case "relation":
    case "select":
      return equalityOperators;
    case "json":
    case "file":
      return ["exists"];
    default:
      return textOperators;
  }
}

function conditionSchema(name: string, field: AnyField | undefined): JsonSchema {
  const scalar =
    name === "createdAt" || name === "updatedAt"
      ? { type: "string", format: "date-time" }
      : scalarSchema(field);
  const properties: Record<string, JsonSchema> = {};
  for (const op of name === "createdAt" || name === "updatedAt"
    ? rangeOperators
    : operatorsOf(field)) {
    if (op === "exists") properties[op] = { type: "boolean" };
    else if (op === "in" || op === "notIn") properties[op] = { type: "array", items: scalar };
    else properties[op] = scalar;
  }
  return { type: "object", properties, additionalProperties: false };
}

function whereSchema(collection: SanitizedCollection, name: string): JsonSchema {
  const self = ref(name);
  const properties: Record<string, JsonSchema> = {};
  for (const system of systemNames) properties[system] = conditionSchema(system, undefined);
  for (const field of collection.fieldList) {
    properties[field.name] = conditionSchema(field.name, field);
  }
  properties.and = { type: "array", items: self };
  properties.or = { type: "array", items: self };
  return {
    type: "object",
    description: "Filter. Conditions are combined with AND.",
    properties,
    additionalProperties: false,
  };
}

function listSchema(one: string): JsonSchema {
  const count = { type: ["integer", "null"] };
  return {
    type: "object",
    properties: {
      docs: { type: "array", items: ref(one) },
      limit: { type: "integer" },
      hasNextPage: { type: "boolean" },
      nextCursor: { type: ["string", "null"], description: "Pass as `cursor` for the next page." },
      page: count,
      totalDocs: count,
      totalPages: count,
    },
    required: ["docs", "limit", "hasNextPage", "nextCursor", "page", "totalDocs", "totalPages"],
  };
}

function addFileRef(registry: SchemaRegistry): void {
  registry.add("FileRef", {
    type: "object",
    description: "A stored file. Download it from `GET /{collection}/{id}/{field}`.",
    properties: {
      key: { type: "string" },
      name: { type: "string" },
      mime: { type: "string" },
      size: { type: "integer" },
      sha256: { type: "string" },
    },
    required: ["key", "name", "mime", "size", "sha256"],
  });
}

function selectParameter(collection: SanitizedCollection): OpenApiParameter {
  const names = [...systemNames, ...collection.fieldList.map((field) => field.name)];
  return {
    name: "select",
    in: "query",
    description: "Fields to return, comma-separated.",
    style: "form",
    explode: false,
    schema: { type: "array", items: { type: "string", enum: names } },
  };
}

const depthParameter: OpenApiParameter = {
  name: "depth",
  in: "query",
  description: "Load relations to this depth. `0` returns ids.",
  schema: { type: "integer", minimum: 0, maximum: MAX_DEPTH },
};

const idParameter: OpenApiParameter = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
};

function listParameters(
  collection: SanitizedCollection,
  names: { one: string; many: string },
  maxLimit: number,
): OpenApiParameter[] {
  return [
    {
      name: "where",
      in: "query",
      description: 'Filter as JSON: `{"status":{"eq":"draft"}}`.',
      content: { "application/json": { schema: ref(`${names.one}Where`) } },
    },
    {
      name: "sort",
      in: "query",
      description: "Sort keys, comma-separated. `-` sorts descending: `-createdAt,title`.",
      style: "form",
      explode: false,
      schema: { type: "array", items: { type: "string" } },
    },
    {
      name: "limit",
      in: "query",
      schema: { type: "integer", minimum: 1, maximum: maxLimit },
    },
    {
      name: "page",
      in: "query",
      description: "Page number, from 1.",
      schema: { type: "integer", minimum: 1 },
    },
    {
      name: "cursor",
      in: "query",
      description: "`nextCursor` of the previous page. Not with `page`.",
      schema: { type: "string" },
    },
    selectParameter(collection),
    depthParameter,
  ];
}

function bodyContent(
  collection: SanitizedCollection,
  schema: JsonSchema,
): Record<string, OpenApiMediaType> {
  const content: Record<string, OpenApiMediaType> = { "application/json": { schema } };
  const files = collection.fieldList.filter((field) => field.type === "file");
  if (files.length > 0) {
    const properties: Record<string, JsonSchema> = {
      _payload: {
        type: "string",
        contentMediaType: "application/json",
        description: "The other fields, as JSON.",
      },
    };
    for (const field of files) {
      properties[field.name] = { type: "string", contentMediaType: "application/octet-stream" };
    }
    content["multipart/form-data"] = { schema: { type: "object", properties } };
  }
  return content;
}

function json(schema: JsonSchema): Record<string, OpenApiMediaType> {
  return { "application/json": { schema } };
}

function hasUnique(collection: SanitizedCollection): boolean {
  return collection.fieldList.some((field) => field.unique);
}

function finish(
  operation: OpenApiOperation,
  errors: ErrorStatus[],
  context: CollectionContext,
): OpenApiOperation {
  addErrors(operation.responses, [...errors, 401, 403, 500], context.usedErrors);
  return operation;
}

/** Paths of the CRUD routes of one collection. */
export function collectionPaths(
  collection: SanitizedCollection,
  context: CollectionContext,
): Record<string, OpenApiPathItem> {
  const { registry } = context;
  const names = collectionNames(collection.slug);
  const { one, many } = names;
  const tags = [collection.slug];
  if (collection.fieldList.some((field) => field.type === "file")) addFileRef(registry);
  const doc = registry.add(one, docSchema(collection, context));
  const createInput = registry.add(`${one}CreateInput`, inputSchema(collection, context, "create"));
  const updateInput = registry.add(`${one}UpdateInput`, inputSchema(collection, context, "update"));
  registry.add(`${one}Where`, whereSchema(collection, `${one}Where`));
  const list = registry.add(`${one}List`, listSchema(one));
  const write: ErrorStatus[] = [400, ...(hasUnique(collection) ? ([409] as const) : []), 413, 415];
  const base = `/${collection.slug}`;
  const paths: Record<string, OpenApiPathItem> = {
    [base]: {
      get: finish(
        {
          operationId: `list${many}`,
          summary: `List ${collection.slug}`,
          tags,
          parameters: listParameters(collection, names, context.maxLimit),
          responses: { "200": { description: "Success.", content: json(list) } },
        },
        [400],
        context,
      ),
      post: finish(
        {
          operationId: `create${one}`,
          summary: `Create a ${collection.slug} document`,
          tags,
          requestBody: { required: true, content: bodyContent(collection, createInput) },
          responses: { "201": { description: "Created.", content: json(doc) } },
        },
        write,
        context,
      ),
    },
    [`${base}/{id}`]: {
      get: finish(
        {
          operationId: `get${one}`,
          summary: `Get a ${collection.slug} document`,
          tags,
          parameters: [idParameter, selectParameter(collection), depthParameter],
          responses: { "200": { description: "Success.", content: json(doc) } },
        },
        [400, 404],
        context,
      ),
      patch: finish(
        {
          operationId: `update${one}`,
          summary: `Update a ${collection.slug} document`,
          tags,
          parameters: [idParameter],
          requestBody: { required: true, content: bodyContent(collection, updateInput) },
          responses: { "200": { description: "Success.", content: json(doc) } },
        },
        [...write, 404],
        context,
      ),
      delete: finish(
        {
          operationId: `delete${one}`,
          summary: `Delete a ${collection.slug} document`,
          tags,
          parameters: [idParameter],
          responses: { "200": { description: "The deleted document.", content: json(doc) } },
        },
        [404],
        context,
      ),
    },
  };
  for (const field of collection.fieldList) {
    if (field.type !== "file") continue;
    const types = field.accept ?? ["application/octet-stream"];
    paths[`${base}/{id}/${field.name}`] = {
      get: finish(
        {
          operationId: `get${one}${pascal(field.name)}`,
          summary: `Download the ${field.name} file`,
          tags,
          parameters: [
            idParameter,
            {
              name: "download",
              in: "query",
              description: "Send `Content-Disposition: attachment`.",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "The file.",
              content: Object.fromEntries(types.map((type) => [type, {}])),
            },
            "304": { description: "Not modified (`If-None-Match`)." },
          },
        },
        [400, 404],
        context,
      ),
    };
  }
  return paths;
}

export type { CollectionContext };
