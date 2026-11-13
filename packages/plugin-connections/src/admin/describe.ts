import { z } from "zod";

import { CREDENTIAL_KINDS } from "../provider";

import type { AnyProvider, CredentialKind, ProviderLogo } from "../provider";

/** A metadata field of the connection form, derived from the provider's Zod schema. */
export interface FieldView {
  key: string;
  label: string;
  description: string | null;
  placeholder: string | null;
  control: "text" | "number" | "checkbox" | "select" | "json";
  options: string[];
  required: boolean;
  default: unknown;
  min: number | null;
  max: number | null;
}

/** What the admin shows of a provider. Plain data, so client components can take it. */
export interface ProviderView {
  type: string;
  label: string;
  category: string;
  description: string;
  logo: ProviderLogo | null;
  capabilities: string[];
  baseUrl: { required: boolean; default: string | null; placeholder: string | null };
  credential: { required: boolean; kinds: CredentialKind[] };
  fields: FieldView[];
  testable: boolean;
}

interface JsonSchemaNode {
  type?: string | string[];
  enum?: unknown[];
  title?: string;
  description?: string;
  placeholder?: unknown;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  anyOf?: JsonSchemaNode[];
}

function humanize(key: string): string {
  const words = key
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/([a-z\d])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function controlOf(node: JsonSchemaNode): FieldView["control"] {
  if (Array.isArray(node.enum) && node.enum.every((value) => typeof value === "string")) {
    return "select";
  }
  const type = Array.isArray(node.type) ? node.type.find((t) => t !== "null") : node.type;
  switch (type) {
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "checkbox";
    case "array":
    case "object":
      return "json";
    default:
      return "text";
  }
}

/** Form fields of a metadata schema. Non-object schemas give one JSON field per key. */
export function describeFields(schema: z.ZodType): FieldView[] {
  let root: JsonSchemaNode;
  try {
    root = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonSchemaNode;
  } catch {
    return [];
  }
  const required = new Set(root.required ?? []);
  return Object.entries(root.properties ?? {}).map(([key, raw]) => {
    const node = raw.anyOf?.find((option) => option.type !== "null") ?? raw;
    const merged: JsonSchemaNode = { ...node, ...raw };
    const control = controlOf(node);
    return {
      key,
      label: merged.title ?? humanize(key),
      description: merged.description ?? null,
      placeholder: typeof merged.placeholder === "string" ? merged.placeholder : null,
      control,
      options:
        control === "select"
          ? (node.enum ?? []).filter((v): v is string => typeof v === "string")
          : [],
      required: required.has(key) && merged.default === undefined,
      default: merged.default,
      min: node.minimum ?? null,
      max: node.maximum ?? null,
    };
  });
}

/** Plain data of a provider for the admin. */
export function describeProvider(provider: AnyProvider): ProviderView {
  return {
    type: provider.type,
    label: provider.label,
    category: provider.category,
    description: provider.description,
    logo: provider.logo ?? null,
    capabilities: [...provider.capabilities],
    baseUrl: {
      required: provider.baseUrl.required,
      default: provider.baseUrl.default ?? null,
      placeholder: provider.baseUrl.placeholder ?? provider.baseUrl.default ?? null,
    },
    credential: { required: provider.credential.required, kinds: [...provider.credential.kinds] },
    fields: describeFields(provider.fields),
    testable: provider.test !== undefined,
  };
}

/** The label of a credential kind. */
export function kindLabel(kind: string): string {
  return CREDENTIAL_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

/**
 * Metadata from a submitted form: fields named `metadata.<key>`, converted by control type.
 * Empty text stays out, so the schema default applies. Invalid JSON is kept as text, so the
 * schema reports it.
 */
export function metadataFromForm(
  fields: readonly FieldView[],
  formData: FormData,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const field of fields) {
    const name = `metadata.${field.key}`;
    if (field.control === "checkbox") {
      metadata[field.key] = formData.get(name) === "on";
      continue;
    }
    const value = formData.get(name);
    if (typeof value !== "string" || value.trim() === "") continue;
    if (field.control === "number") {
      const number = Number(value);
      metadata[field.key] = Number.isFinite(number) ? number : value;
    } else if (field.control === "json") {
      try {
        metadata[field.key] = JSON.parse(value) as unknown;
      } catch {
        metadata[field.key] = value;
      }
    } else {
      metadata[field.key] = value.trim();
    }
  }
  return metadata;
}
