import { z } from "zod";

import type { AnyProvider, TestResult } from "../provider";

/** `https://x/v1/` → `https://x/v1`. */
export function trimSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
}

/** Join a base URL and a path that starts with `/`. */
export function joinUrl(base: string, path: string): string {
  return `${trimSlashes(base.trim())}${path}`;
}

/** The tester's own text for an HTTP status. Never the provider's message. */
export function statusError(label: string, status: number): string {
  if (status === 401) return `${label} rejected the credential (HTTP 401).`;
  if (status === 403) return `${label} refused access: the credential lacks permission (HTTP 403).`;
  if (status === 404) return `${label} answered HTTP 404. Check the base URL and the model.`;
  if (status === 429) return `${label} is rate limiting requests (HTTP 429).`;
  return `${label} answered HTTP ${String(status)}.`;
}

/** A test result from a response: success for 2xx. */
export function fromStatus(label: string, response: Response, model?: string): TestResult {
  const extra = model === undefined ? {} : { model };
  return response.ok
    ? { ok: true, ...extra }
    : { ok: false, error: statusError(label, response.status), ...extra };
}

const price = z.number().min(0).max(10_000);

/** One model of an LLM connection. */
export const llmModelSchema = z.object({
  id: z.string().trim().min(1).max(200),
  label: z.string().trim().max(200).default(""),
  /** Reads images. */
  vision: z.boolean().default(false),
  /** Returns JSON that follows a schema. */
  structuredOutput: z.boolean().default(true),
  /** USD per million input tokens. */
  inputPerMTokUsd: price.default(0),
  /** USD per million output tokens. */
  outputPerMTokUsd: price.default(0),
  /** The model used when a caller does not name one. At most one. */
  default: z.boolean().default(false),
});

/** A model of an LLM connection, defaults filled. */
export type LlmModel = z.output<typeof llmModelSchema>;

/** A schema of one model: {@link llmModelSchema}, or an extension of it. */
export type ModelSchema<M extends LlmModel = LlmModel> = z.ZodType<M>;

/** The `models` list for a model schema: unique ids, at most one default. */
export function modelListSchema<S extends ModelSchema>(schema: S) {
  return z
    .array(schema)
    .max(100)
    .superRefine((list, ctx) => {
      const ids = new Set<string>();
      for (const [index, model] of list.entries()) {
        if (ids.has(model.id)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "id"],
            message: `Duplicate model ${model.id}`,
          });
        }
        ids.add(model.id);
      }
      if (list.filter((model) => model.default).length > 1) {
        ctx.addIssue({ code: "custom", message: "Only one model can be the default" });
      }
    });
}

/** The `models` list of an LLM connection: unique ids, at most one default. */
export const llmModelsSchema = modelListSchema(llmModelSchema);

/** Metadata of the built-in LLM providers. */
export const llmFields = z.object({
  models: llmModelsSchema.default([]).meta({
    title: "Models",
    description: "Models callers may use. One row per model; at most one is the default.",
  }),
});

/**
 * The model to use: the one asked for, else the default, else the first. `schema` parses the
 * entries (default {@link llmModelSchema}); pass your extended schema to keep its keys.
 */
export function pickModel<M extends LlmModel = LlmModel>(
  metadata: unknown,
  requested?: string,
  schema: ModelSchema<M> = llmModelSchema as unknown as ModelSchema<M>,
): M | undefined {
  const parsed = z.array(schema).safeParse((metadata as { models?: unknown } | null)?.models ?? []);
  const models = parsed.success ? parsed.data : [];
  if (requested !== undefined) return models.find((model) => model.id === requested);
  return models.find((model) => model.default) ?? models[0];
}

/** The model a test calls: the one asked for, the connection's default, or `fallback`. */
export function testModel(
  metadata: unknown,
  requested: string | undefined,
  fallback: string | undefined,
): string | undefined {
  return requested ?? pickModel(metadata)?.id ?? fallback;
}

/** The secret of a test context, or a failed result when there is none. */
export function requireSecret(
  label: string,
  credential: { secret: string } | null,
): { secret: string } | { result: TestResult } {
  return credential
    ? { secret: credential.secret }
    : { result: { ok: false, error: `${label} needs a credential.` } };
}

/** JSON request headers. */
export const jsonHeaders = { accept: "application/json", "content-type": "application/json" };

/**
 * Use `schema` for the `models` of a built-in LLM provider. Other providers are returned as
 * they are.
 */
export function withModelSchema<P extends AnyProvider>(provider: P, schema: ModelSchema): P {
  const fields = provider.fields;
  if (!provider.capabilities.includes("llm") || !(fields instanceof z.ZodObject)) return provider;
  const models = (fields.shape as Record<string, z.ZodType | undefined>).models;
  if (!models) return provider;
  return {
    ...provider,
    fields: fields.extend({
      models: modelListSchema(schema)
        .default([])
        .meta(models.meta() ?? {}),
    }),
  };
}
