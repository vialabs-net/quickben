/**
 * `@quickben/plugin-doc-reader/connections`: models from `@quickben/plugin-connections`.
 *
 * ```ts
 * docReader({ ...connectionModels() })
 * ```
 */
import { findConnectionsByCapability } from "@quickben/plugin-connections";
import { resolveLanguageModel } from "@quickben/plugin-connections/ai";

import type { ListModels, ModelChoice, ResolveModel } from "./models";
import type { LanguageModelFactory } from "@quickben/plugin-connections/ai";

/** Options of {@link connectionModels}. */
export interface ConnectionModelsOptions {
  /** Pages sent in one call. Connections do not store it. Default 4. */
  maxPages?: number;
  /** Factories for your own provider types, passed to `resolveLanguageModel`. */
  factories?: Readonly<Record<string, LanguageModelFactory>>;
}

interface StoredModel {
  id?: unknown;
  label?: unknown;
  vision?: unknown;
}

/** Vision models listed in a connection's metadata. */
function visionModels(metadata: Readonly<Record<string, unknown>>): ModelChoice["models"] {
  const models = Array.isArray(metadata.models) ? (metadata.models as StoredModel[]) : [];
  return models.flatMap((model) =>
    typeof model.id === "string" && model.vision === true
      ? [
          {
            id: model.id,
            ...(typeof model.label === "string" && model.label ? { label: model.label } : {}),
          },
        ]
      : [],
  );
}

/**
 * `resolveModel` and `listModels` backed by `@quickben/plugin-connections`. Add the connections
 * plugin to the same config. Keys stay in the connections plugin; the reader gets a ready model
 * and its prices.
 */
export function connectionModels(options: ConnectionModelsOptions = {}): {
  resolveModel: ResolveModel;
  listModels: ListModels;
} {
  const maxPages = options.maxPages ?? 4;
  return {
    resolveModel: async (connectionId, modelId, qb) => {
      const resolved = await resolveLanguageModel(qb, connectionId, {
        ...(modelId === undefined ? {} : { model: modelId }),
        ...(options.factories ? { factories: options.factories } : {}),
      });
      const { connection, model } = resolved;
      return {
        connection: { id: connection.id, name: connection.name },
        model: {
          id: model.id,
          ...(model.label ? { label: model.label } : {}),
          vision: model.vision,
          structuredOutput: model.structuredOutput,
          maxPages,
          inputPerMTokUsd: model.inputPerMTokUsd,
          outputPerMTokUsd: model.outputPerMTokUsd,
        },
        languageModel: resolved.languageModel,
      };
    },
    listModels: async (qb) => {
      const connections = await findConnectionsByCapability(qb, "llm");
      return connections.flatMap((connection) => {
        const models = visionModels(connection.metadata);
        return models.length > 0
          ? [{ connectionId: connection.id, connectionName: connection.name, models }]
          : [];
      });
    },
  };
}
