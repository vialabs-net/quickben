import { z } from "zod";

import type { JsonSchema } from "./types";

/** Prefix of references to `components/schemas`. */
export const schemaRef = "#/components/schemas/";

/** `{ $ref }` to a component schema. */
export function ref(name: string): JsonSchema {
  return { $ref: `${schemaRef}${name}` };
}

/** Code-point order: the same on every machine, unlike `localeCompare`. */
export function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Whether a value is a plain object. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** FNV-1a hash, hex: stable names for schemas that have no id. */
function hash(text: string): string {
  let value = 0x81_1c_9d_c5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.codePointAt(index) ?? 0;
    value = Math.imul(value, 0x01_00_01_93) >>> 0;
  }
  return value.toString(16).padStart(8, "0");
}

/** Replace `$ref` values. Other keys are copied as is. */
function mapRefs(value: unknown, map: (target: string) => string): unknown {
  if (Array.isArray(value)) return value.map((item) => mapRefs(item, map));
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "$ref" && typeof item === "string" ? map(item) : mapRefs(item, map),
    ]),
  );
}

type Io = "input" | "output";

/** Drop `additionalProperties: false`: Zod adds it to every output object. */
function withoutClosedObjects(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutClosedObjects);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => !(key === "additionalProperties" && item === false))
      .map(([key, item]) => [key, withoutClosedObjects(item)]),
  );
}

function convert(schema: z.core.$ZodType, io: Io): JsonSchema {
  const converted = z.toJSONSchema(schema, { io, unrepresentable: "any", target: "draft-2020-12" });
  // Responses may gain fields without breaking clients, so they stay open.
  return io === "output" ? (withoutClosedObjects(converted) as JsonSchema) : converted;
}

/**
 * Component schemas of a document. Zod schemas named with `.meta({ id })` become shared
 * components. A schema whose request (input) form differs from its response (output) form,
 * for example because of defaults, gets a second component named `<id>Input`.
 */
export class SchemaRegistry {
  readonly schemas = new Map<string, JsonSchema>();
  readonly #inputNames = new Map<string, string>();

  /** Add a component. The same name with other content throws. */
  add(name: string, schema: JsonSchema): JsonSchema {
    const existing = this.schemas.get(name);
    if (existing === undefined) this.schemas.set(name, schema);
    else if (JSON.stringify(existing) !== JSON.stringify(schema)) {
      throw new Error(`[quickben] Two different schemas use the OpenAPI component name "${name}"`);
    }
    return ref(name);
  }

  /** The schema behind a `$ref` to a component, or the schema itself. */
  resolve(schema: JsonSchema): JsonSchema {
    const target = schema.$ref;
    if (typeof target !== "string" || !target.startsWith(schemaRef)) return schema;
    return this.schemas.get(target.slice(schemaRef.length)) ?? schema;
  }

  /** JSON Schema of a Zod schema, as a request (`input`) or a response (`output`). */
  fromZod(schema: z.ZodType, io: Io): JsonSchema {
    const converted = convert(schema, io);
    const { $defs } = converted;
    const root: JsonSchema = Object.fromEntries(
      Object.entries(converted).filter(([key]) => key !== "$schema" && key !== "$defs"),
    );
    const defs = isObject($defs) ? ($defs as Record<string, JsonSchema>) : {};
    const names = new Map<string, string>();
    for (const [key, def] of Object.entries(defs)) names.set(key, this.#nameOf(key, def, io));
    let selfName: string | undefined;
    const rewrite = (target: string): string => {
      if (target === "#") {
        selfName ??= `Schema${hash(JSON.stringify(root))}`;
        return `${schemaRef}${selfName}`;
      }
      const key = target.startsWith("#/$defs/") ? target.slice(8) : undefined;
      const name = key === undefined ? undefined : names.get(key);
      return name === undefined ? target : `${schemaRef}${name}`;
    };
    for (const [key, def] of Object.entries(defs)) {
      this.add(names.get(key) ?? key, mapRefs(def, rewrite) as JsonSchema);
    }
    const result = mapRefs(root, rewrite) as JsonSchema;
    // A recursive schema without an id refers to itself with "#": make it a component.
    return selfName === undefined ? result : this.add(selfName, result);
  }

  #nameOf(key: string, def: JsonSchema, io: Io): string {
    if (key.startsWith("__")) return `Schema${hash(JSON.stringify(def))}`;
    if (io === "output") return key;
    let name = this.#inputNames.get(key);
    if (name === undefined) {
      const named = z.globalRegistry._idmap.get(key);
      const same =
        named === undefined ||
        JSON.stringify(convert(named, "input")) === JSON.stringify(convert(named, "output"));
      name = same ? key : `${key}Input`;
      this.#inputNames.set(key, name);
    }
    return name;
  }
}
