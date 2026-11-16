import { Validator } from "@seriousme/openapi-schema-validator";

/** Validate a document against the OpenAPI 3.1 schema (bundled, no network). */
export async function validateOpenApi(doc: unknown): Promise<{ valid: boolean; errors: unknown }> {
  const validator = new Validator();
  const result = await validator.validate(doc as Record<string, unknown>);
  return { valid: result.valid, errors: result.errors };
}
