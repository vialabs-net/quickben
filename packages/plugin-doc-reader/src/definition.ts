/**
 * A document type: what to read from one kind of document and how.
 *
 * Types are data. They are stored as versions in `doc-types` and edited in the admin, so
 * everything here must survive a JSON round trip.
 */
import { z } from "zod";

/** Value types of a field. They decide how a read value is normalized and compared. */
export const FIELD_TYPES = ["text", "date", "number", "email", "phone"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Text changes applied before `pattern` is checked. */
export const FIELD_TRANSFORMS = ["upper", "compact"] as const;
export type FieldTransform = (typeof FIELD_TRANSFORMS)[number];

export function isValidPattern(pattern: string): boolean {
  try {
    new RegExp(pattern, "iu");
    return true;
  } catch {
    return false;
  }
}

const KEY = /^[a-z][a-zA-Z\d]*$/;
/** Lowercase words joined by `-`. */
export const TYPE_KEY = /^[a-z][a-z\d]*(?:-[a-z\d]+)*$/;

const pattern = z.string().max(500).refine(isValidPattern, "invalid regular expression");

export const fieldSchema = z.object({
  key: z.string().max(64).regex(KEY, "camelCase, starting with a letter"),
  label: z.string().trim().min(1).max(120),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  /** What the field means, for people and for LLM extractors. */
  description: z.string().max(500).optional(),
  /** `upper`: uppercase. `compact`: uppercase without spaces, dots and dashes (codes, plates). */
  transform: z.enum(FIELD_TRANSFORMS).optional(),
  /** A value must match this regular expression (case-insensitive) after `transform`. */
  pattern: pattern.optional(),
  /** How `date` fields are printed when the year comes last. Default `dmy`. */
  dateOrder: z.enum(["dmy", "mdy"]).optional(),
  /** Decimal separator of `number` fields as printed. Default `.`. */
  decimalSeparator: z.enum([".", ","]).optional(),
});
export type FieldDefinition = z.infer<typeof fieldSchema>;

export const paramSchema = z.object({
  key: z.string().max(64).regex(KEY, "camelCase, starting with a letter"),
  label: z.string().trim().min(1).max(120),
  type: z.enum(["string", "string-list"]),
  description: z.string().max(500).optional(),
  /**
   * Field keys whose value can never be one of this parameter's values, e.g. the issuer's own
   * tax id on an invoice it issued. Matching values are dropped.
   */
  excludes: z.array(z.string()).default([]),
});
export type ParamDefinition = z.infer<typeof paramSchema>;

export const stepSchema = z.object({
  /** Extractor key, e.g. `text-layer` or `vision-llm`. */
  extractor: z.string().min(1).max(64),
  /** Extractor settings, e.g. `{ template: "invoice" }` or `{ connectionId, model }`. */
  config: z.record(z.string(), z.unknown()).default({}),
});
export type PipelineStep = z.infer<typeof stepSchema>;

export const pipelineSchema = z.object({
  steps: z.array(stepSchema).min(1).max(10),
  /** A field counts as read at or above this confidence. */
  threshold: z.number().min(0).max(1).default(0.8),
  /** When to stop: `required` once every required field is read, `all` once every field is. */
  stopWhen: z.enum(["required", "all"]).default("required"),
});
export type Pipeline = z.infer<typeof pipelineSchema>;

export const classificationSchema = z.object({
  /** Regular expressions over the first page's text; any match counts. */
  text: z.array(pattern).default([]),
  /** Regular expressions over the file name, used when there is no text. */
  fileName: z.array(pattern).default([]),
});

export const documentTypeSchema = z
  .object({
    key: z.string().max(64).regex(TYPE_KEY, "lowercase words joined by -"),
    version: z.number().int().min(1),
    label: z.string().trim().min(1).max(120),
    state: z.enum(["draft", "published"]).default("draft"),
    description: z.string().max(1000).optional(),
    fields: z.array(fieldSchema).min(1).max(100),
    classification: classificationSchema.default({ text: [], fileName: [] }),
    /** 1-based pages to read. */
    pages: z.array(z.number().int().min(1)).min(1).max(50).default([1]),
    params: z.array(paramSchema).default([]),
    /** Extra prompt text for LLM extractors. */
    instructions: z.string().max(5000).default(""),
    pipeline: pipelineSchema,
  })
  .superRefine((type, ctx) => {
    const seen = new Set<string>();
    type.fields.forEach((field, index) => {
      if (seen.has(field.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["fields", index, "key"],
          message: `duplicate field ${field.key}`,
        });
      }
      seen.add(field.key);
    });
    const params = new Set<string>();
    type.params.forEach((param, index) => {
      if (params.has(param.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["params", index, "key"],
          message: `duplicate parameter ${param.key}`,
        });
      }
      params.add(param.key);
      param.excludes.forEach((key, at) => {
        if (!seen.has(key)) {
          ctx.addIssue({
            code: "custom",
            path: ["params", index, "excludes", at],
            message: `unknown field ${key}`,
          });
        }
      });
    });
  });

export type DocumentType = z.infer<typeof documentTypeSchema>;
/** A type as written by hand: defaults may be left out. */
export type DocumentTypeInput = z.input<typeof documentTypeSchema>;

/** Parse and fill defaults. Throws a `ZodError` that lists every problem. */
export function parseDocumentType(input: unknown): DocumentType {
  return documentTypeSchema.parse(input);
}

export function requiredFields(type: DocumentType): string[] {
  return type.fields.filter((field) => field.required).map((field) => field.key);
}

/** Caller parameters, as every extractor accepts them: strings or string lists. */
export type ExtractionParams = Readonly<Record<string, string | readonly string[] | undefined>>;

/** A list parameter, tolerating a single string. */
export function listParam(params: ExtractionParams, key: string): string[] {
  const value = Object.hasOwn(params, key) ? params[key] : undefined;
  if (value === undefined) return [];
  return typeof value === "string" ? [value] : [...value];
}

export const paramsSchema = z.record(
  z.string().max(64),
  z.union([z.string().max(2000), z.array(z.string().max(2000)).max(100)]),
);
