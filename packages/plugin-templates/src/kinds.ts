import { ConfigError } from "@quickben/core";

import type { TemplateContent } from "./content";

/** How a variable's value is printed and compared. */
export type VariableType = "text" | "number" | "date" | "boolean" | "enum" | "list";

/** A value of `enum` variables: the code expressions compare against and the printed label. */
export interface EnumValue {
  value: string;
  label: string;
}

/** A field of each item of a `list` variable. */
export interface ListField {
  key: string;
  label: string;
}

/** A variable a template can use. */
export interface VariableDefinition {
  /**
   * Dot path into the render data: `customer.name` reads `data.customer.name`. Letters, digits
   * and `_` per segment. `brand.*` is reserved for the brand variables.
   */
  path: string;
  label: string;
  /** Group in the variable panel. Default `Data`. */
  group?: string;
  /** Default `text`. */
  type?: VariableType;
  /** `enum`: the codes and their printed labels. */
  values?: readonly EnumValue[];
  /** `list`: the fields of each item (an object with these keys). */
  fields?: readonly ListField[];
  /** Value used by the editor preview. */
  sample?: unknown;
  /** Printed when the value is missing. Default: a blank line. */
  placeholder?: string;
  /** Help text in the variable panel. */
  hint?: string;
  /** Custom text for a present value. Runs on the server only. */
  format?: (value: unknown) => string;
}

/** A template kind, as a product registers it. */
export interface TemplateKindDefinition {
  /** Identifier: lowercase letters, digits, `-` and `_`. */
  kind: string;
  label: string;
  description?: string;
  /** Variables the kind's templates can use. */
  catalog: readonly VariableDefinition[];
  /**
   * Content used when no version is published, and the starting text of the editor. Without
   * one, rendering a kind with no published version throws `NotFoundError`.
   */
  baseTemplate?: TemplateContent;
  /** Data for the editor preview. Default: built from the `sample` of each variable. */
  sampleData?: Record<string, unknown>;
  /** Publishing needs a signature block. Default `false`. */
  requireSignature?: boolean;
}

/** A variable with defaults applied. Plain data: safe to send to the browser. */
export interface CatalogVariable {
  path: string;
  label: string;
  group: string;
  type: VariableType;
  values?: EnumValue[];
  fields?: ListField[];
  placeholder?: string;
  hint?: string;
}

/** A kind with defaults applied. */
export interface ResolvedKind {
  readonly kind: string;
  readonly label: string;
  readonly description: string | null;
  readonly catalog: readonly CatalogVariable[];
  /** Server-only formatters by path. */
  readonly formats: ReadonlyMap<string, (value: unknown) => string>;
  readonly baseTemplate: TemplateContent | null;
  readonly sampleData: Record<string, unknown>;
  readonly requireSignature: boolean;
}

const kindPattern = /^[a-z\d][a-z\d_-]{0,62}$/;
const pathPattern = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;
const types = new Set<VariableType>(["text", "number", "date", "boolean", "enum", "list"]);

/** Paths that are not data: the brand variables. */
export const BRAND_GROUP = "Brand";

/** Variables every kind gets, filled from the brand. */
export const brandVariables: readonly CatalogVariable[] = [
  { path: "brand.name", label: "Brand name", group: BRAND_GROUP, type: "text" },
  { path: "brand.legalName", label: "Legal name", group: BRAND_GROUP, type: "text" },
  { path: "brand.taxId", label: "Tax id", group: BRAND_GROUP, type: "text" },
  { path: "brand.address", label: "Address", group: BRAND_GROUP, type: "text" },
  { path: "brand.contact", label: "Contact", group: BRAND_GROUP, type: "text" },
];

/**
 * Define a template kind: what a document is for and which variables its templates can use.
 * Register kinds in `templates({ kinds })`.
 *
 * ```ts
 * const invoice = defineTemplateKind({
 *   kind: "invoice",
 *   label: "Invoice",
 *   catalog: [{ path: "customer.name", label: "Customer", sample: "Ada Lovelace" }],
 * });
 * ```
 */
export function defineTemplateKind<const T extends TemplateKindDefinition>(definition: T): T {
  resolveKind(definition);
  return definition;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let node = target;
  for (const key of keys.slice(0, -1)) {
    const next = Object.hasOwn(node, key) ? node[key] : undefined;
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      const created: Record<string, unknown> = {};
      node[key] = created;
      node = created;
    } else {
      node = next as Record<string, unknown>;
    }
  }
  node[keys.at(-1) ?? path] = value;
}

function checkVariable(kind: string, variable: VariableDefinition): CatalogVariable {
  const where = `template kind "${kind}", variable "${variable.path}"`;
  if (!pathPattern.test(variable.path)) {
    throw new ConfigError(
      `Invalid path in ${where}. Use names joined by dots, e.g. customer.name.`,
    );
  }
  if (variable.path === "brand" || variable.path.startsWith("brand.")) {
    throw new ConfigError(`${where}: "brand." is reserved for the brand variables`);
  }
  const type = variable.type ?? "text";
  if (!types.has(type)) throw new ConfigError(`Unknown type "${type}" in ${where}`);
  if (type === "enum" && (variable.values?.length ?? 0) === 0) {
    throw new ConfigError(`${where}: an enum needs \`values\``);
  }
  if (type === "list" && (variable.fields?.length ?? 0) === 0) {
    throw new ConfigError(`${where}: a list needs \`fields\``);
  }
  return {
    path: variable.path,
    label: variable.label,
    group: variable.group ?? "Data",
    type,
    ...(variable.values ? { values: variable.values.map((v) => ({ ...v })) } : {}),
    ...(variable.fields ? { fields: variable.fields.map((f) => ({ ...f })) } : {}),
    ...(variable.placeholder === undefined ? {} : { placeholder: variable.placeholder }),
    ...(variable.hint === undefined ? {} : { hint: variable.hint }),
  };
}

/** Check a kind and apply defaults. Throws `ConfigError`. */
export function resolveKind(definition: TemplateKindDefinition): ResolvedKind {
  if (!kindPattern.test(definition.kind)) {
    throw new ConfigError(
      `Invalid template kind "${definition.kind}". Use lowercase letters, digits, "-" and "_".`,
    );
  }
  const seen = new Set<string>();
  const formats = new Map<string, (value: unknown) => string>();
  const sampleData: Record<string, unknown> = {};
  const catalog = definition.catalog.map((variable) => {
    if (seen.has(variable.path)) {
      throw new ConfigError(
        `Template kind "${definition.kind}" lists variable "${variable.path}" twice`,
      );
    }
    seen.add(variable.path);
    if (variable.format) formats.set(variable.path, variable.format);
    if (variable.sample !== undefined) setPath(sampleData, variable.path, variable.sample);
    return checkVariable(definition.kind, variable);
  });
  return {
    kind: definition.kind,
    label: definition.label,
    description: definition.description ?? null,
    catalog: [...catalog, ...brandVariables],
    formats,
    baseTemplate: definition.baseTemplate ?? null,
    sampleData: definition.sampleData ?? sampleData,
    requireSignature: definition.requireSignature ?? false,
  };
}
