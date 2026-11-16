/**
 * The narrow interface between the doc reader and wherever models and their credentials live
 * (for example `@quickben/plugin-connections`). The reader never sees a key: it gets a ready
 * language model plus the prices to bill it with.
 */
import type { Quickben } from "@quickben/core";
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
  /** USD per million cached input tokens. Absent: cached input costs the input price. */
  readonly cachedInputPerMTokUsd?: number;
}

/** A connection's model, ready for a call. */
export interface ResolvedModel {
  readonly connection: { readonly id: string; readonly name?: string };
  readonly model: ModelInfo;
  readonly languageModel: LanguageModel;
}

/**
 * Resolve a connection and one of its models; no `modelId` means the connection's default.
 * `qb` is the instance the plugin runs in. Throw a `QuickbenError` (its message is shown) when
 * the connection cannot be used.
 */
export type ResolveModel = (
  connectionId: string,
  modelId: string | undefined,
  qb: Quickben,
) => Promise<ResolvedModel>;

/** A connection and its vision models, for the admin's pickers. */
export interface ModelChoice {
  readonly connectionId: string;
  readonly connectionName: string;
  readonly models: readonly { readonly id: string; readonly label?: string }[];
}

/** Lists connections with vision models, for the admin's pickers. */
export type ListModels = (qb: Quickben) => Promise<readonly ModelChoice[]>;

/**
 * USD for one call, from the model's prices per million tokens, rounded to micro-dollars.
 * `cachedInputTokens` are part of `inputTokens` and billed at the cached price when the model
 * has one.
 */
export function callCost(
  model: Pick<ModelInfo, "inputPerMTokUsd" | "outputPerMTokUsd" | "cachedInputPerMTokUsd">,
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
    1e6;
  return Math.round(usd * 1e6) / 1e6;
}
