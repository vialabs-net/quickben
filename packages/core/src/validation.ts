import { z } from "zod";

import { ValidationError } from "./errors";

import type { QuickbenUser } from "./auth";
import type { ValidationIssue } from "./errors";
import type { AnyField, FieldValidator } from "./fields";
import type { SanitizedCollection } from "./types";

const dateInput = z.union([z.date(), z.iso.date(), z.iso.datetime({ offset: true })]);
const datetimeInput = z.union([z.date(), z.iso.datetime({ offset: true }), z.iso.date()]);

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function validDate(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

/** Zod schema of one field value, without the null/optional wrapper. */
export function fieldValueSchema(field: AnyField): z.ZodType {
  switch (field.type) {
    case "text":
    case "textarea":
      return withLength(z.string(), field.minLength, field.maxLength);
    case "email":
      return withLength(z.email(), field.minLength, field.maxLength);
    case "url":
      return withLength(z.url({ protocol: /^https?$/ }), field.minLength, field.maxLength);
    case "number": {
      let schema = field.integer ? z.int() : z.number();
      if (field.min !== undefined) schema = schema.min(field.min);
      if (field.max !== undefined) schema = schema.max(field.max);
      return schema;
    }
    case "boolean":
      return z.boolean();
    case "date":
      return dateInput
        .transform(toDate)
        .refine(validDate, "Invalid date")
        .transform((date) => date.toISOString().slice(0, 10));
    case "datetime":
      return datetimeInput
        .transform(toDate)
        .refine(validDate, "Invalid date")
        .transform((date) => date.toISOString());
    case "select": {
      const option = z.enum(field.options as [string, ...string[]]);
      return field.many ? uniqueArray(option, field.required) : option;
    }
    case "relation": {
      const id = z.string().min(1);
      return field.many ? uniqueArray(id, field.required) : id;
    }
    case "json":
      return field.schema ?? z.json();
  }
}

function withLength(schema: z.ZodString | z.ZodEmail | z.ZodURL, min?: number, max?: number) {
  let result = schema;
  if (min !== undefined) result = result.min(min);
  if (max !== undefined) result = result.max(max);
  return result;
}

function uniqueArray(item: z.ZodType, required: boolean) {
  const schema = z.array(item).refine((values) => new Set(values).size === values.length, {
    message: "Values must be unique",
  });
  return required
    ? schema.refine((values) => values.length > 0, "At least one value is required")
    : schema;
}

/** Zod schema for create (`partial = false`) or update (`partial = true`) data. */
export function dataSchema(collection: SanitizedCollection, partial: boolean): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const field of collection.fieldList) {
    const value = fieldValueSchema(field);
    const nullable = !field.required && !field.many;
    let schema: z.ZodType = nullable ? value.nullable() : value;
    if (partial || !field.required) schema = schema.optional();
    shape[field.name] = schema;
  }
  if (!partial) shape.id = z.string().min(1).max(255).optional();
  return z.strictObject(shape);
}

const schemaCache = new WeakMap<SanitizedCollection, { create: z.ZodType; update: z.ZodType }>();

function schemasFor(collection: SanitizedCollection) {
  let schemas = schemaCache.get(collection);
  if (!schemas) {
    schemas = { create: dataSchema(collection, false), update: dataSchema(collection, true) };
    schemaCache.set(collection, schemas);
  }
  return schemas;
}

/** Context of {@link validateData}. */
export interface ValidateDataArgs {
  collection: SanitizedCollection;
  operation: "create" | "update";
  data: unknown;
  original: Record<string, unknown> | null;
  user: QuickbenUser | null;
}

/**
 * Validate create or update data: Zod checks first, then each field's `validate`.
 * Returns parsed data (dates normalized). Throws `ValidationError` with every issue.
 */
export async function validateData(args: ValidateDataArgs): Promise<Record<string, unknown>> {
  const { collection, operation, original, user } = args;
  const schemas = schemasFor(collection);
  const result = (operation === "create" ? schemas.create : schemas.update).safeParse(args.data);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  const data = result.data as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  for (const field of collection.fieldList) {
    const value = data[field.name];
    if (!field.validate || value === undefined || value === null) continue;
    const validate = field.validate as FieldValidator<unknown>;
    const outcome = await validate(value, { operation, data, original, user });
    if (outcome !== true) issues.push({ path: field.name, message: outcome });
  }
  if (issues.length > 0) throw new ValidationError(issues);
  return data;
}
