/**
 * The narrow interface between the doc reader and wherever models and their credentials live
 * (for example `@quickben/plugin-connections`). The reader never sees a key: it gets a ready
 * language model plus the prices to bill it with.
 */
import type { LanguageModel } from "ai";

/** A model a connection offers, with what the reader needs to know about it. */
export interface ModelInfo {
  readonly id: string;
  readonly label?: string;
  /** Reads images. A `vision-llm` step refuses a model without it. */
  readonly vision: boolean;
  /** Supports structured outputs (JSON schema). Without it the reply is parsed as JSON. */
  readonly structuredOutput: boolean;
  /** Most pages sent in one call. */
  readonly maxPages: number;
  readonly inputPerMTokUsd: number;
  readonly outputPerMTokUsd: number;
}

/** A connection's model, ready for a call. */
export interface ResolvedModel {
  readonly connection: { readonly id: string; readonly name?: string };
  readonly model: ModelInfo;
  readonly languageModel: LanguageModel;
}

/**
 * Resolve a connection and one of its models; no `modelId` means the connection's default.
 * Throw a `QuickbenError` (its message is shown) when the connection cannot be used.
 */
export type ResolveModel = (connectionId: string, modelId?: string) => Promise<ResolvedModel>;

/** A connection and its vision models, for the admin's pickers. */
export interface ModelChoice {
  readonly connectionId: string;
  readonly connectionName: string;
  readonly models: readonly { readonly id: string; readonly label?: string }[];
}

/** Lists connections with vision models, for the admin's pickers. */
export type ListModels = () => Promise<readonly ModelChoice[]>;

/** USD for one call, from the model's prices per million tokens, rounded to micro-dollars. */
export function callCost(
  model: Pick<ModelInfo, "inputPerMTokUsd" | "outputPerMTokUsd">,
  inputTokens: number,
  outputTokens: number,
): number {
  const usd = (inputTokens * model.inputPerMTokUsd + outputTokens * model.outputPerMTokUsd) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}
