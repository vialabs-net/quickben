import { definePlugin } from "@quickben/core";

import { connectionsCollection, credentialsCollection } from "./collections";
import { register, resolveOptions } from "./options";

import type { ConnectionsCollection, CredentialsCollection } from "./collections";
import type { ConnectionsOptions } from "./options";
import type { llmModelSchema, LlmModel, ModelSchema } from "./providers/shared";
import type { Plugin } from "@quickben/core";
import type { z } from "zod";

/**
 * The plugin returned by {@link connections}. `TModel` is the type of one model entry; read it
 * with `ModelOf<typeof plugin>`.
 */
export type ConnectionsPlugin<TModel extends LlmModel = LlmModel> = Plugin<
  CredentialsCollection | ConnectionsCollection
> & { readonly "~model"?: TModel };

/** The model entry type of a connections plugin: `ModelOf<typeof plugin>`. */
export type ModelOf<P> = P extends ConnectionsPlugin<infer M> ? M : LlmModel;

/**
 * Connections and credentials. Adds the `credentials` collection (encrypted secrets that no
 * read returns) and the `connections` collection (a provider endpoint, its settings and the
 * credential it uses).
 *
 * ```ts
 * connections({ masterKey: process.env.QUICKBEN_MASTER_KEY });
 * ```
 */
export function connections<S extends ModelSchema = typeof llmModelSchema>(
  options: ConnectionsOptions & { modelSchema?: (base: typeof llmModelSchema) => S } = {},
): ConnectionsPlugin<z.output<S>> {
  const state = resolveOptions(options);
  return definePlugin({
    name: "connections",
    collections: [credentialsCollection(state), connectionsCollection(state)],
    onInit: (qb) => {
      register(qb.config, state);
    },
  });
}
