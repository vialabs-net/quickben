import { z } from "zod";

/** A property of the objects in a list, edited as one column of a row editor. */
export interface JsonRowColumn {
  /** Property name. */
  key: string;
  /** The schema `title` (`.meta({ title })`), else the key in words. */
  label: string;
  /** The schema `description`, or `null`. */
  description: string | null;
  /** `select` for string enums. */
  type: "text" | "number" | "boolean" | "select";
  /** Required in the input: no default and not optional. */
  required: boolean;
  /** Default of the property, when it has one. */
  default?: unknown;
  /** Values of `select` columns. */
  options?: string[];
  /** Whole numbers only (`number` columns). */
  integer?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
}

/** The part of JSON Schema that row columns read. */
interface Node {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  title?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  properties?: Record<string, Node>;
  required?: string[];
  items?: Node;
  anyOf?: Node[];
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `maxPages` → `Max pages`. */
function words(key: string): string {
  const text = key
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/([a-z\d])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The node without a `null` branch (`.nullable()`), merged with its outer keys. */
function unwrap(node: Node): { node: Node; nullable: boolean } {
  if (!node.anyOf) return { node, nullable: false };
  const branches = node.anyOf.filter((branch) => branch.type !== "null");
  if (branches.length !== 1 || !branches[0]) return { node, nullable: false };
  const merged: Node = { ...branches[0], ...node };
  delete merged.anyOf;
  return { node: merged, nullable: branches.length < node.anyOf.length };
}

function typeOf(node: Node): string | undefined {
  const types = Array.isArray(node.type) ? node.type.filter((t) => t !== "null") : [node.type];
  return types.length === 1 ? types[0] : undefined;
}

function column(key: string, raw: Node, required: boolean): JsonRowColumn | null {
  const { node, nullable } = unwrap(raw);
  const base = {
    key,
    label: node.title ?? words(key),
    description: node.description ?? null,
    required: required && !nullable && node.default === undefined,
    ...(node.default === undefined ? {} : { default: node.default }),
  };
  if (Array.isArray(node.enum)) {
    const options = node.enum.filter((value): value is string => typeof value === "string");
    return options.length === node.enum.length ? { ...base, type: "select", options } : null;
  }
  switch (typeOf(node)) {
    case "string":
      return {
        ...base,
        type: "text",
        ...(node.minLength === undefined ? {} : { minLength: node.minLength }),
        ...(node.maxLength === undefined ? {} : { maxLength: node.maxLength }),
      };
    case "number":
    case "integer":
      return {
        ...base,
        type: "number",
        integer: typeOf(node) === "integer",
        ...(node.minimum === undefined ? {} : { min: node.minimum }),
        ...(node.maximum === undefined ? {} : { max: node.maximum }),
      };
    case "boolean":
      return { ...base, type: "boolean" };
    default:
      return null;
  }
}

/**
 * Columns of a row editor for a JSON Schema node: an array of objects whose properties are
 * all strings, numbers, booleans or string enums. Returns `null` for any other shape.
 */
export function jsonSchemaRowColumns(schema: unknown): JsonRowColumn[] | null {
  if (!isNode(schema)) return null;
  const { node } = unwrap(schema);
  if (typeOf(node) !== "array" || !isNode(node.items)) return null;
  const items = unwrap(node.items).node;
  if (typeOf(items) !== "object" || !isNode(items.properties)) return null;
  const required = new Set(items.required ?? []);
  const columns: JsonRowColumn[] = [];
  for (const [key, property] of Object.entries(items.properties)) {
    const described = isNode(property) ? column(key, property, required.has(key)) : null;
    if (!described) return null;
    columns.push(described);
  }
  return columns.length > 0 ? columns : null;
}

/**
 * Columns of a row editor for a Zod schema: `z.array(z.object({ … }))` whose properties are
 * strings, numbers, booleans or string enums (optional, nullable or with defaults). Returns
 * `null` for any other shape, and for schemas that JSON Schema cannot describe.
 *
 * ```ts
 * jsonRowColumns(z.array(z.object({ id: z.string(), price: z.number().min(0) })));
 * // [{ key: "id", type: "text", required: true, … }, { key: "price", type: "number", min: 0, … }]
 * ```
 */
export function jsonRowColumns(schema: z.ZodType): JsonRowColumn[] | null {
  try {
    return jsonSchemaRowColumns(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }));
  } catch {
    return null;
  }
}
