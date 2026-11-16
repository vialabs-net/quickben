import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { createOpenAI } from "@ai-sdk/openai";

import { getConnection, systemContext } from "./api";
import { ConnectionError } from "./errors";
import { getConnectionsOptions } from "./options";
import { parseServiceAccount } from "./providers/google-auth";
import { llmModelSchema, pickModel } from "./providers/shared";

import type { ConnectionRecord, ResolvedConnection } from "./api";
import type { LlmModel, ModelSchema } from "./providers/shared";
import type { Quickben, RequestContext } from "@quickben/core";
import type { LanguageModel } from "ai";

/** Builds an AI SDK model for one provider type. */
export type LanguageModelFactory = (resolved: ResolvedConnection, modelId: string) => LanguageModel;

const text = (value: unknown) =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

const baseURL = (resolved: ResolvedConnection) => resolved.baseUrl ?? undefined;
const apiKey = (resolved: ResolvedConnection) => resolved.credential?.secret;

function vertexModel(resolved: ResolvedConnection, modelId: string): LanguageModel {
  const { credential, metadata } = resolved;
  // Never fall back to the server's own Google credentials (ADC): their token must not reach
  // a URL typed in the admin. The provider requires a credential; check again here.
  if (!credential) throw new ConnectionError("no-credential", "Vertex AI needs a credential");
  if (credential.kind === "api_key") {
    return createVertex({ apiKey: credential.secret, baseURL: baseURL(resolved) })(modelId);
  }
  const account = parseServiceAccount(credential.secret);
  if (!account)
    throw new ConnectionError("wrong-kind", "The credential is not a service account key");
  return createVertex({
    project: text(metadata.project) ?? account.project_id,
    location: text(metadata.location) ?? "us-central1",
    baseURL: baseURL(resolved),
    googleAuthOptions: {
      credentials: { client_email: account.client_email, private_key: account.private_key },
    },
  })(modelId);
}

/** AI SDK factories of the built-in LLM providers, by provider type. */
export const languageModelFactories: Readonly<Record<string, LanguageModelFactory>> = {
  anthropic: (resolved, modelId) =>
    createAnthropic({ apiKey: apiKey(resolved), baseURL: baseURL(resolved) })(modelId),
  // Chat Completions: the one API every OpenAI-compatible gateway serves.
  openai_compatible: (resolved, modelId) =>
    createOpenAI({ apiKey: apiKey(resolved) ?? "", baseURL: baseURL(resolved) }).chat(modelId),
  google: (resolved, modelId) =>
    createGoogleGenerativeAI({ apiKey: apiKey(resolved), baseURL: baseURL(resolved) })(modelId),
  vertex: vertexModel,
};

/** Options of {@link resolveLanguageModel}. */
export interface LanguageModelOptions {
  /** A model id from the connection's `models`. Default: its default model, else the first. */
  model?: string;
  /** Who may read the connection. Default: trusted server code. */
  ctx?: RequestContext;
  /** Factories for your own provider types; they override the built-in ones. */
  factories?: Readonly<Record<string, LanguageModelFactory>>;
}

/**
 * A connection's LLM, ready for `generateText` and friends. `TModel` is the model entry type,
 * for a `modelSchema`: `resolveLanguageModel<ModelOf<typeof plugin>>(…)`.
 */
export interface ResolvedLanguageModel<TModel extends LlmModel = LlmModel> {
  readonly connection: ConnectionRecord;
  /** The model entry from the connection's metadata (prices, vision, keys of `modelSchema`). */
  readonly model: TModel;
  readonly languageModel: LanguageModel;
}

/**
 * An AI SDK language model from a connection. Server code only: the model carries the
 * decrypted key.
 *
 * ```ts
 * const { languageModel } = await resolveLanguageModel(qb, connectionId);
 * await generateText({ model: languageModel, prompt: "…" });
 * ```
 */
export async function resolveLanguageModel<TModel extends LlmModel = LlmModel>(
  qb: Quickben,
  connectionId: string,
  options: LanguageModelOptions = {},
): Promise<ResolvedLanguageModel<TModel>> {
  const resolved = await getConnection(qb, connectionId, options.ctx ?? systemContext);
  const { connection, provider } = resolved;
  const factory = options.factories?.[provider.type] ?? languageModelFactories[provider.type];
  if (!provider.capabilities.includes("llm") || !factory) {
    throw new ConnectionError("not-llm", `Connection "${connection.name}" is not an LLM`);
  }
  const schema = (getConnectionsOptions(qb).modelSchema ?? llmModelSchema) as ModelSchema<TModel>;
  const model = pickModel(resolved.metadata, options.model, schema);
  if (!model) {
    throw new ConnectionError(
      "no-model",
      options.model === undefined
        ? `Connection "${connection.name}" has no models`
        : `Model ${options.model} is not in connection "${connection.name}"`,
    );
  }
  return { connection, model, languageModel: factory(resolved, model.id) };
}

/**
 * USD for one call, from the model's prices per million tokens. `cachedInputTokens` are part of
 * `inputTokens`, billed at `cachedInputPerMTokUsd` when the model has it.
 */
export function callCost(
  model: Pick<LlmModel, "inputPerMTokUsd" | "outputPerMTokUsd" | "cachedInputPerMTokUsd">,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
): number {
  const cached = Math.min(Math.max(0, cachedInputTokens), inputTokens);
  const cachedPrice = model.cachedInputPerMTokUsd ?? model.inputPerMTokUsd;
  const usd =
    ((inputTokens - cached) * model.inputPerMTokUsd +
      cached * cachedPrice +
      outputTokens * model.outputPerMTokUsd) /
    1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}
